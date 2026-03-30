import { contextBridge, ipcRenderer } from 'electron';

// Expose a controlled API to the renderer process.
// This is the ONLY way the renderer should communicate with the main process.
contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('app:get-version'),
});
