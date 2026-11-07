// Perfil enxuto, aba Chat, Studio escondido sem plano, Loja (plano, moedas, skins) e liberação pelo administrador.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { WebSocket } from 'ws';

const require = createRequire(import.meta.url);
let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch { console.log('jsdom não instalado: rode "npm i --no-save jsdom" para este teste.'); process.exit(0); }

const PORT = 3993, URL_ = `http://localhost:${PORT}/`;
const dir = mkdtempSync(path.join(tmpdir(), 'gp-sto-')), dbf = path.join(dir, 's.db');
const srv = spawn('node', ['--disable-warning=ExperimentalWarning', 'src/index.js'], { env: { ...process.env, PORT, DB_FILE: dbf, ADMIN_EMAIL: 'adm@x.com', JWT_SECRET: 't' }, stdio: ['ignore', 'ignore', 'inherit'] });
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

async function main() {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(URL_ + 'api/health')).ok) break; } catch {} await wait(150); }
  const adm = await api('POST', '/auth/register', { name: 'Chefe', email: 'adm@x.com', password: 'senha12345' });
  const ana = await api('POST', '/auth/register', { name: 'Ana', email: 'ana@x.com', password: 'senha12345' });
  const A = open({ gp_clean: 2, gp_token: ana.token, gp_user: ana.user });
  await wait(900);
  const nav = () => [...A.d.querySelectorAll('#nav button')].map(b => b.textContent.replace(/\d+$/, ''));
  ok('menu sem Studio para quem não tem o plano', !nav().includes('Studio') && nav().includes('Chat'), nav().join());
  A.click('[data-a="go"][data-v="profile"]');
  ok('perfil mostra o ID do jogador', /ID #001/.test(A.text()));
  ok('perfil não tem mais Mensagens, Amigos, Comunidade, Notificações, Administração nem Configurações', !/Mensagens|Amigos|Comunidade|Administração|Configurações/.test(A.d.querySelector('.tiles').textContent) && !A.$('.mrow'));
  ok('configurações ficam no topo', !!A.$('#cfgb[data-v="settings"]') && A.$('#admb').hidden === true);
  ok('início oferece planos em vez de criar jogo', (A.click('[data-a="go"][data-v="home"]'), !!A.$('[data-a="plans"]') && !A.$('[data-a="go"][data-v="studio"]')));

  // Chat unificado
  A.click('[data-a="go"][data-v="chat"]');
  ok('aba Chat reúne mensagens, amigos, comunidade e grupos', ['Mensagens', 'Amigos', 'Feed', 'Grupos', 'Comunidades'].every(t => new RegExp(t).test(A.d.querySelector('.tabs').textContent)));

  // Loja: planos, moedas, skins
  A.click('[data-a="go"][data-v="store"]'); A.click('[data-a="sttab"][data-v="plans"]');
  ok('loja mostra planos com preço', await until(() => /Studio 30 dias/.test(A.text()) && /R\$ 19,90/.test(A.text())));
  A.click('[data-a="buy"][data-v="studio30"]');
  ok('comprar o plano libera o Studio na hora', await until(() => nav().includes('Studio')), A.toast());
  A.click('[data-a="go"][data-v="studio"]');
  ok('Studio abre depois da compra', await until(() => A.$('#sTitle')));
  A.click('[data-a="go"][data-v="store"]'); A.click('[data-a="sttab"][data-v="coins"]');
  A.click('[data-a="buy"][data-v="coins500"]');
  ok('pacote de moedas soma no saldo', await until(() => /500/.test(A.$('.idc.coin')?.textContent || '')), A.toast());
  A.click('[data-a="sttab"][data-v="skins"]');
  ok('skins listam molduras e fundos', await until(() => /Moldura dourada/.test(A.text()) && /Fundo aurora/.test(A.text())));
  A.click('[data-a="buy"][data-v="fr_gold"]');
  ok('skin comprada vira "Remover" (em uso)', await until(() => /Remover/.test(A.text())), A.toast());
  A.click('[data-a="go"][data-v="profile"]');
  ok('moldura aparece no perfil', !!A.$('.pf-av.fr-gold'));

  // Administrador: ID 000, ícone no topo, libera o Studio de outra pessoa
  const bia = await api('POST', '/auth/register', { name: 'Bia', email: 'bia@x.com', password: 'senha12345' });
  const D = open({ gp_clean: 2, gp_token: adm.token, gp_user: adm.user });
  await wait(900);
  ok('administrador tem ID 000 e ícone de administração no topo', adm.user.uid === '000' && !D.$('#admb').hidden);
  D.click('#admb'); await until(() => D.$('[data-a="atab"][data-v="users"]'));
  D.click('[data-a="atab"][data-v="users"]');
  ok('lista de usuários mostra o ID', await until(() => /ID #002/.test(D.text())));
  const lib = [...D.d.querySelectorAll('[data-a="ustudio"]')].find(b => b.closest('.acts2').previousElementSibling.textContent.includes('Bia'));
  lib.click();
  ok('administrador libera o Studio para Bia', await until(async () => (await api('GET', '/me', null, bia.token)).user.studio === true, 5000) || (await api('GET', '/me', null, bia.token)).user.studio === true);

  console.log(`\n${pass} passaram, ${fail} falharam`);
  const errs = [...A.errs, ...D.errs];
  if (errs.length) { console.log('Erros no app:', errs); fail++; }
  srv.kill(); rmSync(dir, { recursive: true, force: true }); process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); srv.kill(); process.exit(1); });
