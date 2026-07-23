# GF Casa Share

App compartilhado para **despesas**, **lista de compras** e **chat** em tempo real (Firebase Auth + Firestore).

## URLs

- GitHub: https://github.com/thiago20santos21-coder/gf-casa-share
- Firebase Console: https://console.firebase.google.com/project/gf-casa-share/overview
- Hosting (apÃ³s deploy): https://gf-casa-share.web.app

## Ativar login (obrigatÃ³rio â€” 1 minuto)

O projeto Firebase jÃ¡ existe, mas o **Authentication** precisa ser ligado uma vez no console (limitaÃ§Ã£o da API sem faturamento Identity Platform):

1. Abra: https://console.firebase.google.com/project/gf-casa-share/authentication
2. Clique em **ComeÃ§ar** / **Get started**
3. Em **Sign-in method**, ative **E-mail/senha** e salve

Depois disso, qualquer pessoa cria conta no app, cria/entra em um grupo e vÃª alteraÃ§Ãµes ao vivo.

## Como usar

1. Crie uma conta (e-mail + senha + nome)
2. **Crie um grupo** (nome + nÂº de pessoas) **ou** entre com o **cÃ³digo de convite**
3. Use as abas:
   - **Despesas** â€” rateio + PIX/QR + texto WhatsApp
   - **Compras** â€” lista interativa (marcar comprado)
   - **Chat** â€” mensagens do grupo
   - **Grupo** â€” convite, membros, chave PIX e nÂº de pessoas

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

