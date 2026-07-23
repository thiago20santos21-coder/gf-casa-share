# -*- coding: utf-8 -*-
"""Fix UTF-8 mojibake and polish Portuguese UI copy."""
from pathlib import Path

ROOT = Path(r"C:\Users\tiago\Downloads\gf\public")

# Common mojibake sequences (UTF-8 read as cp1252/latin-1)
REPLACEMENTS = [
    ("â€”", "—"),
    ("â€“", "–"),
    ("â€¦", "…"),
    ("â€œ", "“"),
    ("â€", "”"),
    ("â€˜", "‘"),
    ("â€™", "’"),
    ("â†’", "→"),
    ("â€¢", "•"),
    ("Â·", "·"),
    ("Ã·", "÷"),
    ("Ã¡", "á"),
    ("Ã ", "à"),
    ("Ã¢", "â"),
    ("Ã£", "ã"),
    ("Ã¤", "ä"),
    ("Ã©", "é"),
    ("Ã¨", "è"),
    ("Ãª", "ê"),
    ("Ã­", "í"),
    ("Ã³", "ó"),
    ("Ã´", "ô"),
    ("Ã¶", "ö"),
    ("Ãº", "ú"),
    ("Ã¼", "ü"),
    ("Ã§", "ç"),
    ("Ã‡", "Ç"),
    ("Ã‰", "É"),
    ("Ã“", "Ó"),
    ("Ãš", "Ú"),
    ("Ã\x81", "Á"),
    ("Ã\x83", "Ã"),
    ("nÃ£o", "não"),
    ("NÃ£o", "Não"),
    ("vocÃª", "você"),
    ("VocÃª", "Você"),
    ("Ã©", "é"),
    ("jÃ¡", "já"),
    ("estÃ¡", "está"),
    ("estÃ£o", "estão"),
    ("invÃ¡lido", "inválido"),
    ("invÃ¡lidos", "inválidos"),
    ("mÃ­n", "mín"),
    ("MÃ­nimo", "Mínimo"),
    ("possÃ­vel", "possível"),
    ("AlteraÃ§Ãµes", "Alterações"),
    ("notificaÃ§Ãµes", "notificações"),
    ("NotificaÃ§Ãµes", "Notificações"),
    ("configuraÃ§Ãµes", "configurações"),
    ("PermissÃ£o", "Permissão"),
    ("permissÃ£o", "permissão"),
    ("UsuÃ¡rio", "Usuário"),
    ("cÃ³digo", "código"),
    ("CÃ³digo", "Código"),
    ("peÃ§a", "peça"),
    ("PeÃ§a", "Peça"),
    ("espaÃ§os", "espaços"),
    ("espaÃ§o", "espaço"),
    ("pÃ¡gina", "página"),
    ("AlguÃ©m", "Alguém"),
    ("alguÃ©m", "alguém"),
    ("conteÃºdo", "conteúdo"),
    ("ediÃ§Ã£o", "edição"),
    ("aparecerÃ£o", "aparecerão"),
    ("botÃµes", "botões"),
    ("BotÃµes", "Botões"),
    ("aÃ§Ã£o", "ação"),
    ("ConfirmaÃ§Ã£o", "Confirmação"),
    ("serÃ£o", "serão"),
    ("MÃ¡ximo", "Máximo"),
    ("deixarÃ¡", "deixará"),
    ("conexÃ£o", "conexão"),
    ("estÃ¡vel", "estável"),
    ("InÃ­cio", "Início"),
    ("Ã­cone", "ícone"),
    ("Ã\x80", "À"),
    ("Ã ", "à"),
]

# Extra spelling / wording polish (after mojibake fix)
SPELLING = [
    ("sincroniza ao conectar", "sincroniza ao reconectar"),
    ("use despesas/compras/chat", "use despesas, compras e chat"),
    ("PIX é só leitura", "PIX é somente leitura"),
    ("PIX bloqueado para edição — somente o criador altera", "A edição do PIX está bloqueada — só o criador pode alterar"),
    ("Confira se digitou certo", "Confira se digitou corretamente"),
]


def fix_text(text: str) -> str:
    # strip BOM
    if text.startswith("\ufeff"):
        text = text.lstrip("\ufeff")
    # ordered: longer first for some
    for old, new in sorted(REPLACEMENTS, key=lambda x: -len(x[0])):
        text = text.replace(old, new)
    for old, new in SPELLING:
        text = text.replace(old, new)
    return text


def main():
    for name in ("app.js", "index.html", "sw.js", "manifest.json"):
        path = ROOT / name
        if not path.exists():
            continue
        original = path.read_text(encoding="utf-8-sig", errors="replace")
        fixed = fix_text(original)
        # remove replacement chars leftovers if any obvious patterns
        fixed = fixed.replace("\ufffd", "")
        path.write_text(fixed, encoding="utf-8", newline="\n")
        print(f"fixed {name}: {len(original)} -> {len(fixed)} chars")


if __name__ == "__main__":
    main()
