# GF Casa Share

App compartilhado para **despesas**, **lista de compras** e **chat** em tempo real (Firebase Auth + Firestore), com PWA offline e instalavel.

## URLs

- GitHub: https://github.com/thiago20santos21-coder/gf-casa-share
- App: https://gf-casa-share.web.app
- Firebase Console: https://console.firebase.google.com/project/gf-casa-share/overview

## Papeis

| Papel | Pode |
|-------|------|
| **Criador** | PIX (unico), promover/remover admins, remover membros, apagar grupo, moderar conteudo |
| **Admin** | Remover membros, apagar despesas/compras/msgs de outros |
| **Membro** | Usar despesas/compras/chat; **sair do grupo**; nao edita PIX |

- Criador **recebe** o PIX e **nao paga** o rateio.
- Membros (nao criador) usam **Sair deste grupo** (com modal de confirmacao).
- Criador nao sai: usa **Apagar grupo**.

## Instalar no celular

- Botao **Instalar** no topo e card em **Grupo** (sempre visivel se nao estiver em modo app).
- Chrome/Android: `beforeinstallprompt` ou menu do navegador.
- iOS Safari: Compartilhar → Adicionar a Tela de Inicio.

## Notificacoes

- Em **Grupo → Ativar notificacoes**.
- Locais via Service Worker: chat, despesa, compras, PIX gerado (aba em background).
- Push FCM remoto (app totalmente fechado) exige Web Push certificate no console Firebase.

## Deploy

```bash
firebase use gf-casa-share
firebase deploy --only firestore:rules,hosting
```

Arquivos publicados ficam em `public/`.
