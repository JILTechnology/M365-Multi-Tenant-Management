import { BrowserWindow, Menu } from 'electron';
import type { MenuItemConstructorOptions, WebContents } from 'electron';

interface ContextMenuOptions {
  window?: BrowserWindow;
  additionalItems?: () => MenuItemConstructorOptions[];
}

const contextMenus = new WeakMap<WebContents, ContextMenuOptions>();

export function installApplicationEditMenu(): void {
  // Keep native editing accelerators registered even while the menu bar is hidden.
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'editMenu' }]));
}

export function installEditingContextMenu(
  contents: WebContents,
  options: ContextMenuOptions = {},
): void {
  const installed = contextMenus.has(contents);
  contextMenus.set(contents, options);
  if (installed) return;

  contents.on('context-menu', (_event, params) => {
    const { editFlags, isEditable } = params;
    const items: MenuItemConstructorOptions[] = [];
    if (isEditable) {
      items.push(
        { role: 'undo', enabled: editFlags.canUndo },
        { role: 'redo', enabled: editFlags.canRedo },
        { type: 'separator' },
        { role: 'cut', enabled: editFlags.canCut },
      );
    }
    items.push({ role: 'copy', enabled: editFlags.canCopy });
    if (isEditable) {
      items.push(
        { role: 'paste', enabled: editFlags.canPaste },
        { role: 'pasteAndMatchStyle', enabled: editFlags.canPaste },
      );
    }
    items.push({ role: 'selectAll', enabled: editFlags.canSelectAll });

    const currentOptions = contextMenus.get(contents)!;
    const extraItems = currentOptions.additionalItems?.() ?? [];
    if (extraItems.length > 0) items.push({ type: 'separator' }, ...extraItems);
    const window = currentOptions.window ?? BrowserWindow.fromWebContents(contents);
    if (!window || window.isDestroyed() || contents.isDestroyed()) return;

    // Native roles act on the focused page, including its focused iframe.
    contents.focus();
    Menu.buildFromTemplate(items).popup({
      window,
      ...(params.frame ? { frame: params.frame } : {}),
    });
  });
}
