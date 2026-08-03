const { contextBridge, ipcRenderer } = require('electron');

// Local HTML, no network and no portal session. It is told what is on offer,
// reports which button was pressed, and asks the window to resize when the
// notes are disclosed — nothing else.
contextBridge.exposeInMainWorld('TMAUpdateOffer', {
  onRelease: (cb) => ipcRenderer.on('update-available:release', (_e, release) => cb(release)),
  choose: (choice) => ipcRenderer.send('update-available:choice', choice),
  resize: (height) => ipcRenderer.send('update-available:height', height),
});
