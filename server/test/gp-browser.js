// App no navegador de verdade (Chromium): atualização, interface remota, tamanhos, atalhos, puxar para atualizar, offline e notificações.
// Pula sozinho se o Playwright não estiver instalado (npm i --no-save playwright).
import { spawn, execSync } from 'node:child_process';
import http from 'node:http';
import crypto from 'node:crypto';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { try { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); } catch { console.log('Playwright não instalado: teste de navegador pulado.'); process.exit(0); } }
const { chromium } = pw;

const PORT = 3991, MP = 3992, BASE = `http://localhost:${PORT}`;
const dir = mkdtempSync(path.join(tmpdir(), 'gpb-')), www = path.join(dir, 'www');
const srcWww = existsSync('www/index.html') ? 'www' : '../app/www';
cpSync(srcWww, www, { recursive: true });
const html1 = readFileSync(path.join(www, 'index.html'), 'utf8');
let pushGot = [];
const mock = http.createServer((req, res) => { let b = ''; req.on('data', d => b += d); req.on('end', () => { pushGot.push(JSON.parse(b || '{}')); res.end('{}'); }); }).listen(MP);
const srv = spawn('node', ['--disable-warning=ExperimentalWarning', 'src/index.js'], { env: { ...process.env, PORT, DB_FILE: path.join(dir, 't.db'), STATIC_DIR: www, ADMIN_EMAIL: 'admin@teste.com', STUDIO_GATE: 'off', CONFIRM_GATE: 'off', BACKUP_AUTO: 'off', JWT_SECRET: 'teste', TEST_HOSTS: '1', PUSH_MOCK: `http://localhost:${MP}/push`, PUSH_FAST_RETRY: '1' }, stdio: ['ignore', 'ignore', 'inherit'] });
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'OK   ' : 'FALHA'} ${n}${c ? '' : ' ' + x}`); };
const wait = ms => new Promise(r => setTimeout(r, ms));
async function api(method, url, body, token) {
  const r = await fetch(BASE + '/api' + url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const txt = await r.text(); let j = {}; try { j = JSON.parse(txt); } catch {} return { s: r.status, ...j };
}
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const APK = 'https://github.com/BlackFieldX9Ops/Game-Platform/releases/download/apk-latest/game-platform.apk', APK_SHA = sha('apk');

// celular: define o que o app Android injeta
const NATIVE = build => `try{localStorage.setItem('gp_cfg',JSON.stringify({autoupd:0}))}catch(e){};window.GPNative={platform:'android',getBuild:()=>${build},canInstall:()=>true,openUrl:u=>{window.__opened=u},installApk:u=>{window.__inst=[u]},installApkVerified:(u,s,z)=>{window.__inst=[u,s,z]},setFullscreen(){},setOrientation(){},takeAuth(){return ''},getInstaller:()=>'',openInstallSettings(){}};`;

async function main() {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(BASE + '/api/health')).ok) break; } catch {} await wait(150); }
  const reg = async n => (await api('POST', '/auth/register', { name: n, email: n.toLowerCase() + '@teste.com', password: 'senha12345' }));
  const adm = await reg('Admin'), ana = await reg('Ana');
  const seed = u => `try{localStorage.setItem('gp_token',${JSON.stringify(JSON.stringify(u.token))});localStorage.setItem('gp_user',${JSON.stringify(JSON.stringify(u.user))})}catch(e){};`;
  const br = await chromium.launch();
  const phone = { viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 };
  async function page(opts, init) {
    const ctx = await br.newContext(opts), p = await ctx.newPage(); p.errs = [];
    p.on('pageerror', e => p.errs.push(e.message));
    if (init) await ctx.addInitScript(init);
    return p;
  }
  const txt = (p, s) => p.evaluate(s => { const e = document.querySelector(s); return e ? e.textContent : null; }, s);
  const goto = async (p, u = '/') => { await p.goto(BASE + u); await p.waitForTimeout(2600); };

  // ---------- 1. conexão central e manifesto ----------
  let p = await page(phone, seed(ana));
  const reqs = []; p.on('request', r => reqs.push(r.url()));
  await goto(p);
  ok('o app consulta o manifesto do servidor ao abrir', reqs.some(u => /\/api\/app\/manifest\?platform=android/.test(u)));
  ok('o manifesto fica guardado para uso sem internet', await p.evaluate(() => { try { const m = JSON.parse(localStorage.getItem('gp_manifest')); return m.ok && m.server.api === 1 && !!m.content.version } catch { return false } }));
  ok('o navegador usa o próprio site como servidor (sem digitar endereço)', await p.evaluate(() => document.querySelector('meta[name=gp-server]').content === ''));
  ok('sem erros ao abrir', p.errs.length === 0, p.errs.join('|'));

  // ---------- 2. Android: servidor oficial fixo, sem campo de endereço ----------
  let pa = await page(phone, NATIVE(10) + seed(ana));
  await goto(pa);
  await pa.evaluate(() => document.querySelector('[data-a=sub][data-v=settings]') && 0);
  await pa.click('#cfgb'); await pa.waitForTimeout(400);
  ok('no Android não há campo para trocar o servidor', await pa.evaluate(() => !document.getElementById('srvUrl')));
  ok('o servidor fica escondido de quem não é administrador', await pa.evaluate(() => !/game-platform-dgvz\.onrender\.com|Servidor oficial/.test(document.querySelector('#view').textContent)));
  await pa.context().close();

  // ---------- 3. versões: tela de atualização ----------
  const pub = await api('POST', '/admin/versions', { build: 50, name: '1.2.50', notes: 'Nova tela de atualização com progresso', fixes: ['Corrige o chat', 'Melhora a Loja'], url: APK, sha256: APK_SHA, size: 12582912 }, adm.token);
  ok('admin publica a versão 50', pub.s === 200, JSON.stringify(pub));
  pa = await page(phone, NATIVE(10) + seed(ana));
  await goto(pa);
  ok('o app antigo (build 10) vê a versão nova', await pa.evaluate(() => /Nova versão disponível/.test(document.querySelector('#view').textContent)));
  await pa.click('[data-a=sub][data-v=update]').catch(async () => { await pa.evaluate(() => document.querySelector('[data-a=sub][data-v=update]').click()); });
  await pa.waitForTimeout(400);
  const ut = await txt(pa, '#view');
  ok('tela de atualização: versão atual, nova, descrição e correções', /build 10/.test(ut) && /1\.2\.50/.test(ut) && /Nova tela de atualização/.test(ut) && /Corrige o chat/.test(ut) && /Melhora a Loja/.test(ut) && /12,0 MB/.test(ut), ut.slice(0, 300));
  ok('jogador comum vê a conexão sem endereço nem versões do servidor', /Conexão/.test(ut) && !/game-platform-dgvz|Servidor oficial|HTTPS|Conteúdo \d/.test(ut), ut.slice(0, 400));
  await pa.evaluate(() => document.querySelector('#view [data-a=doupd]').click()); await pa.waitForTimeout(300);
  ok('"Atualizar agora" chama a instalação com SHA-256 e tamanho', await pa.evaluate(([a, s]) => JSON.stringify(window.__inst) === JSON.stringify([a, s, 12582912]), [APK, APK_SHA]), JSON.stringify(await pa.evaluate(() => window.__inst)));
  await pa.evaluate(() => window.GPUpd('dl', 40)); await pa.waitForTimeout(150);
  ok('barra de progresso acompanha o download', await pa.evaluate(() => document.querySelector('.updbar i') && document.querySelector('.updbar i').style.width === '40%' && /40%/.test(document.querySelector('[data-updpct]').textContent)));
  await pa.evaluate(() => window.GPUpd('sha', 'não confere')); await pa.waitForTimeout(150);
  ok('arquivo adulterado: aviso e botão para tentar de novo', /não passou na conferência/.test(await txt(pa, '#view')) && await pa.evaluate(() => !!document.querySelector('#view [data-a=doupd]')));
  await pa.context().close();

  // ---------- 4. atualização obrigatória ----------
  const vid = (await api('GET', '/admin/versions', null, adm.token)).versions[0].id;
  await api('POST', `/admin/versions/${vid}/mandatory`, {}, adm.token);
  pa = await page(phone, NATIVE(10) + seed(ana));
  await goto(pa);
  ok('versão obrigatória bloqueia o app com tela própria', await pa.evaluate(() => { const f = document.getElementById('frc'); return !!f && /Atualização obrigatória/.test(f.textContent) && !f.querySelector('[data-a=back]') && getComputedStyle(f).position === 'fixed'; }));
  ok('a atualização obrigatória começa sozinha, mesmo com a automática desligada', await pa.evaluate(a => Array.isArray(window.__inst) && window.__inst[1] === a, APK_SHA));
  const pa2 = await page(phone, NATIVE(50) + seed(ana));
  await goto(pa2);
  ok('quem já está na build 50 não é bloqueado', await pa2.evaluate(() => !document.getElementById('frc')));
  await pa.context().close(); await pa2.context().close();
  await api('POST', `/admin/versions/${vid}/mandatory`, {}, adm.token);

  // ---------- 5. interface remota (OTA) ----------
  const html2 = html1.replace(/(<meta name="gp-ui" content=")[^"]*(">)/, '$1uiOTAv2$2').replace('</body>', '<!--v2--><script>window.__v2=1</script></body>');
  writeFileSync(path.join(www, 'index.html'), html2);
  const sha2 = sha(html2);
  pa = await page(phone, NATIVE(10) + seed(ana));
  await pa.route(BASE + '/', r => r.fulfill({ status: 200, contentType: 'text/html', body: html1 }));
  await goto(pa);
  ok('no Android a interface nova é baixada e conferida (SHA-256)', await pa.evaluate(() => { try { const o = JSON.parse(localStorage.getItem('gp_ota')); return o.v === 'uiOTAv2' && o.forBuild === 10 && localStorage.getItem('gp_ota_html').length > 1000 } catch { return false } }), JSON.stringify(await pa.evaluate(() => localStorage.getItem('gp_ota'))));
  ok('a interface remota só entra ao reabrir o app (não troca no meio do uso)', await pa.evaluate(() => !window.__GP_OTA));
  await pa.reload(); await pa.waitForTimeout(1500);
  ok('ao reabrir, o app usa a interface remota', await pa.evaluate(() => window.__GP_OTA === 'uiOTAv2' && window.__v2 === 1 && !!document.getElementById('app')));
  ok('a interface remota fica de pé (marca de sucesso)', (await pa.waitForFunction(() => window.__GP_OK === 1, null, { timeout: 7000 }).then(() => true).catch(() => false)));
  await pa.context().close();
  // adulteração: servidor devolve outro conteúdo
  pa = await page(phone, NATIVE(10) + seed(ana));
  await pa.route(BASE + '/', r => r.fulfill({ status: 200, contentType: 'text/html', body: html1 }));
  await pa.route(BASE + '/app/ui.html', r => r.fulfill({ status: 200, contentType: 'text/html', body: html2.replace('window.__v2=1', 'window.__evil=1') }));
  await goto(pa);
  ok('interface adulterada no caminho é recusada', await pa.evaluate(() => !localStorage.getItem('gp_ota_html')));
  await pa.context().close();
  // proteção: interface com defeito volta sozinha
  pa = await page(phone, NATIVE(10) + seed(ana) + `try{if(!localStorage.getItem('gp_seeded')){localStorage.setItem('gp_seeded','1');localStorage.setItem('gp_ota',JSON.stringify({v:'bad1',sha:'x',forBuild:10,at:1}));localStorage.setItem('gp_ota_html','<!doctype html><title>x</title>QUEBRADA');localStorage.setItem('gp_ota_try',JSON.stringify({v:'bad1',n:2,ok:0}))}}catch(e){}`);
  await pa.route(BASE + '/', r => r.fulfill({ status: 200, contentType: 'text/html', body: html1 }));
  await goto(pa);
  ok('interface remota que não abre é descartada e o app volta ao normal', await pa.evaluate(() => { let o = null; try { o = JSON.parse(localStorage.getItem('gp_ota')) } catch {} return !!document.getElementById('app') && !window.__GP_OTA && JSON.parse(localStorage.getItem('gp_ota_bad')) === 'bad1' && (!o || o.v !== 'bad1'); }));
  await pa.context().close();
  // navegador: aviso de interface nova
  pa = await page(phone, seed(ana));
  await pa.route(BASE + '/', r => r.fulfill({ status: 200, contentType: 'text/html', body: html1 }));
  await goto(pa);
  ok('no navegador aparece o aviso para recarregar', await pa.evaluate(() => { const b = document.getElementById('uib'); return !!b && /versão nova/i.test(b.textContent) && !localStorage.getItem('gp_ota_html'); }));
  await pa.context().close();
  writeFileSync(path.join(www, 'index.html'), html1);

  // ---------- 6. offline e reconexão ----------
  p = await page(phone, seed(ana));
  await goto(p);
  await p.context().route('**/api/**', r => r.abort());
  await p.evaluate(() => window.dispatchEvent(new Event('offline')));
  await p.waitForTimeout(500);
  ok('sem conexão: aviso e dados salvos continuam na tela', await p.evaluate(() => /Mostrando os dados salvos/.test(document.querySelector('#view').textContent) && !!document.getElementById('app')));
  await p.context().unroute('**/api/**');
  await p.evaluate(() => window.dispatchEvent(new Event('online')));
  ok('volta a conexão: aviso some sozinho', await p.waitForFunction(() => !/Mostrando os dados salvos/.test(document.querySelector('#view').textContent), null, { timeout: 8000 }).then(() => true).catch(() => false));
  const pc = await page(phone, seed(ana));
  await pc.context().route('**/api/**', r => r.abort());
  await goto(pc);
  ok('abrir sem servidor usa o cache e não quebra', await pc.evaluate(() => !!document.getElementById('app')) && pc.errs.length === 0, pc.errs.join('|'));
  await pc.context().close();

  // ---------- 7. tamanhos e responsividade ----------
  const sizes = [[360, 640], [390, 780], [768, 1024], [1280, 800], [1920, 1080]];
  const bad = [];
  for (const [w, h] of sizes) for (const g of [80, 100, 130]) for (const txtz of [100, 130]) {
    const q = await page({ viewport: { width: w, height: h }, hasTouch: w < 1000, isMobile: w < 800 }, seed(ana) + `try{localStorage.setItem('gp_ui',JSON.stringify({g:${g},txt:${txtz},lay:100,menu:100,panel:100,btn:100,tch:0,hide:{},short:null}))}catch(e){}`);
    await goto(q);
    for (const tab of ['home', 'store', 'lib', 'profile']) {
      await q.evaluate(t => { const b = document.querySelector(`nav.bar [data-v=${t}]`); if (b) b.click(); }, tab); await q.waitForTimeout(250);
      const r = await q.evaluate(() => { const de = document.documentElement, m = document.getElementById('view'), n = document.querySelector('nav.bar').getBoundingClientRect(); return { sw: de.scrollWidth > innerWidth + 1, mw: m.scrollWidth > m.clientWidth + 1, nav: n.bottom > innerHeight + 2 || n.right > innerWidth + 2 }; });
      if (r.sw || r.mw || r.nav) bad.push(`${w}x${h} g${g} t${txtz} ${tab} ${JSON.stringify(r)}`);
    }
    await q.context().close();
  }
  ok('sem cortes nem rolagem lateral em 5 resoluções, 3 tamanhos e texto grande', bad.length === 0, bad.slice(0, 5).join(' ; '));

  // ---------- 8. personalização ----------
  p = await page(phone, seed(ana));
  await goto(p);
  await p.evaluate(() => document.querySelector('[data-a=sub][data-v=uiprefs]').click()); await p.waitForTimeout(300);
  await p.evaluate(() => document.querySelector('[data-a=uitab][data-v=tamanho]').click()); await p.waitForTimeout(150);
  await p.evaluate(() => { const r = document.getElementById('ui_btn'); r.value = 130; r.dispatchEvent(new Event('input', { bubbles: true })); const t = document.getElementById('ui_txt'); t.value = 120; t.dispatchEvent(new Event('input', { bubbles: true })); });
  ok('cada botão de tamanho muda só a sua parte', await p.evaluate(() => { const s = getComputedStyle(document.documentElement); return s.getPropertyValue('--zb').trim() === '1.3' && s.getPropertyValue('--ts').trim() === '1.2' && s.getPropertyValue('--zm').trim() === '1' }));
  await p.waitForTimeout(500); await p.reload(); await p.waitForTimeout(1000);
  ok('o tamanho escolhido é lembrado ao reabrir', await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--zb').trim() === '1.3'));
  await p.evaluate(() => document.querySelector('[data-a=sub][data-v=uiprefs]').click()); await p.waitForTimeout(300);
  await p.evaluate(() => document.querySelector('[data-a=uitab][data-v=tamanho]').click()); await p.waitForTimeout(150);
  await p.evaluate(() => document.querySelector('[data-a=uireset]').click()); await p.waitForTimeout(200);
  ok('restaurar o padrão', await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--zb').trim() === '1'));
  // atalhos
  await p.evaluate(() => document.querySelector('[data-a=uitab][data-v=inicio]').click()); await p.waitForTimeout(150);
  await p.evaluate(() => document.querySelector('[data-a=shtg][data-v=missions]').click()); await p.waitForTimeout(150);
  await p.evaluate(() => document.querySelector('[data-a=shtg][data-v=notif]').click()); await p.waitForTimeout(150);
  await p.evaluate(() => document.querySelector('[data-a=shmv][data-v="notif:-1"]').click()); await p.waitForTimeout(150);
  await p.evaluate(() => document.querySelector('[data-a=back]').click()); await p.waitForTimeout(250);
  const names = await p.evaluate(() => [...document.querySelectorAll('.shorts .sct span:last-child')].map(e => e.textContent));
  ok('atalhos da tela inicial: remover, adicionar e reordenar', JSON.stringify(names) === JSON.stringify(['Loja', 'Biblioteca', 'Avisos', 'Conquistas']), JSON.stringify(names));
  ok('jogador comum não tem atalho de Auditoria/Painel', await p.evaluate(() => { document.querySelector('[data-a=sub][data-v=uiprefs]').click(); document.querySelector('[data-a=uitab][data-v=inicio]').click(); return true; }) && !/Auditoria|Painel|Versões|Enviar aviso/.test(await txt(p, '#view')));
  await p.evaluate(() => document.querySelector('[data-a=back]').click());
  await p.evaluate(() => { document.querySelector('[data-a=sub][data-v=uiprefs]').click(); }); await p.waitForTimeout(250);
  await p.evaluate(() => document.querySelector('[data-a=uitab][data-v=inicio]').click()); await p.waitForTimeout(150);
  await p.evaluate(() => { const c = document.querySelector('[data-uih=hero]'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); });
  await p.evaluate(() => document.querySelector('[data-a=back]').click()); await p.waitForTimeout(250);
  ok('blocos da tela inicial podem ser escondidos', await p.evaluate(() => !document.querySelector('.hero')));
  await p.context().close();
  // admin: atalho de Auditoria
  p = await page({ ...phone }, seed(adm));
  await goto(p);
  await p.evaluate(() => document.querySelector('[data-a=sub][data-v=uiprefs]').click()); await p.waitForTimeout(250);
  await p.evaluate(() => document.querySelector('[data-a=uitab][data-v=inicio]').click()); await p.waitForTimeout(150);
  ok('administrador pode ter atalhos de Auditoria, Painel, Versões e Enviar aviso', /Auditoria/.test(await txt(p, '#view')) && /Versões/.test(await txt(p, '#view')) && /Enviar aviso/.test(await txt(p, '#view')));
  await p.evaluate(() => document.querySelector('[data-a=shtg][data-v=audit]').click()); await p.waitForTimeout(150);
  await p.evaluate(() => document.querySelector('[data-a=back]').click()); await p.waitForTimeout(250);
  ok('atalho de Auditoria aparece na tela inicial', await p.evaluate(() => [...document.querySelectorAll('.sct')].some(e => /Auditoria/.test(e.textContent))));
  await p.context().close();

  // ---------- 9. puxar para atualizar ----------
  p = await page(phone, seed(ana));
  await goto(p);
  const cdp = await p.context().newCDPSession(p);
  const drag = async (y0, dist) => { const pt = y => [{ x: 195, y, id: 1 }]; await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(y0) }); for (let i = 1; i <= 10; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(y0 + dist * i / 10) }); await p.waitForTimeout(14); } await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
  const calls = []; p.on('request', r => { if (/\/api\/games\?limit/.test(r.url())) calls.push(Date.now()); });
  await drag(200, 35); await p.waitForTimeout(500);
  ok('puxão curto demais não atualiza', calls.length === 0);
  await drag(200, 90); await p.waitForTimeout(1300);
  ok('puxar uns 90 px para baixo atualiza a tela', calls.length >= 1, 'chamadas ' + calls.length);
  await p.waitForTimeout(900);
  await p.evaluate(() => { document.getElementById('view').insertAdjacentHTML('beforeend', '<div style="height:2400px"></div>'); document.getElementById('view').scrollTop = 300; }); await p.waitForTimeout(150);
  const before = calls.length; await drag(200, 140); await p.waitForTimeout(800);
  ok('no meio da lista o puxão rola, não atualiza', calls.length === before);
  await p.evaluate(() => { document.getElementById('view').scrollTop = 0; document.querySelector('[data-a=refreshnow]') || 0; });
  await p.context().close();
  // desktop: botão Atualizar e seta visível
  p = await page({ viewport: { width: 1280, height: 800 } }, seed(ana));
  await goto(p);
  ok('no computador a seta de atualizar não é mais escondida', await p.evaluate(() => { const e = document.getElementById('ptr'); return !e || getComputedStyle(e).display !== 'none'; }));

  // ---------- 10. notificações no navegador (assinatura simulada) ----------
  const FAKE = `
   (function(){var sub={endpoint:'https://push.example.com/e2e',toJSON(){return{endpoint:this.endpoint,keys:{p256dh:'BPk',auth:'AU'}}},unsubscribe(){return Promise.resolve(true)}};var cur=null;
   var pm={getSubscription:()=>Promise.resolve(cur),subscribe:()=>{cur=sub;return Promise.resolve(sub)}};
   var reg={pushManager:pm};
   Object.defineProperty(navigator,'serviceWorker',{value:{register:()=>Promise.resolve(reg),ready:Promise.resolve(reg),getRegistration:()=>Promise.resolve(reg),addEventListener(){}},configurable:true});
   window.PushManager=window.PushManager||function(){};
   var perm='default';Object.defineProperty(window,'Notification',{value:{get permission(){return perm},requestPermission:()=>{perm='granted';return Promise.resolve('granted')}},configurable:true});})();`;
  p = await page(phone, FAKE + seed(ana));
  await goto(p);
  await p.evaluate(() => document.querySelector('[data-a=sub][data-v=notifprefs]') ? document.querySelector('[data-a=sub][data-v=notifprefs]').click() : document.querySelector('#bell').click());
  await p.waitForTimeout(400);
  if (await p.evaluate(() => !/Preferências|Neste aparelho/.test(document.querySelector('#view').textContent))) { await p.evaluate(() => document.querySelector('[data-a=sub][data-v=notifprefs]').click()); await p.waitForTimeout(500); }
  let nt = await txt(p, '#view');
  ok('preferências: aparelho, categorias, horário de silêncio', /Neste aparelho/.test(nt) && /Atualizações da Game Platform/.test(nt) && /Menssagens|Mensagens recebidas/.test(nt) && /Horário de silêncio/.test(nt) && /Atividades de criadores PRO|Criadores PRO|criadores PRO/.test(nt) && /Segurança e acesso/.test(nt), nt.slice(0, 200));
  ok('as 13 categorias aparecem', await p.evaluate(() => document.querySelectorAll('[data-np^="cat:"]').length === 13));
  await p.evaluate(() => document.querySelector('[data-a=np_enable]').click()); await p.waitForTimeout(900);
  ok('ativar no navegador registra o aparelho na conta', (await api('GET', '/push/devices', null, ana.token)).devices.some(d => d.kind === 'web' && d.active));
  ok('a tela mostra "ativadas neste aparelho"', /Ativadas neste aparelho/.test(await txt(p, '#view')));
  await p.evaluate(() => { const c = document.querySelector('[data-np="cat:friend"]'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); });
  await p.waitForTimeout(400);
  ok('desligar uma categoria grava no servidor', (await api('GET', '/push/prefs', null, ana.token)).prefs.cats.friend === false);
  await p.evaluate(() => { const c = document.querySelector('[data-np="quiet:on"]'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); });
  await p.waitForTimeout(300);
  ok('horário de silêncio grava no servidor', (await api('GET', '/push/prefs', null, ana.token)).prefs.quiet.on === true);
  ok('categoria de segurança não pode ser desligada', await p.evaluate(() => document.querySelector('[data-np="cat:security"]').disabled));
  await api('PUT', '/push/prefs', { quiet: { on: false } }, ana.token);

  // central: o admin envia, o app recebe em tempo real
  pushGot = [];
  await p.evaluate(() => document.querySelector('[data-a=back]').click()); await p.waitForTimeout(200);
  const sent = await api('POST', '/admin/notif/send', { title: 'Torneio sábado', body: 'Vale prêmio!', category: 'event', audience: 'all' }, adm.token);
  ok('admin envia para todos', sent.s === 200 && sent.count >= 2, JSON.stringify(sent));
  ok('o aparelho do navegador recebe o push (fila)', await (async () => { for (let i = 0; i < 100 && !pushGot.length; i++) await wait(100); return pushGot.some(g => g.payload.title === 'Torneio sábado' && g.kind === 'web'); })());
  ok('o app avisa em tempo real e acende o sino', await p.waitForFunction(() => { const d = document.querySelector('#bell .dot'); return !!d && +d.textContent >= 1; }, null, { timeout: 5000 }).then(() => true).catch(() => false));
  await p.evaluate(() => document.querySelector('#bell').click()); await p.waitForTimeout(500);
  nt = await txt(p, '#view');
  ok('central: lista, categoria, filtros e não lidas', /Torneio sábado/.test(nt) && /Eventos/.test(nt) && /Não lidas/.test(nt) && await p.evaluate(() => !!document.querySelector('.nrow.unr')));
  await p.evaluate(() => document.querySelector('[data-a=ncat][data-v=event]').click()); await p.waitForTimeout(200);
  ok('filtrar por categoria', await p.evaluate(() => [...document.querySelectorAll('.nrow')].every(r => /Eventos/.test(r.textContent)) && document.querySelectorAll('.nrow').length >= 1));
  await p.evaluate(() => document.querySelector('.nrow .body').click()); await p.waitForTimeout(500);
  ok('tocar na notificação marca como lida (no servidor também)', (await api('GET', '/notifications', null, ana.token)).notifications.find(n => n.title === 'Torneio sábado').read === true);
  await p.evaluate(() => document.querySelector('[data-a=ncat][data-v=all]').click()); await p.waitForTimeout(150);
  await api('POST', '/admin/notif/send', { title: 'Outro aviso', body: 'segundo', category: 'admin', audience: 'all' }, adm.token);
  await p.waitForFunction(() => /Outro aviso/.test(document.querySelector('#view').textContent), null, { timeout: 5000 }).catch(() => {});
  await p.evaluate(() => { const b = document.querySelector('[data-a=nreadall]'); if (b) b.click(); }); await p.waitForTimeout(500);
  ok('marcar todas como lidas', (await api('GET', '/notifications/summary', null, ana.token)).unread === 0 && await p.evaluate(() => !document.querySelector('#bell .dot')));
  await p.context().close();

  // ---------- 11. painel do administrador (tela grande) ----------
  p = await page({ viewport: { width: 1400, height: 900 } }, seed(adm));
  await goto(p);
  ok('painel mostra Versões do app e Notificações no menu', await p.evaluate(() => [...document.querySelectorAll('.wnav')].some(b => /Versões do app/.test(b.textContent)) && [...document.querySelectorAll('.wnav')].some(b => /Notificações/.test(b.textContent))));
  await p.evaluate(() => [...document.querySelectorAll('.wnav')].find(b => /Versões do app/.test(b.textContent)).click()); await p.waitForTimeout(900);
  nt = await txt(p, '#ws');
  ok('Versões: publicar, regras, histórico e atividade', /Publicar versão do app/.test(nt) && /Regras e configuração remota/.test(nt) && /Histórico de versões/.test(nt) && /Atividade dos aparelhos/.test(nt) && /1\.2\.50/.test(nt), nt.slice(0, 200));
  await p.fill('[data-wf="ver.build"]', '51'); await p.fill('[data-wf="ver.notes"]', 'Melhorias gerais'); await p.fill('[data-wf="ver.fixes"]', 'Corrige X\nMelhora Y'); await p.fill('[data-wf="ver.url"]', APK); await p.fill('[data-wf="ver.sha"]', sha('apk2'));
  await p.click('[data-a=w_vpub]'); await p.waitForTimeout(900);
  ok('publicar versão pelo painel', (await api('GET', '/admin/versions', null, adm.token)).versions.some(v => v.build === 51 && v.fixes.length === 2), (await txt(p, '#toast')));
  await p.evaluate(() => [...document.querySelectorAll('.wnav')].find(b => /Notificações/.test(b.textContent)).click()); await p.waitForTimeout(900);
  nt = await txt(p, '#ws');
  ok('Notificações: aparelhos, fila, falhas, envio e histórico', /Android ativos/.test(nt) && /Navegadores ativos/.test(nt) && /Nova notificação/.test(nt) && /Enviadas e agendadas/.test(nt) && /Torneio sábado/.test(nt), nt.slice(0, 250));
  await p.selectOption('[data-wf="ntf.cat"]', 'newgame'); await p.fill('[data-wf="ntf.title"]', 'Jogo novo na Loja'); await p.fill('[data-wf="ntf.body"]', 'Venha conferir');
  const fut = new Date(Date.now() + 7200e3); const pad = n => String(n).padStart(2, '0');
  await p.fill('[data-wf="ntf.at"]', `${fut.getFullYear()}-${pad(fut.getMonth() + 1)}-${pad(fut.getDate())}T${pad(fut.getHours())}:${pad(fut.getMinutes())}`);
  await p.click('[data-a=w_nsend]'); await p.waitForTimeout(700);
  await p.click('.wmodal [data-a=w_mok], .wmodal .btn:not(.ghost)'); await p.waitForTimeout(1000);
  const camps = (await api('GET', '/admin/notif/campaigns', null, adm.token)).campaigns;
  ok('agendar pelo painel', camps.some(c => c.title === 'Jogo novo na Loja' && c.status === 'scheduled'), JSON.stringify(camps.map(c => [c.title, c.status])));
  await p.evaluate(() => document.querySelector('[data-a=w_ncancel]').click()); await p.waitForTimeout(500);
  await p.click('.wmodal .btn:not(.ghost)'); await p.waitForTimeout(800);
  ok('cancelar agendamento pelo painel', (await api('GET', '/admin/notif/campaigns', null, adm.token)).campaigns.find(c => c.title === 'Jogo novo na Loja').status === 'cancelled');
  ok('sem erros no painel', p.errs.length === 0, p.errs.join('|'));

  // ---------- a abertura (logo) nunca fica presa: mesmo se o evento load não vier ----------
  { const ctx = await br.newContext(phone), pz = await ctx.newPage();
    await pz.route('**/vendor/jszip.min.js', () => { /* nunca responde: o load da página não dispara */ });
    await pz.goto(BASE + '/', { waitUntil: 'commit' });
    await pz.waitForTimeout(9800);
    ok('a tela de abertura some sozinha mesmo com um arquivo travado', await pz.evaluate(() => !document.getElementById('splash')));
    await ctx.close(); }
  // ---------- interface baixada (OTA) reescreve a página: a abertura tem que sair mesmo assim ----------
  { const ctx = await br.newContext(phone), pz = await ctx.newPage();
    await ctx.addInitScript(([h]) => { window.GPNative = { platform: 'android', getBuild: () => 77, canInstall: () => true, openUrl() {}, installApk() {} }; try { if (!localStorage.getItem('gp_ota')) { localStorage.setItem('gp_ota', JSON.stringify({ v: 'antiga', forBuild: 77, at: Date.now() })); localStorage.setItem('gp_ota_html', h); } } catch (e) {} }, [html1]);
    await pz.goto(BASE + '/');
    await pz.waitForTimeout(10500);
    ok('com a interface baixada em uso, a tela de abertura também sai', await pz.evaluate(() => window.__GP_OTA === 'antiga' && !document.getElementById('splash')) );
    await ctx.close(); }
  // ---------- recursos desligados, Studio e servidor só para o administrador ----------
  await api('POST', '/admin/config', { featChat: false, featMissions: false, featShortcuts: false }, adm.token);
  ok('o servidor informa os recursos desligados', JSON.stringify((await api('GET', '/platform')).feat) === JSON.stringify({ chat: false, missions: false, shortcuts: false }));
  let pf = await page(phone, seed(ana));
  await goto(pf); await pf.waitForTimeout(900);
  let ft = await txt(pf, '#view');
  ok('Início sem atalhos quando desligados', !/Atalhos/.test(ft));
  ok('Início sem o cartão Comunidade quando o chat está desligado', !/Grupos, feed e conversas/.test(ft));
  await pf.click('#nav [data-v=chat]'); await pf.waitForTimeout(400);
  ft = await txt(pf, '#view');
  ok('aba Chat mostra "em desenvolvimento / em breve"', /Chat em desenvolvimento/.test(ft) && /Em breve será lançado/.test(ft));
  ok('o aviso do chat fica centralizado', await pf.evaluate(() => { const e = document.querySelector('.soon'); if (!e) return false; const r = e.getBoundingClientRect(), v = document.querySelector('#view').getBoundingClientRect(); return Math.abs((r.left + r.width / 2) - (v.left + v.width / 2)) < 4 && getComputedStyle(e).justifyContent === 'center'; }));
  await pf.click('#nav [data-v=profile]'); await pf.waitForTimeout(400);
  ok('Perfil sem o cartão de Missões', !(await pf.$('[data-a=sub][data-v=missions]')));
  await pf.evaluate(() => document.querySelector('[data-a=sub][data-v=uiprefs]') && document.querySelector('[data-a=sub][data-v=uiprefs]').click());
  await pf.waitForTimeout(300);
  const tabIn = await pf.$('[data-a=uitab][data-v=inicio]');
  if (tabIn) { await tabIn.click(); await pf.waitForTimeout(250); }
  ok('Aparência sem a lista de atalhos', !/Usar atalhos padrão/.test(await txt(pf, '#view')));
  ok('sem erros com os recursos desligados', pf.errs.length === 0, pf.errs.join('|'));
  await pf.context().close();
  await api('POST', '/admin/config', { featChat: true, featMissions: true, featShortcuts: true }, adm.token);
  pf = await page(phone, seed(ana));
  await goto(pf); await pf.waitForTimeout(900);
  ok('com tudo ligado voltam os atalhos', /Atalhos/.test(await txt(pf, '#view')));
  await pf.click('#nav [data-v=chat]'); await pf.waitForTimeout(400);
  ok('com o chat ligado não há aviso de desenvolvimento', !/Chat em desenvolvimento/.test(await txt(pf, '#view')));
  await pf.context().close();

  // ---------- Loja: busca, ordenação, saldo e chips ----------
  const mkG = (t, c, d, extra = {}) => api('POST', '/games', { title: t, description: 'Jogo ' + t, category: c, age: 'Livre', dim: d, libs: [], code: '<!doctype html><canvas id=c></canvas><script>c.getContext("2d")</script>', orientation: 'auto', tags: ['loja'], version: '1.0.0', visibility: 'public', settings: { kind: 'Jogo', monetization: 'paid', price: 50, ...extra } }, adm.token);
  await mkG('Lojinha Alfa', 'Corrida', '2D', { price: 300 }); await mkG('Lojinha Beta', 'RPG', '3D', { price: 20 });
  let ls = await page(phone, seed(ana));
  await goto(ls); await ls.waitForTimeout(500);
  await ls.click('#nav [data-v=store]'); await ls.waitForTimeout(600);
  ok('Loja: campo de busca, ordenação e saldo', !!(await ls.$('#stq')) && !!(await ls.$('#stSort')) && !!(await ls.$('.stbal')));
  ok('Loja: o ícone de busca é um desenho de verdade', await ls.evaluate(() => !/undefined/.test(document.querySelector('.stq').innerHTML)));
  const nGrid = () => ls.evaluate(() => document.querySelectorAll('#stgrid .scard').length);
  const all0 = await nGrid();
  ok('Loja: mostra os jogos pagos', all0 >= 2, String(all0));
  await ls.evaluate(() => { const i = document.getElementById('stq'); i.value = 'lojinha alfa'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await ls.waitForTimeout(300);
  ok('Loja: a busca filtra a lista', (await nGrid()) === 1 && /Lojinha Alfa/.test(await txt(ls, '#stgrid')));
  await ls.evaluate(() => { const i = document.getElementById('stq'); i.value = 'zzzz-nada'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await ls.waitForTimeout(300);
  ok('Loja: busca sem resultado mostra aviso e botão de limpar', (await nGrid()) === 0 && !!(await ls.$('[data-a=stclear]')));
  await ls.click('[data-a=stclear]'); await ls.waitForTimeout(400);
  ok('Loja: limpar filtros volta a lista toda', (await nGrid()) === all0);
  await ls.evaluate(() => { const s = document.getElementById('stSort'); const o = [...s.options].find(x => /menor|barato/i.test(x.textContent)); if (o) { s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); } });
  await ls.waitForTimeout(400);
  const prices = await ls.evaluate(() => [...document.querySelectorAll('#stgrid .scard')].map(c => { const m = (c.querySelector('.sprow') || c).textContent.match(/(\d[\d.]*)/); return m ? +m[1].replace(/\./g, '') : 0; }));
  ok('Loja: ordenar por menor preço', prices.length > 1 && prices.every((v, i) => !i || v >= prices[i - 1]), prices.join(','));
  ok('Loja: cartões mostram o peso do jogo (Leve/Médio/Pesado)', /Leve|Médio|Pesado/.test(await txt(ls, '#stgrid')));
  ok('sem erros na Loja', ls.errs.length === 0, ls.errs.join('|'));
  await ls.context().close();

  // ---------- botão do jogo arrastável, pastas dos jogos, ponte GP e app oficial ----------
  const gcode = '<!doctype html><body><div id=hud style="position:absolute;top:8px;left:8px">HUD</div><script>localStorage.setItem("nivel","7")</script></body>';
  const gj = await api('POST', '/games', { title: 'Jogo Pasta', description: 'jogo de teste das pastas', category: 'Ação', age: 'Livre', dim: '2D', libs: [], code: gcode, orientation: 'auto', tags: ['pasta'], version: '1.0.0', visibility: 'public', settings: { kind: 'Jogo' } }, adm.token);
  const gid = String((gj.game && gj.game.id) || gj.id);
  // simulação do Android: pastas em memória com as mesmas regras do código nativo
  const NATFS = `(function(){var F={};var ok=function(p){p=String(p||'');return !p||(p.length<=200&&p[0]!=='/'&&!/\\\\/.test(p)&&p.split('/').every(function(x){return x&&x!=='.'&&x!=='..'}))};var k=function(g,p){return g+'/'+p};window.__fs=F;
   window.GPNative={platform:'android',getBuild:function(){return 99},canInstall:function(){return true},openUrl:function(){},installApk:function(){},installApkVerified:function(){},setFullscreen:function(){},setOrientation:function(){},takeAuth:function(){return ''},getInstaller:function(){return ''},openInstallSettings:function(){},
   getSignature:function(){return window.__sig||'A31C58B91E9672285B221A2F33E37BA3203030A038ECFD3ABB434002EAF49B93'},gamesPath:function(){return '/sdcard/Android/data/app/files/GamePlatform'},
   gameWrite:function(g,p,d,b){if(!ok(p)||!p)return 'err:caminho invalido';F[k(g,p)]={d:d,b:b,s:b?Math.floor(d.length*3/4):d.length,t:Date.now()};return 'ok'},
   gameRead:function(g,p,b){var r=F[k(g,p)];if(!r||!ok(p))return null;return r.d},
   gameList:function(g,p){var pre=g+'/'+(p?p+'/':''),seen={},o=[];Object.keys(F).forEach(function(x){if(x.indexOf(pre)!==0)return;var rest=x.slice(pre.length),i=rest.indexOf('/');if(i<0)o.push({n:rest,d:false,s:F[x].s,t:F[x].t});else if(!seen[rest.slice(0,i)]){seen[rest.slice(0,i)]=1;o.push({n:rest.slice(0,i),d:true,s:0,t:0})}});return JSON.stringify(o)},
   gameRemove:function(g,p){var pre=g+'/'+(p||'');Object.keys(F).forEach(function(x){if(x===pre||x.indexOf(pre+'/')===0||!p&&x.indexOf(g+'/')===0)delete F[x]});return true},
   gamesIndex:function(){var m={};Object.keys(F).forEach(function(x){var g=x.split('/')[0];(m[g]=m[g]||{n:g,s:0,c:0,t:0}).s+=F[x].s;m[g].c++});return JSON.stringify(Object.keys(m).map(function(g){return m[g]}))},
   gameDownload:function(g,p,u,id){setTimeout(function(){if(/ruim/.test(u)){window.GPFile(id,false,'servidor respondeu 404');return}F[k(g,p)]={d:'baixado',b:false,s:7,t:Date.now()};window.GPFile(id,true,'7')},50)}}})();`;
  const runGame = async (pg) => { await pg.evaluate(id => { const b = document.querySelector('[data-a=open][data-v="' + id + '"]') || document.querySelector('[data-a=open]'); if (b && !document.querySelector('[data-a=play]')) b.click(); }, gid); await pg.waitForTimeout(700); await pg.evaluate(() => document.querySelector('[data-a=play]').click()); await pg.waitForTimeout(1500); };
  const inGame = (pg, fn, arg) => pg.frames().find(f => f !== pg.mainFrame()).evaluate(fn, arg);
  let pn = await page(phone, seed(ana) + NATFS);
  await goto(pn); await pn.waitForTimeout(500);
  await runGame(pn);
  ok('jogo recebe a ponte GP', await inGame(pn, () => typeof GP === 'object' && typeof GP.files.write === 'function'));
  await pn.waitForTimeout(700);
  ok('dados do jogo vão para a pasta do jogo no celular', /"nivel"/.test((await pn.evaluate(() => (window.__fs['Jogo Pasta/dados.json'] || {}).d)) || ''));
  ok('a pasta guarda as configurações do jogo (jogo.json)', /Jogo Pasta/.test((await pn.evaluate(() => (window.__fs['Jogo Pasta/jogo.json'] || {}).d)) || ''));
  ok('GP.files grava e lê', await inGame(pn, async () => { await GP.files.write('saves/a.json', JSON.stringify({ x: 1 })); return (await GP.files.read('saves/a.json', 'json')).x === 1; }));
  ok('o arquivo foi para a pasta certa', await pn.evaluate(() => !!window.__fs['Jogo Pasta/saves/a.json']));
  ok('GP.files bloqueia caminhos perigosos', await inGame(pn, async () => { const r = []; for (const bad of ['../x', '/etc/a', 'a/../b', 'a\\b']) { try { await GP.files.write(bad, 'z'); r.push('aceitou ' + bad); } catch (e) { } } return r.length === 0; }));
  ok('GP.files.download baixa para a pasta', await inGame(pn, async () => (await GP.files.download('https://exemplo.com/a.bin', 'dl/a.bin')) === 7));
  ok('GP.files.download recusa link sem https', await inGame(pn, async () => { try { await GP.files.download('http://exemplo.com/a.bin', 'dl/b.bin'); return false; } catch (e) { return true; } }));
  ok('GP.files.download informa erro do servidor', await inGame(pn, async () => { try { await GP.files.download('https://exemplo.com/ruim', 'dl/c.bin'); return false; } catch (e) { return /404/.test(e.message); } }));
  ok('GP.info mostra a pasta', await inGame(pn, async () => (await GP.info()).pasta === 'Jogo Pasta'));
  ok('GP.files.list lista a pasta', await inGame(pn, async () => (await GP.files.list('')).some(x => x.n === 'saves' && x.d)));
  await pn.evaluate(() => document.getElementById('pClose').click()); await pn.waitForTimeout(600);
  await runGame(pn);
  ok('ao reabrir, o progresso volta da pasta', await inGame(pn, () => localStorage.getItem('nivel')) === '7');
  await pn.evaluate(() => document.getElementById('pClose').click()); await pn.waitForTimeout(600);
  await pn.evaluate(() => document.querySelector('#nav [data-v=profile]').click()); await pn.waitForTimeout(500);
  await pn.evaluate(() => document.querySelector('[data-a=sub][data-v=settings]').click()); await pn.waitForTimeout(400);
  ok('Configurações tem "Pastas dos jogos"', !!(await pn.$('[data-a=sub][data-v=files]')));
  await pn.evaluate(() => document.querySelector('[data-a=sub][data-v=files]').click()); await pn.waitForTimeout(700);
  let ft2 = await txt(pn, '#view');
  ok('Pastas dos jogos lista GamePlatform e o jogo', /GamePlatform/.test(ft2) && /Jogo Pasta/.test(ft2) && /GamePlatform/.test(ft2), ft2.slice(0, 120));
  ok('Pastas dos jogos mostra o caminho no celular', /Android\/data\/app\/files\/GamePlatform/.test(ft2));
  await pn.evaluate(() => document.querySelector('[data-a=fopen]').click()); await pn.waitForTimeout(500);
  ok('abrir a pasta mostra os arquivos', /dados\.json/.test(await txt(pn, '#view')) && /saves/.test(await txt(pn, '#view')));
  ok('os ícones das pastas têm tamanho de ícone', await pn.evaluate(() => [...document.querySelectorAll('#view svg.fic')].every(s => s.getBoundingClientRect().width <= 24)));
  await pn.evaluate(() => document.querySelector('[data-a=fclear]').click()); await pn.waitForTimeout(300);
  ok('limpar pede confirmação antes de apagar', /Toque de novo/.test(await txt(pn, '#view')) && await pn.evaluate(() => Object.keys(window.__fs).length > 0));
  await pn.evaluate(() => document.querySelector('[data-a=fclear]').click()); await pn.waitForTimeout(700);
  ok('confirmar apaga os dados do jogo', await pn.evaluate(() => Object.keys(window.__fs).filter(k => k.indexOf('Jogo Pasta/') === 0).length === 0));
  ok('sem erros com as pastas dos jogos', pn.errs.length === 0, pn.errs.join('|'));
  await pn.context().close();
  // app oficial x cópia
  let pg2 = await page(phone, seed(ana) + NATFS + "window.__sig='" + 'B'.repeat(64) + "';");
  await goto(pg2); await pg2.waitForTimeout(500);
  ok('cópia com outra assinatura recebe aviso de app não oficial', /App não oficial/.test(await txt(pg2, '#view')));
  await pg2.context().close();
  pg2 = await page(phone, seed(ana) + NATFS);
  await goto(pg2); await pg2.waitForTimeout(500);
  ok('app com a assinatura oficial não mostra aviso', !/App não oficial/.test(await txt(pg2, '#view')));
  await pg2.context().close();
  // navegador (sem app): a ponte GP usa o armazenamento do navegador
  let pw = await page(phone, seed(ana));
  await goto(pw); await pw.waitForTimeout(500);
  await runGame(pw);
  ok('no navegador GP.files também funciona', await inGame(pw, async () => { await GP.files.write('x/y.txt', 'oi'); return (await GP.files.read('x/y.txt')) === 'oi' && (await GP.files.list('x')).length === 1; }));
  ok('no navegador o binário volta igual', await inGame(pw, async () => { await GP.files.write('b.bin', new Uint8Array([1, 2, 250]).buffer); return Array.from(new Uint8Array(await GP.files.read('b.bin', 'arraybuffer'))).join() === '1,2,250'; }));
  ok('sem erros no navegador', pw.errs.length === 0, pw.errs.join('|'));
  await pw.context().close();
  // botão do jogo arrastável
  let ph = await page({ viewport: { width: 800, height: 360 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 }, seed(ana));
  await goto(ph); await ph.waitForTimeout(500);
  await runGame(ph);
  await ph.waitForTimeout(4800);
  const hrect = () => ph.evaluate(() => { const h = document.getElementById('pHandle').getBoundingClientRect(), m = document.querySelector('#player .pb').getBoundingClientRect(), u = document.getElementById('hud') ? 0 : 0; return { hx: h.x, hy: h.y, hw: h.width, mx: m.x, my: m.y, mw: m.width, open: document.getElementById('player').classList.contains('bar') }; });
  let hr = await hrect();
  ok('o botão do jogo não fica no canto superior esquerdo (HUD do jogo)', hr.hy > 60);
  await ph.evaluate(() => document.getElementById('pHandle').click()); await ph.waitForTimeout(350);
  hr = await hrect();
  ok('o menu abre pequeno ao lado do botão, sem cobrir o topo', hr.open && hr.mw < 260 && hr.my > 20);
  await ph.waitForTimeout(5200);
  const c0 = await hrect();
  await ph.mouse.move(c0.hx + c0.hw / 2, c0.hy + c0.hw / 2); await ph.mouse.down(); await ph.mouse.move(400, 150, { steps: 5 }); await ph.mouse.move(760, 200, { steps: 5 }); await ph.mouse.up(); await ph.waitForTimeout(300);
  hr = await hrect();
  ok('arrastar leva o botão para a lateral direita', hr.hx > 700);
  ok('arrastar não abre o menu sem querer', !hr.open);
  ok('a posição fica salva', /"s":"r"/.test(await ph.evaluate(() => localStorage.getItem('gp_hpos'))));
  await ph.evaluate(() => document.getElementById('pHandle').click()); await ph.waitForTimeout(350);
  hr = await hrect();
  ok('com o botão na direita o menu abre para a esquerda', hr.open && hr.mx + hr.mw <= hr.hx + 2);
  ok('sem erros no botão do jogo', ph.errs.length === 0, ph.errs.join('|'));
  await ph.context().close();

  // ---------- banner de boas-vindas (carrossel e editor) ----------
  const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  let pb = await page(phone, seed(ana));
  await goto(pb);
  ok('banner padrão: um slide só, sem pontinhos, sem lápis para jogador', await pb.evaluate(() => document.querySelectorAll('.bnt>.hero').length === 1 && !document.querySelector('.bnd') && !document.querySelector('.bned')));
  ok('banner padrão mostra Jogar agora', /Jogar agora/.test(await txt(pb, '.bn')));
  await pb.context().close();
  const bput = await api('PUT', '/admin/banners', { auto: 3, slides: [
    { title: 'Bem-vindo à Arena', text: 'Jogue e crie', b1: { act: 'playnow', label: 'Jogar já' }, b2: { act: 'url', label: 'Site', val: 'https://exemplo.com' } },
    { title: 'Novo jogo', image: 'data:image/png;base64,' + PNG1.toString('base64'), b1: { act: 'tab', label: 'Ver na Loja', val: 'store' } },
    { title: 'Terceiro slide' }] }, adm.token);
  ok('admin salva o banner pela API', !!bput.ok, JSON.stringify(bput).slice(0, 100));
  pb = await page(phone, seed(ana));
  await goto(pb);
  const bst = () => pb.evaluate(() => ({ n: document.querySelectorAll('.bnt>.hero').length, i: [...document.querySelectorAll('.bnd i')].findIndex(x => x.classList.contains('on')), dots: document.querySelectorAll('.bnd i').length }));
  let b0 = await bst();
  ok('banner configurado vira carrossel com pontinhos', b0.n === 3 && b0.dots === 3, JSON.stringify(b0));
  ok('o título e o botão configurados aparecem', /Bem-vindo à Arena/.test(await txt(pb, '.bn')) && /Jogar já/.test(await txt(pb, '.bn')));
  ok('slide com imagem usa a imagem do servidor', await pb.evaluate(() => { const i = document.querySelector('.bnimg'); return !!i && /\/api\/banners\/img\//.test(i.src); }));
  const i0 = (await bst()).i;
  await pb.waitForTimeout(3800);
  const i1 = (await bst()).i;
  ok('o carrossel gira sozinho', i1 !== i0, i0 + '->' + i1);
  const cdpB = await pb.context().newCDPSession(pb);
  const swipe = async (x1, x2, y) => { await cdpB.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y }] }); for (let k = 1; k <= 8; k++) await cdpB.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x1 + (x2 - x1) * k / 8, y }] }); await cdpB.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
  const by = await pb.evaluate(() => { const r = document.querySelector('.bn').getBoundingClientRect(); return r.y + 40; });
  const s0 = (await bst()).i;
  await swipe(320, 60, by); await pb.waitForTimeout(700);
  const s1 = (await bst()).i;
  ok('arrastar para a esquerda avança o slide', s1 === (s0 + 1) % 3, s0 + '->' + s1);
  await swipe(60, 320, by); await pb.waitForTimeout(700);
  ok('arrastar para a direita volta o slide', (await bst()).i === s0);
  await pb.evaluate(() => [...document.querySelectorAll('.bnd i')][1].click()); await pb.waitForTimeout(500);
  ok('tocar no pontinho vai direto ao slide', (await bst()).i === 1);
  ok('jogador comum não vê o lápis de editar', !(await pb.$('.bned')));
  ok('sem erros no carrossel', pb.errs.length === 0, pb.errs.join('|'));
  await pb.context().close();
  // editor (administrador, no celular)
  let pe = await page(phone, seed(adm));
  await goto(pe);
  ok('administrador vê o lápis de editar no banner', !!(await pe.$('.bned')));
  await pe.evaluate(() => document.querySelector('.bned').click()); await pe.waitForTimeout(900);
  ok('o editor abre com os slides e o giro', /Banner de boas-vindas/.test(await txt(pe, '#view')) && (await pe.$$('.bnc-card')).length === 3 && !!(await pe.$('#bnAuto')));
  await pe.fill('[data-bn=title][data-i="0"]', 'Título editado no teste'); await pe.waitForTimeout(200);
  ok('a prévia do slide muda enquanto digita', /Título editado no teste/.test(await txt(pe, '.bnpv[data-pv="0"]')));
  await pe.selectOption('[data-bn="b2.act"][data-i="0"]', 'none'); await pe.waitForTimeout(300);
  ok('trocar o botão para "Sem botão" tira o botão da prévia', !/Site/.test(await txt(pe, '.bnpv[data-pv="0"]')));
  await pe.selectOption('[data-bn="b2.act"][data-i="0"]', 'game'); await pe.waitForTimeout(500);
  const gopts = await pe.evaluate(() => [...document.querySelectorAll('[data-bn="b2.val"][data-i="0"] option')].map(o => o.textContent));
  ok('"Abrir um jogo" lista os jogos da plataforma', gopts.some(t => /Jogo Pasta/.test(t)), JSON.stringify(gopts));
  await pe.selectOption('[data-bn="b2.val"][data-i="0"]', { label: gopts.find(t => /Jogo Pasta/.test(t)) }); await pe.waitForTimeout(300);
  ok('botão de jogo abre o jogo escolhido (id com r)', await pe.evaluate(() => /data-v="r\d+"/.test(document.querySelector('.bnpv[data-pv="0"]').innerHTML)));
  await pe.selectOption('[data-bn="b2.act"][data-i="0"]', 'none'); await pe.waitForTimeout(300);
  const [fc] = await Promise.all([pe.waitForEvent('filechooser'), pe.evaluate(() => document.querySelector('[data-a=bnimg][data-v="2"]').click())]);
  await fc.setFiles({ name: 'capa.png', mimeType: 'image/png', buffer: PNG1 }); await pe.waitForTimeout(900);
  ok('escolher imagem mostra a imagem na prévia', await pe.evaluate(() => !!document.querySelector('.bnpv[data-pv="2"] .bnimg')));
  await pe.evaluate(() => document.querySelector('[data-a=bnadd]').click()); await pe.waitForTimeout(300);
  ok('novo slide é adicionado', (await pe.$$('.bnc-card')).length === 4);
  await pe.evaluate(() => document.querySelector('[data-a=bndel][data-v="3"]').click()); await pe.waitForTimeout(300);
  ok('slide pode ser apagado', (await pe.$$('.bnc-card')).length === 3);
  await pe.evaluate(() => document.querySelector('[data-a=bnmv][data-v="0_1"]').click()); await pe.waitForTimeout(300);
  ok('slide pode ser movido para baixo', /Novo jogo/.test(await txt(pe, '.bnpv[data-pv="0"]')));
  await pe.selectOption('#bnAuto', '0');
  await pe.evaluate(() => document.querySelector('[data-a=bnsave]').click()); await pe.waitForTimeout(1500);
  const after = await api('GET', '/banners');
  ok('salvar grava as mudanças no servidor', after.slides.length === 3 && after.slides[1].title === 'Título editado no teste' && after.auto === 0 && after.slides[1].b2.act === 'none', JSON.stringify(after).slice(0, 200));
  ok('o slide com imagem nova foi salvo com imagem', !!after.slides[2].image);
  ok('depois de salvar volta para a Início com o banner novo', /Novo jogo/.test(await txt(pe, '.bn')) || /Título editado/.test(await txt(pe, '.bn')));
  ok('sem erros no editor do banner', pe.errs.length === 0, pe.errs.join('|'));
  await pe.context().close();
  await api('PUT', '/admin/banners', { auto: 6, slides: [] }, adm.token);

  // Studio: Bibliotecas dentro de Avançado, dimensão Misto e tipo de projeto
  await api('POST', '/admin/studio-defaults', {}, adm.token);
  ok('categorias novas existem por padrão', (await api('GET', '/categories')).categories.some(c => /Battle Royale/.test(c)) && (await api('GET', '/categories')).categories.includes('Engine HTML'));
  ok('tipos de projeto padrão', JSON.stringify((await api('GET', '/kinds')).kinds) === JSON.stringify(['Jogo', 'Aplicativo', 'Engine', 'Ferramenta']));
  let ps = await page(phone, seed(adm));
  await goto(ps); await ps.waitForTimeout(900);
  await ps.evaluate(() => document.querySelector('[data-a=go][data-v=studio]').click()); await ps.waitForTimeout(400);
  await ps.evaluate(() => { const b = document.querySelector('[data-a=stab][data-v=pub]'); if (b) b.click(); });
  await ps.waitForTimeout(300);
  let st = await txt(ps, '#view');
  ok('Studio: não existe mais a aba Bibliotecas', !(await ps.$('[data-a=ssect][data-v=libs]')) && !!(await ps.$('[data-a=ssect][data-v=adv]')));
  ok('Studio: seletor de dimensão com Misto e tipo de projeto', /2D e 3D/.test(st) && /Tipo de projeto/.test(st) && !!(await ps.$('#sKind')));
  await ps.evaluate(() => { document.querySelector('[data-a=sdim][data-v=Misto]').click(); });
  await ps.waitForTimeout(200);
  ok('Misto fica marcado', await ps.evaluate(() => document.querySelector('[data-a=sdim][data-v=Misto]').getAttribute('aria-pressed') === 'true'));
  const opts = await ps.evaluate(() => [...document.querySelectorAll('#sKind option')].map(o => o.textContent));
  ok('o tipo vem da lista do servidor', opts.join() === 'Jogo,Aplicativo,Engine,Ferramenta', opts.join());
  await ps.evaluate(() => document.querySelector('[data-a=ssect][data-v=adv]').click());
  await ps.waitForTimeout(250);
  st = await txt(ps, '#view');
  ok('Avançado traz as bibliotecas', /Bibliotecas externas/.test(st) && /Configurações avançadas/.test(st));
  ok('sem aba Missões do Studio com missões desligadas? (ligada: aparece)', !!(await ps.$('[data-a=ssect][data-v=mis]')));
  // análise automática do arquivo: aparece na revisão e vira requisitos na página do jogo
  await ps.evaluate(() => document.querySelector('[data-a=ssect][data-v=code]').click()); await ps.waitForTimeout(200);
  await ps.evaluate(() => document.querySelector('[data-a=smode][data-v=code]').click()); await ps.waitForTimeout(200);
  await ps.fill('#sCode', '<!doctype html><meta name=viewport content="width=device-width"><canvas id=c></canvas><script>const s=new THREE.Scene();c.getContext("webgl2")</script>');
  await ps.evaluate(() => document.querySelector('[data-a=ssect][data-v=rev]').click()); await ps.waitForTimeout(1200);
  st = await txt(ps, '#view');
  ok('Revisar mostra a análise do arquivo (tamanho, memória, motor)', /Análise do arquivo/.test(st) && /Three\.js/.test(st) && /Memória/.test(st) && /WebGL 2/.test(st), st.slice(0, 300));
  ok('sem erros no Studio', ps.errs.length === 0, ps.errs.join('|'));
  await ps.context().close();
  const gp = await api('POST', '/games', { title: 'Leve Demais', description: 'jogo pequeno', category: 'Ação', age: 'Livre', dim: '2D', libs: [], code: '<!doctype html><canvas id=c></canvas><script>c.getContext("2d")</script>', orientation: 'auto', tags: [], version: '1.0.0', visibility: 'public', settings: {} }, adm.token);
  let pd = await page(phone, seed(adm));
  await goto(pd); await pd.waitForTimeout(600);
  await pd.evaluate((id) => { const b = document.querySelector('[data-a=open][data-v="r' + id + '"]') || document.querySelector('[data-a=open]'); b.click(); }, gp.id);
  await pd.waitForTimeout(400);
  await pd.evaluate(() => [...document.querySelectorAll('[data-a=dtab]')].find(b => /Requisitos/.test(b.textContent)).click()); await pd.waitForTimeout(300);
  const dt = await txt(pd, '#view');
  ok('requisitos do jogo vêm da análise (512 MB, tamanho, sem internet)', /512 MB/.test(dt) && /Tamanho do jogo/.test(dt) && /Funciona sem internet/.test(dt) && /Leve/.test(dt), dt.slice(0, 500));
  await pd.context().close();
  // painel: aba Studio em Configurações
  ps = await page({ viewport: { width: 1280, height: 900 } }, seed(adm));
  await goto(ps); await ps.waitForTimeout(900);
  await ps.evaluate(() => { document.querySelector('#admb').click(); });
  await ps.waitForTimeout(700);
  await ps.evaluate(() => [...document.querySelectorAll('.wnav')].find(b => /Configurações/.test(b.textContent)).click()); await ps.waitForTimeout(700);
  await ps.evaluate(() => [...document.querySelectorAll('.wtab')].find(b => /Studio/.test(b.textContent)).click());
  await ps.waitForTimeout(900);
  st = await txt(ps, '#ws');
  ok('Configurações → Studio lista categorias e tipos', /Categorias dos jogos/.test(st) && /Tipos de projeto/.test(st) && /Battle Royale/.test(st) && /Aplicativo/.test(st), st.slice(0, 200));
  await ps.fill('#wsSt_kind', 'Plugin'); await ps.click('[data-a=w_stadd][data-v=kind]'); await ps.waitForTimeout(700);
  ok('adicionar tipo pelo painel', (await api('GET', '/kinds')).kinds.includes('Plugin'));
  await ps.fill('#wsSt_cat', 'Cartas'); await ps.click('[data-a=w_stadd][data-v=cat]'); await ps.waitForTimeout(700);
  ok('adicionar categoria pelo painel', (await api('GET', '/categories')).categories.includes('Cartas'));
  await ps.evaluate(() => document.querySelector('[data-a=w_strm][data-v="kind:Plugin"]').click()); await ps.waitForTimeout(700);
  ok('remover tipo pelo painel', !(await api('GET', '/kinds')).kinds.includes('Plugin'));
  ok('sem erros no painel de configurações', ps.errs.length === 0, ps.errs.join('|'));
  await ps.context().close();
  // servidor visível só para o administrador
  let pad2 = await page(phone, NATIVE(10) + seed(adm));
  await goto(pad2); await pad2.waitForTimeout(500);
  await pad2.click('#cfgb'); await pad2.waitForTimeout(400);
  ok('administrador no Android vê o servidor', /game-platform-dgvz\.onrender\.com|Servidor oficial/.test(await txt(pad2, '#view')));
  await pad2.context().close();
  await br.close();
}
main().catch(e => { console.error(e); fail++; }).finally(() => {
  console.log(`\n${pass} ok, ${fail} falhas`);
  srv.kill(); mock.close(); process.exit(fail ? 1 : 0);
});
