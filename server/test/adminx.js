// Configurações gerais, regras de uso, aparelhos compatíveis, formatação protegida e lançamento.
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PORT = 3996, BASE = `http://localhost:${PORT}`;
const dir = mkdtempSync(path.join(tmpdir(), 'gpx-'));
const srv = spawn('node', ['src/index.js'], { env: { ...process.env, PORT, DB_FILE: path.join(dir, 't.db'), ADMIN_EMAIL: 'admin@teste.com', STUDIO_GATE: 'off', CONFIRM_GATE: 'off', BACKUP_AUTO: 'off', JWT_SECRET: 'teste', PUSH_WORKER: 'off', ADMINX_LOCK_MS: '1500' }, stdio: 'ignore' });
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'OK   ' : 'FALHA'} ${n}${c ? '' : ' ' + x}`); };
async function call(method, url, body, token) {
  const r = await fetch(BASE + url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const txt = await r.text(); let j = {}; try { j = JSON.parse(txt); } catch {}
  return { s: r.status, j, txt };
}
const wait = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(BASE + '/api/health')).ok) break; } catch {} await wait(150); }
  const reg = async n => (await call('POST', '/api/auth/register', { name: n, email: n.toLowerCase() + '@teste.com', password: 'senha12345' })).j;
  const adm = await reg('Admin'), ana = await reg('Ana');
  const [ADM, A] = [adm.token, ana.token];

  // identidade
  let r = await call('GET', '/api/platform');
  ok('o nome da plataforma é público e tem padrão', r.s === 200 && r.j.platform.name === 'Game Platform' && r.j.launched === false);
  r = await call('POST', '/api/admin/platform', { name: 'Arena X', supportEmail: 'ajuda@arena.com', termsUrl: 'https://arena.com/termos' }, ADM);
  ok('admin altera identidade', r.s === 200 && r.j.platform.name === 'Arena X', r.txt);
  ok('a mudança é pública', (await call('GET', '/api/platform')).j.platform.supportEmail === 'ajuda@arena.com');
  r = await call('POST', '/api/admin/platform', { supportEmail: 'sem-arroba' }, ADM);
  ok('e-mail inválido é recusado', r.s === 400);
  r = await call('POST', '/api/admin/platform', { termsUrl: 'http://inseguro.com' }, ADM);
  ok('link sem https é recusado', r.s === 400);
  r = await call('POST', '/api/admin/platform', { name: 'x' }, A);
  ok('jogador não altera a identidade', r.s === 403);

  // regras e aparelhos
  r = await call('GET', '/api/rules');
  ok('as regras de uso têm texto padrão', r.s === 200 && r.j.rules.sections.length >= 5 && /Respeito/.test(JSON.stringify(r.j.rules.sections)));
  ok('os requisitos listam o Android mínimo', r.j.rules.devices.some(d => d.name === 'Android' && /7\.0/.test(d.req)));
  r = await call('POST', '/api/admin/rules', { intro: 'Oi', sections: [{ title: 'Regra única', body: 'Seja gentil.' }], devices: [{ name: 'Android', req: 'Android 8', rec: '', note: '' }] }, ADM);
  ok('admin edita as regras e os aparelhos', r.s === 200 && r.j.rules.sections.length === 1, r.txt);
  ok('a edição aparece para todos', (await call('GET', '/api/rules')).j.rules.devices[0].req === 'Android 8');
  r = await call('POST', '/api/admin/rules', { intro: '', sections: [], devices: [] }, ADM);
  ok('regras vazias são recusadas', r.s === 400);
  r = await call('POST', '/api/admin/rules', { reset: true }, ADM);
  ok('admin restaura o padrão', r.s === 200 && (await call('GET', '/api/rules')).j.rules.sections.length >= 5);
  r = await call('POST', '/api/admin/rules', { sections: [{ title: 'a', body: 'b' }], devices: [] }, A);
  ok('jogador não edita regras', r.s === 403);

  // dados para formatar
  await call('POST', '/api/store/checkout', { id: 'coins500' }, A);
  await call('POST', '/api/store/checkout', { id: 'premium30' }, A);
  await call('POST', '/api/store/buy', { id: 'fr_gold' }, A);
  r = await call('GET', '/api/admin/reset', null, ADM);
  ok('a prévia mostra o que será apagado', r.s === 200 && r.j.scopes.sales.rows >= 2 && r.j.scopes.wallet.rows >= 1 && r.j.phrase === 'FORMATAR TUDO', r.txt);
  r = await call('GET', '/api/admin/reset', null, A);
  ok('jogador não vê a formatação', r.s === 403);
  const me0 = (await call('GET', '/api/store', null, A)).j;
  ok('antes: o jogador tem moedas e Premium', me0.coins > 0 && me0.premium.active === true);

  // proteções
  r = await call('POST', '/api/admin/reset', { scopes: ['sales'], password: 'errada', phrase: 'FORMATAR TUDO' }, ADM);
  ok('senha errada não formata', r.s === 403 && (await call('GET', '/api/admin/reset', null, ADM)).j.scopes.sales.rows >= 2, r.txt);
  r = await call('POST', '/api/admin/reset', { scopes: ['sales'], password: 'senha12345', phrase: 'formatar' }, ADM);
  ok('frase errada não formata', r.s === 403);
  r = await call('POST', '/api/admin/reset', { scopes: [], password: 'senha12345', phrase: 'FORMATAR TUDO' }, ADM);
  ok('sem escolher o que apagar é recusado', r.s === 400);
  r = await call('POST', '/api/admin/reset', { scopes: ['sales'], password: 'senha12345', phrase: 'FORMATAR TUDO' }, A);
  ok('jogador não formata nem com a senha certa', r.s === 403 && (await call('GET', '/api/admin/reset', null, ADM)).j.scopes.sales.rows >= 2);
  for (let i = 0; i < 4; i++) await call('POST', '/api/admin/reset', { scopes: ['sales'], password: 'errada', phrase: 'FORMATAR TUDO' }, ADM);
  r = await call('POST', '/api/admin/reset', { scopes: ['sales'], password: 'senha12345', phrase: 'FORMATAR TUDO' }, ADM);
  ok('muitas tentativas erradas travam por um tempo', r.s === 429, r.txt);
  await wait(1700);

  // formatação (só compras e carteira; atividade fica)
  const uBefore = (await call('GET', '/api/admin/users', null, ADM)).j.users.length;
  r = await call('POST', '/api/admin/reset', { scopes: ['sales', 'wallet'], password: 'senha12345', phrase: 'FORMATAR TUDO' }, ADM);
  ok('com senha e frase certas, formata e informa o backup', r.s === 200 && /^app-\d{12}-manual\.db$/.test(r.j.backup) && r.j.removed.sales >= 2, r.txt);
  ok('o backup foi gravado em disco', readdirSync(path.join(dir, 'backups')).includes(r.j.backup));
  r = await call('GET', '/api/admin/sales', null, ADM);
  ok('as vendas zeraram', r.j.sales.length === 0);
  const me1 = (await call('GET', '/api/store', null, A)).j;
  ok('moedas, skins e Premium do jogador voltaram ao início', me1.coins === 0 && me1.owned.length === 0 && me1.premium.active === false, JSON.stringify(me1.owned));
  const admStore = (await call('GET', '/api/store', null, ADM)).j;
  ok('o administrador mantém o acesso ao Studio', admStore.studio.active === true);
  ok('as contas continuam todas lá', (await call('GET', '/api/admin/users', null, ADM)).j.users.length === uBefore);
  r = await call('GET', '/api/admin/commerce', null, ADM);
  ok('o painel de compras mostra tudo zerado', r.j.all.n === 0 && r.j.coinsInCirculation === 0);
  r = await call('GET', '/api/admin/logs', null, ADM);
  ok('a formatação fica na auditoria', /Dados formatados/.test(JSON.stringify(r.j)));

  // lançamento
  r = await call('POST', '/api/admin/launch', { password: 'senha12345', phrase: 'lancar' }, ADM);
  ok('lançar exige a frase certa', r.s === 403);
  r = await call('POST', '/api/admin/launch', { password: 'errada', phrase: 'LANÇAR' }, ADM);
  ok('lançar exige a senha certa', r.s === 403);
  r = await call('POST', '/api/admin/launch', { password: 'senha12345', phrase: 'LANÇAR' }, A);
  ok('jogador não lança', r.s === 403);
  await wait(1700);
  r = await call('POST', '/api/admin/launch', { password: 'senha12345', phrase: 'LANÇAR' }, ADM);
  ok('administrador marca o lançamento', r.s === 200 && !!r.j.launched.at, r.txt);
  ok('o lançamento aparece como informação pública', (await call('GET', '/api/platform')).j.launched === true);
  r = await call('POST', '/api/admin/reset', { scopes: ['sales'], password: 'senha12345', phrase: 'FORMATAR TUDO' }, ADM);
  ok('depois do lançamento a formatação fica bloqueada para sempre', r.s === 423, r.txt);
  r = await call('POST', '/api/admin/launch', { password: 'senha12345', phrase: 'LANÇAR' }, ADM);
  ok('não dá para lançar duas vezes', r.s === 409);
  r = await call('GET', '/api/admin/reset', null, ADM);
  ok('a prévia informa que já foi lançado', !!r.j.launched);

  // banner de boas-vindas (carrossel)
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  r = await call('GET', '/api/banners');
  ok('banner: sem configuração a lista vem vazia (o app mostra o padrão)', r.s === 200 && Array.isArray(r.j.slides) && r.j.slides.length === 0);
  r = await call('PUT', '/api/admin/banners', { auto: 5, slides: [] }, A);
  ok('banner: jogador comum não edita', r.s === 403);
  r = await call('PUT', '/api/admin/banners', { auto: 5, slides: [{ title: 'Olá', text: 'oi', b1: { act: 'playnow', label: 'Jogar agora' }, b2: { act: 'url', label: 'Site', val: 'http://inseguro.com' } }] }, ADM);
  ok('banner: link sem https é recusado', r.s === 400, r.txt);
  r = await call('PUT', '/api/admin/banners', { auto: 5, slides: [{ title: 'Olá', b1: { act: 'game', label: 'Abrir', val: 'abc' } }] }, ADM);
  ok('banner: botão de jogo exige id numérico', r.s === 400, r.txt);
  r = await call('PUT', '/api/admin/banners', { auto: 5, slides: [{ title: '', text: 'sem título e sem imagem' }] }, ADM);
  ok('banner: slide vazio é recusado', r.s === 400, r.txt);
  r = await call('PUT', '/api/admin/banners', { auto: 5, slides: [{ title: 'x', image: 'data:text/html;base64,PGI+' }] }, ADM);
  ok('banner: imagem que não é imagem é recusada', r.s === 400, r.txt);
  r = await call('PUT', '/api/admin/banners', { auto: 5, slides: Array.from({ length: 9 }, () => ({ title: 'x' })) }, ADM);
  ok('banner: no máximo 8 slides', r.s === 400, r.txt);
  r = await call('PUT', '/api/admin/banners', { auto: 99, slides: [
    { title: 'Bem-vindo', text: 'Jogue agora', b1: { act: 'playnow', label: 'Jogar agora' }, b2: { act: 'tab', label: 'Loja', val: 'store' } },
    { title: 'Novo jogo', image: PNG, b1: { act: 'game', label: 'Ver', val: '12' }, on: true },
    { title: 'Escondido', on: false }] }, ADM);
  ok('banner: administrador salva os slides', r.s === 200 && r.j.slides.length === 3 && r.j.auto === 30, r.txt);
  const img = r.j.slides[1];
  r = await call('GET', '/api/banners');
  ok('banner: público só vê slides ligados', r.j.slides.length === 2 && r.j.slides[0].title === 'Bem-vindo');
  ok('banner: a imagem vira um link com versão', /^\/api\/banners\/img\/[a-f0-9]{8}\?v=[a-f0-9]{8}$/.test(r.j.slides[1].image) && !r.txt.includes('base64'), r.txt.slice(0, 200));
  const ir = await fetch(BASE + img.image);
  ok('banner: a imagem é servida com cache', ir.status === 200 && ir.headers.get('content-type') === 'image/png' && /immutable/.test(ir.headers.get('cache-control')));
  ok('banner: id de imagem inválido dá 404', (await fetch(BASE + '/api/banners/img/zzzz')).status === 404);
  r = await call('GET', '/api/admin/banners', null, ADM);
  ok('banner: o admin vê também os slides desligados', r.j.slides.length === 3);
  r = await call('PUT', '/api/admin/banners', { auto: 4, slides: r.j.slides.map(s => ({ ...s, image: s.image ? 'keep' : '' })) }, ADM);
  ok('banner: reenviar com "keep" mantém a imagem', r.s === 200 && !!r.j.slides[1].image && r.j.auto === 4, r.txt);

  console.log(`\n${pass} ok, ${fail} falhas`);
  srv.kill(); process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); srv.kill(); process.exit(1); });
