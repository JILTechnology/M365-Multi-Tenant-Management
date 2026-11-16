import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  powerMonitor,
} from 'electron';
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import started from 'electron-squirrel-startup';
import {
  clearCustomPortalPartition,
  clearTenantPartition,
  clearToolPartition,
  TenantViewManager,
} from './tenant-manager';
import {
  addCustomPortal,
  addTenant,
  addTool,
  getConfiguration,
  getCustomPortals,
  getPreferences,
  getTenantLastTabs,
  getTenants,
  getTools,
  getWindowState,
  moveCustomPortal,
  removeCustomPortal,
  removeTenant,
  removeTool,
  replaceConfiguration,
  saveWindowState,
  setTenantLastTab,
  updateCustomPortal,
  updatePreferences,
  updateTenant,
} from './store';
import {
  assertCompatibleSessionBindings,
  createConfigurationBackupFile,
  createConfigurationRestorePreview,
  createEncryptedConfigurationBackupFile,
  decryptConfigurationBackupFile,
  formatConfigurationRestorePreview,
  isEncryptedConfigurationBackupFile,
  parseConfigurationBackupFile,
  validateAppPreferences,
  validateConfiguration,
} from './configuration-backup';
import { clearAuditEntries, getRecentAuditEntries, recordAudit } from './audit-log';
import { createDiagnosticsReport } from './diagnostics';
import { readExchangePowerShellEntries } from './exchange-powershell';
import {
  closeExchangeTerminals,
  openExchangeTerminal,
  resizeExchangeTerminal,
  writeExchangeTerminal,
} from './exchange-terminal';
import { installApplicationEditMenu } from './editing-menu';
import {
  configureRemoteSession,
  hardenMainWebContents,
  openExternalHttps,
} from './electron-security';
import { customPortalPartition, normalizeTenantDomain } from './url-policy';
import { CLAUDE_CONTROL_PORT, IPC_CHANNELS, PORTALS } from '../types/index';
import type {
  AppPreferences,
  BackupRequest,
  ContentBounds,
  CustomPortalInput,
  CustomPortalMoveDirection,
  CustomPortalUpdateInput,
  DataActionResult,
  DataChangeScope,
  RestoreActionResult,
  RestoreRequest,
  TenantInput,
  TenantTabId,
  ToolInput,
} from '../types/index';

const APP_USER_MODEL_ID =
  'com.squirrel.M365MultiTenantManagement.M365 Multi Tenant Management';
const MAX_BACKUP_BYTES = 5 * 1024 * 1024;
const PENDING_RESTORE_TTL_MS = 5 * 60 * 1000;

// M365 sign-in still depends on third-party cookies across Microsoft origins.
app.commandLine.appendSwitch('disable-features', 'ThirdPartyCookieDeprecation');
app.enableSandbox();

// Opt-in: lets Claude's browser-control tool drive the app over the Chrome DevTools
// Protocol. Chromium binds this port to 127.0.0.1 only. Read once at startup, so
// toggling the setting takes effect after a restart.
const claudeControlActive = getPreferences().claudeControl;
if (claudeControlActive) {
  app.commandLine.appendSwitch('remote-debugging-port', String(CLAUDE_CONTROL_PORT));
}
if (process.platform === 'win32') {
  app.setAppUserModelId(APP_USER_MODEL_ID);
}

// Handle creating/removing shortcuts on Windows when installing or uninstalling.
if (started) {
  app.quit();
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows();
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });
}

const managers = new Map<number, TenantViewManager>();
const pendingRestores = new Map<
  number,
  { sourcePath: string; value: unknown; expiresAt: number }
>();
const windowsHiddenForLock = new Set<number>();
let dataRevision = 0;

function getManager(event: IpcMainEvent | IpcMainInvokeEvent): TenantViewManager | null {
  const window = BrowserWindow.fromWebContents(event.sender);
  return window ? managers.get(window.id) ?? null : null;
}

function forEachManager(action: (manager: TenantViewManager) => void): void {
  for (const manager of managers.values()) action(manager);
}

function broadcastDataChanged(scope: DataChangeScope): void {
  dataRevision += 1;
  for (const window of BrowserWindow.getAllWindows()) {
    if (!managers.has(window.id) || window.isDestroyed()) continue;
    window.webContents.send(IPC_CHANNELS.DATA_CHANGED, {
      scope,
      revision: dataRevision,
    });
  }
}

function addAudit(input: Parameters<typeof recordAudit>[0]): void {
  if (recordAudit(input)) broadcastDataChanged('audit');
}

function applyPreferencesToWindows(preferences = getPreferences()): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.setContentProtection(preferences.contentProtection);
    }
  }
  forEachManager((manager) => manager.applyPreferences());
}

