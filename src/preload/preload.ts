import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../types/index';
import type { PortalId, ContentBounds } from '../types/index';

contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion: (): Promise<string> =>
    ipcRenderer.invoke(IPC_CHANNELS.APP_GET_VERSION),

  getTenants: () =>
    ipcRenderer.invoke(IPC_CHANNELS.TENANT_GET_ALL),

  selectTenant: (tenantId: string, portalId: PortalId): void => {
    ipcRenderer.send(IPC_CHANNELS.TENANT_SELECT, { tenantId, portalId });
  },

  updateLayout: (contentBounds: ContentBounds): void => {
    ipcRenderer.send(IPC_CHANNELS.LAYOUT_UPDATE, { contentBounds });
  },
});
