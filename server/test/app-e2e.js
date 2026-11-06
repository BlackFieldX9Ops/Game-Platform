// Teste do app de verdade (www/index.html) conversando com o servidor, com dois jogadores.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { WebSocket } from 'ws';

const require = createRequire(import.meta.url);
let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch { console.log('jsdom não instalado: rode "npm i --no-save jsdom" para este teste.'); process.exit(0); }

const PORT = 3997, URL_ = `http://localhost:${PORT}/`;
const dir = mkdtempSync(path.join(tmpdir(), 'gp-e2e-'));
const srv = spawn('node', ['--disable-warning=ExperimentalWarning', 'src/index.js'], { env: { ...process.env, PORT, DB_FILE: path.join(dir, 'e.db'), ADMIN_EMAIL: 'adm@x.com', JWT_SECRET: 't' }, stdio: ['ignore', 'ignore', 'inherit'] });
const html = readFileSync(existsSync('www/index.html') ? 'www/index.html' : '../app/www/index.html', 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'OK   ' : 'FALHA'} ${n}${c ? '' : ' ' + x}`); };
const wait = ms => new Promise(r => setTimeout(r, ms));

function open() {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: URL_,
    beforeParse(w) {
      w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => {}, set: () => true });
      w.fetch = (u, o) => fetch(new URL(u, URL_), o);
      w.WebSocket = WebSocket; w.AbortController = AbortController;
    }
  });
  const w = dom.window, d = w.document, errs = [];
  w.addEventListener('error', e => errs.push(e.message));
  const $ = s => d.querySelector(s);
  const click = s => { const el = $(s); if (!el) { errs.push('faltou ' + s); return; } el.click(); };
  const set = (id, v) => { $('#' + id).value = v; };
  const text = () => d.getElementById('view').textContent;
  const toast = () => d.getElementById('toast').textContent;
  return { w, d, $, click, set, text, toast, errs };
}
async function until(fn, ms = 4000) { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await wait(60); } return false; }

async function main() {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(URL_ + 'api/health')).ok) break; } catch {} await wait(150); }
  const A = open(), B = open();
  await wait(400);

  // Ana cria conta
  A.click('[data-a="go"][data-v="profile"]'); A.click('[data-a="sub"][data-v="auth"]');
  await until(() => A.$('#aMail'));
  A.click('[data-a="authtab"][data-v="reg"]');
  A.set('aName', 'Ana'); A.set('aMail', 'ana@x.com'); A.set('aPass', 'senha12345'); A.click('[data-a="authgo"]');
  ok('cadastro pelo app', await until(() => /Conta online/.test(A.text())), A.toast());

  // Ana publica um jogo
  A.click('[data-a="go"][data-v="studio"]'); A.click('[data-a="stab"][data-v="pub"]');
  A.set('sTitle', 'Meu Jogo'); A.set('sDesc', 'Um jogo de teste'); A.click('[data-a="smode"][data-v="code"]'); A.click('[data-a="tpl"]'); A.set('sTitle', 'Meu Jogo');
  A.click('[data-a="spub"]');
  ok('jogo publicado na Loja do servidor', await until(() => /Meu Jogo/.test(A.text()) && /Publicado na Loja|Meu Jogo/.test(A.text())), A.toast());
  const direct = await (await fetch(URL_ + 'api/games')).json();
  ok('o servidor lista o jogo sem expor o código', direct.games.length === 1 && direct.games[0].developer === 'Ana' && direct.games[0].code === undefined);

  // Beto cria conta, vê o jogo, joga, avalia
  B.click('[data-a="go"][data-v="profile"]'); B.click('[data-a="sub"][data-v="auth"]');
  await until(() => B.$('#aMail')); B.click('[data-a="authtab"][data-v="reg"]');
  B.set('aName', 'Beto'); B.set('aMail', 'beto@x.com'); B.set('aPass', 'senha12345'); B.click('[data-a="authgo"]');
  await until(() => /Conta online/.test(B.text()));
  B.click('[data-a="go"][data-v="store"]');
  ok('Beto vê o jogo da Ana na Loja', await until(() => /Meu Jogo/.test(B.text())));
  const gcard = [...B.d.querySelectorAll('[data-a="open"]')].find(e => /Meu Jogo/.test(e.textContent)); gcard.click();
  await until(() => B.$('[data-a="play"]'));
  B.click('[data-a="play"]');
  ok('jogar abre o player com o código vindo do servidor', await until(() => !B.d.getElementById('player').hidden && /requestAnimationFrame/.test(B.d.getElementById('frame').srcdoc || '')));
  B.click('#pClose');
  B.click('[data-a="star"][data-v="4"]'); B.set('rvText', 'Gostei bastante'); B.click('[data-a="revpub"]');
  ok('avaliação aparece na tela', await until(() => /Gostei bastante/.test(B.text())), B.toast());
  B.click('[data-a="add"]');
  await until(() => /Na biblioteca/.test(B.text()));
  B.click('[data-a="go"][data-v="lib"]');
  ok('biblioteca do Beto guarda o jogo', await until(() => /Meu Jogo/.test(B.text())));

  // Amizade e chat em tempo real
  B.click('[data-a="go"][data-v="profile"]'); B.click('[data-a="sub"][data-v="friends"]');
  B.set('fName', 'Ana'); B.click('[data-a="addfriend"]');
  ok('pedido de amizade enviado', await until(() => /Pedido enviado/.test(B.text())), B.toast());
  A.click('[data-a="go"][data-v="profile"]'); A.click('[data-a="sub"][data-v="friends"]');
  ok('Ana vê o pedido ao abrir a tela de amigos', await until(() => A.$('[data-a="accept"]')));
  A.click('[data-a="accept"]');
  ok('Ana aceita e os dois viram amigos', await until(() => A.$('[data-a="chatopen"]')));
  A.click('[data-a="chatopen"]');
  await until(() => A.$('#chatIn'));
  A.set('chatIn', 'Oi, Beto!'); A.click('[data-a="send"]');
  await wait(300);
  ok('Beto recebe a mensagem ao vivo (aviso na tela)', await until(() => /Mensagem de Ana/.test(B.toast())), B.toast());

  // Denúncia e moderação
  const gb = [...B.d.querySelectorAll('[data-a="open"]')];
  B.click('[data-a="go"][data-v="store"]');
  [...B.d.querySelectorAll('[data-a="open"]')].find(e => /Meu Jogo/.test(e.textContent)).click();
  await until(() => B.$('[data-a="report"]'));
  B.click('[data-a="report"]');
  ok('Beto denuncia o jogo', await until(() => /Denúncia enviada/.test(B.toast())), B.toast());

  // Admin entra e remove
  const AD = open(); await wait(300);
  AD.click('[data-a="go"][data-v="profile"]'); AD.click('[data-a="sub"][data-v="auth"]');
  await until(() => AD.$('#aMail')); AD.click('[data-a="authtab"][data-v="reg"]');
  AD.set('aName', 'Admin'); AD.set('aMail', 'adm@x.com'); AD.set('aPass', 'senha12345'); AD.click('[data-a="authgo"]');
  await until(() => /Conta online/.test(AD.text()));
  ok('menu de administração aparece para admin', !!AD.$('[data-a="sub"][data-v="admin"]'));
  AD.click('[data-a="sub"][data-v="admin"]');
  ok('painel de administração mostra os números', await until(() => /Usuários/.test(AD.text()) && /Denúncias pendentes/.test(AD.text())));
  // destaques, categorias e logs
  AD.click('[data-a="atab"][data-v="loja"]');
  ok('aba Loja lista o jogo para destacar', await until(() => /Meu Jogo/.test(AD.text()) && AD.$('[data-a="gfeat"]')));
  AD.click('[data-a="gfeat"]');
  ok('admin destaca o jogo pelo app', await until(() => /1\/8/.test(AD.text())));
  const feat = await (await fetch(URL_ + 'api/games')).json();
  ok('o servidor marca o jogo como destaque', feat.games[0].featured === true);
  AD.set('newCat', 'Esportes'); AD.click('[data-a="catadd"]');
  await wait(600);
  ok('admin adiciona categoria pelo app', (await (await fetch(URL_ + 'api/categories')).json()).categories.includes('Esportes'));
  AD.click('[data-a="atab"][data-v="logs"]');
  ok('logs mostram as ações feitas', await until(() => /Jogo destacado/.test(AD.text()) && /Categorias alteradas/.test(AD.text())));
  AD.click('[data-a="atab"][data-v="mod"]');
  ok('fila de moderação mostra a denúncia', await until(() => /Motivo: Conteúdo impróprio/.test(AD.text())));
  [...AD.d.querySelectorAll('[data-a="repres"]')].find(e => /remove/.test(e.dataset.v)).click();
  await wait(700);
  const after = await (await fetch(URL_ + 'api/games')).json();
  ok('conteúdo removido pelo admin some da Loja', after.games.length === 0);
  ok('Ana (usuária comum) não vê o menu de administração', !A.$('[data-a="sub"][data-v="admin"]'));

  // Sair e voltar ao modo offline
  A.click('[data-a="go"][data-v="profile"]'); A.click('[data-a="sub"][data-v="settings"]'); A.click('[data-a="logout"]');
  ok('sair volta ao modo offline', await until(() => /Entrar ou criar conta/.test(A.text())));
  // Studio offline: rascunho, chips de bibliotecas, publicar; administração de demonstração
  A.click('[data-a="go"][data-v="studio"]');
  ok('Studio mostra o aviso de modo offline', await until(() => /Modo offline/.test(A.text())));
  A.set('sTitle', 'Rascunho Um');
  A.click('[data-a="smode"][data-v="code"]'); A.click('[data-a="tpl"]');
  A.click('[data-a="lib"][data-v="phaser"]');
  ok('chip de biblioteca fica marcado', await until(() => A.$('[data-a="lib"][data-v="phaser"]').getAttribute('aria-pressed') === 'true'));
  ok('editor mostra números de linha', /^1\n2\n3/.test(A.d.getElementById('gut').textContent));
  A.click('[data-a="draftsave"]');
  ok('rascunho é guardado e listado', await until(() => /Rascunhos/.test(A.text()) && /Rascunho Um/.test(A.text())));
  A.click('[data-a="spub"]');
  ok('publicar offline adiciona o jogo e remove o rascunho', await until(() => /Meus jogos publicados/.test(A.text()) && /Rascunho Um/.test(A.text()) && !/Continuar/.test(A.text())), A.toast());
  A.click('[data-a="go"][data-v="profile"]'); A.click('[data-a="sub"][data-v="settings"]');
  await until(() => A.$('input[data-cfg="admin"]'));
  const sw = A.$('input[data-cfg="admin"]'); sw.checked = true; sw.dispatchEvent(new A.w.Event('change', { bubbles: true }));
  A.click('[data-a="back"]'); A.click('[data-a="sub"][data-v="admin"]');
  ok('administração de demonstração abre com as abas', await until(() => /Dados de demonstração/.test(A.text()) && A.$('[data-a="atab"][data-v="logs"]')));
  A.click('[data-a="atab"][data-v="loja"]'); await until(() => A.$('[data-a="gfeat"]'));
  A.click('[data-a="gfeat"]');
  A.click('[data-a="atab"][data-v="logs"]');
  ok('demo: destacar gera log local', await until(() => /Jogo destacado/.test(A.text())));
  A.click('[data-a="go"][data-v="home"]');
  ok('demo: jogo destacado aparece com a marca na Início', await until(() => /Destaque/.test(A.text())));
  // orientação: fora do jogo em pé; o jogo pede paisagem e o app gira
  const calls = []; A.w.GPNative = { setFullscreen() {}, setOrientation(m) { calls.push(m); }, getBuild() { return '0'; }, openUrl() {} };
  A.click('[data-a="go"][data-v="studio"]'); await until(() => A.$('[data-a="sori"][data-v="landscape"]'));
  A.set('sTitle', 'Deitado'); A.click('[data-a="smode"][data-v="code"]'); A.click('[data-a="tpl"]');
  A.click('[data-a="sori"][data-v="landscape"]');
  ok('Studio marca a orientação escolhida', await until(() => A.$('[data-a="sori"][data-v="landscape"]').getAttribute('aria-pressed') === 'true'));
  A.click('[data-a="spub"]'); await until(() => /Deitado/.test(A.text()) && A.d.querySelectorAll('[data-a="play"]').length);
  const play = [...A.d.querySelectorAll('[data-a="play"]')].find(b => /Deitado/.test(b.closest('.li').textContent));
  play.click();
  ok('jogo marcado como paisagem gira o app para paisagem', await until(() => calls.includes('landscape')));
  A.$('#pClose').click();
  ok('ao sair do jogo o app volta para retrato', await until(() => calls[calls.length - 1] === 'portrait'));
  const outro = [...A.d.querySelectorAll('[data-a="play"]')].find(b => /Rascunho Um/.test(b.closest('.li').textContent));
  outro.click(); await wait(200);
  ok('jogo automático não força a posição', calls[calls.length - 1] === 'auto');
  A.w.dispatchEvent(new A.w.MessageEvent('message', { data: { gp: 'orient', m: 'landscape-primary' }, source: A.$('#frame').contentWindow }));
  ok('jogo que pede paisagem por screen.orientation.lock gira o app', await until(() => calls[calls.length - 1] === 'landscape'));
  A.w.dispatchEvent(new A.w.MessageEvent('message', { data: { gp: 'orient', m: 'any' }, source: A.$('#frame').contentWindow }));
  A.w.dispatchEvent(new A.w.MessageEvent('message', { data: { gp: 'orient', m: 'portrait' }, source: A.$('#frame').contentWindow }));
  ok('jogo que pede retrato gira o app para retrato', await until(() => calls[calls.length - 1] === 'portrait'));
  A.$('#pClose').click();
  const det = A.w.eval("[GPT.oriDetect(\"screen.orientation.lock('landscape')\"),GPT.oriDetect('{orientation:\"portrait\"}'),GPT.oriDetect('var x=1'),GPT.oriDetect('<meta name=\"screen-orientation\" content=\"landscape\">')].join()");
  ok('detecta a orientação pelo código do jogo', det === 'landscape,portrait,,landscape');
  ok('nenhum erro de script', [A, B, AD].every(x => x.errs.length === 0), JSON.stringify([A.errs, B.errs, AD.errs]));
}
try { await main(); } catch (e) { fail++; console.error('ERRO', e); }
srv.kill(); rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} passaram, ${fail} falharam`); process.exit(fail ? 1 : 0);
