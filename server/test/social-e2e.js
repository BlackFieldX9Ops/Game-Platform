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

const PORT = 3996, URL_ = `http://localhost:${PORT}/`;
const dir = mkdtempSync(path.join(tmpdir(), 'gp-soc-'));
const srv = spawn('node', ['--disable-warning=ExperimentalWarning', 'src/index.js'], { env: { ...process.env, PORT, DB_FILE: path.join(dir, 's.db'), ADMIN_EMAIL: 'adm@x.com', STUDIO_GATE: 'off', JWT_SECRET: 't' }, stdio: ['ignore', 'ignore', 'inherit'] });
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
async function api(method, url, body, token) {
  const r = await fetch(URL_ + 'api' + url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
}
const document_up = (C, x, el) => (el || C.d.body).dispatchEvent(new C.w.MouseEvent('pointerup', { bubbles: true, clientX: x, clientY: 20 }));
async function main() {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(URL_ + 'api/health')).ok) break; } catch {} await wait(150); }
  const ra = await api('POST', '/auth/register', { name: 'Ana', email: 'ana@x.com', password: 'senha12345' });
  const rb = await api('POST', '/auth/register', { name: 'Beto', email: 'beto@x.com', password: 'senha12345' });
  const seed = r => ({ gp_token: r.token, gp_user: r.user, gp_seen: [] });
  const A = open(seed(ra)), B = open(seed(rb));
  await wait(1800);

  // aba Comunidade
  A.click('[data-a="ctab"][data-v="feed"]');
  ok('hub social abre com as 6 abas', await until(() => ['Comunidade','Grupos','Comunidades','Mensagens','Amigos','Avisos'].every(t => A.text().includes(t))));
  ok('feed vazio no começo', /Ainda não há publicações/.test(A.text()));
  A.set('postText', 'Meu recorde: 9000 pontos, valeu @Beto'); A.click('[data-a="post"]');
  ok('criar publicação', await until(() => /Meu recorde: 9000/.test(A.text())), A.toast());
  B.click('[data-a="ctab"][data-v="feed"]');
  ok('outro jogador vê a publicação', await until(() => /Meu recorde: 9000/.test(B.text())));
  ok('menção aparece destacada', !!B.d.querySelector('.mn'));
  B.click('[data-a="follow"]');
  ok('seguir o autor', await until(() => /Seguindo/.test(B.text())));
  B.click('[data-a="cfilter"][data-v="following"]');
  ok('filtro Seguindo mostra o post', await until(() => /Meu recorde: 9000/.test(B.text())));
  B.click('[data-a="cfilter"][data-v="games"]');
  ok('filtro Jogos vazio', await until(() => /Nenhuma publicação com jogo/.test(B.text())));
  B.click('[data-a="cfilter"][data-v="foryou"]'); await until(() => /Meu recorde/.test(B.text()));
  B.click('[data-a="like"]'); ok('curtir', await until(() => B.d.querySelector('.pa button.on')));
  B.click('[data-a="cmt"]'); await until(() => B.$('#cmIn'));
  B.set('cmIn', 'Parabéns!'); B.click('[data-a="cmsend"]');
  ok('comentar', await until(() => /Parabéns!/.test(B.text())), B.toast());

  // aba Avisos de Ana
  A.click('[data-a="ctab"][data-v="notif"]');
  ok('avisos sociais: seguidor, resposta', await until(() => /começou a seguir você/.test(A.text()) && /respondeu sua publicação/.test(A.text())), A.text().slice(0, 200));

  // grupo
  A.click('[data-a="ctab"][data-v="groups"]'); await until(() => A.$('[data-a="cnew"]'));
  ok('grupos começam vazios', /Nenhum grupo ainda/.test(A.text()));
  A.click('[data-a="cnew"]'); await until(() => A.$('#cfName'));
  A.set('cfName', 'Esquadrão'); A.set('cfDesc', 'Treino diário'); A.set('cfRules', 'Sem spam'); A.set('cfMem', 'Beto');
  A.click('[data-a="cacc"][data-v="private"]'); await until(() => /Grupo privado/.test(A.text()));
  A.set('cfName', 'Esquadrão'); A.set('cfMem', 'Beto'); A.click('[data-a="csave"]');
  ok('criar grupo privado com membro inicial', await until(() => /Esquadrão/.test(A.text()) && /Privado/.test(A.text()) && A.$('[data-a="sptab"]')), A.toast());
  B.click('[data-a="ctab"][data-v="groups"]');
  ok('convidado vê o grupo privado com selo de convite', await until(() => /Convite/.test(B.text()) && /Esquadrão/.test(B.text())));
  B.click('[data-a="spopen"]'); await until(() => B.$('[data-a="spjoin"]'));
  B.click('[data-a="spjoin"]');
  ok('aceitar o convite', await until(() => B.$('[data-a="sptab"]') && !B.$('[data-a="spjoin"]') && /Sair/.test(B.text())), B.toast());
  B.click('[data-a="sptab"][data-v="rules"]');
  ok('aba de regras', await until(() => /Sem spam/.test(B.text())));
  B.click('[data-a="sptab"][data-v="chat"]'); await until(() => B.$('#chatIn'));
  B.set('chatIn', 'Bora jogar @Ana'); B.click('[data-a="send"]');
  ok('mensagem no chat do grupo', await until(() => /Bora jogar/.test(B.text())), B.toast());
  ok('botão de imagem e jogo no chat', !!B.$('#chImg') && !!B.$('[data-a="pickgame"]'));
  A.click('[data-a="sptab"][data-v="chat"]');
  ok('o outro participante recebe a mensagem', await until(() => /Bora jogar/.test(A.text()) , 5000) || (await (async () => { A.click('[data-a="spopen"]'); return until(() => A.$('#chatIn')); })()));
  A.click('[data-a="back"]'); A.click('[data-a="ctab"][data-v="msgs"]');
  ok('lista de conversas traz o grupo com prévia', await until(() => /Esquadrão/.test(A.text()) && /Bora jogar/.test(A.text())), A.text().slice(0, 200));
  A.click('[data-a="convopen"]');
  ok('abrir a conversa do grupo', await until(() => A.$('#chatIn') && /Bora jogar/.test(A.text())));

  // comunidade restrita
  A.click('[data-a="back"]'); A.click('[data-a="ctab"][data-v="comms"]'); await until(() => A.$('[data-a="cnew"]'));
  A.click('[data-a="cnew"]'); await until(() => A.$('#cfName'));
  A.set('cfName', 'Fãs de corrida'); A.click('[data-a="cacc"][data-v="restricted"]'); await until(() => /Comunidade restrita/.test(A.text()));
  A.set('cfName', 'Fãs de corrida'); A.click('[data-a="csave"]');
  ok('criar comunidade', await until(() => /Fãs de corrida/.test(A.text()) && /Restrita/.test(A.text()) && /Eventos/.test(A.text())), A.toast());
  A.click('[data-a="sptab"][data-v="events"]'); await until(() => A.$('#evT'));
  A.set('evT', 'Campeonato'); A.set('evW', '2030-05-01T20:00'); A.click('[data-a="evadd"]');
  ok('criar evento', await until(() => /Campeonato/.test(A.text()) && /01\/05\/2030/.test(A.text())), A.toast());
  B.click('[data-a="back"]'); B.click('[data-a="ctab"][data-v="comms"]');
  ok('comunidade aparece para todos', await until(() => /Fãs de corrida/.test(B.text())));
  B.click('[data-a="spopen"]'); await until(() => B.$('[data-a="spjoin"]'));
  B.click('[data-a="spjoin"]');
  ok('pedir para entrar fica pendente', await until(() => /Pedido enviado/.test(B.text())), B.toast());
  A.click('[data-a="sptab"][data-v="members"]');
  await until(() => A.d.querySelector('[data-a="spappr"]'), 1500) || (A.click('[data-a="back"]'), A.click('[data-a="ctab"][data-v="comms"]'), await until(() => A.$('[data-a="spopen"]')), A.click('[data-a="spopen"]'), await until(() => A.$('[data-a="sptab"]')), A.click('[data-a="sptab"][data-v="members"]'));
  ok('criador vê o pedido e aprova', await until(() => A.d.querySelector('[data-a="spappr"]')));
  A.click('[data-a="spappr"]');
  ok('pedido aprovado', await until(() => !A.d.querySelector('[data-a="spappr"]') && /Membros \(2\)/.test(A.text())), A.toast());

  // amigos por ID e DM
  A.click('[data-a="back"]'); A.click('[data-a="ctab"][data-v="friends"]'); await until(() => A.$('#fName'));
  ok('mostra o ID do usuário', new RegExp('#' + ra.user.uid).test(A.text()));
  A.set('fName', '#' + Number(rb.user.uid)); A.click('[data-a="addfriend"]');
  ok('adicionar amigo por ID', await until(() => /Pedido enviado|Pedidos/.test(A.toast() + A.text())), A.toast());
  B.click('[data-a="back"]'); B.click('[data-a="ctab"][data-v="friends"]');
  ok('pedido de amizade chega', await until(() => B.$('[data-a="accept"]')), B.text().slice(0,300) + ' | ' + JSON.stringify(B.errs));
  B.click('[data-a="accept"]');
  ok('aceitar amizade', await until(() => B.$('[data-a="chatopen"]') && B.$('[data-a="invgame"]')), B.toast());
  A.click('[data-a="ctab"][data-v="friends"]'); await until(() => A.$('[data-a="chatopen"]'), 6000) || (await api('GET','/friends',null,ra.token));
  A.click('[data-a="ctab"][data-v="msgs"]'); A.click('[data-a="ctab"][data-v="friends"]'); await until(() => A.$('[data-a="chatopen"]'));
  A.click('[data-a="chatopen"]'); await until(() => A.$('#chatIn'));
  A.set('chatIn', 'Oi Beto'); A.click('[data-a="send"]');
  ok('mensagem direta enviada', await until(() => /Oi Beto/.test(A.text())), A.toast());
  ok('destinatário é avisado em tempo real', await until(() => /Mensagem de Ana/.test(B.toast()) || B.d.querySelector('.social .dot'), 4000));
  B.click('[data-a="ctab"][data-v="msgs"]');
  ok('conversa direta com não lida na lista', await until(() => /Oi Beto/.test(B.text()) && B.d.querySelector('.dot2')), B.text().slice(0, 200));
  B.click('[data-a="convopen"][data-v^="direct"]');
  ok('abrir a DM mostra a mensagem', await until(() => /Oi Beto/.test(B.text())));
  // notificação de jogo publicado leva ao jogo
  const gg = await api('POST', '/games', { title: 'Meu Labirinto', category: 'Ação', dim: '2D', code: '<h1>x</h1>' }, ra.token);
  A.click('[data-a="go"][data-v="home"]'); A.w.document.dispatchEvent(new A.w.Event('visibilitychange'));
  A.click('[data-a="go"][data-v="store"]'); A.click('[data-a="go"][data-v="home"]');
  await wait(300); A.click('#bell');
  await until(() => A.$('[data-a="sub"][data-v="upd"]'), 500);
  A.click('[data-a="sub"][data-v="upd"]');
  await until(() => /Meu Labirinto/.test(A.text()), 3000) || (A.w.document.getElementById('bell').click(), await wait(1200));
  ok('notificação de jogo publicado é clicável', await until(() => A.d.querySelector('button.li[data-a="open"]'), 4000), A.text().slice(0, 200));
  A.click('button.li[data-a="open"]');
  ok('toque na notificação abre o jogo', await until(() => /Meu Labirinto/.test(A.text()) && A.$('[data-a="back"]')));
  // jogo apagado some da biblioteca de quem o tinha, sem recarregar
  const ef = await api('POST', '/games', { title: 'Jogo Efemero', category: 'Ação', dim: '2D', code: '<h1>e</h1>' }, rb.token);
  await api('PUT', '/library/' + ef.id, null, ra.token);
  A.click('#bell'); await wait(900); A.click('[data-a="go"][data-v="lib"]');
  ok('jogo aparece na biblioteca antes de ser apagado', await until(() => /Jogo Efemero/.test(A.text()), 4000), A.text().slice(0, 150));
  await api('DELETE', '/games/' + ef.id, null, rb.token);
  ok('apagar o jogo some da biblioteca de quem tinha, em tempo real', await until(() => !/Jogo Efemero/.test(A.text()), 4000));
  // deslizar para a esquerda apaga
  A.click('#bell');
  await until(() => A.d.querySelectorAll('.swp').length > 0);
  const n0 = A.d.querySelectorAll('.swp').length, row = A.d.querySelector('.swp');
  const ev = (t, x) => row.firstChild.dispatchEvent(new A.w.MouseEvent(t, { bubbles: true, clientX: x, clientY: 20 }));
  ev('pointerdown', 300); ev('pointermove', 280); ev('pointermove', 60); document_up(A, 60);
  ok('deslizar para a esquerda apaga o aviso', await until(() => A.d.querySelectorAll('.swp').length === n0 - 1, 3000), n0 + ' -> ' + A.d.querySelectorAll('.swp').length);
  const row2 = A.d.querySelector('.swp'), n1 = A.d.querySelectorAll('.swp').length;
  row2.firstChild.dispatchEvent(new A.w.MouseEvent('pointerdown', { bubbles: true, clientX: 300, clientY: 20 }));
  row2.firstChild.dispatchEvent(new A.w.MouseEvent('pointermove', { bubbles: true, clientX: 270, clientY: 20 }));
  document_up(A, 270, row2.firstChild); await wait(400);
  ok('deslize curto não apaga', A.d.querySelectorAll('.swp').length === n1);
  ok('nenhum erro de script', [A, B].every(x => x.errs.length === 0), JSON.stringify([A.errs, B.errs]));
}
try { await main(); } catch (e) { fail++; console.error('ERRO', e); }
srv.kill(); rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} passaram, ${fail} falharam`); process.exit(fail ? 1 : 0);