function rendererEntryPath(): string {
  return path.resolve(
    __dirname,
    `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`,
  );
}

function isTrustedRendererUrl(rawUrl: string): boolean {
  try {
    const candidate = new URL(rawUrl);
    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
      return candidate.origin === new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).origin;
    }
    return (
      candidate.protocol === 'file:' &&
      path.resolve(fileURLToPath(candidate)) === rendererEntryPath()
    );
  } catch {
    return false;
  }
}

function assertTrustedIpcSender(event: IpcMainEvent | IpcMainInvokeEvent): void {
  const senderFrame = event.senderFrame;
  if (
    !senderFrame ||
    senderFrame !== event.sender.mainFrame ||
    !isTrustedRendererUrl(senderFrame.url)
  ) {
    throw new Error('Blocked IPC request from an untrusted renderer.');
  }
}

type TrustedHandler = (
  event: IpcMainInvokeEvent,
  ...args: any[]
) => unknown | Promise<unknown>;
type TrustedListener = (event: IpcMainEvent, ...args: any[]) => void;

function handleTrusted(channel: string, handler: TrustedHandler): void {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedIpcSender(event);
    return handler(event, ...args);
  });
}

function onTrusted(channel: string, listener: TrustedListener): void {
  ipcMain.on(channel, (event, ...args) => {
    try {
      assertTrustedIpcSender(event);
      listener(event, ...args);
    } catch {
      // One-way IPC cannot return an error; silently reject untrusted senders.
    }
  });
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string, maxLength = 2048): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function requireId(value: unknown, label: string): string {
  const id = requireString(value, label, 128);
  if (
    !/^[a-zA-Z0-9_-]+$/.test(id) ||
    ['__proto__', 'constructor', 'prototype'].includes(id.toLowerCase())
  ) {
    throw new Error(`${label} contains unsupported characters.`);
  }
  return id;
}

function requireTenantInput(value: unknown): TenantInput {
  const input = requireRecord(value, 'Tenant');
  return {
    name: requireString(input.name, 'Tenant name', 200),
    domain: requireString(input.domain, 'Tenant domain', 253),
  };
}

function requireCustomPortalInput(value: unknown): CustomPortalInput {
  const input = requireRecord(value, 'Custom portal');
  return {
    tenantId: requireId(input.tenantId, 'Tenant ID'),
    label: requireString(input.label, 'Custom portal label', 200),
    url: requireString(input.url, 'Custom portal URL'),
  };
}

function requireCustomPortalUpdateInput(value: unknown): CustomPortalUpdateInput {
  const input = requireRecord(value, 'Custom portal');
  return {
    label: requireString(input.label, 'Custom portal label', 200),
    url: requireString(input.url, 'Custom portal URL'),
  };
}

function requireToolInput(value: unknown): ToolInput {
  const input = requireRecord(value, 'Tool');
  return {
    label: requireString(input.label, 'Tool label', 200),
    url: requireString(input.url, 'Tool URL'),
  };
}

function requireTenantTabId(value: unknown): TenantTabId {
  const tabId = requireString(value, 'Tenant tab', 256);
  if (Object.prototype.hasOwnProperty.call(PORTALS, tabId)) {
    return tabId as TenantTabId;
  }
  if (/^custom:[a-zA-Z0-9_-]{1,128}$/.test(tabId)) {
    return tabId as TenantTabId;
  }
  throw new Error('Tenant tab is invalid.');
}

function requireContentBounds(value: unknown): ContentBounds {
  const bounds = requireRecord(value, 'Content bounds');
  const numbers = ['x', 'y', 'width', 'height'].map((key) => bounds[key]);
  if (
    numbers.some((number) => typeof number !== 'number' || !Number.isFinite(number)) ||
    numbers.some((number) => (number as number) < 0 || (number as number) > 20000)
  ) {
    throw new Error('Content bounds are invalid.');
  }
  return {
    x: Math.round(numbers[0] as number),
    y: Math.round(numbers[1] as number),
    width: Math.round(numbers[2] as number),
    height: Math.round(numbers[3] as number),
  };
}

function requireBackupRequest(value: unknown): BackupRequest {
  const request = requireRecord(value, 'Backup request');
  if (typeof request.encrypted !== 'boolean') {
    throw new Error('Backup protection choice is invalid.');
  }
  if (
    request.passphrase !== undefined &&
    (typeof request.passphrase !== 'string' || request.passphrase.length > 1024)
  ) {
    throw new Error('Backup password is invalid.');
  }
  return {
    encrypted: request.encrypted,
    ...(request.passphrase !== undefined
      ? { passphrase: request.passphrase as string }
      : {}),
  };
}

