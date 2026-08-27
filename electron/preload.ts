import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isElectron: true,
  terminalWrite: (sessionId: string, data: string) => {
    ipcRenderer.send('terminal:write', sessionId, data);
  },
  openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url),
  getWindowVisibility: () => ipcRenderer.invoke('window:is-visible'),
  onWindowVisibilityChange: (callback: (visible: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, visible: boolean) => callback(visible);
    ipcRenderer.on('window:visibility', handler);
    return () => ipcRenderer.removeListener('window:visibility', handler);
  },
});
