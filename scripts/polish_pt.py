# -*- coding: utf-8 -*-
from pathlib import Path
import re

ROOT = Path(r"C:\Users\tiago\Downloads\gf\public")

# index.html
idx = ROOT / "index.html"
t = idx.read_text(encoding="utf-8")
t = re.sub(
    r'(id="btn-close-modal"[^>]*>)[^<]*(</button>)',
    r"\1&times;\2",
    t,
    count=1,
)
idx_repls = [
    (
        "<p><strong>Instalar no celular</strong>Adicione",
        "<p><strong>Instalar no celular</strong> — adicione",
    ),
    (
        "Abra esta aba (Grupo) para instalar o app, ativar notificações e gerenciar membros.",
        "Nesta aba você instala o app, ativa notificações e gerencia os membros.",
    ),
    (
        "Se você é criador, use os botões em cada pessoa para admin/remover.",
        "Se você é o criador, use os botões em cada pessoa para tornar admin ou remover.",
    ),
    (
        "Quem cria o grupo recebe o PIX e não entra no rateio. Os demais pagam.",
        "Quem cria o grupo recebe o PIX e não entra no rateio. Os demais membros pagam.",
    ),
    (
        "Adicione à tela inicial para abrir como aplicativo.",
        "Adicione à tela inicial para abrir como um aplicativo.",
    ),
    ('placeholder="voce@email.com"', 'placeholder="seu@email.com"'),
    (
        "Criador — PIX, admins, remover membros, apagar grupo.",
        "Criador — edita o PIX, define admins, remove membros e apaga o grupo.",
    ),
    (
        "Admin — remover membros e moderar conteúdo.",
        "Admin — remove membros e modera o conteúdo.",
    ),
    (
        "Membro — usar o app e sair do grupo; não edita PIX.",
        "Membro — usa o app e pode sair do grupo; não edita o PIX.",
    ),
]
for a, b in idx_repls:
    t = t.replace(a, b)
idx.write_text(t, encoding="utf-8", newline="\n")
print("index ok")

# app.js
app = ROOT / "app.js"
t2 = app.read_text(encoding="utf-8")
app_repls = [
    (
        "toast('Salvo offline — sincroniza ao reconectar')",
        "toast('Salvo offline — será sincronizado ao reconectar')",
    ),
    (
        "toast('Sem conexão estável — na fila')",
        "toast('Sem conexão estável — salvo na fila')",
    ),
    (
        "membersHelp.textContent = 'Somente criador/admin gerenciam a lista.';",
        "membersHelp.textContent = 'Somente o criador e os admins gerenciam a lista.';",
    ),
    (
        "'Você é MEMBRO: use despesas, compras e chat. Pode sair do grupo. PIX é somente leitura.';",
        "'Você é MEMBRO: use despesas, compras e chat. Pode sair do grupo. O PIX é somente leitura.';",
    ),
    (
        "'Convide alguém com o código acima. Depois aparecerão botões Tornar admin / Remover.';",
        "'Convide alguém com o código acima. Depois aparecerão os botões Tornar admin e Remover.';",
    ),
    (
        "'Botões por membro: Tornar admin, Remover admin, Remover do grupo.';",
        "'Botões por membro: Tornar admin, Remover admin e Remover do grupo.';",
    ),
    (
        "'Como admin, você pode Remover outros membros (exceto o criador).';",
        "'Como admin, você pode remover outros membros (exceto o criador).';",
    ),
    (
        "toast(err.message || 'Falha ao atualizar admin (permissão/regras)');",
        "toast(err.message || 'Falha ao atualizar admin (sem permissão)');",
    ),
    (
        "throw new Error('Código inválido. Confira se digitou corretamente (sem espaços).');",
        "throw new Error('Código inválido. Confira se digitou corretamente, sem espaços.');",
    ),
    (
        ": 'A edição do PIX está bloqueada — só o criador pode alterar.';",
        ": 'A edição do PIX está bloqueada: só o criador pode alterar.';",
    ),
    (
        "hint.textContent = 'No iPhone/iPad use Safari: Compartilhar → Adicionar à Tela de Início.';",
        "hint.textContent = 'No iPhone/iPad, use o Safari: Compartilhar → Adicionar à Tela de Início.';",
    ),
    (
        "hint.textContent = 'Use o botão abaixo ou o menu do navegador (Instalar app / Adicionar à tela inicial).';",
        "hint.textContent = 'Use o botão abaixo ou o menu do navegador (Instalar app / Adicionar à tela inicial).';",
    ),
]
for a, b in app_repls:
    if a in t2:
        t2 = t2.replace(a, b)
        print("app replaced:", a[:48])
    else:
        print("app miss:", a[:48])
app.write_text(t2, encoding="utf-8", newline="\n")

# bump cache versions lightly
for name in ("index.html", "sw.js"):
    p = ROOT / name
    txt = p.read_text(encoding="utf-8")
    txt = txt.replace("20260723i", "20260723j")
    txt = txt.replace("casa-share-v9", "casa-share-v10")
    txt = txt.replace("Service Worker v9", "Service Worker v10")
    p.write_text(txt, encoding="utf-8", newline="\n")

# verify bad chars
remain = []
for name in ("app.js", "index.html", "sw.js"):
    txt = (ROOT / name).read_text(encoding="utf-8")
    for i, line in enumerate(txt.splitlines(), 1):
        if any(x in line for x in ("Ã", "â€", "Â", "\ufffd")):
            remain.append(f"{name}:{i}")
print("remaining bad:", remain or "none")
