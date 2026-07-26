import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isElectron: true,
  terminalWrite: (sessionId: string, data: string) => {
    ipcRenderer.send('terminal:write', sessionId, data);
  },
  openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url),
});
