// Configurações do administrador: um cadastro único (tipos, limites, textos de ajuda) que o painel desenha sozinho
// e que o servidor realmente respeita (cadastro, moderação, chat, economia, notificações).
// Chat, Missões e Atalhos começam desligados na versão publicada (produção); FEAT_DEFAULT=on/off força o contrário.
const FEAT_DEF = process.env.FEAT_DEFAULT ? process.env.FEAT_DEFAULT === 'on' : process.env.NODE_ENV !== 'production';
export const GROUPS = [
  { id: 'signup', name: 'Cadastro e login', desc: 'Quem pode entrar e como as contas são protegidas.' },
  { id: 'mod', name: 'Moderação automática', desc: 'Filtros e limites que ajudam a equipe a cuidar da comunidade.' },
  { id: 'chat', name: 'Chat e comunidade', desc: 'Regras de conversa, imagens, grupos e publicações.' },
  { id: 'economy', name: 'Moedas e economia', desc: 'Bônus, recompensas e a parte dos criadores.' },
  { id: 'push', name: 'Notificações (padrões)', desc: 'O que vale para todos, antes de cada pessoa ajustar o seu.' },
  { id: 'app', name: 'Recursos e aviso no app', desc: 'Liga ou desliga partes do app para todos e define o recado fixo da tela inicial.' },
];
export const FIELDS = [
  { key: 'signupOpen', group: 'signup', type: 'bool', def: true, label: 'Aceitar novos cadastros', help: 'Desligue para fechar a entrada de gente nova (quem já tem conta continua entrando).' },
  { key: 'minPassword', group: 'signup', type: 'int', def: 8, min: 8, max: 32, label: 'Tamanho mínimo da senha', help: 'Vale para novas contas e para quem trocar a senha.' },
  { key: 'blockedDomains', group: 'signup', type: 'list', def: [], max: 50, item: 60, label: 'E-mails bloqueados', help: 'Domínios que não podem criar conta. Um por linha, ex.: mailinator.com' },
  { key: 'sessionDays', group: 'signup', type: 'int', def: 30, min: 1, max: 90, label: 'Dias que o login dura', help: 'Depois disso a pessoa precisa entrar de novo. Vale para os próximos logins.' },
  { key: 'bannedWords', group: 'mod', type: 'list', def: [], max: 200, item: 40, label: 'Palavras proibidas', help: 'Mensagens, publicações, comentários e avaliações com estas palavras são recusadas. Uma por linha.' },
  { key: 'reportsToAlert', group: 'mod', type: 'int', def: 3, min: 0, max: 50, label: 'Denúncias abertas para avisar a equipe', help: 'Quando um mesmo conteúdo chega a este número, os administradores recebem um alerta. 0 desliga.' },
  { key: 'reportsPerHour', group: 'mod', type: 'int', def: 20, min: 1, max: 200, label: 'Denúncias por hora, por pessoa', help: 'Evita enxurrada de denúncias falsas.' },
  { key: 'maxMsgLen', group: 'chat', type: 'int', def: 300, min: 50, max: 1000, label: 'Tamanho máximo da mensagem', help: 'Letras por mensagem no chat e nos grupos.' },
  { key: 'slowModeSec', group: 'chat', type: 'int', def: 0, min: 0, max: 120, label: 'Intervalo entre mensagens (segundos)', help: 'Cada pessoa só envia uma mensagem a cada tantos segundos. 0 desliga.' },
  { key: 'allowImages', group: 'chat', type: 'bool', def: true, label: 'Permitir imagens no chat', help: 'Desligue para aceitar só texto.' },
  { key: 'allowSpaceCreate', group: 'chat', type: 'bool', def: true, label: 'Permitir criar grupos e comunidades', help: 'Desligado, só a equipe cria novos grupos.' },
  { key: 'maxPostLen', group: 'chat', type: 'int', def: 500, min: 100, max: 2000, label: 'Tamanho máximo da publicação', help: 'Letras por publicação no feed.' },
  { key: 'welcomeCoins', group: 'economy', type: 'int', def: 0, min: 0, max: 5000, label: 'Moedas de boas-vindas', help: 'Quantas moedas cada conta nova ganha ao se cadastrar.' },
  { key: 'dailyCoins', group: 'economy', type: 'int', def: 10, min: 0, max: 1000, label: 'Bônus diário (moedas)', help: 'Recompensa de quem coleta todo dia.' },
  { key: 'dailyCoinsPremium', group: 'economy', type: 'int', def: 30, min: 0, max: 2000, label: 'Bônus diário do Premium (moedas)', help: 'Recompensa diária de quem tem Premium.' },
  { key: 'premiumBonusPct', group: 'economy', type: 'int', def: 10, min: 0, max: 100, label: 'Bônus do Premium nos pacotes (%)', help: 'Moedas extras que o Premium recebe em cada pacote.' },
  { key: 'creatorSharePct', group: 'economy', type: 'int', def: 70, min: 10, max: 95, label: 'Parte do criador nas vendas de jogos (%)', help: 'O resto fica com a plataforma. Vale para as próximas vendas.' },
  { key: 'pushOffCats', group: 'push', type: 'cats', def: [], label: 'Categorias desligadas para todos', help: 'Nenhuma notificação externa destas categorias é enviada. Segurança nunca desliga.' },
  { key: 'pushDailyLimit', group: 'push', type: 'int', def: 0, min: 0, max: 100, label: 'Limite de notificações externas por dia, por pessoa', help: 'Avisos de segurança e manutenção passam sempre. 0 sem limite.' },
  { key: 'quietDefault', group: 'push', type: 'bool', def: false, label: 'Horário silencioso ligado por padrão', help: 'Vale só para quem nunca mexeu nas próprias preferências.' },
  { key: 'quietFrom', group: 'push', type: 'time', def: '22:00', label: 'Silêncio começa às', help: '' },
  { key: 'quietTo', group: 'push', type: 'time', def: '07:00', label: 'Silêncio termina às', help: '' },
  { key: 'featChat', group: 'app', type: 'bool', def: FEAT_DEF, label: 'Chat liberado', help: 'Desligado: a aba Chat mostra "Em desenvolvimento, em breve será lançado".' },
  { key: 'featMissions', group: 'app', type: 'bool', def: FEAT_DEF, label: 'Missões liberadas', help: 'Desligado: as missões da plataforma ficam escondidas no app.' },
  { key: 'featShortcuts', group: 'app', type: 'bool', def: FEAT_DEF, label: 'Atalhos na tela inicial', help: 'Desligado: os atalhos saem da Início e da personalização.' },
  { key: 'homeNotice', group: 'app', type: 'text', def: '', max: 160, label: 'Aviso na tela inicial', help: 'Aparece no topo da Início para todos. Deixe vazio para esconder.' },
];
const BY = Object.fromEntries(FIELDS.map(f => [f.key, f]));

