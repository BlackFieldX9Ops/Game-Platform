// Painel de gestão (tela larga): só equipe vê, jogador e celular não; usuários, suspensão com motivo, moderação, denúncias, auditoria.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { WebSocket } from 'ws';

const require = createRequire(import.meta.url);
let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch { console.log('jsdom não instalado: rode "npm i --no-save jsdom" para este teste.'); process.exit(0); }

const PORT = 3995, URL_ = `http://localhost:${PORT}/`;
const dir = mkdtempSync(path.join(tmpdir(), 'gp-ws-')), dbf = path.join(dir, 's.db');
const srv = spawn('node', ['--disable-warning=ExperimentalWarning', 'src/index.js'], { env: { ...process.env, PORT, DB_FILE: dbf, ADMIN_EMAIL: 'adm@x.com', JWT_SECRET: 't', STUDIO_GATE: 'off' }, stdio: ['ignore', 'ignore', 'inherit'] });
const html = readFileSync(existsSync('www/index.html') ? 'www/index.html' : '../app/www/index.html', 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'OK   ' : 'FALHA'} ${n}${c ? '' : ' ' + x}`); };
const wait = ms => new Promise(r => setTimeout(r, ms));

function open(seed, wide = true) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: URL_,
    beforeParse(w) {
      w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => {}, set: () => true });
      w.fetch = (u, o) => fetch(new URL(u, URL_), o);
      w.WebSocket = WebSocket; w.AbortController = AbortController;
      w.matchMedia = q => ({ matches: /min-width:\s*1000px/.test(q) ? wide : false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      if (seed) Object.entries(seed).forEach(([k, v]) => w.localStorage.setItem(k, JSON.stringify(v)));
    }
  });
  const w = dom.window, d = w.document, errs = [];
  w.addEventListener('error', e => errs.push(e.message));
  const $ = s => d.querySelector(s);
  const click = s => { const el = $(s); if (!el) { errs.push('faltou ' + s); return; } el.click(); };
  const ws = () => d.getElementById('ws');
  const wtext = () => ws().textContent;
  return { w, d, $, click, ws, wtext, errs, toast: () => d.getElementById('toast').textContent };
}
async function until(fn, ms = 4000) { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await wait(60); } return false; }
async function api(method, url, body, token) {
  const r = await fetch(URL_ + 'api' + url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
}
const reg = (name) => api('POST', '/auth/register', { name, email: name.toLowerCase() + '@x.com', password: 'senha12345' });

async function main() {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(URL_ + 'api/health')).ok) break; } catch {} await wait(150); }
  const adm = await reg('adm'); adm.user.name = 'Chefe';
  const ana = await reg('Ana'), bia = await reg('Bia'), caio = await reg('Caio');
  await api('POST', `/admin/users/${bia.user.id}/role`, { role: 'mod' }, adm.token);
  const post = await api('POST', '/posts', { text: 'compre moedas baratas aqui' }, caio.token);
  const pid = post.post ? post.post.id : post.id;
  await api('POST', `/posts/${pid}/comments`, { text: 'comentário ofensivo' }, caio.token);
  await api('POST', '/reports', { targetType: 'user', targetId: caio.user.id, reason: 'Spam no chat' }, ana.token);

  // quem vê o painel
  const P = open({ gp_clean: 2, gp_token: ana.token, gp_user: ana.user });
  await wait(900);
  ok('jogador comum não vê o painel', P.ws().hidden === true && !P.d.documentElement.classList.contains('ws'));
  const N = open({ gp_clean: 2, gp_token: adm.token, gp_user: adm.user }, false);
  await wait(900);
  ok('administrador no celular continua no app', N.ws().hidden === true && !N.d.documentElement.classList.contains('ws'));

  const A = open({ gp_clean: 2, gp_token: adm.token, gp_user: adm.user });
  ok('administrador em tela larga vê o painel', await until(() => !A.ws().hidden && A.d.documentElement.classList.contains('ws')));
  ok('menu lateral completo com auditoria e itens em breve', ['Visão geral', 'Usuários', 'Moderação', 'Denúncias', 'Auditoria', 'Compras', 'Jogos', 'Mensagens', 'Studio'].every(t => A.wtext().includes(t)) && (A.wtext().match(/em breve/g) || []).length === 4);
  ok('visão geral carrega números', await until(() => /Usuários\s*4/.test(A.wtext())), A.wtext().slice(0, 200));

  // usuários
  A.click('[data-a="w_sec"][data-v="users"]');
  ok('lista de usuários aparece com e-mail para admin', await until(() => A.d.querySelectorAll('.wrow').length === 4 && /caio@x\.com/.test(A.wtext())));
  const search = A.$('#wsUq'); search.value = 'cai'; search.dispatchEvent(new A.w.Event('input', { bubbles: true }));
  ok('busca filtra por nome', await until(() => A.d.querySelectorAll('.wrow').length === 1 && /Caio/.test(A.wtext())));
  A.d.querySelector('.wrow').click();
  ok('gaveta mostra detalhes do usuário', await until(() => A.$('.wdrawer') && /Spam no chat|Denúncias/.test(A.$('.wdrawer').textContent) && A.$('[data-a="w_ustatus"]')));
  A.click('[data-a="w_ustatus"][data-v$=":suspended"]');
  ok('suspender abre confirmação com prazo e motivo', !!A.$('#wsMReason') && !!A.$('#wsMDays'));
  A.click('[data-a="w_mok"]');
  ok('sem motivo não suspende', /motivo/i.test(A.toast()) && (await api('GET', '/admin/users/' + caio.user.id, null, adm.token)).user.status === 'active');
  A.$('#wsMReason').value = 'Spam repetido no chat'; A.$('#wsMDays').value = '3'; A.click('[data-a="w_mok"]');
  ok('com motivo suspende por 3 dias', await until(async () => (await api('GET', '/admin/users/' + caio.user.id, null, adm.token)).user.status === 'suspended', 4000));
  const dd = (await api('GET', '/admin/users/' + caio.user.id, null, adm.token)).user;
  ok('prazo e motivo ficam salvos', dd.status_reason === 'Spam repetido no chat' && !!dd.status_until);
  ok('gaveta passa a mostrar suspensa e histórico', await until(() => /Suspensa/.test(A.$('.wdrawer').textContent) && /Spam repetido no chat/.test(A.$('.wdrawer').textContent)));
  const lg = await api('POST', '/auth/login', { email: 'caio@x.com', password: 'senha12345' });
  ok('conta suspensa não entra', /suspensa/i.test(lg.error || ''), JSON.stringify(lg));

  // moderação em massa
  A.click('[data-a="w_sec"][data-v="mod"]');
  ok('comentários listados para moderar', await until(() => /comentário ofensivo/.test(A.wtext())));
  A.click('[data-a="w_ctab"][data-v="post"]');
  ok('aba de publicações lista posts', await until(() => /compre moedas baratas/.test(A.wtext())));
  A.click('input[data-a="w_cpick"]');
  A.click('[data-a="w_cbulk"]');
  A.$('#wsMReason').value = 'Propaganda'; A.click('[data-a="w_mok"]');
  ok('remoção em massa com motivo apaga o post', await until(() => !/compre moedas baratas/.test(A.wtext()) && /removido/.test(A.toast())), A.toast());

  // denúncias e auditoria
  A.click('[data-a="w_sec"][data-v="rep"]');
  ok('denúncia aberta aparece', await until(() => /Spam no chat/.test(A.wtext())));
  A.click('[data-a="w_rres"][data-v$=":dismiss"]');
  ok('dispensar denúncia esvazia a fila', await until(() => /Nenhuma denúncia aberta/.test(A.wtext())));
  A.click('[data-a="w_sec"][data-v="audit"]');
  ok('auditoria mostra suspensão e remoção com autor e motivo', await until(() => /Usuário suspenso/.test(A.wtext()) && /Propaganda/.test(A.wtext()) && /Administrador/.test(A.wtext())));
  A.click('[data-a="w_sec"][data-v="buy"]');
  ok('Compras mostra em breve', /em breve/.test(A.$('.wbody').textContent));

  // moderador
  const M = open({ gp_clean: 2, gp_token: bia.token, gp_user: { ...bia.user, role: 'mod' } });
  ok('moderador vê o painel', await until(() => !M.ws().hidden));
  ok('moderador não vê Auditoria', !/Auditoria/.test(M.ws().querySelector('.wnavs').textContent));
  M.click('[data-a="w_sec"][data-v="users"]');
  ok('moderador vê usuários sem e-mail', await until(() => M.d.querySelectorAll('.wrow').length === 4) && !/@x\.com/.test(M.wtext()));
  [...M.d.querySelectorAll('.wrow')].find(r => /Ana/.test(r.textContent)).click();
  ok('moderador não tem Banir nem Tornar moderador', await until(() => M.$('[data-a="w_ustatus"]')) && !M.$('[data-v$=":banned"]') && !M.$('[data-a="w_urole"]'));

  // sair do painel e voltar
  A.click('[data-a="w_exit"]');
  ok('"Voltar ao app" esconde o painel', A.ws().hidden === true && !!A.$('#nav button'));
  A.d.querySelector('[data-a="sub"][data-v="settings"]').click();
  ok('configurações oferecem reabrir o painel', !!A.$('[data-a="w_enter"]'));
  A.click('[data-a="w_enter"]');
  ok('reabrir painel funciona', await until(() => !A.ws().hidden));

  console.log(`\n${pass} passaram, ${fail} falharam`);
  const errs = [...P.errs, ...N.errs, ...A.errs, ...M.errs];
  if (errs.length) { console.log('Erros no app:', errs); fail++; }
  srv.kill(); rmSync(dir, { recursive: true, force: true }); process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); srv.kill(); process.exit(1); });
