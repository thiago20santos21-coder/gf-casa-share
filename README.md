# GF Casa Share

App compartilhado para **despesas**, **lista de compras** e **chat** em tempo real (Firebase Auth + Firestore), com PWA offline e instalável.

## URLs

- GitHub: https://github.com/thiago20santos21-coder/gf-casa-share
- App: https://gf-casa-share.web.app
- Firebase Console: https://console.firebase.google.com/project/gf-casa-share/overview

## Ativar login (obrigatorio — 1 minuto)

1. Abra: https://console.firebase.google.com/project/gf-casa-share/authentication
2. Clique em **Comecar**
3. Em **Sign-in method**, ative **E-mail/senha** e salve

## Regra de rateio / PIX

- Quem **cria o grupo** e o **recebedor** e **nao paga**.
- O total e dividido **somente entre os demais membros** (pagantes).
- Labels, texto WhatsApp, valor do PIX e QR usam essa regra.

## Offline

- Assets em cache via Service Worker.
- Escritas offline vao para fila IndexedDB e sincronizam ao reconectar.
- Indicador **Offline / fila** no topo.

## Instalar no celular

- Banner **Instalar** (Chrome/Android) quando disponivel.
- iOS: Safari → Compartilhar → **Adicionar a Tela de Inicio**.
- Icones PNG 192/512 + maskable + apple-touch.

## Notificacoes

- Em **Grupo → Ativar notificacoes**, permita o navegador.
- Alertas locais (via Service Worker) para nova despesa, item de compra, chat e PIX.
- Push remoto FCM completo exige certificado Web Push no console (Cloud Messaging → Web Push certificates). Sem isso, as notificacoes funcionam com o app aberto/em segundo plano apos permissao.

## Deploy

```bash
firebase use gf-casa-share
firebase deploy --only firestore:rules,hosting
```

Arquivos publicados ficam em `public/`.

## Stack

- Frontend PWA (`public/`)
- Firebase Auth + Firestore + Hosting
- Projeto: `gf-casa-share`
