// Game Platform para Linux: abre o mesmo app do Android numa janela do computador.
const { app, BrowserWindow, ipcMain, protocol, net, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const BUILD = (() => { try { return Number(require('./build.json').build) || 0; } catch { return 0; } })();
const WWW = process.env.GP_WWW || (app.isPackaged ? path.join(process.resourcesPath, 'www') : path.join(__dirname, '..', 'app', 'www'));
const SCHEME = 'gameplatform';
let win = null;
let pendingAuth = '';

protocol.registerSchemesAsPrivileged([
  { scheme: 'gp', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);

// Só uma janela por vez: abrir de novo (ou voltar do login do Google) traz a janela existente.
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
app.on('second-instance', (_e, argv) => { handleLink(argv.find(a => a.startsWith(SCHEME + '://'))); focus(); });
app.on('open-url', (e, url) => { e.preventDefault(); handleLink(url); focus(); });
app.setAsDefaultProtocolClient(SCHEME);

function focus() { if (!win) return; if (win.isMinimized()) win.restore(); win.show(); win.focus(); }

function handleLink(url) {
  if (!url) return;
  let code = '';
  try { code = new URL(url).searchParams.get('code') || ''; } catch { return; }
  if (!/^[a-f0-9]{8,128}$/i.test(code)) return;
  pendingAuth = code;
  if (win && !win.webContents.isLoading()) deliverAuth();
}

function deliverAuth() {
  if (!pendingAuth || !win) return;
  const c = pendingAuth;
  pendingAuth = '';
  win.webContents.executeJavaScript('window.GPAuth&&window.GPAuth(' + JSON.stringify(c) + ')').catch(() => {});
}

function serveWww(req) {
  const u = new URL(req.url);
  let rel = decodeURIComponent(u.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(WWW, rel));
  if (!file.startsWith(WWW + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory())
    return new Response('Não encontrado', { status: 404 });
  return net.fetch(pathToFileURL(file).toString());
}

function createWindow() {
  win = new BrowserWindow({
    width: 1180, height: 800, minWidth: 360, minHeight: 560,
    title: 'Game Platform',
    backgroundColor: '#0a1133',
    autoHideMenuBar: true,
    show: false,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false }
  });
  win.setMenuBarVisibility(false);
  win.once('ready-to-show', () => win.show());
  win.loadURL('gp://app/index.html');
  win.webContents.on('did-finish-load', deliverAuth);
  if (process.env.GP_SMOKE) win.webContents.once('did-finish-load', smoke);
  win.on('closed', () => { win = null; });

  // Links externos abrem no navegador, nunca dentro do app.
  const external = (url) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); };
  win.webContents.setWindowOpenHandler(({ url }) => { external(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('gp://')) { e.preventDefault(); external(url); } });

  // Atalhos do computador: F11 tela cheia, F5 recarrega, Ctrl + / - / 0 zoom.
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const wc = win.webContents;
    if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    else if (input.key === 'F5') { wc.reload(); e.preventDefault(); }
    else if (input.control && (input.key === '+' || input.key === '=')) { wc.setZoomLevel(wc.getZoomLevel() + 0.5); e.preventDefault(); }
    else if (input.control && input.key === '-') { wc.setZoomLevel(wc.getZoomLevel() - 0.5); e.preventDefault(); }
    else if (input.control && input.key === '0') { wc.setZoomLevel(0); e.preventDefault(); }
  });
}

ipcMain.on('gp:build', (e) => { e.returnValue = BUILD; });
ipcMain.on('gp:open', (_e, url) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); });
ipcMain.on('gp:takeAuth', (e) => { e.returnValue = pendingAuth; pendingAuth = ''; });
ipcMain.on('gp:fullscreen', (_e, f) => { if (win) win.setFullScreen(!!f); });

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  protocol.handle('gp', serveWww);
  const allowed = new Set(['fullscreen', 'pointerLock', 'clipboard-sanitized-write', 'media', 'notifications']);
  const ses = require('electron').session.defaultSession;
  ses.setPermissionRequestHandler((_wc, perm, cb) => cb(allowed.has(perm)));
  createWindow();
  handleLink(process.argv.find(a => a.startsWith(SCHEME + '://')));
});
app.on('window-all-closed', () => app.quit());
app.on('activate', () => { if (!win) createWindow(); });

// Teste rápido usado pelo GitHub antes de gerar o instalador: abre o app e confere o essencial.
async function smoke() {
  try {
    await new Promise(r => setTimeout(r, 3000));
    const r = await win.webContents.executeJavaScript(`(async()=>{
      const out = { plat: window.GPNative && GPNative.platform, build: GPNative.getBuild(), body: document.body.innerText.length,
        ls: (()=>{try{localStorage.setItem('s','1');return localStorage.getItem('s')==='1'}catch(e){return false}})() };
      let got = ''; window.GPAuth = c => { got = c };
      out.auth = typeof GPNative.takeAuth() === 'string';
      out.fetchSelf = (await fetch('gp://app/index.html')).ok;
      out.nav = !!document.getElementById('nav');
      return out })()`);
    handleLink(SCHEME + '://auth?code=abcdef0123456789');
    const ok = r.plat === 'linux' && r.body > 50 && r.ls && r.auth && r.fetchSelf && r.nav && pendingAuth === '';
    console.log('SMOKE', JSON.stringify(r), ok ? 'OK' : 'FALHOU');
    process.exit(ok ? 0 : 1);
  } catch (e) { console.log('SMOKE ERRO', e.message); process.exit(1); }
}
