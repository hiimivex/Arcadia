// Menu Arcadia affiché par-dessus un émulateur externe (Switch…)
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('ov', {
  onShow: cb => ipcRenderer.on('ov:show', (_e, d) => cb(d)),
  onBanner: cb => ipcRenderer.on('ov:banner', (_e, b) => cb(b)),
  onNav: cb => ipcRenderer.on('ov:nav', (_e, k) => cb(k)),
  onToast: cb => ipcRenderer.on('ov:toast', (_e, t) => cb(t)),
  act: (action) => ipcRenderer.invoke('ov:act', action),
  set: (key, value) => ipcRenderer.invoke('ov:set', key, value),
  run: (what) => ipcRenderer.invoke('ov:do', what),
  ctl: (patch) => ipcRenderer.invoke('ov:ctl', patch)
});
