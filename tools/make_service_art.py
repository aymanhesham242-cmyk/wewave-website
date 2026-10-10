"""
Generate a background image in assets/services/ for each service.

These are original, generated artwork -- not stock photography -- so there is
no licensing question. The card CSS desaturates the image and washes it back
behind a palette overlay, so what reads on screen is composition and tone, not
subject matter. Each service gets a distinct motif drawn in the brand greens.

Replace any file here with real photography whenever you have it; the filename
is the only contract. Then re-run tools/build_shots.py.

Run:  python tools/make_service_art.py
"""
import math
import pathlib
from PIL import Image, ImageDraw, ImageFilter

W, H = 900, 700
OUT = pathlib.Path(__file__).resolve().parent.parent / "assets" / "services"
OUT.mkdir(parents=True, exist_ok=True)

DEEP = (18, 60, 42)
PRIM = (31, 107, 69)
ACC  = (46, 139, 87)
PALE = (221, 239, 229)


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def ground(c1, c2, angle=0.6):
    """Smooth diagonal gradient base."""
    img = Image.new("RGB", (W, H))
    px = img.load()
    for y in range(H):
        for x in range(0, W, 4):
            t = (x / W * angle + y / H * (1 - angle))
            col = lerp(c1, c2, min(max(t, 0), 1))
            for dx in range(4):
                if x + dx < W:
                    px[x + dx, y] = col
    return img


def vignette(img, strength=0.55):
    mask = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(mask)
    d.ellipse([-W * 0.25, -H * 0.35, W * 1.25, H * 1.35], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(150))
    dark = Image.new("RGB", (W, H), (8, 24, 17))
    return Image.composite(img, Image.blend(img, dark, strength), mask)


def finish(img, name):
    img = vignette(img)
    img = img.filter(ImageFilter.GaussianBlur(0.6))
    img.save(OUT / f"{name}.jpg", quality=72, optimize=True)


def bars(d, col):
    for i, h in enumerate([180, 300, 240, 420, 350, 500, 300]):
        x = 120 + i * 100
        d.rounded_rectangle([x, H - 90 - h, x + 58, H - 90], radius=8, fill=col)


def grid(d, col, cols=6, rows=4):
    for r in range(rows):
        for c in range(cols):
            x, y = 110 + c * 120, 150 + r * 120
            d.rounded_rectangle([x, y, x + 92, y + 92], radius=12, outline=col, width=5)


def rings(d, col):
    cx, cy = W * 0.62, H * 0.5
    for r in (300, 225, 150, 78):
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=col, width=10)
    d.ellipse([cx - 26, cy - 26, cx + 26, cy + 26], fill=col)


def frames(d, col):
    for i in range(3):
        x = 90 + i * 250
        d.rounded_rectangle([x, 190, x + 200, 500], radius=16, outline=col, width=7)
    d.polygon([(400, 290), (400, 410), (505, 350)], fill=col)


def lines(d, col):
    d.text((110, 120), '"', fill=col)
    for i, w in enumerate([620, 700, 520, 660, 430, 600]):
        y = 210 + i * 68
        d.rounded_rectangle([120, y, 120 + w, y + 26], radius=13, fill=col)


def palette(d, col, col2):
    spots = [(300, 260, 130), (520, 330, 165), (350, 470, 110), (620, 190, 88)]
    for i, (x, y, r) in enumerate(spots):
        d.ellipse([x - r, y - r, x + r, y + r],
                  outline=col if i % 2 else col2, width=9)


def trend(d, col):
    pts = [(110, 560), (250, 470), (370, 505), (500, 350), (630, 395), (790, 190)]
    d.line(pts, fill=col, width=12, joint="curve")
    for p in pts:
        d.ellipse([p[0] - 15, p[1] - 15, p[0] + 15, p[1] + 15], fill=col)
    d.line([(790, 190), (720, 205)], fill=col, width=12)
    d.line([(790, 190), (778, 262)], fill=col, width=12)


def donut(d, col, col2):
    cx, cy, r = W * 0.35, H * 0.5, 190
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=col, width=44)
    d.pieslice([cx - r, cy - r, cx + r, cy + r], -95, 55, outline=col2, width=44)
    for i, h in enumerate([150, 250, 200, 320]):
        x = 620 + i * 66
        d.rounded_rectangle([x, H - 130 - h, x + 42, H - 130], radius=6, fill=col2)


def window(d, col, col2):
    d.rounded_rectangle([100, 140, 800, 560], radius=20, outline=col, width=8)
    d.line([(100, 218), (800, 218)], fill=col, width=8)
    for i in range(3):
        cx = 145 + i * 42
        d.ellipse([cx - 12, 167, cx + 12, 191], fill=col)
    for i, w in enumerate([300, 430, 210, 380, 260]):
        y = 268 + i * 54
        d.rounded_rectangle([150, y, 150 + w, y + 22], radius=11, fill=col2)


JOBS = [
    ("competitor-market-analysis", (DEEP, PRIM), bars,    (ACC,)),
    ("media-buying",               (DEEP, ACC),  rings,   (PALE,)),
    ("photography-reels",          (PRIM, DEEP), frames,  (PALE,)),
    ("brand-identity",             (ACC,  DEEP), palette, (PALE, ACC)),
    ("web-development",            (DEEP, ACC),  window,  (PALE, ACC)),
]

for name, (c1, c2), fn, args in JOBS:
    img = ground(c1, c2)
    layer = Image.new("RGB", (W, H), (0, 0, 0))
    lmask = Image.new("L", (W, H), 0)
    ld = ImageDraw.Draw(lmask)
    fn(ld, *[255] * len(args))          # draw motif into an alpha mask
    lmask = lmask.filter(ImageFilter.GaussianBlur(1.2))
    tint = Image.new("RGB", (W, H), args[0])
    img = Image.composite(Image.blend(img, tint, 0.55), img, lmask)
    finish(img, name)

print(f"wrote {len(JOBS)} images to assets/services/")
