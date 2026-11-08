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
const srv = spawn('node', ['--disable-warning=ExperimentalWarning', 'src/index.js'], { env: { ...process.env, PORT, DB_FILE: path.join(dir, 'e.db'), ADMIN_EMAIL: 'adm@x.com', STUDIO_GATE: 'off', JWT_SECRET: 't' }, stdio: ['ignore', 'ignore', 'inherit'] });
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
  w.eval('GPT.forceStudio()'); // os testes antigos usam o Studio sem comprar o plano
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
  for (const [tab, sub] of [['store'], ['lib'], ['profile'], ['chat'], ['profile', 'wish'], ['profile', 'upd'], ['profile', 'ach']]) {
    C.click(`[data-a="go"][data-v="${tab}"]`); if (sub) C.click(`[data-a="sub"][data-v="${sub}"]`);
    if (FAKE.test(C.text())) ok(`sem conteúdo fictício em ${tab}/${sub || ''}`, false, C.text().slice(0, 80));
  }
  ok('sem conteúdo fictício em nenhuma tela', true);
  C.click('[data-a="go"][data-v="chat"]'); C.click('[data-a="ctab"][data-v="feed"]');
  ok('comunidade começa sem posts', /Nenhuma publicação ainda/.test(C.text()));
  C.click('[data-a="ctab"][data-v="friends"]');
  ok('amigos offline pedem conta e não listam ninguém', /é preciso ter uma conta/.test(C.text()) && !C.$('[data-a="chatopen"]'));
  C.click('[data-a="sub"][data-v="upd"]');
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
  ok('cadastro pelo app', await until(() => /ID #[0-9]{3}/.test(A.text())), A.toast());

  // Ana publica um jogo
  A.click('[data-a="go"][data-v="studio"]'); A.click('[data-a="stab"][data-v="pub"]');
  A.set('sTitle', 'Meu Jogo'); A.set('sDesc', 'Um jogo de teste'); A.click('[data-a="ssect"][data-v="code"]'); A.click('[data-a="smode"][data-v="code"]'); A.click('[data-a="tpl"]');
  A.click('[data-a="ssect"][data-v="rev"]'); A.click('[data-a="spub"]');
  ok('jogo publicado na Loja do servidor', await until(() => /Meu Jogo/.test(A.text()) && /Publicado na Loja|Meu Jogo/.test(A.text())), A.toast());
  const direct = await (await fetch(URL_ + 'api/games')).json();
  ok('o servidor lista o jogo sem expor o código', direct.games.length === 1 && direct.games[0].developer === 'Ana' && direct.games[0].code === undefined);

  // Beto cria conta, vê o jogo, joga, avalia
  B.click('[data-a="go"][data-v="profile"]'); B.click('[data-a="sub"][data-v="auth"]');
  await until(() => B.$('#aMail')); B.click('[data-a="authtab"][data-v="reg"]');
  B.set('aName', 'Beto'); B.set('aMail', 'beto@x.com'); B.set('aPass', 'senha12345'); B.click('[data-a="authgo"]');
  await until(() => /ID #[0-9]{3}/.test(B.text()));
  B.click('[data-a="go"][data-v="home"]');
  ok('Beto vê o jogo da Ana na Início', await until(() => /Meu Jogo/.test(B.text())));
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
  B.click('[data-a="go"][data-v="chat"]'); B.click('[data-a="ctab"][data-v="friends"]');
  B.set('fName', 'Ana'); B.click('[data-a="addfriend"]');
  ok('pedido de amizade enviado', await until(() => /Pedido enviado/.test(B.text())), B.toast());
  A.click('[data-a="go"][data-v="chat"]'); A.click('[data-a="ctab"][data-v="friends"]');
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
  B.click('[data-a="go"][data-v="home"]');
  [...B.d.querySelectorAll('[data-a="open"]')].find(e => /Meu Jogo/.test(e.textContent)).click();
  await until(() => B.$('[data-a="report"]'));
  B.click('[data-a="report"]');
  ok('Beto denuncia o jogo', await until(() => /Denúncia enviada/.test(B.toast())), B.toast());

  // Admin entra e remove
  const AD = open(); await wait(300);
  AD.click('[data-a="go"][data-v="profile"]'); AD.click('[data-a="sub"][data-v="auth"]');
  await until(() => AD.$('#aMail')); AD.click('[data-a="authtab"][data-v="reg"]');
  AD.set('aName', 'Admin'); AD.set('aMail', 'adm@x.com'); AD.set('aPass', 'senha12345'); AD.click('[data-a="authgo"]');
  await until(() => /ID #[0-9]{3}/.test(AD.text()));
  ok('menu de administração aparece para admin', !!AD.$('#admb:not([hidden])'));
  AD.click('[data-a="sub"][data-v="admin"]');
  ok('painel de administração mostra os números', await until(() => /Usuários/.test(AD.text()) && /Denúncias pendentes/.test(AD.text())));
  // destaques, categorias e logs
  AD.click('[data-a="atab"][data-v="jogos"]');
  ok('aba Loja lista o jogo para destacar', await until(() => /Meu Jogo/.test(AD.text()) && AD.$('[data-a="gfeat"]')));
  AD.click('[data-a="gfeat"]');
  ok('admin destaca o jogo pelo app', await until(() => /1\/8/.test(AD.text())));
  const feat = await (await fetch(URL_ + 'api/games')).json();
  ok('o servidor marca o jogo como destaque', feat.games[0].featured === true);
  // admin controla o jogo de outro usuário pelo app
  ok('lista de jogos do admin mostra criador, status e ações', /Ana/.test(AD.text()) && /Publicado/.test(AD.text()) && !!AD.$('[data-a="admedit"]') && !!AD.$('[data-a="admpub"]') && !!AD.$('[data-a="admadd"]'));
  AD.click('[data-a="ags"][data-v="unpublished"]');
  ok('filtro de status esconde o jogo publicado', await until(() => !/Meu Jogo/.test(AD.text()) && /Nenhum jogo encontrado/.test(AD.text())));
  AD.click('[data-a="ags"][data-v="all"]'); AD.click('[data-a="agc"][data-v="me"]');
  ok('filtro "Eu" não mostra jogo de outro usuário', await until(() => !/Meu Jogo/.test(AD.text())));
  AD.click('[data-a="agc"][data-v="others"]');
  ok('filtro "Outros" mostra o jogo da Ana', await until(() => /Meu Jogo/.test(AD.text())));
  AD.click('[data-a="admedit"][data-v$=":code"]');
  ok('admin abre o jogo de outro usuário no Studio', await until(() => AD.$('#sCode') && /como administrador o jogo de Ana/.test(AD.text())));
  AD.click('[data-a="ssect"][data-v="info"]'); await until(() => AD.$('#sTitle'));
  AD.set('sTitle', 'Meu Jogo Revisado'); AD.click('[data-a="ssect"][data-v="rev"]'); AD.click('[data-a="spub"]');
  ok('admin salva a edição e volta para a lista de jogos', await until(() => /Meu Jogo Revisado/.test(AD.text()) && !!AD.$('[data-a="admedit"]')), AD.toast());
  ok('o servidor guardou a edição do admin', (await (await fetch(URL_ + 'api/games')).json()).games.some(g => g.title === 'Meu Jogo Revisado'));
  AD.click('[data-a="admpub"]');
  ok('admin despublica o jogo pelo app', await until(() => !!AD.$('.agame .badge.warn')));
  ok('despublicado some da Loja pública', (await (await fetch(URL_ + 'api/games')).json()).games.length === 0);
  AD.click('[data-a="admpub"]');
  ok('admin republica o jogo', await until(() => !AD.$('.agame .badge.warn') && !!AD.$('.agame')) && (await (await fetch(URL_ + 'api/games')).json()).games.length === 1, AD.toast());
  AD.click('[data-a="atab"][data-v="users"]');
  ok('usuários mostram quantos jogos cada um tem', await until(() => /ana@x\.com · 1 jogo/.test(AD.text()) && !!AD.$('[data-a="ugames"]')));
  AD.click('[data-a="ugames"][data-v$=":Ana"]');
  ok('"Ver jogos" abre a lista filtrada pelo criador', await until(() => /Criador: Ana/.test(AD.text()) && /Meu Jogo Revisado/.test(AD.text())));
  AD.click('[data-a="ugx"]'); AD.click('[data-a="agc"][data-v="all"]');
  AD.click('[data-a="atab"][data-v="cats"]'); AD.set('newCat', 'Esportes'); AD.click('[data-a="catadd"]');
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
  ok('Ana (usuária comum) não vê o menu de administração', !A.$('#admb:not([hidden])'));

  // Sair e voltar ao modo offline
  A.click('[data-a="go"][data-v="profile"]'); A.click('[data-a="sub"][data-v="settings"]'); A.click('[data-a="logout"]');
  ok('sair volta ao modo offline', await until(() => /Entrar ou criar conta/.test(A.text())));
  // Studio offline: rascunho, chips de bibliotecas, publicar; administração de demonstração
  A.click('[data-a="go"][data-v="studio"]'); A.click('[data-a="stab"][data-v="pub"]');
  ok('Studio mostra o aviso de modo offline', await until(() => /Modo offline/.test(A.text())));
  A.set('sTitle', 'Rascunho Um');
  A.click('[data-a="ssect"][data-v="code"]'); A.click('[data-a="smode"][data-v="code"]'); A.click('[data-a="tpl"]');
  A.click('[data-a="ssect"][data-v="libs"]');
  A.click('[data-a="lib"][data-v="phaser"]');
  ok('chip de biblioteca fica marcado', await until(() => A.$('[data-a="lib"][data-v="phaser"]').getAttribute('aria-pressed') === 'true'));
  A.click('[data-a="ssect"][data-v="code"]');
  ok('editor colore o código (syntax highlight)', !!A.$('#hl i.hk') && !!A.$('#hl i.ht') && /<script>/.test(A.$('#sCode').value));
  ok('editor mostra números de linha', /^1\n2\n3/.test(A.d.getElementById('gut').textContent));
  A.click('[data-a="ssect"][data-v="rev"]'); A.click('[data-a="draftsave"]');
  ok('rascunho é guardado e listado', await until(() => /Rascunhos/.test(A.text()) && /Rascunho Um/.test(A.text())));
  A.click('[data-a="ssect"][data-v="rev"]'); A.click('[data-a="spub"]');
  ok('publicar offline adiciona o jogo e remove o rascunho', await until(() => /Meus jogos publicados/.test(A.text()) && /Rascunho Um/.test(A.text()) && !/Continuar/.test(A.text())), A.toast());
  // Studio avançado (offline): tags, avançado, bibliotecas externas, visibilidade, meus jogos
  A.click('[data-a="go"][data-v="studio"]'); A.click('[data-a="stab"][data-v="pub"]'); await until(() => A.$('#sTitle'));
  A.set('sTitle', 'Completo'); A.set('sDesc', 'abc'); A.d.getElementById('sDesc').dispatchEvent(new A.w.Event('input', { bubbles: true }));
  ok('descrição tem contador de caracteres', A.$('#dcnt').textContent === '3/200');
  ok('Studio: aba Informações não repete Testar/Publicar nem Meus jogos', !A.$('[data-a="spub"]') && !A.$('[data-a="stest"]') && !/Meus jogos publicados/.test(A.text()) && !!A.$('[data-a="spreview"]'));
  A.click('[data-a="ssect"][data-v="code"]');
  ok('Studio: aba Código tem análise do código e Testar', !!A.$('[data-a="stest"]') && !A.$('[data-a="spub"]'));
  A.click('[data-a="ssect"][data-v="libs"]');
  ok('Studio: aba Bibliotecas só tem bibliotecas', !!A.$('[data-a="lib"]') && !A.$('[data-a="stest"]') && !A.$('[data-a="spreview"]'));
  A.click('[data-a="ssect"][data-v="rev"]');
  ok('Studio: aba Revisar tem checklist, resumo e Publicar', !!A.$('[data-a="spub"]') && /Revisão/.test(A.text()) && /Resumo/.test(A.text()) && !/Meus jogos publicados/.test(A.text()));
  A.click('[data-a="ssect"][data-v="info"]');
  A.set('sTag', 'Puzzle, Relaxante, puzzle'); A.click('[data-a="tagadd"]');
  ok('tags: várias de uma vez, sem repetir', await until(() => A.d.querySelectorAll('[data-a="tagrm"]').length === 2));
  A.click('[data-a="tagrm"][data-v="relaxante"]');
  ok('tag some ao tocar nela', await until(() => A.d.querySelectorAll('[data-a="tagrm"]').length === 1));
  A.click('[data-a="ssect"][data-v="code"]'); A.click('[data-a="tplmode"]');
  ok('modo Modelo carrega o código inicial no editor', await until(() => A.$('#sCode') && /<script>/.test(A.$('#sCode').value)));
  A.click('[data-a="ssect"][data-v="libs"]');
  A.set('xUrl', 'http://ruim.com/x.js'); A.click('[data-a="extadd"]');
  ok('biblioteca externa exige https', /https/.test(A.toast()) && A.d.querySelectorAll('[data-a="extrm"]').length === 0);
  A.set('xUrl', 'https://cdn.exemplo.com/lib.min.js'); A.click('[data-a="extadd"]');
  ok('biblioteca externa por URL é adicionada', await until(() => A.d.querySelectorAll('[data-a="extrm"]').length === 1 && /lib.min.js/.test(A.text())));
  A.click('[data-a="ssect"][data-v="adv"]');
  A.set('sVer', '1.2.0'); A.click('[data-a="svis"][data-v="private"]'); A.click('[data-a="smon"][data-v="ads"]'); A.click('[data-a="sctl"][data-v="gamepad"]');
  const sw3 = A.$('input[data-ss="save"]'); sw3.checked = true; sw3.dispatchEvent(new A.w.Event('change', { bubbles: true }));
  const sw4 = A.$('input[data-ss="fs"]'); sw4.checked = false; sw4.dispatchEvent(new A.w.Event('change', { bubbles: true }));
  ok('configurações avançadas ficam marcadas', await until(() => A.$('[data-a="svis"][data-v="private"]').getAttribute('aria-pressed') === 'true' && A.$('[data-a="smon"][data-v="ads"]').getAttribute('aria-pressed') === 'true' && A.$('[data-a="sctl"][data-v="gamepad"]').getAttribute('aria-pressed') === 'true'));
  A.click('[data-a="ssect"][data-v="info"]'); A.click('[data-a="spreview"]');
  ok('pré-visualização mostra nome, versão, visibilidade e tags', await until(() => /Pré-visualização/.test(A.text()) && /v1\.2\.0/.test(A.text()) && /Privado/.test(A.text()) && /#puzzle/.test(A.text())));
  A.click('[data-a="spreview"]'); A.click('[data-a="ssect"][data-v="rev"]'); A.click('[data-a="spub"]');
  ok('jogo completo é publicado', await until(() => /Completo/.test(A.text()) && /Meus jogos publicados/.test(A.text())), A.toast());
  const mineSaved = JSON.parse(A.w.localStorage.getItem('gp_mine')).find(g => g.title === 'Completo');
  ok('o jogo guarda tags, versão, visibilidade e configurações', mineSaved && mineSaved.ver === '1.2.0' && mineSaved.vis === 'private' && mineSaved.cfg.fullscreen === 0 && mineSaved.cfg.saveProgress === 1 && mineSaved.cfg.monetization === 'ads' && mineSaved.cfg.controls.includes('gamepad') && mineSaved.cfg.ext.length === 1 && mineSaved.tags.join() === 'puzzle');
  A.click('[data-a="go"][data-v="home"]');
  ok('jogo privado não aparece na Loja', !/Completo/.test(A.text()));
  A.click('[data-a="go"][data-v="studio"]'); await until(() => A.$('[data-a="gst"]'));
  const gs = [...A.d.querySelectorAll('[data-a="gst"]')].find(b => /Completo/.test(b.closest('.mg').textContent)); gs.click();
  ok('estatísticas do jogo abrem na lista', await until(() => !!A.$('.stt') && /Partidas/.test(A.text())));
  [...A.d.querySelectorAll('[data-a="upub"]')].find(b => /Completo/.test(b.closest('.mg').textContent)).click();
  ok('dono despublica o jogo e vê o estado', await until(() => [...A.d.querySelectorAll('.mg')].find(m => /Completo/.test(m.textContent) && /Despublicado/.test(m.textContent))));
  [...A.d.querySelectorAll('[data-a="supd"]')].find(b => /Completo/.test(b.closest('.mg').textContent)).click();
  ok('Atualizar abre o código com a versão aumentada', await until(() => A.$('#sCode') && /versão 1\.2\.1/.test(A.toast())));
  A.click('[data-a="ssect"][data-v="info"]'); A.click('[data-a="go"][data-v="home"]'); A.click('[data-a="go"][data-v="studio"]'); A.click('[data-a="stab"][data-v="jogos"]'); await until(() => A.$('[data-a="mdel"]'));
  const dl = [...A.d.querySelectorAll('[data-a="mdel"]')].find(b => /Completo/.test(b.closest('.mg').textContent)); dl.click();
  ok('excluir meu jogo pede confirmação', await until(() => !!A.$('.btn.danger[data-a="mdel"]')) && /Completo/.test(A.text()));
  A.click('.btn.danger[data-a="mdel"]');
  ok('jogo excluído some de "meus jogos"', await until(() => ![...A.d.querySelectorAll('.mg')].some(m => /Completo/.test(m.textContent))));
  A.click('[data-a="go"][data-v="profile"]'); A.click('[data-a="sub"][data-v="settings"]');
  await until(() => A.$('input[data-cfg="admin"]'));
  const sw = A.$('input[data-cfg="admin"]'); sw.checked = true; sw.dispatchEvent(new A.w.Event('change', { bubbles: true }));
  ok('sem código o painel de administração continua fechado', await until(() => A.$('#admCode2') && /Crie um código/.test(A.text())) && !A.$('#admb:not([hidden])'));
  A.set('admCode', 'abc'); A.set('admCode2', 'abc'); A.click('[data-a="admgo"]');
  ok('código curto é recusado', /pelo menos 6/.test(A.toast()));
  A.set('admCode', 'segredo1'); A.set('admCode2', 'diferente'); A.click('[data-a="admgo"]');
  ok('códigos diferentes são recusados', /não são iguais/.test(A.toast()) && !A.$('#admb:not([hidden])'));
  A.set('admCode', 'segredo1'); A.set('admCode2', 'segredo1'); A.click('[data-a="admgo"]');
  ok('criar o código ativa o administrador local', await until(() => /Ativo/.test(A.text()) && !!A.$('[data-a="admlock"]')));
  ok('o código não fica guardado em texto puro', !/segredo1/.test(A.w.localStorage.getItem('gp_admcode')) && /"h":"[0-9a-f]{64}"/.test(A.w.localStorage.getItem('gp_admcode')));
  ok('sha256 confere com a referência', A.w.eval("GPT.sha256('abc')") === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  A.click('[data-a="admlock"]');
  ok('bloquear fecha o menu de administração', await until(() => !A.$('[data-a="admlock"]')));
  A.click('[data-a="go"][data-v="profile"]'); ok('perfil sem menu de administração quando bloqueado', !A.$('#admb:not([hidden])'));
  A.click('[data-a="sub"][data-v="settings"]'); await until(() => A.$('input[data-cfg="admin"]'));
  const sw2 = A.$('input[data-cfg="admin"]'); sw2.checked = true; sw2.dispatchEvent(new A.w.Event('change', { bubbles: true }));
  await until(() => A.$('#admCode') && !A.$('#admCode2'));
  A.set('admCode', 'errado1'); A.click('[data-a="admgo"]');
  ok('código errado é recusado', /incorreto/.test(A.toast()) && !A.$('[data-a="admlock"]'));
  A.set('admCode', 'segredo1'); A.click('[data-a="admgo"]');
  ok('código certo desbloqueia', await until(() => !!A.$('[data-a="admlock"]')));
  A.click('[data-a="back"]'); A.click('[data-a="sub"][data-v="admin"]');
  ok('administração de demonstração abre com as abas', await until(() => /Administrador local \(temporário\)/.test(A.text()) && A.$('[data-a="atab"][data-v="logs"]')));
  A.click('[data-a="atab"][data-v="jogos"]'); await until(() => A.$('[data-a="gfeat"]'));
  A.click('[data-a="gfeat"]');
  A.click('[data-a="atab"][data-v="logs"]');
  ok('demo: destacar gera log local', await until(() => /Jogo destacado/.test(A.text())));
  A.click('[data-a="go"][data-v="home"]');
  ok('demo: jogo destacado aparece com a marca na Início', await until(() => /Destaque/.test(A.text())));
  // orientação: fora do jogo em pé; o jogo pede paisagem e o app gira
  const calls = []; A.w.GPNative = { setFullscreen() {}, setOrientation(m) { calls.push(m); }, getBuild() { return '0'; }, openUrl() {} };
  A.click('[data-a="go"][data-v="studio"]'); A.click('[data-a="stab"][data-v="pub"]'); await until(() => A.$('#sTitle'));
  A.set('sTitle', 'Deitado'); A.click('[data-a="ssect"][data-v="code"]'); A.click('[data-a="smode"][data-v="code"]'); A.click('[data-a="tpl"]');
  A.click('[data-a="ssect"][data-v="adv"]');
  A.click('[data-a="sori"][data-v="landscape"]');
  ok('Studio marca a orientação escolhida', await until(() => A.$('[data-a="sori"][data-v="landscape"]').getAttribute('aria-pressed') === 'true'));
  A.click('[data-a="ssect"][data-v="rev"]'); A.click('[data-a="spub"]'); await until(() => /Deitado/.test(A.text()) && A.d.querySelectorAll('[data-a="play"]').length);
  const play = [...A.d.querySelectorAll('[data-a="play"]')].find(b => /Deitado/.test(b.closest('.mg').textContent));
  play.click();
  ok('jogo marcado como paisagem gira o app para paisagem', await until(() => calls.includes('landscape')));
  A.$('#pClose').click();
  ok('ao sair do jogo o app volta para retrato', await until(() => calls[calls.length - 1] === 'portrait'));
  const outro = [...A.d.querySelectorAll('[data-a="play"]')].find(b => /Rascunho Um/.test(b.closest('.mg').textContent));
  outro.click(); await wait(200);
  ok('jogo automático não força a posição', calls[calls.length - 1] === 'auto');
  A.w.dispatchEvent(new A.w.MessageEvent('message', { data: { gp: 'orient', m: 'landscape-primary' }, source: A.$('#frame').contentWindow }));
  ok('jogo que pede paisagem por screen.orientation.lock gira o app', await until(() => calls[calls.length - 1] === 'landscape'));
  A.w.dispatchEvent(new A.w.MessageEvent('message', { data: { gp: 'orient', m: 'any' }, source: A.$('#frame').contentWindow }));
  A.w.dispatchEvent(new A.w.MessageEvent('message', { data: { gp: 'orient', m: 'portrait' }, source: A.$('#frame').contentWindow }));
  ok('jogo que pede retrato gira o app para retrato', await until(() => calls[calls.length - 1] === 'portrait'));
  A.$('#pClose').click();
  A.click('[data-a="go"][data-v="profile"]'); A.click('[data-a="sub"][data-v="admin"]');
  A.click('[data-a="atab"][data-v="jogos"]'); await until(() => A.$('[data-a="gdel"]'));
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
  const oldTs = Date.now() - 30 * 36e5;
  const N = open({ gp_clean: 2, gp_upd: [{ id: 'n1', t: 'Aviso comum velho', d: 'x', a: '1 d', ts: oldTs, k: 'sys' }, { id: 'n2', t: 'Atualização disponível', d: 'Há uma versão nova', a: '1 d', ts: oldTs, k: 'update', ref: 'settings' }, { id: 'n3', t: 'Aviso recente', d: 'y', a: 'agora', ts: Date.now(), k: 'sys' }] });
  await wait(600); N.click('#bell');
  ok('aviso comum com mais de 24 h some sozinho', await until(() => /Aviso recente/.test(N.text())) && !/Aviso comum velho/.test(N.text()));
  ok('aviso importante antigo continua, marcado como Importante', /Atualização disponível/.test(N.text()) && /Importante/.test(N.text()));
  ok('toque na atualização abre a tela de atualização/Configurações', (N.click('.nrow [data-a="sub"]'), await until(() => /Atualização do app|Atualização automática|Configurações|Versão/.test(N.text()))));
  ok('nenhum erro de script', [A, B, AD].every(x => x.errs.length === 0), JSON.stringify([A.errs, B.errs, AD.errs]));
}
try { await main(); } catch (e) { fail++; console.error('ERRO', e); }
srv.kill(); rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} passaram, ${fail} falharam`); process.exit(fail ? 1 : 0);
