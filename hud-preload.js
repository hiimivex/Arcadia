// Compteur d'images/s par-dessus le jeu : reçoit les valeurs, rien d'autre
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('hud', { on: cb => ipcRenderer.on('hud', (_e, d) => cb(d)) });
