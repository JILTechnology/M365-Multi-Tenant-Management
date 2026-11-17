// Runs real Chromium editing commands against disposable local pages and sessions.
// No tenant profile or remote site is loaded. Clipboard buffers stay in memory.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const projectPath = path.resolve(path.dirname(scriptPath), '..');

if (!process.versions.electron) {
  const { stripTypeScriptTypes } = await import('node:module');
  const { spawn } = await import('node:child_process');
  const { default: electronPath } = await import('electron');
  const fixturePath = await fs.mkdtemp(path.join(os.tmpdir(), 'm365-editing-smoke-'));
  try {
    const source = await fs.readFile(path.join(projectPath, 'src/main/editing-menu.ts'), 'utf8');
    await fs.writeFile(path.join(fixturePath, 'editing-menu.mjs'), stripTypeScriptTypes(source));
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(electronPath, [scriptPath, fixturePath], {
      env, stdio: 'inherit', windowsHide: true,
    });
    const timer = setTimeout(() => {
      process.stderr.write('Electron editing smoke test exceeded 60 seconds.\n');
      child.kill();
    }, 60_000);
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (exitCode) => resolve(exitCode ?? 1));
    });
    clearTimeout(timer);
    process.exitCode = code;
  } finally {
    // mkdtemp returned this unique fixture directory; never remove an app profile.
    await fs.rm(fixturePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
} else {
  process.stdout.write('Starting isolated Electron editing checks.\n');
  const { app, BrowserWindow, WebContentsView, Menu, clipboard } = await import('electron');
  const fixturePath = process.argv[2];
  app.setPath('userData', path.join(fixturePath, 'profile'));
  // Do not await ready at ESM top level: Electron waits for the module first.
  void app.whenReady().then(async () => {
  const { installApplicationEditMenu, installEditingContextMenu } = await import(
    pathToFileURL(path.join(fixturePath, 'editing-menu.mjs')).href
  );
  const savedClipboard = clipboard.availableFormats().map((format) => [format, clipboard.readBuffer(format)]);
  const marker = 'M365 editing smoke fixture';
  const passed = [];
  let capturedMenu;
  const originalPopup = Menu.prototype.popup;
  Menu.prototype.popup = function (options) {
    capturedMenu = { menu: this, options };
  };

  const pause = () => new Promise((resolve) => setTimeout(resolve, 30));
  async function until(check, description) {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      if (await check()) return;
      await pause();
    }
    throw new Error(description);
  }
  async function shortcut(contents, keyCode, modifiers = ['control']) {
    contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    contents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await pause();
  }
  const html = `<style>textarea {width:300px;height:80px;display:block;margin:10px} iframe {display:block;width:360px;height:160px}</style>
    <textarea id="source">${marker}</textarea><textarea id="destination"></textarea>
    <p id="selection">${marker}</p><input id="readonly" readonly value="Read only">
    <iframe srcdoc='<textarea id="source">${marker}</textarea><textarea id="destination"></textarea>'></iframe>`;
  const page = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);

  async function exercise(window, contents, name) {
    window.show();
    window.focus();
    contents.focus();
    const run = (expression) => contents.executeJavaScript(expression);
    await run('document.querySelector("#source").focus(); document.querySelector("#source").select()');
    clipboard.writeText('M365 editing smoke sentinel');
    await shortcut(contents, 'C');
    await until(() => clipboard.readText() === marker, `${name}: Ctrl+C failed`);
    await run('document.querySelector("#destination").focus()');
    await shortcut(contents, 'V');
    await until(() => run(`document.querySelector('#destination').value === ${JSON.stringify(marker)}`), `${name}: Ctrl+V failed`);
    await shortcut(contents, 'A');
    await shortcut(contents, 'X');
    await until(() => run('document.querySelector("#destination").value === ""'), `${name}: Ctrl+A / Ctrl+X failed`);
    await shortcut(contents, 'Z');
    await until(() => run(`document.querySelector('#destination').value === ${JSON.stringify(marker)}`), `${name}: Ctrl+Z failed`);
    passed.push(`${name}: copy, paste, select all, cut, undo shortcuts`);

    async function contextMenu(selector) {
      capturedMenu = undefined;
      const point = await run(`(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        element.focus();
        const rect = element.getBoundingClientRect();
        return {x: Math.round(rect.x + 8), y: Math.round(rect.y + 8)};
      })()`);
      contents.sendInputEvent({ type: 'mouseDown', button: 'right', clickCount: 1, ...point });
      contents.sendInputEvent({ type: 'mouseUp', button: 'right', clickCount: 1, ...point });
      await until(() => Boolean(capturedMenu), `${name}: right-click did not open a menu`);
      assert.equal(capturedMenu.options.window, window);
      return capturedMenu.menu;
    }
    const menu = await contextMenu('#source');
    await run('document.querySelector("#source").select()');
    const copy = menu.items.find((item) => item.role === 'copy');
    const paste = menu.items.find((item) => item.role === 'paste');
    assert.ok(copy && paste, `${name}: copy/paste items missing`);
    assert.ok(copy.enabled && paste.enabled, `${name}: copy/paste items disabled`);
    clipboard.writeText('M365 editing smoke sentinel');
    copy.click({}, window, contents);
    await until(() => clipboard.readText() === marker, `${name}: context-menu Copy failed`);
    await run('document.querySelector("#destination").value = ""');
    const destinationMenu = await contextMenu('#destination');
    destinationMenu.items.find((item) => item.role === 'paste').click({}, window, contents);
    await until(() => run(`document.querySelector('#destination').value === ${JSON.stringify(marker)}`), `${name}: context-menu Paste failed`);
    const readonlyMenu = await contextMenu('#readonly');
    assert.ok(!readonlyMenu.items.find((item) => item.role === 'paste')?.enabled, `${name}: read-only input offers Paste`);
    passed.push(`${name}: right-click copy/paste and read-only input`);

    await run('document.querySelector("iframe").contentDocument.querySelector("#source").focus(); document.querySelector("iframe").contentDocument.querySelector("#source").select()');
    clipboard.writeText('M365 editing smoke sentinel');
    await shortcut(contents, 'C');
    await until(() => clipboard.readText() === marker, `${name}: iframe Ctrl+C failed`);
    await run('document.querySelector("iframe").contentDocument.querySelector("#destination").focus()');
    await shortcut(contents, 'V');
    await until(() => run(`document.querySelector('iframe').contentDocument.querySelector('#destination').value === ${JSON.stringify(marker)}`), `${name}: iframe Ctrl+V failed`);
    passed.push(`${name}: iframe copy/paste shortcuts`);
  }

  try {
    installApplicationEditMenu();
    const main = new BrowserWindow({ show: false, width: 900, height: 700, autoHideMenuBar: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    installEditingContextMenu(main.webContents);
    await main.loadURL(page);
    await exercise(main, main.webContents, 'App form');

    const view = new WebContentsView({ webPreferences: {
      partition: 'editing-smoke-portal', sandbox: true, contextIsolation: true, nodeIntegration: false,
    } });
    main.contentView.addChildView(view);
    view.setBounds({ x: 0, y: 0, width: 850, height: 650 });
    installEditingContextMenu(view.webContents);
    installEditingContextMenu(view.webContents, { window: main, additionalItems: () => [{ label: 'Back' }] });
    assert.equal(view.webContents.listenerCount('context-menu'), 1, 'Duplicate context menus');
    await view.webContents.loadURL(page);
    await exercise(main, view.webContents, 'Embedded portal');
    assert.ok(capturedMenu.menu.items.some((item) => item.label === 'Back'), 'Portal navigation items were removed');

    const popup = new BrowserWindow({ show: false, parent: main, autoHideMenuBar: true,
      webPreferences: { partition: 'editing-smoke-popup', sandbox: true, contextIsolation: true, nodeIntegration: false } });
    installEditingContextMenu(popup.webContents);
    await popup.loadURL(page);
    await exercise(popup, popup.webContents, 'Pop-up window');
    process.stdout.write(JSON.stringify({ status: 'passed', checks: passed }, null, 2) + '\n');
  } catch (error) {
    process.stderr.write(String(error.stack ?? error) + '\n');
    process.exitCode = 1;
  } finally {
    Menu.prototype.popup = originalPopup;
    // Avoid overwriting anything the user copied while the checks ran.
    if (clipboard.readText().startsWith('M365 editing smoke')) {
      clipboard.clear();
      for (const [format, buffer] of savedClipboard) clipboard.writeBuffer(format, buffer);
    }
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
    app.exit(process.exitCode ?? 0);
  }
  }).catch((error) => {
    process.stderr.write(String(error.stack ?? error) + '\n');
    app.exit(1);
  });
}