function requireRestoreRequest(value: unknown): RestoreRequest {
  if (value === undefined) return {};
  const request = requireRecord(value, 'Restore request');
  if (
    request.passphrase !== undefined &&
    (typeof request.passphrase !== 'string' || request.passphrase.length > 1024)
  ) {
    throw new Error('Backup password is invalid.');
  }
  return request.passphrase === undefined
    ? {}
    : { passphrase: request.passphrase as string };
}

function requireAuditLimit(value: unknown): number {
  if (value === undefined) return 100;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 500
  ) {
    throw new Error('Audit history limit is invalid.');
  }
  return value;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[.:]/g, '-');
}

function showOpenDialog(
  parentWindow: BrowserWindow | null,
  options: Electron.OpenDialogOptions,
): Promise<Electron.OpenDialogReturnValue> {
  return parentWindow
    ? dialog.showOpenDialog(parentWindow, options)
    : dialog.showOpenDialog(options);
}

function showSaveDialog(
  parentWindow: BrowserWindow | null,
  options: Electron.SaveDialogOptions,
): Promise<Electron.SaveDialogReturnValue> {
  return parentWindow
    ? dialog.showSaveDialog(parentWindow, options)
    : dialog.showSaveDialog(options);
}

function showMessageBox(
  parentWindow: BrowserWindow | null,
  options: Electron.MessageBoxOptions,
): Promise<Electron.MessageBoxReturnValue> {
  return parentWindow
    ? dialog.showMessageBox(parentWindow, options)
    : dialog.showMessageBox(options);
}

