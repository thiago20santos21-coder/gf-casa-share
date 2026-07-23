# GF Casa Share

App compartilhado para **despesas**, **lista de compras** e **chat** em tempo real (Firebase Auth + Firestore).

## URLs

- GitHub: https://github.com/thiago20santos21-coder/gf-casa-share
- App (Firebase Hosting): https://gf-casa-share.web.app
- Firebase Console: https://console.firebase.google.com/project/gf-casa-share/overview

## Ativar login (obrigatorio — 1 minuto)

O projeto Firebase ja existe, mas o **Authentication** precisa ser ligado uma vez no console (a API exige Identity Platform com faturamento; no plano Spark e so pelo console):

1. Abra: https://console.firebase.google.com/project/gf-casa-share/authentication
2. Clique em **Comecar** / **Get started**
3. Em **Sign-in method**, ative **E-mail/senha** e salve

Depois disso, qualquer pessoa cria conta no app, cria/entra em um grupo e ve alteracoes ao vivo.

## Como usar

1. Crie uma conta (e-mail + senha + nome)
2. **Crie um grupo** (nome + n de pessoas) **ou** entre com o **codigo de convite**
3. Use as abas:
   - **Despesas** — rateio + PIX/QR + texto WhatsApp
   - **Compras** — lista interativa (marcar comprado)
   - **Chat** — mensagens do grupo
   - **Grupo** — convite, membros, chave PIX e n de pessoas

## Deploy

```bash
firebase use gf-casa-share
firebase deploy --only firestore:rules,hosting
```

## Desktop (opcional)

```bash
pip install -r requirements.txt
python main.py
```

## Stack

- Frontend: HTML/CSS/JS (PWA)
- Backend: Firebase Auth + Cloud Firestore
- Hosting: Firebase Hosting
- Projeto GCP/Firebase: `gf-casa-share`
