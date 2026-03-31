import { app, BrowserWindow, ipcMain } from 'electron';
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

let viewManager: TenantViewManager | null = null;

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

  viewManager = new TenantViewManager(mainWindow);

  // Load the React renderer
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    );
  }

};

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

ipcMain.handle(IPC_CHANNELS.TENANT_REMOVE, (_event, id: string) => {
  viewManager?.destroyTenantViews(id);
  removeTenant(id);
});

ipcMain.on(
  IPC_CHANNELS.TENANT_SELECT,
  (_event, payload: { tenantId: string; portalId: PortalId }) => {
    viewManager?.selectView(payload.tenantId, payload.portalId);
  }
);

ipcMain.on(
  IPC_CHANNELS.LAYOUT_UPDATE,
  (_event, payload: { contentBounds: ContentBounds }) => {
    viewManager?.updateBounds(payload.contentBounds);
  }
);

// --- App Lifecycle ---

app.on('ready', createWindow);

app.on('window-all-closed', () => {
  viewManager?.destroyAll();
  app.quit();
});
