# Game Platform

Plataforma mobile para jogar, criar e publicar jogos 2D e 3D feitos em HTML, CSS e JavaScript (inclui WebGL, Three.js, Phaser, p5.js e PixiJS).

- **`app/`**: o aplicativo (telas, player de jogos, Game Studio) empacotado para Android com Capacitor.
- **`server/`**: API em Node.js com banco SQLite, login, upload de jogos, avaliações, amigos, chat em tempo real e administração.

## 1. Baixar o APK

O APK é gerado automaticamente pelo GitHub a cada alteração na pasta `app/`.

1. Abra a aba **Releases** do repositório e entre em **APK mais recente** (`apk-latest`).
2. No celular Android, baixe o arquivo `game-platform.apk` e toque nele.
3. O Android vai pedir para permitir a instalação de apps desconhecidos para o navegador. Permita e conclua.

Se a release ainda não existir, abra **Actions > Gerar APK > Run workflow** e espere cerca de 8 minutos. O arquivo também fica em **Artifacts** dentro da execução.

Este é um APK de teste (debug). Para publicar na Google Play, veja `app/LEIA-ME.md`.

### Atualizar o app

O app confere sozinho se existe versão nova (a cada 6 horas) e mostra um aviso na tela inicial. Também dá para tocar em **Perfil > Configurações > Atualização do app > Verificar agora**. Ao tocar em **Atualizar**, o Android baixa o `game-platform.apk`; abra o arquivo e instale por cima. Seus dados e jogos ficam.

Isso só funciona porque todo APK é assinado com a mesma chave (`app/keystore/debug.keystore`) e tem número de versão crescente (o número da execução do **Gerar APK**). Essa chave é só para testes e fica pública no repositório; para a Google Play use uma chave sua. **Atenção:** o APK instalado antes desta mudança tinha outra assinatura, então desinstale-o uma vez antes de instalar o novo. Depois disso, as atualizações entram por cima.

### Tela cheia e rotação

- **Tela cheia de ponta a ponta:** o app desenha por trás da barra de status e do recorte da câmera (sem faixa branca). Deslize a partir da borda para ver as barras por um instante. Dá para desligar em **Perfil > Configurações > Tela**.
- **Fora dos jogos o app fica sempre em pé.** Ao abrir um jogo, ele gira sozinho para a posição que o jogo pede, e volta para em pé ao sair.
- **Como o app sabe a posição do jogo**, nesta ordem: (1) sua escolha em Configurações (*Sempre em pé* ou *Sempre deitado*); (2) o campo **Orientação do jogo** que o criador marca no Studio (Automática, Retrato ou Paisagem); (3) o código do jogo, quando ele chama `screen.orientation.lock('landscape')` ou `'portrait'` (o app intercepta a chamada, que dentro do jogo isolado não funcionaria sozinha); (4) se nada disso existir, o jogador gira o aparelho como quiser.
- Jogos em tela cheia não mostram o cabeçalho do app; o botão discreto de três pontinhos no canto mostra Voltar e Recarregar por 3 segundos.

O código nativo dessa parte está em `app/native/MainActivity.java` e entra no APK pelo fluxo **Gerar APK**.

### Publicar jogos com vários arquivos

No **Studio > Enviar arquivo** você pode mandar um único `.html` ou um `.zip` com o jogo inteiro (HTML, JavaScript, CSS, imagens, sons, fontes, modelos 3D, JSON). O app junta tudo em uma só página: scripts e CSS entram direto, e os demais arquivos ficam embutidos e são achados pelo caminho original (`assets/hero.png`, `data/level.json`) por `fetch`, `XMLHttpRequest`, `Image`, `Audio` e `<script>`. Limites: ZIP de até 15 MB, jogo final de uns 18 MB. Offline o limite é 2,5 MB. Scripts `type="module"` que importam arquivos locais (`import './x.js'`) não são suportados; gere um pacote único (Vite, esbuild, Rollup) antes.

### Studio e administração

- **Capa do jogo:** no Studio, arraste uma imagem (ou toque) para a área de capa. O app recorta em 16:9 e reduz para uns 100 KB; ela aparece na Loja, na Início e na Biblioteca.
- **Rascunhos:** o botão *Rascunho* guarda o jogo no aparelho (até 10, 2,5 MB cada) para continuar depois.
- **Administração** (Perfil > Administração, só para contas admin): resumo com números, fila de moderação, usuários (suspender e reativar), notificação global, **destaques da loja** (até 8 jogos aparecem primeiro), **categorias** (adicionar e remover) e **logs de atividade** (últimas 60 ações). Em modo offline o painel funciona com dados de demonstração.

## 2. Colocar o servidor no ar

Sem servidor o app funciona offline. Com servidor, você tem contas, Loja compartilhada, amigos e chat.

**De graça e com dados permanentes (Oracle Cloud):** siga `deploy/ORACLE.md`. É uma máquina sempre ligada; um script instala tudo, com HTTPS e backup diário. Precisa de cartão apenas para a Oracle verificar a conta.

**Pelo Render (simples, mas pago para guardar dados):** o plano grátis do Render dorme após 15 minutos e apaga os arquivos locais (inclusive o banco SQLite) a cada reinício, então não serve para este servidor. O `render.yaml` usa o plano pago com disco.

