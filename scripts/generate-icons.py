"""Generate professional GF Casa Share PNG icons (teal/gold dark theme)."""
from PIL import Image, ImageDraw
import os

OUT = os.path.join(os.path.dirname(__file__), "..", "public", "icons")
os.makedirs(OUT, exist_ok=True)

BG = (11, 15, 20, 255)        # #0b0f14
PLATE = (24, 33, 44, 255)     # #18212c
TEAL = (61, 154, 139, 255)    # #3d9a8b
TEAL_D = (42, 111, 101, 255)
GOLD = (232, 192, 125, 255)   # #e8c07d
WHITE = (232, 237, 242, 255)
MUTED = (139, 150, 163, 255)


def rr(draw, box, radius, fill):
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def draw_mark(draw, size, pad_ratio=0.14):
    pad = int(size * pad_ratio)
    # outer plate
    rr(draw, (pad, pad, size - pad, size - pad), int(size * 0.2), PLATE)

    # left teal bar (ledger spine)
    inner = pad + int(size * 0.14)
    bar_w = int(size * 0.13)
    rr(draw, (inner, inner, inner + bar_w, size - inner), int(size * 0.045), TEAL)

    # gold card top-right
    gap = int(size * 0.07)
    cx = inner + bar_w + gap
    cy = inner
    sq = int(size * 0.3)
    rr(draw, (cx, cy, cx + sq, cy + sq), int(size * 0.06), GOLD)

    # accent notch on gold
    n = int(size * 0.06)
    rr(draw, (cx + sq - n * 2, cy + int(sq * 0.55), cx + sq - int(n * 0.4), cy + int(sq * 0.55) + n), n // 2, TEAL_D)

    # list lines
    line_h = max(3, size // 42)
    lx0, lx1 = cx, size - inner
    for i, yoff in enumerate((0.48, 0.58, 0.68)):
        y = int(size * yoff)
        color = TEAL if i == 0 else (WHITE if i == 1 else MUTED)
        rr(draw, (lx0, y, lx1, y + line_h), line_h // 2, color)


def make(size, maskable=False):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    if maskable:
        draw.rectangle((0, 0, size, size), fill=BG)
        draw_mark(draw, size, pad_ratio=0.22)
    else:
        rr(draw, (0, 0, size - 1, size - 1), int(size * 0.22), BG)
        draw_mark(draw, size, pad_ratio=0.14)
    return img


sizes = {
    "icon-192.png": (192, False),
    "icon-512.png": (512, False),
    "icon-maskable-192.png": (192, True),
    "icon-maskable-512.png": (512, True),
    "apple-touch-icon.png": (180, False),
}

for name, (size, maskable) in sizes.items():
    path = os.path.join(OUT, name)
    make(size, maskable).save(path, "PNG", optimize=True)
    print("wrote", path, os.path.getsize(path))

# SVG companion
svg = os.path.join(OUT, "..", "icon.svg")
open(svg, "w", encoding="utf-8").write(
    '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="GF Casa Share">
  <rect width="512" height="512" rx="112" fill="#0b0f14"/>
  <rect x="72" y="72" width="368" height="368" rx="80" fill="#18212c"/>
  <rect x="118" y="118" width="68" height="276" rx="22" fill="#3d9a8b"/>
  <rect x="222" y="118" width="152" height="152" rx="30" fill="#e8c07d"/>
  <rect x="318" y="210" width="40" height="28" rx="8" fill="#2a6f65"/>
  <rect x="222" y="308" width="172" height="18" rx="9" fill="#3d9a8b"/>
  <rect x="222" y="350" width="172" height="18" rx="9" fill="#e8edf2"/>
  <rect x="222" y="392" width="172" height="18" rx="9" fill="#8b96a3"/>
</svg>
'''
)
print("done")
