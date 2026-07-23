# GF Casa Share

App compartilhado para **despesas**, **lista de compras** e **chat** em tempo real (Firebase Auth + Firestore).

## URLs

- Firebase Console: https://console.firebase.google.com/project/gf-casa-share/overview
- Hosting (após deploy): https://gf-casa-share.web.app

## Ativar login (obrigatório — 1 minuto)

O projeto Firebase já existe, mas o **Authentication** precisa ser ligado uma vez no console (limitação da API sem faturamento Identity Platform):

1. Abra: https://console.firebase.google.com/project/gf-casa-share/authentication
2. Clique em **Começar** / **Get started**
3. Em **Sign-in method**, ative **E-mail/senha** e salve

Depois disso, qualquer pessoa cria conta no app, cria/entra em um grupo e vê alterações ao vivo.

## Como usar

1. Crie uma conta (e-mail + senha + nome)
2. **Crie um grupo** (nome + nº de pessoas) **ou** entre com o **código de convite**
3. Use as abas:
   - **Despesas** — rateio + PIX/QR + texto WhatsApp
   - **Compras** — lista interativa (marcar comprado)
   - **Chat** — mensagens do grupo
   - **Grupo** — convite, membros, chave PIX e nº de pessoas

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