export function makeCfg({ get, run, parseJ }) {
  let cache = null, at = 0;
  const raw = () => { if (cache && Date.now() - at < 2000) return cache; const r = get("SELECT value FROM settings WHERE key = 'cfg'"); cache = r ? parseJ(r.value, {}) : {}; at = Date.now(); return cache; };
  const val = k => { const f = BY[k]; if (!f) return undefined; const v = raw()[k]; return v === undefined ? f.def : v; };
  const values = () => Object.fromEntries(FIELDS.map(f => [f.key, val(f.key)]));
  function clean(f, v, bad, cats) {
    if (f.type === 'bool') return !!v;
    if (f.type === 'int') { const n = Number(v); if (!Number.isInteger(n) || n < f.min || n > f.max) bad(`${f.label}: use um número de ${f.min} a ${f.max}`); return n; }
    if (f.type === 'text') return String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, f.max);
    if (f.type === 'time') { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v))) bad(`${f.label}: use HH:MM`); return String(v); }
    if (f.type === 'list') {
      const a = (Array.isArray(v) ? v : String(v ?? '').split(/[\n,;]/)).map(x => String(x).trim().toLowerCase().replace(/\s+/g, ' ')).filter(Boolean).map(x => x.slice(0, f.item));
      return [...new Set(a)].slice(0, f.max);
    }
    if (f.type === 'cats') { const a = (Array.isArray(v) ? v : []).map(String).filter(x => cats[x] && !cats[x].locked); return [...new Set(a)]; }
    return v;
  }
  function save(patch, bad, cats) {
    const cur = { ...raw() }, notes = [];
    for (const [k, v] of Object.entries(patch || {})) {
      const f = BY[k]; if (!f) continue;
      const nv = clean(f, v, bad, cats), ov = val(k);
      if (JSON.stringify(nv) !== JSON.stringify(ov)) { cur[k] = nv; notes.push(`${f.label}: ${fmt(f, ov)} → ${fmt(f, nv)}`); }
    }
    if (notes.length) { run("INSERT INTO settings (key, value) VALUES ('cfg', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(cur)); cache = null; }
    return notes;
  }
  const fmt = (f, v) => f.type === 'bool' ? (v ? 'ligado' : 'desligado') : Array.isArray(v) ? v.length + ' item(ns)' : String(v === '' ? 'vazio' : v).slice(0, 40);
  // palavras proibidas: acha a primeira que aparece como palavra inteira (sem acento/maiúscula)
  const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const badWord = text => {
    const list = val('bannedWords'); if (!list.length || !text) return '';
    const t = ' ' + norm(text).replace(/[^\p{L}\p{N}]+/gu, ' ') + ' ';
    for (const w of list) { const n = ' ' + norm(w).replace(/[^\p{L}\p{N}]+/gu, ' ').trim() + ' '; if (n.trim() && t.includes(n)) return w; }
    return '';
  };
  return { val, values, save, badWord, GROUPS, FIELDS };
}
