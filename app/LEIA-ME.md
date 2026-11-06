# App Android

Esta pasta empacota o app (`www/index.html`) como aplicativo Android com o Capacitor. O guia principal está no `README.md` da raiz do repositório.

## Gerar o APK no computador

Requisitos: Node.js 20 ou mais novo, JDK 17 e Android Studio (com o Android SDK).

```bash
cd app
npm install
npx cap add android
npm run android:assets
npx cap sync android
npx cap open android
```

No Android Studio, use **Build > Build APK(s)**. Para testar direto no celular, conecte por USB com a depuração ativada e toque em **Run**.

Sempre que mudar o `www/index.html`, rode `npx cap sync android` antes de gerar de novo.

## Publicar na Google Play

O APK de teste serve para instalar e experimentar. Para a Play Store é preciso:

1. Uma conta de desenvolvedor Google Play (taxa única).
2. Um app assinado: no Android Studio, **Build > Generate Signed Bundle / APK**, escolha **Android App Bundle (.aab)** e crie uma chave. Guarde o arquivo `.keystore` e as senhas em local seguro, fora do repositório.
3. Ficha da loja: descrição, capturas de tela, política de privacidade e classificação etária.

## Observações

- Para mudar o nome ou o identificador do app, edite `capacitor.config.json` antes de `cap add android`.
- O app precisa de internet para as fontes e para as bibliotecas dos jogos (Three.js, Phaser, p5.js, PixiJS). Os jogos de demonstração rodam sem conexão.
- O servidor precisa ser acessado por HTTPS.
