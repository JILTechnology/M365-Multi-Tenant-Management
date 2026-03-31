import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../types/index';
import type { PortalId, ContentBounds, TenantInput, NavState } from '../types/index';

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

  selectTenant: (tenantId: string, portalId: PortalId): void => {
    ipcRenderer.send(IPC_CHANNELS.TENANT_SELECT, { tenantId, portalId });
  },

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
});
