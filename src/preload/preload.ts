import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../types/index';
import type {
  AppPreferences,
  BackupRequest,
  ContentBounds,
  CustomPortalInput,
  CustomPortalMoveDirection,
  CustomPortalUpdateInput,
  DataChangeNotice,
  ElectronAPI,
  NavState,
  RestoreRequest,
  TenantInput,
  TerminalDataEvent,
  TerminalExitEvent,
  TenantTabId,
  ToolInput,
} from '../types/index';

const electronAPI: ElectronAPI = {
  getAppVersion: (): Promise<string> =>
    ipcRenderer.invoke(IPC_CHANNELS.APP_GET_VERSION),

  isClaudeControlActive: (): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.APP_CLAUDE_CONTROL_ACTIVE),

  getExchangePowerShellTenantIds: (): Promise<string[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.EXCHANGE_POWERSHELL_TENANTS),

  getSiteIcon: (kind: 'tenant' | 'tool', id: string): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.SITE_ICON_GET, kind, id),

  openTerminal: (tenantId: string, cols: number, rows: number): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_OPEN, tenantId, cols, rows),

  writeTerminal: (tenantId: string, data: string) =>
    ipcRenderer.send(IPC_CHANNELS.TERMINAL_INPUT, tenantId, data),

  resizeTerminal: (tenantId: string, cols: number, rows: number) =>
    ipcRenderer.send(IPC_CHANNELS.TERMINAL_RESIZE, tenantId, cols, rows),

  onTerminalData: (callback: (event: TerminalDataEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: TerminalDataEvent) => callback(payload);
    ipcRenderer.on(IPC_CHANNELS.TERMINAL_DATA, handler);
    return () => { ipcRenderer.removeListener(IPC_CHANNELS.TERMINAL_DATA, handler); };
  },

  onTerminalExit: (callback: (event: TerminalExitEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: TerminalExitEvent) => callback(payload);
    ipcRenderer.on(IPC_CHANNELS.TERMINAL_EXIT, handler);
    return () => { ipcRenderer.removeListener(IPC_CHANNELS.TERMINAL_EXIT, handler); };
  },

  getPreferences: () =>
    ipcRenderer.invoke(IPC_CHANNELS.PREFERENCES_GET),

  updatePreferences: (preferences: AppPreferences) =>
    ipcRenderer.invoke(IPC_CHANNELS.PREFERENCES_UPDATE, preferences),

  getTenants: () =>
    ipcRenderer.invoke(IPC_CHANNELS.TENANT_GET_ALL),

  addTenant: (input: TenantInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.TENANT_ADD, input),

  updateTenant: (id: string, input: TenantInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.TENANT_UPDATE, id, input),

  removeTenant: (id: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.TENANT_REMOVE, id),

  clearTenantSession: (id: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.TENANT_CLEAR_SESSION, id),

  selectTenant: (tenantId: string, tabId: TenantTabId): void => {
    ipcRenderer.send(IPC_CHANNELS.TENANT_SELECT, { tenantId, tabId });
  },

  getCustomPortals: () =>
    ipcRenderer.invoke(IPC_CHANNELS.CUSTOM_PORTAL_GET_ALL),

  addCustomPortal: (input: CustomPortalInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.CUSTOM_PORTAL_ADD, input),

  updateCustomPortal: (id: string, input: CustomPortalUpdateInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.CUSTOM_PORTAL_UPDATE, id, input),

  moveCustomPortal: (id: string, direction: CustomPortalMoveDirection) =>
    ipcRenderer.invoke(IPC_CHANNELS.CUSTOM_PORTAL_MOVE, id, direction),

  removeCustomPortal: (id: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.CUSTOM_PORTAL_REMOVE, id),

  getTenantLastTabs: () =>
    ipcRenderer.invoke(IPC_CHANNELS.TENANT_LAST_TABS_GET),

  setTenantLastTab: (tenantId: string, tabId: TenantTabId) =>
    ipcRenderer.invoke(IPC_CHANNELS.TENANT_LAST_TAB_SET, tenantId, tabId),

  getTools: () =>
    ipcRenderer.invoke(IPC_CHANNELS.TOOL_GET_ALL),

  addTool: (input: ToolInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.TOOL_ADD, input),

  removeTool: (id: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.TOOL_REMOVE, id),

  selectTool: (toolId: string): void => {
    ipcRenderer.send(IPC_CHANNELS.TOOL_SELECT, toolId);
  },

  updateLayout: (contentBounds: ContentBounds): void => {
    ipcRenderer.send(IPC_CHANNELS.LAYOUT_UPDATE, { contentBounds });
  },

  navBack: (): void => {
    ipcRenderer.send(IPC_CHANNELS.NAV_BACK);
  },

  navForward: (): void => {
    ipcRenderer.send(IPC_CHANNELS.NAV_FORWARD);
  },

  navReload: (): void => {
    ipcRenderer.send(IPC_CHANNELS.NAV_RELOAD);
  },

  navigateTo: (url: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.NAV_NAVIGATE, url),

  onNavState: (callback: (state: NavState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: NavState) => callback(state);
    ipcRenderer.on(IPC_CHANNELS.NAV_STATE, handler);
    return () => { ipcRenderer.removeListener(IPC_CHANNELS.NAV_STATE, handler); };
  },

  onDataChanged: (callback: (notice: DataChangeNotice) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, notice: DataChangeNotice) => callback(notice);
    ipcRenderer.on(IPC_CHANNELS.DATA_CHANGED, handler);
    return () => { ipcRenderer.removeListener(IPC_CHANNELS.DATA_CHANGED, handler); };
  },

  checkForUpdates: (): void => {
    ipcRenderer.send(IPC_CHANNELS.CHECK_FOR_UPDATES);
  },

  openExtensionPopup: (): void => {
    ipcRenderer.send(IPC_CHANNELS.OPEN_EXTENSION_POPUP);
  },

  backupData: (request: BackupRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.DATA_BACKUP, request),

  restoreData: (request?: RestoreRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.DATA_RESTORE, request),

  getRecentAuditEntries: (limit?: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.AUDIT_GET_RECENT, limit),

  exportAuditLog: () =>
    ipcRenderer.invoke(IPC_CHANNELS.AUDIT_EXPORT),

  clearAuditLog: () =>
    ipcRenderer.invoke(IPC_CHANNELS.AUDIT_CLEAR),

  exportDiagnostics: () =>
    ipcRenderer.invoke(IPC_CHANNELS.DIAGNOSTICS_EXPORT),
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
