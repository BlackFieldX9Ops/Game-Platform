// Contas: Google (com servidor Google falso), recuperar senha, verificar e-mail, progresso entre aparelhos.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';

const PORT = 3997, GPORT = 3996, BASE = `http://localhost:${PORT}/api`;
const dir = mkdtempSync(path.join(tmpdir(), 'gpa-')), dbf = path.join(dir, 't.db');
let gProfile = { sub: 'g1', email: 'gente@gmail.com', email_verified: true, given_name: 'Gente' };
const fake = http.createServer((req, res) => {
  req.resume(); req.on('end', () => {
    const b = s => Buffer.from(JSON.stringify(s)).toString('base64url');
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ id_token: `${b({ alg: 'none' })}.${b({ aud: 'cid', ...gProfile })}.x` }));
  });
}).listen(GPORT);
const srv = spawn('node', ['src/index.js'], { env: { ...process.env, PORT, DB_FILE: dbf, JWT_SECRET: 'teste', GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'sec', PUBLIC_URL: `http://localhost:${PORT}`, GOOGLE_TOKEN_URL: `http://localhost:${GPORT}/token` }, stdio: ['ignore', 'pipe', 'inherit'] });
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'OK   ' : 'FALHA'} ${n}${c ? '' : ' ' + x}`); };
async function call(method, url, body, token) {
  const r = await fetch(BASE + url, { method, redirect: 'manual', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = {}; try { j = await r.json(); } catch {}
  return { s: r.status, j, loc: r.headers.get('location') };
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const lastCode = (email) => { const d = new DatabaseSync(dbf); const r = d.prepare('SELECT body FROM dev_outbox WHERE to_email = ? ORDER BY id DESC LIMIT 1').get(email); d.close(); return r && r.body.match(/: (\d{6})/)?.[1]; };

async function main() {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch {} await wait(150); }
  const cfg = (await call('GET', '/auth/config')).j;
  ok('config informa Google ligado', cfg.google === true);

  const ana = (await call('POST', '/auth/register', { name: 'Ana', email: 'ana@teste.com', password: 'senha12345' })).j;
  ok('conta nova começa sem e-mail verificado', ana.user.emailVerified === false || (await call('GET', '/me', null, ana.token)).j.user.emailVerified === false);

  // verificar e-mail
  ok('envia código de verificação', (await call('POST', '/auth/verify/send', {}, ana.token)).j.ok === true);
  const vc = lastCode('ana@teste.com');
  ok('código chegou na caixa de desenvolvimento', /^\d{6}$/.test(vc || ''));
  ok('código errado é recusado', (await call('POST', '/auth/verify', { code: '000000' === vc ? '111111' : '000000' }, ana.token)).s === 400);
  ok('código certo verifica o e-mail', (await call('POST', '/auth/verify', { code: vc }, ana.token)).j.ok === true);
  ok('/me mostra e-mail verificado', (await call('GET', '/me', null, ana.token)).j.user.emailVerified === true);
  ok('código só vale uma vez', (await call('POST', '/auth/verify', { code: vc }, ana.token)).s === 400);

  // recuperar senha
  ok('forgot responde igual para e-mail desconhecido', (await call('POST', '/auth/forgot', { email: 'ninguem@teste.com' })).j.ok === true && !lastCode('ninguem@teste.com'));
  await call('POST', '/auth/forgot', { email: 'ana@teste.com' });
  const rc = lastCode('ana@teste.com');
  ok('reset com código errado falha', (await call('POST', '/auth/reset', { email: 'ana@teste.com', code: '999999' === rc ? '888888' : '999999', password: 'novasenha99' })).s === 400);
  ok('reset com senha curta falha', (await call('POST', '/auth/reset', { email: 'ana@teste.com', code: rc, password: '123' })).s === 400);
  const rs = await call('POST', '/auth/reset', { email: 'ana@teste.com', code: rc, password: 'novasenha99' });
  ok('reset com código certo troca a senha e entra', !!rs.j.token);
  ok('senha antiga não funciona mais', (await call('POST', '/auth/login', { email: 'ana@teste.com', password: 'senha12345' })).s === 401);
  ok('senha nova funciona', !!(await call('POST', '/auth/login', { email: 'ana@teste.com', password: 'novasenha99' })).j.token);
  for (let i = 0; i < 5; i++) await call('POST', '/auth/forgot', { email: 'ana@teste.com' });
  const rc2 = lastCode('ana@teste.com');
  for (let i = 0; i < 5; i++) await call('POST', '/auth/reset', { email: 'ana@teste.com', code: '000001', password: 'outrasenha1' });
  ok('após 5 erros o código deixa de valer', (await call('POST', '/auth/reset', { email: 'ana@teste.com', code: rc2, password: 'outrasenha1' })).s >= 400);

  // Google
  const st = await call('GET', '/auth/google/start?app=1');
  ok('start redireciona ao Google com state', st.s === 302 && /accounts\.google\.com/.test(st.loc || '') && /state=/.test(st.loc));
  const state = new URL(st.loc).searchParams.get('state');
  const bad = await fetch(`${BASE}/auth/google/callback?code=x&state=${state}x`);
  ok('state adulterado é recusado', bad.status === 400);
  const cb = await fetch(`${BASE}/auth/google/callback?code=abc&state=${state}`);
  const html = await cb.text();
  const ex = html.match(/gameplatform:\/\/auth\?code=([a-f0-9]+)/)?.[1];
  ok('callback do app devolve deep link com código', cb.status === 200 && !!ex);
  const g1 = await call('POST', '/auth/exchange', { code: ex });
  ok('troca do código dá token e usuário verificado', !!g1.j.token && g1.j.user.emailVerified === true && g1.j.user.google === true && g1.j.user.name === 'Gente');
  ok('código de troca é de uso único', (await call('POST', '/auth/exchange', { code: ex })).s === 400);
  const st2 = await call('GET', '/auth/google/start');
  const cb2 = await fetch(`${BASE}/auth/google/callback?code=abc&state=${new URL(st2.loc).searchParams.get('state')}`, { redirect: 'manual' });
  ok('na web o callback volta para a página com #gpcode', cb2.status === 302 && /#gpcode=[a-f0-9]+/.test(cb2.headers.get('location') || ''));
  const ex2 = (cb2.headers.get('location') || '').split('#gpcode=')[1];
  const g2 = await call('POST', '/auth/exchange', { code: ex2 });
  ok('segundo login Google reutiliza a mesma conta', g2.j.user.id === g1.j.user.id);
  // vincula conta de e-mail existente
  gProfile = { sub: 'g2', email: 'ana@teste.com', email_verified: true, given_name: 'Ana' };
  const st3 = await call('GET', '/auth/google/start');
  const cb3 = await fetch(`${BASE}/auth/google/callback?code=abc&state=${new URL(st3.loc).searchParams.get('state')}`, { redirect: 'manual' });
  const g3 = await call('POST', '/auth/exchange', { code: (cb3.headers.get('location') || '').split('#gpcode=')[1] });
  ok('Google com e-mail já cadastrado entra na conta existente', g3.j.user.id === ana.user.id);
  gProfile = { sub: 'g3', email: 'naover@gmail.com', email_verified: false };
  const st4 = await call('GET', '/auth/google/start');
  const cb4 = await fetch(`${BASE}/auth/google/callback?code=abc&state=${new URL(st4.loc).searchParams.get('state')}`, { redirect: 'manual' });
  ok('e-mail Google não verificado é recusado', cb4.status === 400);

  // progresso
  ok('progresso começa vazio', (await call('GET', '/me/progress', null, g1.j.token)).j.data === null);
  ok('salva progresso', (await call('PUT', '/me/progress', { data: { gp_mis: '{"x":1}' } }, g1.j.token)).j.ok === true);
  ok('lê progresso em outro aparelho', (await call('GET', '/me/progress', null, g1.j.token)).j.data.gp_mis === '{"x":1}');
  ok('progresso exige login', (await call('GET', '/me/progress')).s === 401);
  ok('progresso inválido é recusado', (await call('PUT', '/me/progress', { data: [1] }, g1.j.token)).s === 400);
  ok('progresso é separado por usuário', (await call('GET', '/me/progress', null, ana.token)).j.data === null);

  console.log(`\n${pass} passaram, ${fail} falharam`);
  srv.kill(); fake.close(); process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); srv.kill(); fake.close(); process.exit(1); });
