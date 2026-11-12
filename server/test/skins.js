// Criador de itens da Loja: molduras, fundos, títulos, cores, balões e temas do app criados pelo administrador.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PORT = 3993, BASE = `http://localhost:${PORT}`;
const dir = mkdtempSync(path.join(tmpdir(), 'gps-'));
const srv = spawn('node', ['src/index.js'], { env: { ...process.env, PORT, DB_FILE: path.join(dir, 't.db'), ADMIN_EMAIL: 'admin@teste.com', STUDIO_GATE: 'off', CONFIRM_GATE: 'off', BACKUP_AUTO: 'off', JWT_SECRET: 'teste', PUSH_WORKER: 'off' }, stdio: 'ignore' });
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'OK   ' : 'FALHA'} ${n}${c ? '' : ' ' + x}`); };
async function call(method, url, body, token) {
  const r = await fetch(BASE + url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const txt = await r.text(); let j = {}; try { j = JSON.parse(txt); } catch {}
  return { s: r.status, j, txt };
}
const wait = ms => new Promise(r => setTimeout(r, ms));
// PNG 1x1 (animado de mentira: o servidor só confere o tipo real do arquivo)
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const WEBP = 'data:image/webp;base64,' + Buffer.concat([Buffer.from('RIFF'), Buffer.from([30, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(30)]).toString('base64');
const WOFF2 = 'data:font/woff2;base64,' + Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(60)]).toString('base64');

async function main() {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(BASE + '/api/health')).ok) break; } catch {} await wait(150); }
  const reg = async n => (await call('POST', '/api/auth/register', { name: n, email: n.toLowerCase() + '@teste.com', password: 'senha12345' })).j;
  const adm = await reg('Admin'), ana = await reg('Ana');
  const [ADM, A] = [adm.token, ana.token];

  let r = await call('GET', '/api/admin/store-items', null, A);
  ok('jogador não vê o criador de itens', r.s === 403);
  r = await call('POST', '/api/admin/store-items', { slot: 'title', name: 'X' }, A);
  ok('jogador não cria itens', r.s === 403);
  r = await call('GET', '/api/admin/store-items', null, ADM);
  ok('admin vê a lista vazia', r.s === 200 && r.j.items.length === 0 && r.j.slots.length === 6 && r.j.fonts.includes('gotica'));

  // tema de Halloween (cores, fonte, imagem animada, datas)
  r = await call('POST', '/api/admin/store-items', { slot: 'theme', name: 'Halloween', coins: 300, tag: 'halloween', starts_at: '2020-10-01', ends_at: '2099-11-02', img: WEBP, data: { accent: '#F97316', accent2: '#7C2D12', bg: '#0b0610', surface: '#1a0f22', fg: '#fde68a', font: 'gotica', shade: 40, fit: 'cover' } }, ADM);
  const hw = r.j.item;
  ok('o item criado vem ligado', hw && hw.active === true && hw.onSale === true);
  ok('admin cria o tema Halloween', r.s === 200 && hw && hw.id.startsWith('c') && hw.slot === 'theme' && hw.hasImg && hw.data.accent === '#f97316' && hw.data.font === 'gotica', r.txt);
  ok('a imagem do item é servida (WebP) com cache', await fetch(BASE + '/api/store/img/' + hw.id).then(x => x.status === 200 && x.headers.get('content-type') === 'image/webp' && /immutable/.test(x.headers.get('cache-control'))));
  ok('imagem inexistente dá 404', (await fetch(BASE + '/api/store/img/c9999')).status === 404);

  r = await call('POST', '/api/admin/store-items', { slot: 'theme', name: 'Carnaval', coins: 0, tag: 'carnaval', font: WOFF2, data: { accent: '#ec4899', accent2: '#f59e0b' } }, ADM);
  const cv = r.j.item;
  ok('tema com fonte própria (woff2) é aceito', r.s === 200 && cv.hasFont, r.txt);
  ok('a fonte é servida com o tipo certo', await fetch(BASE + '/api/store/font/' + cv.id).then(x => x.status === 200 && x.headers.get('content-type') === 'font/woff2'));

  r = await call('POST', '/api/admin/store-items', { slot: 'frame', name: 'Teia', coins: 120, img: PNG, data: { glow: '#a78bfa', anim: 'pulse' } }, ADM);
  const fr = r.j.item; ok('admin cria moldura com imagem (PNG/APNG)', r.s === 200 && fr.hasImg && fr.data.anim === 'pulse', r.txt);
  r = await call('POST', '/api/admin/store-items', { slot: 'title', name: 'Assombrado', coins: 50, data: { color: '#fb923c' } }, ADM);
  const ti = r.j.item; ok('admin cria título de texto', r.s === 200 && ti.name === 'Assombrado', r.txt);
  r = await call('POST', '/api/admin/store-items', { slot: 'banner', name: 'Cemitério', coins: 80, data: { c1: '#111827', c2: '#4c1d95' } }, ADM);
  const bn = r.j.item; ok('admin cria fundo de perfil com cores', r.s === 200 && bn.slot === 'banner', r.txt);
  r = await call('POST', '/api/admin/store-items', { slot: 'ncolor', name: 'Nome laranja', coins: 10, data: { c1: '#f97316', c2: '#facc15' } }, ADM);
  const nc = r.j.item; ok('admin cria cor de nome', r.s === 200, r.txt);
  r = await call('POST', '/api/admin/store-items', { slot: 'bubble', name: 'Balão abóbora', coins: 10, data: { bg: '#c2410c', fg: '#ffffff' } }, ADM);
  const bb = r.j.item; ok('admin cria balão de chat', r.s === 200, r.txt);

  // validações
  r = await call('POST', '/api/admin/store-items', { slot: 'theme', name: 'Ruim', data: { accent: 'vermelho' } }, ADM);
  ok('cor inválida é recusada', r.s === 400, r.txt);
  r = await call('POST', '/api/admin/store-items', { slot: 'frame', name: 'Vazia', data: {} }, ADM);
  ok('moldura sem imagem nem brilho é recusada', r.s === 400);
  r = await call('POST', '/api/admin/store-items', { slot: 'frame', name: 'Falsa', img: 'data:image/png;base64,' + Buffer.from('isto nao e imagem').toString('base64'), data: {} }, ADM);
  ok('arquivo que não é imagem de verdade é recusado', r.s === 400, r.txt);
  r = await call('POST', '/api/admin/store-items', { slot: 'frame', name: 'Script', img: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', data: { glow: '#ffffff' } }, ADM);
  ok('SVG não é aceito como imagem', r.s === 400);
  r = await call('POST', '/api/admin/store-items', { slot: 'theme', name: 'Fonte falsa', font: 'data:font/woff2;base64,' + Buffer.from('nao').toString('base64'), data: { accent: '#ffffff' } }, ADM);
  ok('fonte falsa é recusada', r.s === 400, r.txt);
  r = await call('POST', '/api/admin/store-items', { slot: 'title', name: 'A' }, ADM);
  ok('nome curto é recusado', r.s === 400);
  r = await call('POST', '/api/admin/store-items', { slot: 'title', name: 'Datas', starts_at: '2025-12-01', ends_at: '2025-01-01' }, ADM);
  ok('data final antes da inicial é recusada', r.s === 400);
  r = await call('POST', '/api/admin/store-items', { slot: 'coisa', name: 'Tipo ruim' }, ADM);
  ok('tipo de item inválido é recusado', r.s === 400);

  // loja do jogador
  r = await call('GET', '/api/store', null, A);
  const ids = r.j.items.map(i => i.id);
  ok('os itens criados aparecem na Loja do jogador', [hw, cv, fr, ti, bn, nc, bb].every(i => ids.includes(i.id)), ids.join());
  const sh = r.j.items.find(i => i.id === hw.id);
  ok('item mostra preço, dados do tema e etiqueta', sh.coins === 300 && sh.data.accent === '#f97316' && sh.tag === 'halloween' && sh.hasImg && sh.ver >= 1, JSON.stringify(sh));
  ok('a Loja entrega as definições de aparência', r.j.skins.length === 7);
  ok('a imagem em si não vai dentro da lista', !/data:image/.test(r.txt));
  r = await call('GET', '/api/skins');
  ok('as definições de aparência são públicas (perfil dos outros)', r.s === 200 && r.j.skins.length === 7);

  r = await call('POST', '/api/store/buy', { id: hw.id }, A);
  ok('sem moedas não compra', r.s === 402, r.txt);
  await call('POST', '/api/admin/users/' + ana.user.id + '/coins', { delta: 1000, reason: 'teste do criador' }, ADM);
  r = await call('POST', '/api/store/buy', { id: hw.id }, A);
  ok('compra o tema e ele já fica em uso', r.s === 200 && r.j.equipped.theme === hw.id && r.j.owned.includes(hw.id) && r.j.coins === 700, r.txt);
  r = await call('POST', '/api/store/buy', { id: hw.id }, A);
  ok('não compra duas vezes', r.s === 409);
  r = await call('POST', '/api/store/buy', { id: cv.id }, A);
  ok('item grátis é pego sem gastar moedas', r.s === 200 && r.j.coins === 700 && r.j.equipped.theme === cv.id, r.txt);
  r = await call('POST', '/api/store/equip', { slot: 'theme', id: hw.id }, A);
  ok('troca de tema entre os que tem', r.s === 200 && r.j.equipped.theme === hw.id);
  r = await call('POST', '/api/store/equip', { slot: 'frame', id: fr.id }, A);
  ok('não equipa item que não comprou', r.s === 403);
  r = await call('POST', '/api/store/buy', { id: ti.id }, A);
  r = await call('GET', '/api/me', null, A);
  ok('o título equipado mostra o nome do item criado', r.j.user.titleName === 'Assombrado' && r.j.user.title === ti.id, r.txt.slice(0, 200));

  // edição, fora de temporada, desligar e apagar
  r = await call('PUT', '/api/admin/store-items/' + hw.id.slice(1), { name: 'Halloween Terror', coins: 350 }, ADM);
  ok('admin edita nome e preço', r.s === 200 && r.j.item.name === 'Halloween Terror' && r.j.item.coins === 350 && r.j.item.ver === hw.ver && r.j.item.hasImg, r.txt);
  r = await call('PUT', '/api/admin/store-items/' + hw.id.slice(1), { img: WEBP, data: { accent: '#22c55e' } }, ADM);
  ok('trocar imagem ou cores aumenta a versão (limpa o cache)', r.s === 200 && r.j.item.ver === hw.ver + 1 && r.j.item.data.accent === '#22c55e', r.txt);
  r = await call('PUT', '/api/admin/store-items/' + hw.id.slice(1), { img: null }, ADM);
  ok('admin remove a imagem', r.s === 200 && !r.j.item.hasImg);
  r = await call('PUT', '/api/admin/store-items/' + bn.id.slice(1), { ends_at: '2020-01-01' }, ADM);
  ok('fora das datas o item sai da venda', r.s === 200 && r.j.item.onSale === false);
  ok('item fora de temporada some da Loja', !(await call('GET', '/api/store', null, A)).j.items.some(i => i.id === bn.id));
  r = await call('POST', '/api/store/buy', { id: bn.id }, A);
  ok('e não pode ser comprado', r.s === 410, r.txt);
  r = await call('PUT', '/api/admin/store-items/' + nc.id.slice(1), { active: false }, ADM);
  ok('admin tira um item da venda', r.s === 200 && r.j.item.onSale === false);
  r = await call('POST', '/api/admin/store-items', { slot: 'title', name: 'Temporada passada', coins: 0, ends_at: '2020-01-01' }, ADM);
  const old = r.j.item; r = await call('PUT', '/api/admin/store-items/' + hw.id.slice(1), { starts_at: '2020-01-01', ends_at: '2020-02-01' }, ADM);
  const keep = await call('GET', '/api/store', null, A);
  ok('quem já tem o item continua vendo (marcado fora de venda)', keep.j.items.some(i => i.id === hw.id && i.offsale === true));
  ok('o tema fora de temporada continua equipado', keep.j.equipped.theme === hw.id);

  r = await call('DELETE', '/api/admin/store-items/' + ti.id.slice(1), null, A);
  ok('jogador não apaga item', r.s === 403);
  r = await call('DELETE', '/api/admin/store-items/' + hw.id.slice(1), null, ADM);
  ok('admin apaga o item', r.s === 200 && r.j.owners === 1, r.txt);
  r = await call('GET', '/api/store', null, A);
  ok('apagar tira o item de quem tinha e de quem usava', !r.j.owned.includes(hw.id) && r.j.equipped.theme !== hw.id && !r.j.items.some(i => i.id === hw.id), JSON.stringify(r.j.equipped));
  r = await call('DELETE', '/api/admin/store-items/99999', null, ADM);
  ok('apagar item que não existe dá 404', r.s === 404);
  r = await call('GET', '/api/admin/log', null, ADM).catch(() => ({ s: 0, txt: '' }));

  console.log(`\n${pass} ok, ${fail} falhas`);
  srv.kill(); process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); srv.kill(); process.exit(1); });
