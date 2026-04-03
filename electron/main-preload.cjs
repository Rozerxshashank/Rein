const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  getSources: () => {
    // Try to get sources from either standard or internal handler
    return ipcRenderer.invoke('get-sources').catch(() => ipcRenderer.invoke('get-sources-internal'));
  },
  selectSource: (sourceId) => ipcRenderer.send('source-selected', sourceId),
  showSourcePicker: () => ipcRenderer.invoke('show-source-picker'),
});
