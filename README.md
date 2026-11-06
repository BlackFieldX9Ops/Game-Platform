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

### Tela cheia e rotação

No app Android, abra **Perfil > Configurações > Tela**:

- **Tela cheia automática** (ligada por padrão) esconde a barra de status e a de navegação e usa também a área do recorte da câmera. Deslize a partir da borda para ver as barras por um instante.
- **Orientação:** *Automática* gira junto com o aparelho (mesmo com o bloqueio de rotação do Android ligado), *Vertical* e *Horizontal* travam a tela.
- Na posição horizontal, a barra de navegação passa para a lateral e as listas ganham mais colunas.

O código nativo dessa parte está em `app/native/MainActivity.java` e entra no APK pelo fluxo **Gerar APK**.

## 2. Colocar o servidor no ar

Sem servidor o app funciona offline. Com servidor, você tem contas, Loja compartilhada, amigos e chat.

**Pelo Render (mais simples):**

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