**Pelo Render, passo a passo:**

1. Entre em render.com e escolha **New > Blueprint**. Conecte este repositório. O arquivo `render.yaml` já descreve o serviço.
2. Quando pedir, preencha `ADMIN_EMAIL` com o seu e-mail. Quem se cadastrar com esse e-mail vira administrador. A chave `JWT_SECRET` é gerada sozinha.
3. Aguarde o deploy e copie o endereço do serviço, por exemplo `https://game-platform.onrender.com`.
4. Abra esse endereço no navegador para testar: o app já funciona por lá.

O banco fica em um disco persistente (`/app/data`). No Render, disco persistente exige um plano pago; confira o preço atual. Sem disco, os dados somem a cada novo deploy.

**Outras hospedagens:** qualquer uma que rode Docker serve (Railway, Fly.io, VPS). Construa pela raiz do repositório:

```bash
docker build -t game-platform .
docker run -d -p 3000:3000 -v gp-data:/app/data \
  -e JWT_SECRET=troque-por-uma-chave-longa -e ADMIN_EMAIL=voce@exemplo.com game-platform
```

Use sempre HTTPS. O app Android não conversa com servidores `http://` simples.

## 3. Ligar o APK ao servidor

**Forma automática (recomendada):** no GitHub, abra **Settings > Secrets and variables > Actions > Variables**, crie a variável `SERVER_URL` com o endereço do servidor (com `https://`) e rode **Actions > Gerar APK** de novo. O APK novo já vem apontando para o seu servidor.

**Forma manual:** no app, abra **Perfil > Configurações**, escreva o endereço em **Endereço do servidor**, toque em **Salvar e testar** e depois em **Entrar ou criar conta**.

## 4. Rodar no computador

Requisito: Node.js 22.13 ou mais novo.

```bash
cd server
npm install
npm run dev          # http://localhost:3000 (API e app juntos)
npm test             # testes da API
npm run test:app     # o app de verdade contra o servidor, com dois jogadores
```

## O que ainda não existe

- **Pagamentos.** A receita do painel do criador é uma simulação. Cobrar de verdade exige conta em um provedor (Mercado Pago, Stripe ou Pix) e regras de repasse.
- **E-mail** de confirmação de conta e recuperação de senha.
- **Moderação automática.** Hoje a moderação é manual, pelo painel de administração.

## Segurança

Senhas com bcrypt, limite de tentativas no login, contas suspensas perdem o acesso na hora, e só amigos trocam mensagens. Os jogos rodam em um `iframe` isolado (`sandbox` sem `allow-same-origin`), então o código de um jogo não lê o login nem os dados do jogador.

## Abertura, perfil e jogos lançados

- **Abertura:** ao abrir o app aparece o logotipo com o nome *Game Platform* por cerca de 2 segundos.
- **Perfil:** toque na câmera ou em *Editar perfil* para trocar a foto (ela é reduzida no próprio aparelho), o nome e o texto *Sobre você*. Com conta online os dados ficam no servidor; sem conta, no aparelho.
- **Início:** mostra só os jogos lançados, com os mais novos primeiro (destacados vêm antes). O nível e o XP ficam só no Perfil.
- **Administração > Loja:** o administrador pode excluir qualquer jogo, inclusive os que ele mesmo publicou. Há uma confirmação antes de excluir e a ação vai para os logs.

## Atualização automática

- O app confere se há versão nova ao abrir, ao voltar para ele e a cada 30 minutos, e baixa e instala sozinho (Configurações > Atualização do app > *Atualizar sozinho*, ligado por padrão).
- **Primeira vez:** o Android exige que você libere *Instalar apps desta fonte* para o Game Platform. O app avisa e leva até a tela certa. É uma permissão do sistema; nenhum app comum consegue pular essa etapa.
- **Depois disso:** no Android 12 ou mais novo a atualização costuma entrar sem nenhuma pergunta. Em versões mais antigas, o Android mostra uma tela de confirmação.
- Não atualiza no meio de uma partida. Ao terminar a instalação o Android fecha o app; é só abrir de novo. Seus dados e jogos ficam.
- A abertura mostra o logotipo, o nome e uma barra de carregamento por pelo menos 3 segundos.

## Administrador local (temporário)

Enquanto não há servidor, **Perfil > Configurações > Modo administrador (local)** exige um código:

- Na primeira vez você cria o código (mínimo 6 caracteres). Ele fica guardado só como hash SHA-256 com sal, nunca em texto puro.
- Depois, ligar a chave pede o código. Certo, o menu *Administração* aparece e as ações (moderar, suspender, destacar, categorias, excluir jogos) funcionam. Errado 5 vezes, espera 1 minuto.
- Ao fechar o app ele bloqueia de novo. Dá para bloquear na hora ou trocar o código.
- Esqueceu o código? *Apagar dados deste aparelho* remove o código e os dados locais.
- **Limite honesto:** como tudo roda no aparelho, quem controla o próprio celular pode contornar essa trava. Serve para uso temporário e demonstração. Quando o servidor entrar, o papel de administrador vem da conta (já funciona assim com conta online) e esta opção deixa de valer.

