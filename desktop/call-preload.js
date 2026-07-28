const { contextBridge, ipcRenderer } = require('electron');

// The ring panel is local HTML with no network access and no portal session.
// It receives who is calling, and can answer or decline — nothing else.
contextBridge.exposeInMainWorld('TMACallPanel', {
  onCall: (callback) => ipcRenderer.on('call:info', (_event, call) => callback(call)),
  accept: () => ipcRenderer.send('call:accept'),
  decline: () => ipcRenderer.send('call:decline'),
});
