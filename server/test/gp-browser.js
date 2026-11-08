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
  ok('no Android não há campo para trocar o servidor', await pa.evaluate(() => !document.getElementById('srvUrl')) && /Servidor oficial/.test(await txt(pa, '#view')));
  ok('o servidor oficial é a base das chamadas', await pa.evaluate(() => /game-platform-dgvz\.onrender\.com/.test(document.querySelector('#view').textContent)));
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
  ok('mostra conexão e versões do sistema', /Conexão com o servidor/.test(ut) && /Interface/.test(ut) && /Conteúdo/.test(ut) && /HTTPS|Sem HTTPS/.test(ut));
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
  await p.evaluate(() => { const r = document.getElementById('ui_btn'); r.value = 130; r.dispatchEvent(new Event('input', { bubbles: true })); const t = document.getElementById('ui_txt'); t.value = 120; t.dispatchEvent(new Event('input', { bubbles: true })); });
  ok('cada botão de tamanho muda só a sua parte', await p.evaluate(() => { const s = getComputedStyle(document.documentElement); return s.getPropertyValue('--zb').trim() === '1.3' && s.getPropertyValue('--ts').trim() === '1.2' && s.getPropertyValue('--zm').trim() === '1' }));
  await p.waitForTimeout(500); await p.reload(); await p.waitForTimeout(1000);
  ok('o tamanho escolhido é lembrado ao reabrir', await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--zb').trim() === '1.3'));
  await p.evaluate(() => document.querySelector('[data-a=sub][data-v=uiprefs]').click()); await p.waitForTimeout(300);
  await p.evaluate(() => document.querySelector('[data-a=uireset]').click()); await p.waitForTimeout(200);
  ok('restaurar o padrão', await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--zb').trim() === '1'));
  // atalhos
  await p.evaluate(() => document.querySelector('[data-a=shtg][data-v=missions]').click()); await p.waitForTimeout(150);
  await p.evaluate(() => document.querySelector('[data-a=shtg][data-v=notif]').click()); await p.waitForTimeout(150);
  await p.evaluate(() => document.querySelector('[data-a=shmv][data-v="notif:-1"]').click()); await p.waitForTimeout(150);
  await p.evaluate(() => document.querySelector('[data-a=back]').click()); await p.waitForTimeout(250);
  const names = await p.evaluate(() => [...document.querySelectorAll('.shorts .sct span:last-child')].map(e => e.textContent));
  ok('atalhos da tela inicial: remover, adicionar e reordenar', JSON.stringify(names) === JSON.stringify(['Loja', 'Biblioteca', 'Avisos', 'Conquistas']), JSON.stringify(names));
  ok('jogador comum não tem atalho de Auditoria/Painel', await p.evaluate(() => { document.querySelector('[data-a=sub][data-v=uiprefs]').click(); return true; }) && !/Auditoria|Painel|Versões|Enviar aviso/.test(await txt(p, '#view')));
  await p.evaluate(() => document.querySelector('[data-a=back]').click());
  await p.evaluate(() => { document.querySelector('[data-a=sub][data-v=uiprefs]').click(); }); await p.waitForTimeout(250);
  await p.evaluate(() => { const c = document.querySelector('[data-uih=hero]'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); });
  await p.evaluate(() => document.querySelector('[data-a=back]').click()); await p.waitForTimeout(250);
  ok('blocos da tela inicial podem ser escondidos', await p.evaluate(() => !document.querySelector('.hero')));
  await p.context().close();
  // admin: atalho de Auditoria
  p = await page({ ...phone }, seed(adm));
  await goto(p);
  await p.evaluate(() => document.querySelector('[data-a=sub][data-v=uiprefs]').click()); await p.waitForTimeout(250);
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
  await br.close();
}
main().catch(e => { console.error(e); fail++; }).finally(() => {
  console.log(`\n${pass} ok, ${fail} falhas`);
  srv.kill(); mock.close(); process.exit(fail ? 1 : 0);
});