async function backupConfiguration(
  parentWindow: BrowserWindow | null,
  request: BackupRequest,
): Promise<DataActionResult> {
  const encryptedLabel = request.encrypted ? ' encrypted' : '';
  const result = await showSaveDialog(parentWindow, {
    title: 'Save Configuration Backup',
    defaultPath: path.join(
      app.getPath('documents'),
      `M365 Multi Tenant Management${encryptedLabel} configuration ${timestamp()}.json`,
    ),
    filters: [{ name: 'Configuration backup', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePath) {
    addAudit({ action: 'backup.create', outcome: 'canceled' });
    return { ok: false, message: 'Backup canceled.' };
  }

  try {
    const backup = request.encrypted
      ? await createEncryptedConfigurationBackupFile(
          getConfiguration(),
          app.getVersion(),
          request.passphrase ?? '',
        )
      : createConfigurationBackupFile(getConfiguration(), app.getVersion());
    await fs.writeFile(result.filePath, JSON.stringify(backup, null, 2), 'utf8');
    addAudit({
      action: 'backup.create',
      outcome: 'success',
      detail: request.encrypted ? 'Password protected' : 'Not password protected',
    });
    return {
      ok: true,
      message: request.encrypted
        ? 'Password-protected configuration backup saved. Tenant sign-in sessions were intentionally not included.'
        : 'Configuration backup saved without password protection. Tenant sign-in sessions were intentionally not included.',
      path: result.filePath,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    addAudit({ action: 'backup.create', outcome: 'failed', detail: message });
    return { ok: false, message: `Backup failed: ${message}` };
  }
}

async function readBackupValue(filePath: string): Promise<unknown> {
  const stats = await fs.stat(filePath);
  if (!stats.isFile() || stats.size > MAX_BACKUP_BYTES) {
    throw new Error('The selected backup is not a valid configuration file.');
  }
  return JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown;
}

function parsePlainConfigurationBackup(value: unknown, filePath: string) {
  try {
    return parseConfigurationBackupFile(value).configuration;
  } catch (error) {
    // Legacy full-profile backups contained an electron-store tenants.json file.
    // Import only its validated configuration and never its browser-session data.
    if (path.basename(filePath).toLowerCase() === 'tenants.json') {
      return validateConfiguration(value);
    }
    throw error;
  }
}

async function finishConfigurationRestore(
  parentWindow: BrowserWindow | null,
  sourcePath: string,
  configuration: ReturnType<typeof getConfiguration>,
): Promise<DataActionResult> {
  const currentConfiguration = getConfiguration();
  assertCompatibleSessionBindings(currentConfiguration, configuration);
  const preview = formatConfigurationRestorePreview(
    createConfigurationRestorePreview(currentConfiguration, configuration),
  );
  const confirmation = await showMessageBox(parentWindow, {
    type: 'warning',
    title: 'Restore Configuration',
    message: 'Review the changes before restoring this backup.',
    detail: `${preview}\n\nA recovery copy will be saved first. Existing tenant sign-in sessions will not be changed.`,
    buttons: ['Restore', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
  });
  if (confirmation.response !== 0) {
    addAudit({ action: 'backup.restore', outcome: 'canceled' });
    return { ok: false, message: 'Restore canceled.' };
  }

  const recoveryDirectory = path.join(
    app.getPath('userData'),
    'configuration-backups',
  );
  const recoveryPath = path.join(
    recoveryDirectory,
    `pre-restore-${timestamp()}.json`,
  );
  await fs.mkdir(recoveryDirectory, { recursive: true });
  await fs.writeFile(
    recoveryPath,
    JSON.stringify(
      createConfigurationBackupFile(currentConfiguration, app.getVersion()),
      null,
      2,
    ),
    'utf8',
  );

  replaceConfiguration(configuration);
  forEachManager((manager) => manager.destroyAll());
  applyPreferencesToWindows(configuration.preferences);
  addAudit({ action: 'backup.restore', outcome: 'success' });
  broadcastDataChanged('all');
  return {
    ok: true,
    message:
      'Configuration restored. Existing tenant sign-in sessions were left in place.',
    path: sourcePath,
  };
}

async function restoreConfiguration(
  event: IpcMainInvokeEvent,
  request: RestoreRequest,
): Promise<RestoreActionResult> {
  const parentWindow = BrowserWindow.fromWebContents(event.sender);
  const senderId = event.sender.id;

  try {
    if (request.passphrase !== undefined) {
      const pending = pendingRestores.get(senderId);
      if (!pending || pending.expiresAt < Date.now()) {
        pendingRestores.delete(senderId);
        return {
          ok: false,
          message: 'The selected backup expired. Choose the backup again.',
        };
      }

      try {
        const decrypted = await decryptConfigurationBackupFile(
          pending.value,
          request.passphrase,
        );
        pendingRestores.delete(senderId);
        return await finishConfigurationRestore(
          parentWindow,
          pending.sourcePath,
          decrypted.configuration,
        );
      } catch {
        addAudit({
          action: 'backup.decrypt',
          outcome: 'failed',
          detail: 'Incorrect password or damaged backup',
        });
        return {
          ok: false,
          requiresPassphrase: true,
          message: 'The password was incorrect or the backup file is damaged.',
        };
      }
    }

    const result = await showOpenDialog(parentWindow, {
      title: 'Choose Configuration Backup',
      defaultPath: app.getPath('documents'),
      properties: ['openFile'],
      filters: [{ name: 'Configuration backup', extensions: ['json'] }],
    });
    if (result.canceled || result.filePaths.length === 0) {
      addAudit({ action: 'backup.restore', outcome: 'canceled' });
      return { ok: false, message: 'Restore canceled.' };
    }

    const sourcePath = result.filePaths[0];
    const value = await readBackupValue(sourcePath);
    if (isEncryptedConfigurationBackupFile(value)) {
      pendingRestores.set(senderId, {
        sourcePath,
        value,
        expiresAt: Date.now() + PENDING_RESTORE_TTL_MS,
      });
      event.sender.once('destroyed', () => pendingRestores.delete(senderId));
      return {
        ok: false,
        requiresPassphrase: true,
        message: 'Enter the password for this backup.',
      };
    }

    return await finishConfigurationRestore(
      parentWindow,
      sourcePath,
      parsePlainConfigurationBackup(value, sourcePath),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    addAudit({ action: 'backup.restore', outcome: 'failed', detail: message });
    return { ok: false, message: `Restore failed: ${message}` };
  }
}

async function exportAuditLog(
  parentWindow: BrowserWindow | null,
): Promise<DataActionResult> {
  const result = await showSaveDialog(parentWindow, {
    title: 'Export Activity History',
    defaultPath: path.join(
      app.getPath('documents'),
      `M365 Multi Tenant Management activity ${timestamp()}.json`,
    ),
    filters: [{ name: 'JSON file', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePath) {
    return { ok: false, message: 'Activity export canceled.' };
  }

  try {
    await fs.writeFile(
      result.filePath,
      JSON.stringify(
        {
          format: 'm365-multi-tenant-audit-log',
          version: 1,
          exportedAt: new Date().toISOString(),
          entries: getRecentAuditEntries(500),
        },
        null,
        2,
      ),
      'utf8',
    );
    addAudit({ action: 'audit.export', outcome: 'success' });
    return {
      ok: true,
      message: 'Activity history exported.',
      path: result.filePath,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `Activity export failed: ${message}` };
  }
}

async function exportDiagnostics(
  parentWindow: BrowserWindow | null,
): Promise<DataActionResult> {
  const result = await showSaveDialog(parentWindow, {
    title: 'Export Redacted Diagnostics',
    defaultPath: path.join(
      app.getPath('documents'),
      `M365 Multi Tenant Management diagnostics ${timestamp()}.json`,
    ),
    filters: [{ name: 'JSON file', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePath) {
    return { ok: false, message: 'Diagnostics export canceled.' };
  }

  try {
    const configuration = getConfiguration();
    const report = createDiagnosticsReport({
      appVersion: app.getVersion(),
      schemaVersion: configuration.schemaVersion,
      tenantCount: configuration.tenants.length,
      customPortalCount: configuration.customPortals.length,
      toolCount: configuration.tools.length,
      preferences: configuration.preferences,
      windowCount: managers.size,
      liveViewCount: Array.from(managers.values()).reduce(
        (total, manager) => total + manager.getLiveViewCount(),
        0,
      ),
      recentAuditEntries: getRecentAuditEntries(50),
    });
    await fs.writeFile(result.filePath, JSON.stringify(report, null, 2), 'utf8');
    addAudit({ action: 'diagnostics.export', outcome: 'success' });
    return {
      ok: true,
      message: 'Redacted diagnostics exported.',
      path: result.filePath,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `Diagnostics export failed: ${message}` };
  }
}

async function confirmSessionClear(
  parentWindow: BrowserWindow | null,
  tenantName: string,
): Promise<boolean> {
  const confirmation = await showMessageBox(parentWindow, {
    type: 'warning',
    title: 'Clear Tenant Session',
    message: `Sign out and clear saved browser data for ${tenantName}?`,
    detail:
      'This affects every app window and cannot be undone. Other tenant sessions are not affected.',
    buttons: ['Clear Session', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
  });
  return confirmation.response === 0;
}

async function clearTenantData(tenantId: string): Promise<void> {
  const customPortalIds = getCustomPortals()
    .filter((portal) => portal.tenantId === tenantId)
    .map((portal) => portal.id);
  forEachManager((manager) => manager.destroyTenantViews(tenantId));
  await Promise.all([
    clearTenantPartition(tenantId),
    ...customPortalIds.map((portalId) => clearCustomPortalPartition(portalId)),
  ]);
}

const createWindow = (): void => {
  const windowState = getWindowState();
  const mainWindow = new BrowserWindow({
    autoHideMenuBar: true,
    icon: path.join(__dirname, '../../assets/icon.ico'),
    x: windowState.x,
    y: windowState.y,
    width: windowState.width,
    height: windowState.height,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      navigateOnDragDrop: false,
      devTools: !app.isPackaged,
    },
  });

  configureRemoteSession(mainWindow.webContents.session, () => mainWindow);
  hardenMainWebContents(mainWindow.webContents, isTrustedRendererUrl);
  mainWindow.setContentProtection(getPreferences().contentProtection);
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (
      (input.control || input.meta) &&
      input.type === 'keyDown' &&
      input.key.toLowerCase() === 'n'
    ) {
      event.preventDefault();
      createWindow();
    }
  });

  if (windowState.isMaximized) mainWindow.maximize();

  const manager = new TenantViewManager(mainWindow, createWindow);
  managers.set(mainWindow.id, manager);
  const webContentsId = mainWindow.webContents.id;

  mainWindow.on('close', () => {
    const bounds = mainWindow.getNormalBounds();
    saveWindowState({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      isMaximized: mainWindow.isMaximized(),
    });
  });

  mainWindow.on('closed', () => {
    manager.dispose();
    managers.delete(mainWindow.id);
    closeExchangeTerminals(webContentsId);
    windowsHiddenForLock.delete(mainWindow.id);
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(rendererEntryPath());
  }
};

// --- IPC handlers ---

handleTrusted(IPC_CHANNELS.APP_GET_VERSION, () => app.getVersion());
handleTrusted(IPC_CHANNELS.APP_CLAUDE_CONTROL_ACTIVE, () => claudeControlActive);
handleTrusted(IPC_CHANNELS.EXCHANGE_POWERSHELL_TENANTS, () =>
  readExchangePowerShellEntries(app.getPath('userData')).map((entry) => entry.tenantId),
);
function requireTerminalSize(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 2 || value > 1000) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

// Keystrokes such as Enter or Space are whitespace-only, so requireString doesn't fit.
function requireTerminalInput(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1024 * 1024) {
    throw new Error('Terminal input is invalid.');
  }
  return value;
}

handleTrusted(IPC_CHANNELS.TERMINAL_OPEN, (event, rawId: unknown, rawCols: unknown, rawRows: unknown) => {
  const id = requireId(rawId, 'Tenant ID');
  const tenant = getTenants().find((item) => item.id === id);
  const entry = readExchangePowerShellEntries(app.getPath('userData')).find(
    (item) => item.tenantId === id,
  );
  if (!tenant || !entry) {
    throw new Error('Exchange PowerShell is not set up for this tenant.');
  }
  openExchangeTerminal(
    event.sender,
    id,
    entry,
    requireTerminalSize(rawCols, 'Terminal columns'),
    requireTerminalSize(rawRows, 'Terminal rows'),
  );
  addAudit({ action: 'exchange-powershell.open', outcome: 'success', target: tenant.name });
});
onTrusted(IPC_CHANNELS.TERMINAL_INPUT, (event, rawId: unknown, rawData: unknown) => {
  writeExchangeTerminal(
    event.sender,
    requireId(rawId, 'Tenant ID'),
    requireTerminalInput(rawData),
  );
});
onTrusted(IPC_CHANNELS.TERMINAL_RESIZE, (event, rawId: unknown, rawCols: unknown, rawRows: unknown) => {
  resizeExchangeTerminal(
    event.sender,
    requireId(rawId, 'Tenant ID'),
    requireTerminalSize(rawCols, 'Terminal columns'),
    requireTerminalSize(rawRows, 'Terminal rows'),
  );
});
handleTrusted(IPC_CHANNELS.PREFERENCES_GET, () => getPreferences());
handleTrusted(IPC_CHANNELS.PREFERENCES_UPDATE, (_event, rawValue: unknown) => {
  const preferences = updatePreferences(validateAppPreferences(rawValue));
  applyPreferencesToWindows(preferences);
  addAudit({ action: 'preferences.update', outcome: 'success' });
  broadcastDataChanged('preferences');
  return preferences;
});
handleTrusted(IPC_CHANNELS.TENANT_GET_ALL, () => getTenants());
handleTrusted(IPC_CHANNELS.TENANT_ADD, (_event, input: unknown) => {
  const tenant = addTenant(requireTenantInput(input));
  addAudit({ action: 'tenant.add', outcome: 'success', target: tenant.name });
  broadcastDataChanged('tenants');
  return tenant;
});
handleTrusted(
  IPC_CHANNELS.TENANT_UPDATE,
  async (event, rawId: unknown, rawInput: unknown) => {
    const id = requireId(rawId, 'Tenant ID');
    const previous = getTenants().find((tenant) => tenant.id === id);
    if (!previous) throw new Error(`Tenant not found: ${id}`);
    const input = requireTenantInput(rawInput);
    const nextDomain = normalizeTenantDomain(input.domain);
    if (nextDomain !== previous.domain) {
      const confirmation = await showMessageBox(
        BrowserWindow.fromWebContents(event.sender),
        {
          type: 'warning',
          title: 'Change Tenant Domain',
          message: `Change ${previous.name} to ${nextDomain}?`,
          detail:
            'The selected tenant session will be cleared before the domain changes so an old client session cannot be attached to the new domain. Other tenants are not affected.',
          buttons: ['Change and Clear Session', 'Cancel'],
          defaultId: 1,
          cancelId: 1,
        },
      );
      if (confirmation.response !== 0) {
        addAudit({
          action: 'tenant.update',
          outcome: 'canceled',
          target: previous.name,
        });
        return previous;
      }
      await clearTenantData(id);
    }

    const tenant = updateTenant(id, { ...input, domain: nextDomain });
    forEachManager((manager) => manager.destroyTenantViews(id));
    addAudit({ action: 'tenant.update', outcome: 'success', target: tenant.name });
    broadcastDataChanged('tenants');
    return tenant;
  },
);
handleTrusted(IPC_CHANNELS.TENANT_REMOVE, async (event, rawId: unknown) => {
  const id = requireId(rawId, 'Tenant ID');
  const tenant = getTenants().find((item) => item.id === id);
  if (!tenant) throw new Error(`Tenant not found: ${id}`);

  const parentWindow = BrowserWindow.fromWebContents(event.sender);
  const confirmation = await showMessageBox(parentWindow, {
    type: 'warning',
    title: 'Remove Tenant',
    message: `Remove ${tenant.name} and delete its saved session?`,
    detail:
      'This signs out the selected tenant in every app window. Other tenants are not affected.',
    buttons: ['Remove Tenant', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
  });
  if (confirmation.response !== 0) {
    addAudit({ action: 'tenant.remove', outcome: 'canceled', target: tenant.name });
    return false;
  }

  await clearTenantData(id);
  removeTenant(id);
  addAudit({ action: 'tenant.remove', outcome: 'success', target: tenant.name });
  broadcastDataChanged('tenants');
  broadcastDataChanged('customPortals');
  broadcastDataChanged('tenantLastTabs');
  return true;
});
handleTrusted(
  IPC_CHANNELS.TENANT_CLEAR_SESSION,
  async (event, rawId: unknown) => {
    const id = requireId(rawId, 'Tenant ID');
    const tenant = getTenants().find((item) => item.id === id);
    if (!tenant) throw new Error(`Tenant not found: ${id}`);
    const parentWindow = BrowserWindow.fromWebContents(event.sender);
    if (!(await confirmSessionClear(parentWindow, tenant.name))) {
      addAudit({
        action: 'tenant.session.clear',
        outcome: 'canceled',
        target: tenant.name,
      });
      return false;
    }
    await clearTenantData(id);
    addAudit({
      action: 'tenant.session.clear',
      outcome: 'success',
      target: tenant.name,
    });
    return true;
  },
);
onTrusted(IPC_CHANNELS.TENANT_SELECT, (event, rawPayload: unknown) => {
  const payload = requireRecord(rawPayload, 'Tenant selection');
  getManager(event)?.selectView(
    requireId(payload.tenantId, 'Tenant ID'),
    requireTenantTabId(payload.tabId),
  );
});
onTrusted(IPC_CHANNELS.LAYOUT_UPDATE, (event, rawPayload: unknown) => {
  const payload = requireRecord(rawPayload, 'Layout update');
  getManager(event)?.updateBounds(requireContentBounds(payload.contentBounds));
});

handleTrusted(IPC_CHANNELS.CUSTOM_PORTAL_GET_ALL, () => getCustomPortals());
handleTrusted(IPC_CHANNELS.CUSTOM_PORTAL_ADD, (_event, input: unknown) => {
  const portal = addCustomPortal(requireCustomPortalInput(input));
  addAudit({
    action: 'customPortal.add',
    outcome: 'success',
    target: portal.label,
  });
  broadcastDataChanged('customPortals');
  return portal;
});
handleTrusted(
  IPC_CHANNELS.CUSTOM_PORTAL_UPDATE,
  async (_event, rawId: unknown, rawInput: unknown) => {
    const id = requireId(rawId, 'Custom portal ID');
    const previous = getCustomPortals().find((portal) => portal.id === id);
    const updated = updateCustomPortal(
      id,
      requireCustomPortalUpdateInput(rawInput),
    );
    forEachManager((manager) => manager.destroyCustomPortalViews(id));

    if (previous) {
      const previousPartition = customPortalPartition(
        previous.tenantId,
        previous.id,
        previous.url,
      );
      const updatedPartition = customPortalPartition(
        updated.tenantId,
        updated.id,
        updated.url,
      );
      const originChanged =
        new URL(previous.url).origin !== new URL(updated.url).origin;
      if (
        previousPartition === `persist:custom-${id}` &&
        (previousPartition !== updatedPartition || originChanged)
      ) {
        await clearCustomPortalPartition(id);
      }
    }
    addAudit({
      action: 'customPortal.update',
      outcome: 'success',
      target: updated.label,
    });
    broadcastDataChanged('customPortals');
    return updated;
  },
);
handleTrusted(
  IPC_CHANNELS.CUSTOM_PORTAL_MOVE,
  (_event, rawId: unknown, rawDirection: unknown) => {
    const direction = requireString(
      rawDirection,
      'Move direction',
      5,
    ) as CustomPortalMoveDirection;
    const id = requireId(rawId, 'Custom portal ID');
    const portals = moveCustomPortal(id, direction);
    const portal = portals.find((item) => item.id === id);
    addAudit({
      action: 'customPortal.move',
      outcome: 'success',
      target: portal?.label,
    });
    broadcastDataChanged('customPortals');
    return portals;
  },
);
handleTrusted(
  IPC_CHANNELS.CUSTOM_PORTAL_REMOVE,
  async (_event, rawId: unknown) => {
    const id = requireId(rawId, 'Custom portal ID');
    const portal = getCustomPortals().find((item) => item.id === id);
    forEachManager((manager) => manager.destroyCustomPortalViews(id));
    await clearCustomPortalPartition(id);
    removeCustomPortal(id);
    addAudit({
      action: 'customPortal.remove',
      outcome: 'success',
      target: portal?.label,
    });
    broadcastDataChanged('customPortals');
    broadcastDataChanged('tenantLastTabs');
  },
);
handleTrusted(IPC_CHANNELS.TENANT_LAST_TABS_GET, () => getTenantLastTabs());
handleTrusted(
  IPC_CHANNELS.TENANT_LAST_TAB_SET,
  (_event, rawTenantId: unknown, rawTabId: unknown) => {
    setTenantLastTab(
      requireId(rawTenantId, 'Tenant ID'),
      requireTenantTabId(rawTabId),
    );
    broadcastDataChanged('tenantLastTabs');
  },
);

handleTrusted(IPC_CHANNELS.TOOL_GET_ALL, () => getTools());
handleTrusted(IPC_CHANNELS.TOOL_ADD, (_event, input: unknown) => {
  const tool = addTool(requireToolInput(input));
  addAudit({ action: 'tool.add', outcome: 'success', target: tool.label });
  broadcastDataChanged('tools');
  return tool;
});
handleTrusted(IPC_CHANNELS.TOOL_REMOVE, async (_event, rawId: unknown) => {
  const id = requireId(rawId, 'Tool ID');
  const tool = getTools().find((item) => item.id === id);
  forEachManager((manager) => manager.destroyToolView(id));
  await clearToolPartition(id);
  removeTool(id);
  addAudit({ action: 'tool.remove', outcome: 'success', target: tool?.label });
  broadcastDataChanged('tools');
});
onTrusted(IPC_CHANNELS.TOOL_SELECT, (event, rawToolId: unknown) => {
  getManager(event)?.selectTool(requireId(rawToolId, 'Tool ID'));
});

handleTrusted(IPC_CHANNELS.DATA_BACKUP, (event, rawRequest: unknown) =>
  backupConfiguration(
    BrowserWindow.fromWebContents(event.sender),
    requireBackupRequest(rawRequest),
  ),
);
handleTrusted(IPC_CHANNELS.DATA_RESTORE, (event, rawRequest: unknown) =>
  restoreConfiguration(event, requireRestoreRequest(rawRequest)),
);
handleTrusted(IPC_CHANNELS.AUDIT_GET_RECENT, (_event, rawLimit: unknown) =>
  getRecentAuditEntries(requireAuditLimit(rawLimit)),
);
handleTrusted(IPC_CHANNELS.AUDIT_EXPORT, (event) =>
  exportAuditLog(BrowserWindow.fromWebContents(event.sender)),
);
handleTrusted(IPC_CHANNELS.AUDIT_CLEAR, async (event) => {
  const parentWindow = BrowserWindow.fromWebContents(event.sender);
  const confirmation = await showMessageBox(parentWindow, {
    type: 'warning',
    title: 'Clear Activity History',
    message: 'Clear the local activity history?',
    detail: 'This does not change tenants, sign-in sessions, or configuration backups.',
    buttons: ['Clear History', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
  });
  if (confirmation.response !== 0) {
    return { ok: false, message: 'Clear canceled.' } satisfies DataActionResult;
  }
  clearAuditEntries();
  broadcastDataChanged('audit');
  return { ok: true, message: 'Activity history cleared.' } satisfies DataActionResult;
});
handleTrusted(IPC_CHANNELS.DIAGNOSTICS_EXPORT, (event) =>
  exportDiagnostics(BrowserWindow.fromWebContents(event.sender)),
);

onTrusted(IPC_CHANNELS.CHECK_FOR_UPDATES, (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return;
  void dialog
    .showMessageBox(window, {
      type: 'info',
      title: 'Check for Updates',
      message: `Current version: ${app.getVersion()}`,
      detail:
        'Click "Check" to view signed releases and installation instructions on GitHub.',
      buttons: ['Check', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
    })
    .then(({ response }) => {
      if (response === 0) {
        return openExternalHttps(
          'https://github.com/JILTechnology/M365-Multi-Tenant-Management/releases',
        );
      }
      return false;
    })
    .catch(() => undefined);
});

onTrusted(IPC_CHANNELS.NAV_BACK, (event) => getManager(event)?.goBack());
onTrusted(IPC_CHANNELS.NAV_FORWARD, (event) => getManager(event)?.goForward());
onTrusted(IPC_CHANNELS.NAV_RELOAD, (event) => getManager(event)?.reload());
handleTrusted(IPC_CHANNELS.NAV_NAVIGATE, (event, rawUrl: unknown) =>
  typeof rawUrl === 'string' && (getManager(event)?.navigateTo(rawUrl) ?? false),
);
onTrusted(IPC_CHANNELS.OPEN_EXTENSION_POPUP, (event) =>
  getManager(event)?.openKeeperVault(),
);

// --- App lifecycle ---

app.on('ready', () => {
  installApplicationEditMenu();
  powerMonitor.on('lock-screen', () => {
    if (!getPreferences().hideOnLock) return;
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && window.isVisible()) {
        windowsHiddenForLock.add(window.id);
        window.hide();
      }
    }
    addAudit({ action: 'privacy.lock-hide', outcome: 'success' });
  });
  powerMonitor.on('unlock-screen', () => {
    for (const windowId of windowsHiddenForLock) {
      const window = BrowserWindow.fromId(windowId);
      if (window && !window.isDestroyed()) window.showInactive();
    }
    windowsHiddenForLock.clear();
  });
  createWindow();
  addAudit({ action: 'application.start', outcome: 'success' });
});

app.on('window-all-closed', () => {
  app.quit();
});
