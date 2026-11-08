// Ponte entre o app (página) e o Electron. Faz o computador responder como o "GPNative" do Android.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('GPNative', {
  platform: 'linux',
  getBuild: () => ipcRenderer.sendSync('gp:build'),
  openUrl: (u) => ipcRenderer.send('gp:open', String(u)),
  takeAuth: () => ipcRenderer.sendSync('gp:takeAuth') || '',
  setFullscreen: (f) => ipcRenderer.send('gp:fullscreen', !!f),
  setOrientation: () => {},
  canInstall: () => false
});
