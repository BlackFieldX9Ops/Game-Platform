// Compras: pacotes editáveis, modo teste, InfinitePay (link, aviso e verificação) e Pix manual.
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PORT = 3994, MP = 3995, BASE = `http://localhost:${PORT}`;
const dir = mkdtempSync(path.join(tmpdir(), 'gpy-'));
const paid = new Map(); // order_nsu -> {amount, tx, slug}
const links = [];
const mock = http.createServer((req, res) => {
  let b = ''; req.on('data', d => b += d); req.on('end', () => {
    const j = JSON.parse(b || '{}'); res.setHeader('content-type', 'application/json');
    if (req.url === '/links') { links.push({ ...j, key: req.headers['x-api-key'] || '' }); if (j.handle === 'quebrada') { res.statusCode = 403; return res.end('{"error":"forbidden"}'); } return res.end(JSON.stringify({ url: 'https://checkout.infinitepay.io/' + j.handle + '/' + j.order_nsu.slice(0, 6) })); }
    if (req.url === '/payment_check') { const p = paid.get(j.order_nsu); if (!p || p.tx !== j.transaction_nsu || p.slug !== j.slug) return res.end(JSON.stringify({ success: true, paid: false })); return res.end(JSON.stringify({ success: true, paid: true, amount: p.amount, paid_amount: p.amount + 15, capture_method: 'pix' })); }
    res.statusCode = 404; res.end('{}');
  });
}).listen(MP);
const srv = spawn('node', ['src/index.js'], { env: { ...process.env, PORT, DB_FILE: path.join(dir, 't.db'), ADMIN_EMAIL: 'admin@teste.com', STUDIO_GATE: 'off', CONFIRM_GATE: 'off', BACKUP_AUTO: 'off', JWT_SECRET: 'teste', PUSH_WORKER: 'off', INFINITEPAY_API: `http://localhost:${MP}`, PUBLIC_URL: 'https://exemplo.test' }, stdio: 'ignore' });
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
  const adm = await reg('Admin'), ana = await reg('Ana'), bia = await reg('Bia');
  const [ADM, A, B] = [adm.token, ana.token, bia.token];
  const coins = async t => (await call('GET', '/api/store', null, t)).j.coins;

  // pacotes editáveis
  let r = await call('POST', '/api/admin/prices', { id: 'coins100', coins: 150 }, ADM);
  ok('admin muda as moedas de um pacote', r.s === 200 && r.j.catalog.packs.find(p => p.id === 'coins100').coins === 150, r.txt);
  r = await call('POST', '/api/admin/prices', { id: 'coins100', coins: 0 }, ADM);
  ok('moedas inválidas são recusadas', r.s === 400);
  r = await call('POST', '/api/admin/prices', { id: 'coins100', coins: 200 }, A);
  ok('jogador não edita pacotes', r.s === 403);
  r = await call('POST', '/api/admin/packs', { name: 'Pacote Mega', coins: 9000, price: 19990 }, ADM);
  const mega = r.j.catalog && r.j.catalog.packs.find(p => p.name === 'Pacote Mega');
  ok('admin cria um pacote novo', r.s === 200 && !!mega && mega.coins === 9000 && mega.price === 19990, r.txt);
  r = await call('GET', '/api/store', null, A);
  ok('o pacote novo aparece na loja com as moedas editadas', r.j.packs.some(p => p.id === mega.id) && r.j.packs.find(p => p.id === 'coins100').coins === 150);
  r = await call('DELETE', '/api/admin/packs/coins500', null, ADM);
  ok('pacote padrão não é apagado (só sai de venda)', r.s === 404);
  r = await call('POST', '/api/admin/prices', { id: 'coins500', active: false }, ADM);
  ok('pacote padrão pode sair de venda', r.s === 200 && !(await call('GET', '/api/store', null, A)).j.packs.some(p => p.id === 'coins500'));
  await call('POST', '/api/admin/prices', { id: 'coins500', active: true }, ADM);

  // modo teste (padrão)
  r = await call('GET', '/api/admin/pay', null, ADM);
  ok('o modo de pagamento começa em teste', r.j.cfg.mode === 'test');
  r = await call('POST', '/api/store/checkout', { id: 'coins100' }, A);
  ok('modo teste entrega na hora (moedas editadas)', r.s === 200 && r.j.mode === 'test' && (await coins(A)) === 150, r.txt);

  // configuração
  r = await call('POST', '/api/admin/pay', { mode: 'infinitepay' }, ADM);
  ok('InfinitePay sem InfiniteTag é recusada', r.s === 409);
  r = await call('POST', '/api/admin/pay', { handle: 'a b$' }, ADM);
  ok('InfiniteTag inválido é recusado', r.s === 400);
  r = await call('POST', '/api/admin/pay', { handle: '$minhaloja', apiKey: 'errada' }, ADM);
  ok('chave de API com formato errado é recusada', r.s === 400);
  r = await call('POST', '/api/admin/pay', { handle: '$minhaloja', apiKey: 'inchk_abcdef123456', pixKey: 'chave@pix.com', pixName: 'Loja', mode: 'infinitepay' }, ADM);
  ok('configuração salva', r.s === 200 && r.j.cfg.mode === 'infinitepay' && r.j.cfg.handle === 'minhaloja' && r.j.cfg.hasKey === true, r.txt);
  ok('a chave de API nunca volta nas respostas', !JSON.stringify((await call('GET', '/api/admin/pay', null, ADM)).j).includes('inchk_'));
  r = await call('GET', '/api/admin/pay', null, A);
  ok('jogador não vê a configuração de pagamento', r.s === 403);

  // compra direta bloqueada, checkout cria link
  r = await call('POST', '/api/store/buy', { id: 'coins500' }, A);
  ok('compra de teste é bloqueada com pagamento real ligado', r.s === 409);
  r = await call('POST', '/api/store/checkout', { id: 'coins500' }, A);
  const nsu = r.j.order && r.j.order.nsu;
  ok('checkout devolve o link de pagamento', r.s === 200 && r.j.mode === 'infinitepay' && /^https:\/\/checkout\.infinitepay\.io\/minhaloja\//.test(r.j.url), r.txt);
  const sent = links[links.length - 1];
  ok('o link é pedido com valor em centavos, item e o pedido', sent.handle === 'minhaloja' && sent.items[0].price === 1990 && sent.items[0].quantity === 1 && sent.order_nsu === nsu && sent.key === 'inchk_abcdef123456');
  ok('o retorno e o aviso apontam para o servidor', sent.redirect_url === 'https://exemplo.test/?paid=' + nsu && sent.webhook.url === 'https://exemplo.test/api/pay/webhook');
  ok('o pedido nasce em aberto e nada é entregue ainda', (await coins(A)) === 150);

  // webhook falso não entrega
  r = await call('POST', '/api/pay/webhook', { order_nsu: nsu, transaction_nsu: 'falso', invoice_slug: 'falso', amount: 1990 });
  ok('aviso sem pagamento confirmado é recusado', r.s === 400 && (await coins(A)) === 150, r.txt);
  r = await call('POST', '/api/pay/webhook', { order_nsu: 'nao-existe' });
  ok('aviso de pedido desconhecido é ignorado com 200', r.s === 200);

  // pagamento real
  paid.set(nsu, { amount: 1990, tx: 'tx-1', slug: 'sl-1' });
  r = await call('POST', '/api/pay/webhook', { order_nsu: nsu, transaction_nsu: 'tx-1', invoice_slug: 'sl-1', amount: 1990, paid_amount: 2005, receipt_url: 'https://c.test/1' });
  ok('aviso confirmado entrega as moedas', r.s === 200 && (await coins(A)) === 150 + 500, r.txt);
  r = await call('POST', '/api/pay/webhook', { order_nsu: nsu, transaction_nsu: 'tx-1', invoice_slug: 'sl-1' });
  ok('aviso repetido não entrega de novo', r.s === 200 && (await coins(A)) === 650);
  r = await call('GET', '/api/admin/sales', null, ADM);
  ok('a venda aparece no extrato com o valor certo', r.j.sales.some(s => s.ref === 'coins500' && s.cents === 1990));
  r = await call('GET', '/api/store/orders', null, A);
  ok('o jogador vê o pedido como pago', r.j.orders[0].status === 'paid');

  // verificação pelo retorno do navegador
  r = await call('POST', '/api/store/checkout', { id: 'premium30' }, B);
  const n2 = r.j.order.nsu;
  r = await call('POST', `/api/store/orders/${n2}/verify`, {}, B);
  ok('verificar sem dados de retorno mantém em aberto', r.j.order.status === 'pending');
  r = await call('POST', `/api/store/orders/${n2}/verify`, { transaction_nsu: 'x', slug: 'y' }, B);
  ok('verificação com dados errados não entrega', r.j.order.status === 'pending');
  paid.set(n2, { amount: 990, tx: 'tx-2', slug: 'sl-2' });
  r = await call('POST', `/api/store/orders/${n2}/verify`, { transaction_nsu: 'tx-2', slug: 'sl-2' }, A);
  ok('um jogador não verifica o pedido de outro', r.s === 404);
  r = await call('POST', `/api/store/orders/${n2}/verify`, { transaction_nsu: 'tx-2', slug: 'sl-2' }, B);
  ok('retorno do pagamento confirma e ativa o Premium', r.j.order.status === 'paid' && r.j.premium && r.j.premium.active === true, r.txt);

  // valor divergente
  r = await call('POST', '/api/store/checkout', { id: 'coins1200' }, B);
  const n3 = r.j.order.nsu; paid.set(n3, { amount: 100, tx: 't3', slug: 's3' });
  r = await call('POST', `/api/store/orders/${n3}/verify`, { transaction_nsu: 't3', slug: 's3' }, B);
  ok('pagamento de valor diferente não entrega', r.j.order.status === 'pending');

  // Pix manual
  r = await call('POST', '/api/admin/pay', { mode: 'pix' }, ADM);
  ok('modo Pix manual ligado', r.s === 200 && r.j.cfg.mode === 'pix');
  r = await call('POST', '/api/store/checkout', { id: 'coins100' }, A);
  const n4 = r.j.order.nsu;
  ok('Pix manual mostra a chave, o valor e o código do pedido', r.j.mode === 'pix' && r.j.pix.key === 'chave@pix.com' && r.j.pix.cents === 490 && r.j.pix.code === n4.slice(0, 8).toUpperCase(), r.txt);
  r = await call('GET', '/api/admin/orders?status=pending', null, ADM);
  ok('o admin vê os pedidos em aberto', r.j.orders.some(o => o.nsu === n4) && r.j.pending >= 2);
  r = await call('POST', `/api/admin/orders/${n4}/confirm`, {}, A);
  ok('jogador não confirma pagamento', r.s === 403);
  const before = await coins(A);
  r = await call('POST', `/api/admin/orders/${n4}/confirm`, {}, ADM);
  ok('admin confirma o Pix e entrega as moedas', r.s === 200 && (await coins(A)) === before + 150, r.txt);
  r = await call('POST', `/api/admin/orders/${n4}/confirm`, {}, ADM);
  ok('confirmar duas vezes não entrega de novo', r.s === 409 && (await coins(A)) === before + 150);
  r = await call('POST', '/api/store/checkout', { id: 'coins100' }, A);
  const n5 = r.j.order.nsu;
  r = await call('POST', `/api/admin/orders/${n5}/cancel`, {}, ADM);
  ok('admin cancela um pedido em aberto', r.s === 200);
  r = await call('POST', `/api/admin/orders/${n5}/confirm`, {}, ADM);
  ok('pedido cancelado não pode ser confirmado', r.s === 409);

  // falha da InfinitePay
  await call('POST', '/api/admin/pay', { mode: 'infinitepay', handle: 'quebrada' }, ADM);
  r = await call('POST', '/api/store/checkout', { id: 'coins100' }, A);
  ok('falha da InfinitePay vira erro claro e o pedido é cancelado', r.s === 502 && (await call('GET', '/api/store/orders', null, A)).j.orders[0].status === 'canceled', r.txt);
  r = await call('POST', '/api/admin/pay/test', {}, ADM);
  ok('teste de conexão informa a falha', r.s === 200 && r.j.ok === false);
  await call('POST', '/api/admin/pay', { handle: 'minhaloja' }, ADM);
  r = await call('POST', '/api/admin/pay/test', {}, ADM);
  ok('teste de conexão devolve o link de R$ 1,00', r.j.ok === true && /^https:/.test(r.j.url) && links[links.length - 1].items[0].price === 100);

  // auditoria
  r = await call('GET', '/api/admin/logs', null, ADM);
  const txt = JSON.stringify(r.j);
  ok('as mudanças de pagamento entram na auditoria sem expor a chave', /Pagamentos: configura/.test(txt) && !txt.includes('inchk_'), txt.slice(0, 200));

  // pacote apagado
  r = await call('DELETE', `/api/admin/packs/${mega.id}`, null, ADM);
  ok('admin apaga o pacote que criou', r.s === 200 && !(await call('GET', '/api/store', null, A)).j.packs.some(p => p.id === mega.id));

  console.log(`\n${pass} ok, ${fail} falhas`);
  srv.kill(); mock.close(); process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); srv.kill(); mock.close(); process.exit(1); });
