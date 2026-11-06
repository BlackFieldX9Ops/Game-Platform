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
