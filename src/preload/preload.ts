import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../types/index';
import type { PortalId, ContentBounds, TenantInput, ToolInput, NavState } from '../types/index';

contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion: (): Promise<string> =>
    ipcRenderer.invoke(IPC_CHANNELS.APP_GET_VERSION),

  getTenants: () =>
    ipcRenderer.invoke(IPC_CHANNELS.TENANT_GET_ALL),

  addTenant: (input: TenantInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.TENANT_ADD, input),

  updateTenant: (id: string, input: TenantInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.TENANT_UPDATE, id, input),

  removeTenant: (id: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.TENANT_REMOVE, id),

  clearTenantSession: (id: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.TENANT_CLEAR_SESSION, id),

  selectTenant: (tenantId: string, portalId: PortalId): void => {
    ipcRenderer.send(IPC_CHANNELS.TENANT_SELECT, { tenantId, portalId });
  },

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

  onNavState: (callback: (state: NavState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: NavState) => callback(state);
    ipcRenderer.on(IPC_CHANNELS.NAV_STATE, handler);
    return () => { ipcRenderer.removeListener(IPC_CHANNELS.NAV_STATE, handler); };
  },

  checkForUpdates: (): void => {
    ipcRenderer.send(IPC_CHANNELS.CHECK_FOR_UPDATES);
  },
});
