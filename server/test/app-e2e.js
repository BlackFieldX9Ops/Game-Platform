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

function open(seed) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: URL_,
    beforeParse(w) {
      w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => {}, set: () => true });
      w.fetch = (u, o) => fetch(new URL(u, URL_), o);
      w.WebSocket = WebSocket; w.AbortController = AbortController;
      if (seed) Object.entries(seed).forEach(([k, v]) => w.localStorage.setItem(k, JSON.stringify(v)));
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

  // app limpo: nada de conteúdo fictício
  const FAKE = /LunaPixel|DarkNinja|Mito_Gamer|Arcanist|Mythic|Chuva de Blocos|Túnel Neon|Eternal Quest|ShadowNinja|LuaAstral|DarkPlayer|exemplo/;
  const C = open();
  await wait(300);
  ok('início vazio, sem jogos de exemplo', /Ainda não há jogos publicados/.test(C.text()) && !FAKE.test(C.text()));
  for (const [tab, sub] of [['store'], ['lib'], ['profile'], ['profile', 'community'], ['profile', 'friends'], ['profile', 'wish'], ['profile', 'upd'], ['profile', 'ach']]) {
    C.click(`[data-a="go"][data-v="${tab}"]`); if (sub) C.click(`[data-a="sub"][data-v="${sub}"]`);
    if (FAKE.test(C.text())) ok(`sem conteúdo fictício em ${tab}/${sub || ''}`, false, C.text().slice(0, 80));
  }
  ok('sem conteúdo fictício em nenhuma tela', true);
  C.click('[data-a="go"][data-v="profile"]'); C.click('[data-a="sub"][data-v="community"]');
  ok('comunidade começa sem posts', /Ninguém publicou ainda/.test(C.text()));
  C.click('[data-a="back"]'); C.click('[data-a="go"][data-v="profile"]'); C.click('[data-a="sub"][data-v="friends"]');
  ok('amigos offline pedem conta e não listam ninguém', /precisam de uma conta/.test(C.text()) && !C.$('[data-a="chatopen"]'));
  C.click('[data-a="back"]'); C.click('[data-a="sub"][data-v="upd"]');
  ok('notificações começam vazias', /Nenhuma notificação/.test(C.text()));
  // dados de demonstração salvos por versões antigas são apagados uma única vez
  const old = open({ gp_friends: [{ n: 'LunaPixel', st: 'online', g: 'x' }], gp_mod: [{ id: 1, t: 'Relato', m: 'x', a: '1' }], gp_users: [{ n: 'ShadowNinja', e: 'a@b.c', st: 'Ativo' }], gp_upd: [{ id: 'u1', t: 'Túnel Neon', d: 'x', a: '2 h' }], gp_lib: { d1: 1, u9: 1 }, gp_plays: 12, gp_xp: 300, gp_chats: { LunaPixel: [{ me: 1, t: 'oi' }] }, gp_name: 'Eu' });
  await wait(300);
  ok('migração apaga amigos, moderação, usuários, notificações, chats e contadores de demonstração', old.w.localStorage.getItem('gp_friends') === null && old.w.localStorage.getItem('gp_chats') === null && old.w.localStorage.getItem('gp_xp') === null && old.w.localStorage.getItem('gp_plays') === null && !FAKE.test(old.text()));
  ok('migração tira só os jogos de exemplo da biblioteca', JSON.stringify(JSON.parse(old.w.localStorage.getItem('gp_lib'))) === '{"u9":1}');
  ok('migração mantém o nome do usuário', JSON.parse(old.w.localStorage.getItem('gp_name')) === 'Eu');
  ok('app limpo sem erros de script', C.errs.length === 0 && old.errs.length === 0, JSON.stringify([C.errs, old.errs]));

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
  ok('sem código o painel de administração continua fechado', await until(() => A.$('#admCode2') && /Crie um código/.test(A.text())) && !A.$('[data-a="sub"][data-v="admin"]'));
  A.set('admCode', 'abc'); A.set('admCode2', 'abc'); A.click('[data-a="admgo"]');
  ok('código curto é recusado', /pelo menos 6/.test(A.toast()));
  A.set('admCode', 'segredo1'); A.set('admCode2', 'diferente'); A.click('[data-a="admgo"]');
  ok('códigos diferentes são recusados', /não são iguais/.test(A.toast()) && !A.$('[data-a="sub"][data-v="admin"]'));
  A.set('admCode', 'segredo1'); A.set('admCode2', 'segredo1'); A.click('[data-a="admgo"]');
  ok('criar o código ativa o administrador local', await until(() => /Ativo/.test(A.text()) && !!A.$('[data-a="admlock"]')));
  ok('o código não fica guardado em texto puro', !/segredo1/.test(A.w.localStorage.getItem('gp_admcode')) && /"h":"[0-9a-f]{64}"/.test(A.w.localStorage.getItem('gp_admcode')));
  ok('sha256 confere com a referência', A.w.eval("GPT.sha256('abc')") === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  A.click('[data-a="admlock"]');
  ok('bloquear fecha o menu de administração', await until(() => !A.$('[data-a="admlock"]')));
  A.click('[data-a="go"][data-v="profile"]'); ok('perfil sem menu de administração quando bloqueado', !A.$('[data-a="sub"][data-v="admin"]'));
  A.click('[data-a="sub"][data-v="settings"]'); await until(() => A.$('input[data-cfg="admin"]'));
  const sw2 = A.$('input[data-cfg="admin"]'); sw2.checked = true; sw2.dispatchEvent(new A.w.Event('change', { bubbles: true }));
  await until(() => A.$('#admCode') && !A.$('#admCode2'));
  A.set('admCode', 'errado1'); A.click('[data-a="admgo"]');
  ok('código errado é recusado', /incorreto/.test(A.toast()) && !A.$('[data-a="admlock"]'));
  A.set('admCode', 'segredo1'); A.click('[data-a="admgo"]');
  ok('código certo desbloqueia', await until(() => !!A.$('[data-a="admlock"]')));
  A.click('[data-a="back"]'); A.click('[data-a="sub"][data-v="admin"]');
  ok('administração de demonstração abre com as abas', await until(() => /Administrador local \(temporário\)/.test(A.text()) && A.$('[data-a="atab"][data-v="logs"]')));
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
  A.click('[data-a="go"][data-v="profile"]'); A.click('[data-a="sub"][data-v="admin"]');
  A.click('[data-a="atab"][data-v="loja"]'); await until(() => A.$('[data-a="gdel"]'));
  const nDel = A.d.querySelectorAll('[data-a="gdel"]').length;
  A.click('[data-a="gdel"]');
  ok('excluir pede confirmação antes', await until(() => /Confirmar/.test(A.text())) && A.d.querySelectorAll('.btn.danger[data-a="gdel"]').length === 1);
  A.click('[data-a="gdel"]');
  ok('admin exclui o jogo publicado (demo)', await until(() => A.d.querySelectorAll('[data-a="gdel"]').length === nDel - 1), A.toast());
  A.click('[data-a="go"][data-v="home"]');
  ok('início não mostra XP nem nível', await until(() => /Jogos lançados/.test(A.text())) && !/XP|Nível/.test(A.text()));
  A.click('[data-a="go"][data-v="profile"]');
  ok('perfil mostra nível e XP', await until(() => /NÍVEL/.test(A.text()) && /XP/.test(A.text()) && /Meu legado/.test(A.text())));
  A.click('[data-a="sub"][data-v="editprof"]'); await until(() => A.$('#pfName'));
  ok('editar perfil abre com o nome atual', A.$('#pfName').value === 'Jogador');
  A.set('pfName', 'ShadowVortex'); A.set('pfBio', 'Criador de mundos'); A.click('[data-a="pfsave"]');
  ok('perfil salvo mostra nome e bio', await until(() => /ShadowVortex/.test(A.text()) && /Criador de mundos/.test(A.text())), A.toast());
  A.click('[data-a="sub"][data-v="editprof"]'); await until(() => A.$('#pfName'));
  A.set('pfName', 'ab'); A.click('[data-a="pfsave"]');
  ok('nome curto demais é recusado', await until(() => /3 a 20/.test(A.toast())));
  A.click('[data-a="back"]');
  const det = A.w.eval("[GPT.oriDetect(\"screen.orientation.lock('landscape')\"),GPT.oriDetect('{orientation:\"portrait\"}'),GPT.oriDetect('var x=1'),GPT.oriDetect('<meta name=\"screen-orientation\" content=\"landscape\">')].join()");
  ok('detecta a orientação pelo código do jogo', det === 'landscape,portrait,,landscape');
  ok('nenhum erro de script', [A, B, AD].every(x => x.errs.length === 0), JSON.stringify([A.errs, B.errs, AD.errs]));
}
try { await main(); } catch (e) { fail++; console.error('ERRO', e); }
srv.kill(); rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} passaram, ${fail} falharam`); process.exit(fail ? 1 : 0);
