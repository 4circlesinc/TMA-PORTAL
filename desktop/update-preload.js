const { contextBridge, ipcRenderer } = require('electron');

// The updating screen is local HTML with no network access and no portal
// session. It is told what is happening and shows it — it cannot start, stop or
// influence the update.
contextBridge.exposeInMainWorld('TMAUpdate', {
  onVersion: (cb) => ipcRenderer.on('update:version', (_e, version) => cb(version)),
  onPhase: (cb) => ipcRenderer.on('update:phase', (_e, phase) => cb(phase)),
  onProgress: (cb) => ipcRenderer.on('update:progress', (_e, fraction) => cb(fraction)),
});
