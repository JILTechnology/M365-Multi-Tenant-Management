import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { updateElectronApp } from 'update-electron-app';
import { TenantViewManager } from './tenant-manager';
import { getTenants, addTenant, updateTenant, removeTenant } from './store';
import { IPC_CHANNELS } from '../types/index';
import type { PortalId, ContentBounds, TenantInput } from '../types/index';

// Auto-update from GitHub Releases (only runs in packaged builds)
updateElectronApp();

// Allow third-party cookies — M365 auth flows depend on cross-origin cookies
// between login.microsoftonline.com and admin portals.
app.commandLine.appendSwitch('disable-features', 'ThirdPartyCookieDeprecation');

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// Track each window's view manager
const managers = new Map<number, TenantViewManager>();

function getManager(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): TenantViewManager | null {
  const win = BrowserWindow.fromWebContents(event.sender);
  return win ? managers.get(win.id) ?? null : null;
}

const createWindow = (): void => {
  const mainWindow = new BrowserWindow({
    icon: path.join(__dirname, '../../assets/icon.ico'),
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const manager = new TenantViewManager(mainWindow);
  managers.set(mainWindow.id, manager);

  mainWindow.on('closed', () => {
    manager.destroyAll();
    managers.delete(mainWindow.id);
  });

  // Load the React renderer
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    );
  }
};

// Keep Ctrl+N working via hidden global shortcut
import { globalShortcut } from 'electron';

// --- IPC Handlers ---

ipcMain.handle(IPC_CHANNELS.APP_GET_VERSION, () => {
  return app.getVersion();
});

ipcMain.handle(IPC_CHANNELS.TENANT_GET_ALL, () => {
  return getTenants();
});

ipcMain.handle(IPC_CHANNELS.TENANT_ADD, (_event, input: TenantInput) => {
  return addTenant(input);
});

ipcMain.handle(IPC_CHANNELS.TENANT_UPDATE, (_event, id: string, input: TenantInput) => {
  return updateTenant(id, input);
});

ipcMain.handle(IPC_CHANNELS.TENANT_REMOVE, (event, id: string) => {
  getManager(event)?.destroyTenantViews(id);
  removeTenant(id);
});

ipcMain.on(
  IPC_CHANNELS.TENANT_SELECT,
  (event, payload: { tenantId: string; portalId: PortalId }) => {
    getManager(event)?.selectView(payload.tenantId, payload.portalId);
  }
);

ipcMain.on(
  IPC_CHANNELS.LAYOUT_UPDATE,
  (event, payload: { contentBounds: ContentBounds }) => {
    getManager(event)?.updateBounds(payload.contentBounds);
  }
);

ipcMain.on(
  IPC_CHANNELS.TOOL_SELECT,
  (event, toolId: string) => {
    getManager(event)?.selectTool(toolId);
  }
);

// --- Navigation ---

ipcMain.on(IPC_CHANNELS.NAV_BACK, (event) => getManager(event)?.goBack());
ipcMain.on(IPC_CHANNELS.NAV_FORWARD, (event) => getManager(event)?.goForward());
ipcMain.on(IPC_CHANNELS.NAV_RELOAD, (event) => getManager(event)?.reload());

// --- App Lifecycle ---

app.on('ready', () => {
  Menu.setApplicationMenu(null);
  globalShortcut.register('CmdOrCtrl+N', createWindow);
  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});
