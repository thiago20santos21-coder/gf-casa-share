# -*- coding: utf-8 -*-
"""Full-bleed app icons: solid #0b0f14 square, no white corners."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT = Path(r"C:\Users\tiago\Downloads\gf\public\icons")
OUT.mkdir(parents=True, exist_ok=True)
BG = (11, 15, 20)  # #0b0f14
TEAL = (61, 154, 139)
TEAL_DARK = (42, 111, 101)
GOLD = (232, 192, 125)
GOLD_LIGHT = (240, 211, 153)
GOLD_DARK = (138, 106, 46)
WINDOW = (11, 15, 20)


def draw_icon(size: int, content_scale: float = 0.72) -> Image.Image:
    """Opaque RGB square — OS can round corners; we never leave white."""
    img = Image.new("RGB", (size, size), BG)
    draw = ImageDraw.Draw(img)

    # Content box (safe zone)
    pad = int(size * (1 - content_scale) / 2)
    x0, y0 = pad, pad
    x1, y1 = size - pad, size - pad
    w, h = x1 - x0, y1 - y0

    # House body
    body_l = x0 + int(w * 0.18)
    body_r = x0 + int(w * 0.78)
    body_t = y0 + int(h * 0.38)
    body_b = y0 + int(h * 0.88)
    draw.rectangle([body_l, body_t, body_r, body_b], fill=TEAL)

    # Roof triangle
    peak = (x0 + w // 2, y0 + int(h * 0.12))
    left = (body_l - int(w * 0.06), body_t + int(h * 0.04))
    right = (body_r + int(w * 0.06), body_t + int(h * 0.04))
    draw.polygon([peak, left, right], fill=TEAL)

    # Chimney
    ch_l = x0 + int(w * 0.62)
    ch_r = x0 + int(w * 0.74)
    ch_t = y0 + int(h * 0.18)
    ch_b = y0 + int(h * 0.36)
    draw.rectangle([ch_l, ch_t, ch_r, ch_b], fill=TEAL_DARK)

    # Window 2x2
    wx = x0 + int(w * 0.28)
    wy = y0 + int(h * 0.48)
    ws = int(w * 0.16)
    gap = max(2, int(size * 0.01))
    half = (ws - gap) // 2
    draw.rectangle([wx, wy, wx + half, wy + half], fill=WINDOW)
    draw.rectangle([wx + half + gap, wy, wx + ws, wy + half], fill=WINDOW)
    draw.rectangle([wx, wy + half + gap, wx + half, wy + ws], fill=WINDOW)
    draw.rectangle([wx + half + gap, wy + half + gap, wx + ws, wy + ws], fill=WINDOW)

    # Coin
    cx = x0 + int(w * 0.72)
    cy = y0 + int(h * 0.72)
    cr = int(w * 0.22)
    draw.ellipse([cx - cr, cy - cr, cx + cr, cy + cr], fill=GOLD)
    draw.ellipse(
        [cx - int(cr * 0.82), cy - int(cr * 0.82), cx + int(cr * 0.82), cy + int(cr * 0.82)],
        fill=GOLD_LIGHT,
    )
    # Dollar via text
    font_size = max(12, int(cr * 1.15))
    try:
        font = ImageFont.truetype("arial.ttf", font_size)
    except Exception:
        try:
            font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", font_size)
        except Exception:
            font = ImageFont.load_default()
    text = "$"
    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text((cx - tw / 2 - bbox[0], cy - th / 2 - bbox[1] - font_size * 0.05), text, fill=GOLD_DARK, font=font)

    return img


def save_all():
    specs = [
        ("casa-192.png", 192, 0.78),
        ("casa-512.png", 512, 0.78),
        ("casa-apple-180.png", 180, 0.80),
        ("casa-maskable-192.png", 192, 0.68),
        ("casa-maskable-512.png", 512, 0.68),
        ("icon-192.png", 192, 0.78),
        ("icon-512.png", 512, 0.78),
        ("apple-touch-icon.png", 180, 0.80),
        ("icon-maskable-192.png", 192, 0.68),
        ("icon-maskable-512.png", 512, 0.68),
    ]
    for name, size, scale in specs:
        im = draw_icon(size, scale)
        # Force opaque RGB PNG (no alpha channel = no white corner bleed)
        path = OUT / name
        im.save(path, format="PNG", optimize=True)
        print("wrote", name, im.mode, im.size)

    # Also update public/icon.png and SVG-less fallback
    draw_icon(512, 0.78).save(Path(r"C:\Users\tiago\Downloads\gf\public\icon.png"), format="PNG", optimize=True)
    print("done")


if __name__ == "__main__":
    save_all()
