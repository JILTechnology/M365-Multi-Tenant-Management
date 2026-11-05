import fs from 'node:fs/promises';

const [portValue, screenshotPath] = process.argv.slice(2);
const port = Number(portValue);
if (!Number.isInteger(port) || port < 1024 || port > 65535 || !screenshotPath) {
  throw new Error('Usage: node scripts/smoke-test-ui.mjs <debug-port> <screenshot-path>');
}

const deadline = Date.now() + 30_000;
let targets;
while (Date.now() < deadline) {
  try {
    targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => {
      if (!response.ok) throw new Error(`CDP endpoint returned ${response.status}`);
      return response.json();
    });
    if (Array.isArray(targets) && targets.length > 0) break;
  } catch {
    // The packaged app may still be starting.
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
}

const target = targets?.find((candidate) => candidate.type === 'page');
if (!target?.webSocketDebuggerUrl) {
  throw new Error('The packaged app did not expose a renderer target within 30 seconds.');
}

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let sequence = 0;
const pending = new Map();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data));
  if (!message.id) return;
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  if (message.error) request.reject(new Error(message.error.message));
  else request.resolve(message.result);
});

function send(method, params = {}) {
  sequence += 1;
  const id = sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text ?? 'Renderer evaluation failed.');
  }
  return result.result.value;
}

while (Date.now() < deadline) {
  const ready = await evaluate(`document.readyState === 'complete' && Boolean(document.querySelector('.sidebar'))`);
  if (ready) break;
  await new Promise((resolve) => setTimeout(resolve, 100));
}

const initial = await evaluate(`(() => ({
  readyState: document.readyState,
  bodyWidth: document.body.getBoundingClientRect().width,
  bodyHeight: document.body.getBoundingClientRect().height,
  sidebarWidth: document.querySelector('.sidebar')?.getBoundingClientRect().width ?? 0,
  hasPlaceholder: Boolean(document.querySelector('.content-placeholder')),
  hasSettingsButton: Boolean(document.querySelector('.sidebar-settings-button')),
  text: document.body.innerText,
}))()`);
if (
  initial.readyState !== 'complete' ||
  initial.bodyWidth < 800 ||
  initial.bodyHeight < 600 ||
  initial.sidebarWidth < 200 ||
  !initial.hasPlaceholder ||
  !initial.hasSettingsButton
) {
  throw new Error(`Initial renderer state is invalid: ${JSON.stringify(initial)}`);
}

await evaluate(`document.querySelector('.sidebar-settings-button').click()`);
while (Date.now() < deadline) {
  if (await evaluate(`Boolean(document.querySelector('.settings-dialog'))`)) break;
  await new Promise((resolve) => setTimeout(resolve, 100));
}

const settings = await evaluate(`(() => {
  const dialog = document.querySelector('.settings-dialog');
  const rect = dialog?.getBoundingClientRect();
  return {
    visible: Boolean(dialog),
    width: rect?.width ?? 0,
    height: rect?.height ?? 0,
    hasPrivacy: document.body.innerText.includes('Privacy'),
    hasPerformance: document.body.innerText.includes('Performance'),
    hasRecentActivity: document.body.innerText.includes('Recent Activity'),
    hasReleaseNotes: document.body.innerText.includes('What Changed in 0.1.6'),
  };
})()`);
if (
  !settings.visible ||
  settings.width < 400 ||
  settings.height < 400 ||
  !settings.hasPrivacy ||
  !settings.hasPerformance ||
  !settings.hasRecentActivity ||
  !settings.hasReleaseNotes
) {
  throw new Error(`Settings renderer state is invalid: ${JSON.stringify(settings)}`);
}

const screenshot = await send('Page.captureScreenshot', {
  format: 'png',
  fromSurface: true,
  captureBeyondViewport: false,
});
await fs.writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));

await evaluate(`document.querySelector('.modal-header button').click()`);
await evaluate(`document.querySelector('.sidebar-maintenance-actions button').click()`);
while (Date.now() < deadline) {
  if (await evaluate(`Boolean(document.querySelector('.password-dialog'))`)) break;
  await new Promise((resolve) => setTimeout(resolve, 100));
}
const backupDialog = await evaluate(`(() => ({
  visible: Boolean(document.querySelector('.password-dialog')),
  passwordFields: document.querySelectorAll('.password-dialog input[type="password"]').length,
  hasProtectionToggle: document.body.innerText.includes('Password protection'),
  hasSaveButton: document.body.innerText.includes('Save Backup'),
}))()`);
if (
  !backupDialog.visible ||
  backupDialog.passwordFields !== 2 ||
  !backupDialog.hasProtectionToggle ||
  !backupDialog.hasSaveButton
) {
  throw new Error(`Backup dialog state is invalid: ${JSON.stringify(backupDialog)}`);
}

await evaluate(`document.querySelector('.password-dialog .modal-header button').click()`);
await evaluate(`window.electronAPI.addTenant({
  name: 'Runtime Fixture',
  domain: 'runtimefixture.onmicrosoft.com',
})`);
while (Date.now() < deadline) {
  if (await evaluate(`document.querySelectorAll('.sidebar-list .sidebar-item').length === 1`)) break;
  await new Promise((resolve) => setTimeout(resolve, 100));
}
await evaluate(`document.querySelector('.sidebar-list .sidebar-item').click()`);
while (Date.now() < deadline) {
  if (await evaluate(`Boolean(document.querySelector('.active-context'))`)) break;
  await new Promise((resolve) => setTimeout(resolve, 100));
}
const activeContext = await evaluate(`(() => {
  const context = document.querySelector('.active-context');
  const rect = context?.getBoundingClientRect();
  return {
    visible: Boolean(context),
    height: rect?.height ?? 0,
    text: context?.innerText ?? '',
  };
})()`);
if (
  !activeContext.visible ||
  activeContext.height !== 44 ||
  !activeContext.text.toLowerCase().includes('active tenant') ||
  !activeContext.text.includes('Runtime Fixture') ||
  !activeContext.text.includes('runtimefixture.onmicrosoft.com')
) {
  throw new Error(`Active context state is invalid: ${JSON.stringify(activeContext)}`);
}

socket.close();

process.stdout.write(JSON.stringify({
  initial: { ...initial, text: undefined },
  settings,
  backupDialog,
  activeContext,
}));
