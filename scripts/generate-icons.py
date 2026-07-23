"""Generate professional GF Casa Share PNG icons."""
from PIL import Image, ImageDraw
import os

OUT = os.path.join(os.path.dirname(__file__), "..", "public", "icons")
os.makedirs(OUT, exist_ok=True)

BG = (11, 15, 20, 255)       # #0b0f14
TEAL = (61, 154, 139, 255)   # #3d9a8b
GOLD = (232, 192, 125, 255)  # #e8c07d
SLATE = (30, 40, 52, 255)
WHITE = (232, 237, 242, 255)


def rounded_rect(draw, box, radius, fill):
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def draw_mark(draw, size, pad_ratio=0.18):
    """Abstract house + share mark: rounded square with split bars."""
    pad = int(size * pad_ratio)
    # outer plate
    rounded_rect(draw, (pad, pad, size - pad, size - pad), int(size * 0.18), SLATE)
    # teal accent bar (left)
    inner = pad + int(size * 0.12)
    bar_w = int(size * 0.14)
    rounded_rect(
        draw,
        (inner, inner, inner + bar_w, size - inner),
        int(size * 0.04),
        TEAL,
    )
    # gold accent square (top-right of content)
    gap = int(size * 0.06)
    cx = inner + bar_w + gap
    cy = inner
    sq = int(size * 0.28)
    rounded_rect(draw, (cx, cy, cx + sq, cy + sq), int(size * 0.05), GOLD)
    # white horizontal lines (list metaphor)
    line_h = max(2, size // 48)
    lx0 = cx
    lx1 = size - inner
    for i, yoff in enumerate([0.42, 0.55, 0.68]):
        y = int(size * yoff)
        color = TEAL if i == 0 else WHITE
        alpha_color = color if i < 2 else (140, 150, 165, 255)
        rounded_rect(draw, (lx0, y, lx1, y + line_h), line_h // 2, alpha_color)


def make(size, maskable=False):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    if maskable:
        # full-bleed safe zone: content in center 80%
        draw.rectangle((0, 0, size, size), fill=BG)
        draw_mark(draw, size, pad_ratio=0.22)
    else:
        # rounded app icon
        draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=int(size * 0.22), fill=BG)
        draw_mark(draw, size, pad_ratio=0.16)
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
    make(size, maskable).save(path, "PNG")
    print("wrote", path)

# Also update root favicon-style svg companion is separate
print("done")