## Painel de administração e Studio avançados

- **Administração > Jogos:** lista todos os jogos, de qualquer criador (usuário, administrador ou IA), com capa, criador, categoria, data e status. Filtros por criador (Todos, Eu, Outros, IA), por status e por nome. Em cada jogo: **Editar** (informações), **Modificar** (código), **Publicar/Despublicar**, **Excluir** (com confirmação) e destaque. **Adicionar jogo** publica direto como administrador. Em **Usuários**, *Ver jogos* filtra a lista pelo criador.
- **Studio:** abas *Informações* (capa, nome, descrição com contador, categoria, classificação, tags, 2D/3D, "criado com IA"), *Código* (enviar arquivo, colar com cores e números de linha, ou modelo), *Bibliotecas* (Three.js, Phaser, p5.js, PixiJS e bibliotecas externas por https ou arquivo .js) e *Avançado* (versão, orientação, tela cheia, controles, salvar progresso, monetização, visibilidade). **Testar**, **Rascunho**, **Publicar** e pré-visualização da capa e das informações.
- **Meus jogos:** Jogar, Editar, Atualizar (sobe a versão), Despublicar/Publicar, Estatísticas e Excluir.
- **Visibilidade:** público aparece na Loja; não listado só abre por quem tem o endereço; privado só o dono e a administração veem.
- **Salvar progresso:** quando ligado, o que o jogo guarda em `localStorage` fica salvo no aparelho entre as partidas.
- **Servidor:** novas colunas em `games` (ai, tags, version, visibility, settings) e rotas `/api/my/games`, `/api/games/:id/status`, `/api/games/:id/cover`, `/api/admin/games` (com filtros); editar e excluir jogos de qualquer usuário é permitido ao administrador. As colunas são criadas sozinhas ao iniciar.

## App limpo

Não existe mais nenhum jogo, post, amigo, usuário, avaliação ou número de exemplo. O app começa vazio e só mostra o que usuários criaram de verdade. Quem atualizar de uma versão antiga tem os dados de demonstração apagados uma única vez (a conta, o servidor e os jogos criados por você são mantidos).

## Chat e comunidade

Tudo fica na tela **Comunidade** (atalhos no Início e no Perfil), com seis abas:

