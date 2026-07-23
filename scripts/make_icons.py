from pathlib import Path
from PIL import Image

src = Path(r"C:\Users\tiago\.cursor\projects\c-Users-tiago-Downloads-gf\assets\casa-share-icon.png")
out = Path(r"C:\Users\tiago\Downloads\gf\public\icons")
out.mkdir(parents=True, exist_ok=True)
img = Image.open(src).convert("RGBA")


def fit(size, pad_ratio=0.0):
    canvas = Image.new("RGBA", (size, size), (11, 15, 20, 255))
    inner = int(size * (1 - pad_ratio))
    resized = img.resize((inner, inner), Image.Resampling.LANCZOS)
    offset = (size - inner) // 2
    canvas.paste(resized, (offset, offset), resized)
    return canvas


fit(192).save(out / "icon-192.png")
fit(512).save(out / "icon-512.png")
fit(180).save(out / "apple-touch-icon.png")
fit(192, 0.12).save(out / "icon-maskable-192.png")
fit(512, 0.12).save(out / "icon-maskable-512.png")
fit(512).save(Path(r"C:\Users\tiago\Downloads\gf\public\icon.png"))
print("ok", [p.name for p in out.iterdir()])
