"""Generate full-bleed PWA icons (new filenames to bust install cache)."""
from pathlib import Path
from PIL import Image, ImageDraw

SRC = Path(r"C:\Users\tiago\.cursor\projects\c-Users-tiago-Downloads-gf\assets\casa-share-icon.png")
OUT = Path(r"C:\Users\tiago\Downloads\gf\public\icons")
OUT.mkdir(parents=True, exist_ok=True)
BG = (11, 15, 20, 255)

src = Image.open(SRC).convert("RGBA")


def flatten_full_bleed(size: int, content_scale: float = 0.78) -> Image.Image:
    """Solid square (no baked rounded corners) — better for Android/iOS home screen."""
    canvas = Image.new("RGBA", (size, size), BG)
    # Strip any transparent corners from source by compositing onto BG first
    flat = Image.new("RGBA", src.size, BG)
    flat.paste(src, (0, 0), src)
    # Crop center content roughly (source already has padding)
    w, h = flat.size
    # Use full image scaled
    inner = int(size * content_scale)
    resized = flat.resize((inner, inner), Image.Resampling.LANCZOS)
    # Optional: cover any remaining rounded-corner artifacts by drawing a soft rect
    # Center paste
    off = (size - inner) // 2
    canvas.paste(resized, (off, off), resized)
    # Fill edges solid (ensure no alpha)
    return canvas.convert("RGBA")


def maskable(size: int) -> Image.Image:
    # More padding for safe zone (~80% content)
    return flatten_full_bleed(size, content_scale=0.72)


for size, name, scale in [
    (192, "casa-192.png", 0.82),
    (512, "casa-512.png", 0.82),
    (180, "casa-apple-180.png", 0.86),
    (192, "casa-maskable-192.png", 0.70),
    (512, "casa-maskable-512.png", 0.70),
]:
    flatten_full_bleed(size, scale).save(OUT / name, optimize=True)
    print("wrote", name)

# Keep legacy filenames pointing to new art too (in case old manifest cached)
for legacy, neu in [
    ("icon-192.png", "casa-192.png"),
    ("icon-512.png", "casa-512.png"),
    ("apple-touch-icon.png", "casa-apple-180.png"),
    ("icon-maskable-192.png", "casa-maskable-192.png"),
    ("icon-maskable-512.png", "casa-maskable-512.png"),
]:
    Image.open(OUT / neu).save(OUT / legacy, optimize=True)

print("done")