- **Comunidade:** feed com avatar, nome, tempo, texto, jogo relacionado, curtidas e comentários. Filtros *Para você*, *Seguindo* e *Jogos*; botão **Seguir** em cada autor; menções com `@nome` avisam o jogador.
- **Grupos:** criar (nome, descrição, capa, público ou privado, membros iniciais por nome ou #ID). Dentro: chat, membros (com online) e regras. Privado só aparece para quem foi convidado.
- **Comunidades:** criar (nome, descrição, capa, categoria, regras, aberta ou restrita). Página própria com publicações, chat geral, membros, eventos e regras. Em comunidade restrita o pedido de entrada é aprovado por quem administra.
- **Mensagens:** lista de conversas diretas, de grupos e de comunidades, com prévia, horário e contador de não lidas. No chat dá para enviar imagem e mencionar um jogo.
- **Amigos:** adicionar por nome ou `#ID`, online/offline, **Mensagem**, **Convidar para jogo** e remover.
- **Avisos:** convites de grupo e comunidade, pedidos de entrada, novos seguidores, menções, respostas, amizades, convites para jogo e eventos.

Sem conta, essas telas pedem login e não mostram nada inventado. No servidor: rotas `/api/posts` (filtros e comentários), `/api/users/search`, `/api/users/:id/follow`, `/api/spaces/...`, `/api/conversations`, `/api/messages` e `/api/friends/:id/invite-game`; as tabelas novas são criadas sozinhas ao iniciar. Mensagens de grupo chegam em tempo real pelo WebSocket.

## Notificações: validade, importantes e deslizar para apagar

- **Deslize para a esquerda** em qualquer aviso para apagá-lo (o toque curto continua abrindo o jogo ou as Configurações).
- **Avisos comuns somem sozinhos depois de 24 horas** (no servidor e no aparelho), para não encher a memória.
- **Avisos importantes não expiram** e ficam marcados como *Importante*: atualização do app, permissões, códigos enviados e compras (passe, pacote, skin, Premium para enviar jogos ao Studio). Só saem quando o jogador apaga. No servidor, use `notify(userId, título, texto)` com um destes tipos: `update`, `perm`, `code`, `purchase`, `premium`.
- Avisos gerais da administração apagados por um jogador somem só para ele.
- **Atualização silenciosa:** o APK agora declara a permissão `UPDATE_PACKAGES_WITHOUT_USER_ACTION`. A primeira atualização feita pelo próprio app ainda mostra a tela de confirmação do Android; as seguintes, no Android 12 ou mais novo, entram sem perguntar.

## Apagar jogo pela administração e Android 16

- **Apagar um jogo** (administrador ou dono) o remove da plataforma inteira: Loja, busca, biblioteca, favoritos, histórico e progresso salvo de todos. **Quem comprou continua com o jogo**: ele fica guardado como "Removido da Loja", só nas bibliotecas dos compradores, e continua jogável. Sem compradores, o jogo é apagado de vez. Quem está com o app aberto vê o jogo sumir na hora. A tabela `purchases` já existe no servidor; o fluxo de pagamento ainda será criado.
- **Android 16:** o APK agora é compilado com Capacitor 8, Java 21 e `targetSdk`/`compileSdk` 36.

## Jogo com cadeado e missões por jogo

- **Durante o jogo:** menu compacto com **Sair** e um **cadeado**. Com o cadeado fechado (roxo) a tela fica travada: nem o Sair nem o botão voltar do celular tiram você do jogo. Com ele aberto, os dois saem normalmente. No Android o botão voltar é travado de verdade pelo app (`GPNative.setBackLock`); no navegador, pelo histórico.
- **Progresso e missões** (Perfil): XP total com barra do nível, histórico por jogo (partidas, tempo e missões feitas) e as missões, que o app gera **para cada jogo** (ex.: "5 corridas em Corrida Neon", "Meia hora de ...", "Jogo favorito"). Você decide quais **aceitar**; as aceitas mostram o progresso e se concluem sozinhas, com o XP ganho. **Missões secretas** (Veterano, Sem pressa) só aparecem depois de cumprir o requisito.
- O XP das missões é guardado no aparelho; quando o servidor passar a validar partidas, ele poderá ser conferido lá.

## Missões criadas no Studio

Na aba **Missões** do Studio o criador define até 8 missões exclusivas do jogo (nome, descrição, meta em partidas ou minutos, XP de 5 a 500, e missões secretas que só aparecem depois de N partidas). Jogos sem missões próprias continuam com as missões automáticas. O XP das missões é calculado no aparelho; o servidor valida apenas o formato.

## Contas de verdade

- **Google**: fluxo web com callback no servidor. No app, o navegador volta por `gameplatform://auth?code=…` (intent-filter inserido pelo CI) e o app troca o código de uso único (2 min) por um token.
- **Recuperar senha**: código de 6 dígitos por e-mail, vale 15 minutos, 5 tentativas. Trocar a senha também confirma o e-mail.
- **Confirmar e-mail**: painel em Configurações enquanto o e-mail não estiver confirmado.
- **Progresso entre aparelhos**: missões, tempo de jogo, partidas, saves e XP sobem para a conta alguns segundos após cada mudança e são trazidos ao entrar em outro aparelho. No primeiro login vale o lado com mais progresso; depois vale o mais recente.

Variáveis do servidor (produção):

| Variável | Para quê |
|---|---|
| `PUBLIC_URL` | endereço público HTTPS do servidor |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | cliente OAuth "Aplicativo da Web"; redirecionamento autorizado `PUBLIC_URL/api/auth/google/callback` |
| `RESEND_API_KEY`, `MAIL_FROM` | envio de e-mails (resend.com); sem a chave, em desenvolvimento, os e-mails ficam na tabela `dev_outbox` |

Sem essas variáveis o botão do Google não aparece e a recuperação de senha só funciona em desenvolvimento.

## Perfil, Chat, ID, planos e Loja

- **Navegação**: Início, Loja, Biblioteca, **Chat**, Studio (só com plano) e Perfil. Configurações e Administração (só admin) ficam em ícones no topo, ao lado das notificações. O Chat reúne Mensagens, Amigos, Feed, Grupos, Comunidades e Avisos.
- **ID do jogador**: o administrador é `000`; os demais recebem `001`, `002`… por ordem de cadastro. Serve para buscar e adicionar amigos (`#2`).
- **Studio só com plano**: o servidor recusa publicar jogo sem plano (403) e o app esconde a aba. O administrador libera ou tira o plano na aba Usuários da Administração, ou a pessoa assina na Loja → Planos.
- **Loja**: Jogos, Planos (Studio 30 dias e 1 ano), Moedas (pacotes) e Skins (molduras e fundos de perfil, pagos com moedas).
- **Compras são de teste**: ativam na hora, sem cobrança, até existir um meio de pagamento real (Pix, Google Play etc.).
- `STUDIO_GATE=off` desliga a exigência de plano e existe só para os testes antigos.

## Jogos pagos, acesso antecipado, Premium e skins
- **Início** mostra atualizações de jogos, jogos lançados e acesso antecipado (compacto, só jogos). Comunidade, mensagens, grupos e amigos ficam na aba **Chat**.
- **Loja** vende apenas jogos pagos: o jogador compra o jogo ou compra o **acesso antecipado**. Abas: Jogos, Antecipado, Planos, Moedas, Skins.
- O criador define `price` (em moedas) e `early` nas configurações do jogo no Studio; ele recebe **70%** de cada venda. Sem comprar, o servidor responde 402 e o jogo não entra na biblioteca.
- **Plano Premium** (além do Studio): libera skins exclusivas. **Bônus diário** de moedas na Loja.
- **Skins** em 6 espaços: moldura, fundo do perfil, título, cor do nome, tema do app e balão do chat. Aparecem no próprio perfil e no app do dono.
- Compras continuam em **modo de teste** (sem cobrança real).
- Perfil: botão da câmera troca a foto na hora; o banner tem o botão **Skins**; Configuração e Notificação trocaram de lugar; a busca é só um ícone que expande.

## Studio: cada aba com a sua função
- **Criar** tem 6 abas: Informações (capa, nome, descrição, tags, pré-visualização), Código (envio/edição, análise automática do código e Testar), Bibliotecas, Missões, Avançado (versão, orientação, controles, monetização, visibilidade) e **Revisar** (checklist clicável, resumo, Testar, Rascunho e Publicar, mais a lista de rascunhos).
- **Meus jogos** lista os jogos publicados (jogar, editar, atualizar, despublicar, estatísticas, excluir). **Painel** mostra os números do criador.
- Chat: com o teclado aberto a barra de baixo some e a tela não rola sozinha.

## Skins visíveis, novidades da versão, vendas e extrato
- **Skins para todos:** moldura, cor do nome, título e balão aparecem para os outros jogadores no feed, comentários, conversas, membros de grupos e no chat. Dois balões novos: aurora e ouro (Premium).
- **Novidades da versão:** campo na aba **Revisar** do Studio (até 300 letras). Aparece na página do jogo e nas Atualizações de jogos do Início. Ao atualizar um jogo o campo começa vazio.
- **Vendas reais no Painel:** vendas de jogos pagos e moedas ganhas (70% de cada venda), por jogo.
- **Extrato de moedas** na aba Moedas da Loja: bônus diário, pacotes, skins, jogos comprados e vendas. Tabela `coin_log` (só passa a registrar a partir deste build).

## App para Linux (computador)
Além do APK do Android, o repositório gera um app para Linux, a mesma plataforma numa janela do computador (Electron, pasta `desktop/`).

1. Abra **Releases → App Linux mais recente** (`linux-latest`).
2. **AppImage** (qualquer Linux): baixe `game-platform.AppImage`, dê permissão (`chmod +x game-platform.AppImage`) e abra. Se não abrir no Ubuntu 24 ou mais novo, rode `./game-platform.AppImage --no-sandbox`.
3. **.deb** (Ubuntu/Debian): `sudo apt install ./game-platform.deb`. Ele aparece no menu de aplicativos e registra o retorno do login do Google (`gameplatform://auth`).

Atalhos: **F11** tela cheia, **F5** recarrega, **Ctrl +** e **Ctrl −** aumentam e diminuem o zoom, **Ctrl 0** volta ao normal. Sua conta, jogos e moedas são os mesmos do celular (o servidor é o mesmo). A janela pode ser redimensionada.

O app confere sozinho se há versão nova (build do Linux) e mostra o aviso, com botão para baixar o instalador. O workflow `build-linux.yml` roda o teste rápido do app e só então gera os instaladores. Rodar em desenvolvimento: `cd desktop && npm install && npm start`.

## Painel de gestão (computador / tela larga)
Em telas com 1000 px ou mais (navegador no PC ou app Linux) quem é **administrador ou moderador** ganha um painel de gestão: menu lateral, tabelas e uma gaveta de detalhes. É o mesmo link e o mesmo app; no celular nada muda. Jogadores comuns nunca veem o painel. O botão **Voltar ao app** do menu troca para o visual de celular, e em **Configurações → Painel de gestão** dá para reabrir.

- **Visão geral:** usuários, online agora, jogos, partidas, denúncias, suspensos, banidos, equipe e atividade recente (moedas e vendas só para o administrador).
- **Usuários:** busca por nome, e-mail (admin) ou `#número`; filtros de conta, perfil e plano. A gaveta mostra o perfil, contadores, jogos, posts, comentários e avaliações recentes, compras (admin) e o histórico de moderação daquela pessoa.
- **Suspender / banir / reativar:** suspender pede prazo (1 a 365 dias, moderador até 30) e motivo; banir é só do administrador e também pede motivo. Suspensão vencida é encerrada sozinha. O login mostra o motivo.
- **Perfis:** `user`, `mod` (usuários, denúncias e conteúdo; não vê dinheiro e não bane) e `admin`. O administrador promove e rebaixa moderadores na gaveta do usuário.
- **Moderação:** comentários, avaliações e publicações com busca, seleção em massa e remoção com motivo (o autor é avisado).
- **Denúncias:** fila com dispensar / aplicar.
- **Auditoria (só admin):** quem fez o quê, em quem, quando e por quê.

Depois de atualizar o app, o servidor no Render precisa ser reimplantado para ter os novos endpoints `/api/admin/*`.

### Compras e Jogos no painel
- **Compras (só administrador):** resumo de vendas (hoje, 7 e 30 dias), moedas em circulação e planos ativos; **Vendas** com estorno (motivo obrigatório; devolve moedas, retira dias de plano ou skin, tira o jogo da biblioteca); **Preços** dos pacotes de moedas e das skins, com "tirar da venda" e "restaurar padrão"; **Planos VIP** com nome, preço e lista de vantagens editáveis. Na gaveta do usuário, **Ajustar moedas** e **Ajustar plano** (± dias), sempre com motivo. As compras com dinheiro continuam de teste, sem cobrança real. Tudo vai para a Auditoria.
- **Jogos (administrador e moderador):** partidas, jogadores, biblioteca (sem contar o criador), nota, denúncias e **jogando agora** por jogo; gaveta com quem está jogando e quem já jogou (quantas vezes e quando). Moderador e administrador despublicam com motivo (o criador é avisado); só o administrador destaca.

### Mensagens, manutenção, alertas e Studio grande
- **Mensagens:** o administrador envia um aviso para todos, Premium, quem tem Studio, criadores, equipe ou um jogador; o moderador só para um jogador. Pode marcar como **importante** (não some em 24 h). Pede confirmação com o tamanho do público e fica no histórico e na Auditoria.
- **Modo manutenção (só admin):** ligado, só administradores e moderadores usam o app; os jogadores veem o aviso (faixa no app e erro 503 na API). Login e cadastro continuam abertos.
- **Alertas** na Visão geral: denúncias na fila ou paradas há mais de 24 h, jogo ou jogador com 3+ denúncias, suspensões que terminam em 24 h, onda de contas novas, estornos em excesso e manutenção ligada.
- **Studio grande:** o mesmo Studio do app (informações, código, bibliotecas, missões, avançado, revisar, meus jogos) numa tela larga, com a **prévia do jogo ao lado** (celular em pé, deitado ou tela cheia). Cole o código e use **Rodar** ou Ctrl + Enter no editor; a prévia roda isolada, como no app.
- **Ainda não existe:** confirmação por código no e-mail para ações pesadas; cobrança real de pagamento.

> **Nota:** o app para Linux deixou de ser atualizado automaticamente. No computador use a versão web (o link do servidor no Chrome); no celular, o APK Android. O workflow `build-linux.yml` só roda se for disparado manualmente.

### Segurança do painel, permissões, lixeira e backups
- **Confirmação reforçada**: ações pesadas (banir, mudar perfil, estornar, mexer em preços/moedas/plano, ligar manutenção, mensagem em massa, baixar backup, encerrar sessões, mudar permissões) pedem um **código de 6 números enviado por e-mail** (precisa de `RESEND_API_KEY` no servidor) ou, sem e-mail configurado, a **senha** da própria conta. Vale 10 minutos. No teste local o código vai para `dev_outbox`. Para desligar (só testes): `CONFIRM_GATE=off`.
- **Backups automáticos**: o servidor grava uma cópia do banco (`VACUUM INTO`) em `backups/` ao lado do banco, a cada ~20 h, mantendo os 14 últimos (+10 manuais). Painel → Segurança: "Fazer backup agora" e "Baixar". Desligar o automático: `BACKUP_AUTO=off`. Em produção o banco precisa estar no disco persistente (`/app/data`).
- **Sessões**: Segurança lista admins e moderadores (último acesso, IP, aparelho) e **encerra as sessões** de qualquer um (o token antigo deixa de valer).
- **Permissões por pessoa**: cada moderador tem checkboxes (usuários, moderação de conteúdo, denúncias, jogos, mensagem a um jogador, ver compras, ver auditoria). O padrão é o que moderadores já faziam; o menu do painel esconde o que a pessoa não pode.
- **Lixeira**: remoções de comentário, avaliação e publicação ficam 30 dias em Moderação → Lixeira, com **Restaurar**.
- **Gráficos** (7/14/30 dias) na Visão geral, **exportar CSV** da auditoria e das vendas, **Ctrl+K** (busca de seções, usuários e jogos), **alertas** a cada minuto com aviso do navegador e número na aba, e aviso a todos os admins em eventos graves (3 denúncias no mesmo alvo, manutenção).
- **Cupons**: desconto em % ou bônus em % de moedas, por item/planos/pacotes, limite de usos, validade, uma vez por jogador. O jogador digita o cupom na Loja (Planos e Moedas). **Criadores**: ganhos por criador (70% de cada venda de jogo pago).

## App no computador e puxar para atualizar
- No **navegador do computador** (tela com 1000 px ou mais) todos os jogadores veem o app com **barra lateral e área larga**, no estilo do painel. O **app Android não muda**.
- No celular, **puxar para baixo** no topo da tela mostra uma seta redonda que gira e atualiza jogos, Loja, avisos e a checagem de versão.
- O **app Linux deixou de ser atualizado automaticamente** (o workflow só roda se for disparado à mão): Android para Android, web para computador.

## Servidor central, versões e atualização sem reinstalar

O app Android nasce apontando para o servidor oficial (`https://game-platform-dgvz.onrender.com`, gravado no build; a variável `SERVER_URL` do GitHub só serve para trocar). No Android o endereço não é editável; no navegador ele é o próprio site.

- **Manifesto** (`GET /api/app/manifest?platform&build`): informa a versão mais nova do app, versão mínima, se é obrigatória, a versão da interface (hash SHA-256 e tamanho) e a versão do conteúdo/configuração (atalhos, intervalo de verificação, zoom máximo). O app consulta ao abrir, ao voltar para o primeiro plano e a cada poucos minutos.
- **Interface remota (OTA)**: o servidor entrega `/app/ui.html`. O app baixa, confere tamanho e SHA-256, guarda e passa a abrir por ela na próxima vez. Se o arquivo não confere, nada é aplicado. Se a nova interface falha ao abrir duas vezes, o app volta sozinho para a interface embutida e avisa o servidor. Perfil, favoritos, conquistas e progresso ficam no servidor e no armazenamento local, e não são tocados. O primeiro APK com esse recurso precisa ser instalado uma vez; depois disso a interface atualiza sozinha.
- **Atualização nativa**: o APK novo é baixado, tem o SHA-256 conferido e só então é instalado por cima (mesma assinatura). Se o app foi instalado pela Google Play, o botão abre a loja (as atualizações dentro do app da Play só existem para quem distribui pela Play). O link do APK precisa ser https do GitHub ou do próprio servidor.
- **Tela de atualização**: versão atual e nova, descrição, correções, progresso, "Atualizar agora" e "Depois" (some quando a versão é obrigatória).
- **Offline**: a última resposta fica em cache; sem internet o app abre com o que tem, mostra uma faixa de "sem conexão" e reconecta sozinho ao voltar a rede.
- **Painel (Administração → Versões do app)**: publicar versão (número, descrição, correções, link e SHA-256 do APK, obrigatória ou opcional), histórico, ligar/desligar e "Buscar do GitHub". Há registro de auditoria e contagem de verificações, downloads, instalações e falhas.

## Personalização da interface

Configurações → **Aparência e tamanho**: tamanho geral da tela, e tamanhos separados de espaçamento do layout, menus, painéis, botões e textos; área de toque maior; atalhos da Início configuráveis (adicionar, remover e reordenar; Auditoria e Painel só aparecem para quem tem permissão). Tudo é salvo no aparelho e testado de 320 a 1366 px de largura, sem cortes. O puxar-para-atualizar foi refeito (limite menor, funciona com mouse e dedo).

## Notificações externas

- **Categorias**: atualização, novo jogo, atualização de jogo, mensagem, amizade, convite, evento, conquista, aviso da administração, manutenção, segurança (sempre ligada), Studio e Pro.
- **Preferências** (Configurações → Notificações): tudo ligado/desligado, por categoria, som, vibração, prioridade, horário silencioso.
- **Web Push**: service worker em `/sw.js` e chaves VAPID (`VAPID_PUBLIC`, `VAPID_PRIVATE`, `VAPID_SUBJECT`; se faltarem, o servidor gera e guarda).
- **Android (FCM)**: no servidor defina `FCM_SERVICE_ACCOUNT` (JSON da conta de serviço do Firebase, em texto ou base64). No GitHub crie o segredo `GOOGLE_SERVICES_JSON` com o `google-services.json` em base64 (pacote `com.gameplatform.app`). Sem o segredo, o APK sai sem push externo e continua com a central interna.
- **Servidor**: aparelhos ligados à conta, deduplicação, reenvio (30 s, 2 min, 10 min, 1 h), aparelho inválido é desativado, tokens nunca aparecem nas respostas, tudo auditado. O app só empurra quando a pessoa não está com o app aberto.
- **Painel (Administração → Notificações)**: enviar para todos, grupo ou pessoa, por categoria, agendar e cancelar, avisos de manutenção, anunciar jogos/atualizações, e ver enviadas, entregues, falhas e abertas.
- **Central no app**: histórico, não lidas, marcar uma/todas como lidas, apagar, filtrar por categoria e abrir a tela relacionada.

Testes: `npm test` (servidor), `npm run test:app` (telas), `npm run test:browser` (Chromium real: OTA, atualização, offline, toque, tamanhos, push) e `npm run test:zip`.

## Pagamentos, configurações do administrador e lançamento

- **Pagamentos** (painel > Compras > Pagamentos): escolha *Teste*, *InfinitePay* (link com Pix e cartão; informe o InfiniteTag sem o `$`) ou *Pix manual* (chave Pix; você confirma cada pedido em *Pedidos*). Pacotes de moedas são editáveis (nome, moedas, preço) e dá para criar novos. A InfinitePay não assina o aviso de pagamento, então o servidor sempre confere cada aviso na própria API (`payment_check`) antes de entregar.
- **Configurações** (painel > Configurações, só administrador): Geral (nome, frase, e-mail de suporte, links, aviso na tela inicial), Cadastro e login (abrir/fechar cadastros, senha mínima, e-mails bloqueados, duração do login), Moderação (palavras proibidas, limites de denúncia), Chat e comunidade (tamanho, modo lento, imagens, criação de grupos), Moedas e economia (boas-vindas, bônus diário, bônus do Premium, parte do criador), Notificações (categorias, limite diário, silêncio padrão), Regras e aparelhos e Lançamento e dados. Todas as mudanças vão para a Auditoria com o valor de antes e o de depois, e o servidor respeita cada uma.
- **Regras e requisitos**: o texto e a tabela de aparelhos são editáveis no painel e aparecem para todos em Configurações > Regras e requisitos (o app mostra também a leitura do aparelho de quem abre).
- **Formatar compras e atividade**: pede sua senha e a frase `FORMATAR TUDO`, faz um backup antes e é registrado na Auditoria. Depois de **Lançar a plataforma** (senha + `LANÇAR`) a formatação fica desativada para sempre.
- **Painel no celular**: Configurações > Painel de gestão > *Abrir painel* (equipe). O botão de seta no topo volta ao app.
- **Aparência**: temas (Meia-noite, Grafite, Preto total, Oceano, Floresta, Vinho, Pôr do sol, Claro, Alto contraste), cor do fundo e de destaque livres, 7 tipos de letra, peso e espaço das linhas, bordas e menos animações. Tudo fica guardado no aparelho.

## Recursos desligados, Studio com tipos e servidor escondido

- **Chat, Missões e Atalhos** têm interruptor em Painel → Configurações → Geral ("Recursos e aviso no app"). Na versão publicada (`NODE_ENV=production`) começam **desligados**; em desenvolvimento começam ligados (`FEAT_DEFAULT=on|off` força um dos dois). Desligado, o Chat mostra "Chat em desenvolvimento · Em breve será lançado" no centro da tela, e Missões e Atalhos somem do app.
- **Studio**: a aba Bibliotecas virou parte de Avançado. A dimensão agora tem `2D`, `3D` e `Misto`, e há o campo **Tipo de projeto** (Jogo, Aplicativo, Engine, Ferramenta…). As listas de categorias (Battle Royale, Tiro, Engine HTML, Engine…) e de tipos são editadas em Painel → Configurações → Studio (`PUT /api/admin/categories`, `PUT /api/admin/kinds`, `POST /api/admin/studio-defaults`).
- **Servidor** (endereço, HTTPS, versões de serviço e conteúdo) só aparece para o administrador; jogadores e compradores de plano veem apenas "Conexão".
- **Instalação automática**: o servidor confere sozinho o APK mais novo no GitHub (`AUTO_APK_SYNC`), o app atualiza o manifesto antes de baixar e, se a verificação falhar, oferece "Tentar de novo" e "Baixar pelo navegador".
- **Abertura do app**: a proteção da interface remota agora só dispara se o app não renderizar em 25 s (marca o sucesso na primeira tela) e a tela de abertura sai sozinha em até 7 s, mesmo com a rede lenta.

## Análise automática do arquivo do jogo

Ao publicar (ou editar) um jogo, o servidor lê o arquivo (`server/src/scan.js`) e guarda em `settings.req`: tamanho, imagens/sons embutidos, motor detectado (Three.js, Phaser, Babylon, Unity, Godot…), WebGL/WebAssembly, se precisa de internet e uma **estimativa** de memória (512 MB a 6 GB, mais um degrau recomendado) e de versão do Android. A aba **Requisitos** do jogo usa isso; o criador vê o mesmo resultado em Studio → Revisar (`POST /api/games/analyze`). O criador não consegue forjar a análise, e jogos antigos são analisados na primeira subida do servidor. É uma estimativa feita só lendo o arquivo, sem executar o jogo.

## Loja renovada, perfil e teclado
- **Loja**: busca por nome/descrição/categoria, ordenação (novidades, menor/maior preço, melhor avaliados), chip de saldo que abre Moedas, selos de peso (Leve/Médio/Pesado, vindos da análise do arquivo) e "Limpar filtros" quando nada é encontrado.
- **Perfil**: títulos como "Premium" não ficam mais tortos (nome em bloco, título alinhado, rótulos do legado sem quebrar) e o selo de nível das ferramentas aparece sobre o ícone.
- **Teclado no Android**: o app agora aplica a altura do teclado como margem da WebView e usa `interactive-widget=resizes-content`. Não dá para reproduzir a tela escura no navegador de testes; valide em aparelho real e relate se persistir.

## Botão do jogo, pastas dos jogos e proteção do app
- **Botão do jogo**: a bolinha dentro do jogo é arrastável (qualquer lado; fica salva em `gp_hpos`; toque duplo volta ao padrão) e o menu abre pequeno ao lado dela, sem cobrir o topo do jogo. Por padrão fica no meio da lateral esquerda.
- **Pastas dos jogos**: no Android cada jogo ganha `Android/data/com.gameplatform.app/files/GamePlatform/<nome do jogo>/` com `dados.json` (o `localStorage` do jogo, agora sempre salvo), `jogo.json` (configurações do jogo) e os arquivos que ele gravar. Cada jogo só enxerga a própria pasta (caminhos com `..`, `/` ou `\` são recusados; 50 MB por arquivo, 300 MB por jogo). No navegador os mesmos dados ficam no IndexedDB. A tela **Perfil → Configurações → Pastas dos jogos** lista, abre e limpa (com confirmação).
- **Ponte `GP` para os jogos** (injetada em todo jogo): `GP.files.write(caminho, texto|ArrayBuffer|Blob)`, `read(caminho, 'text'|'json'|'arraybuffer'|'blob'|'base64')`, `list(pasta)`, `remove(caminho)`, `download(urlHttps, caminho)` e `GP.info()`. Todas devolvem Promise. O `localStorage` do jogo é persistido automaticamente.
- **Proteção**: o APK deixou de ser depurável e sem backup/HTTP puro (o CI confere); a depuração do WebView é desligada; o app compara a própria assinatura com a lista `appSig` (Configurações do administrador) e avisa "App não oficial" em cópias reassinadas. Limite honesto: a chave de assinatura ainda é a do repositório (`app/keystore/debug.keystore`); trocar por uma chave secreta exige reinstalar o app uma vez.
