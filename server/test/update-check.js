// Testa a verificação de atualização do app (build instalado x release apk-latest).
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch { console.log('jsdom não instalado.'); process.exit(0); }
const raw = readFileSync(existsSync('www/index.html') ? 'www/index.html' : '../app/www/index.html', 'utf8');
let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : fail++; console.log(`${c ? 'OK   ' : 'FALHA'} ${n}`); };
const wait = ms => new Promise(r => setTimeout(r, ms));

function run(build, latest) {
  const html = raw.replace('<meta name="gp-build" content="">', `<meta name="gp-build" content="${build}">`);
  const calls = [];
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://localhost/', beforeParse(w) {
    w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => {}, set: () => true });
    w.fetch = async u => { calls.push(String(u)); if (/api\.github\.com/.test(u)) return { ok: true, json: async () => ({ name: 'APK mais recente', body: `Build ${latest}. APK de teste`, assets: [{ name: 'game-platform.apk', browser_download_url: 'https://github.com/x/y/releases/download/apk-latest/game-platform.apk' }] }) }; throw new Error('offline'); };
    w.open = u => { calls.push('OPEN ' + u); };
  } });
  return { w: dom.window, d: dom.window.document, calls };
}
const view = x => x.d.getElementById('view').textContent;

(async () => {
  const novo = run(5, 7);
  await wait(3800);
  ok('consulta a release do repositório', novo.calls.some(c => /api\.github\.com\/repos\/BlackFieldX9Ops\/Game-Platform\/releases\/tags\/apk-latest/.test(c)));
  ok('avisa na Home quando há versão nova', /Nova versão disponível/.test(view(novo)) && /Build 7/.test(view(novo)));
  novo.d.querySelector('[data-a="doupd"]').click();
  ok('"Atualizar" abre o download do APK', novo.calls.includes('OPEN https://github.com/x/y/releases/download/apk-latest/game-platform.apk'));
  novo.d.querySelector('[data-a="go"][data-v="profile"]').click();
  novo.d.querySelector('[data-a="sub"][data-v="settings"]').click();
  ok('Configurações mostram versão instalada e botão de verificar', /build 5/.test(view(novo)) && !!novo.d.querySelector('[data-a="chkupd"]'));

  const igual = run(7, 7);
  await wait(3800);
  ok('sem aviso quando já está na última', !/Nova versão disponível/.test(view(igual)));

  const web = run('', 9);
  await wait(3800);
  ok('app de navegador não consulta nem avisa', !web.calls.some(c => /api\.github\.com/.test(c)) && !/Nova versão disponível/.test(view(web)));
  console.log(`\n${pass} passaram, ${fail} falharam`);
  process.exit(fail ? 1 : 0);
})();
