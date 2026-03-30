import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { TenantViewManager } from './tenant-manager';
import { IPC_CHANNELS, DEFAULT_TENANTS } from '../types/index';
import type { PortalId, ContentBounds } from '../types/index';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

let viewManager: TenantViewManager | null = null;

const createWindow = (): void => {
  const mainWindow = new BrowserWindow({
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

  // Open DevTools in development
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }
};

// --- IPC Handlers ---

ipcMain.handle(IPC_CHANNELS.APP_GET_VERSION, () => {
  return app.getVersion();
});

ipcMain.handle(IPC_CHANNELS.TENANT_GET_ALL, () => {
  return DEFAULT_TENANTS;
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
