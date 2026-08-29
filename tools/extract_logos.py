"""
Turn the supplied client logo shots into transparent PNGs.

Each source is a white card with a lime frame ring around the logo. Steps:
  1. detect the lime ring and paint it out (so it can't survive the crop, and
     so the flood in step 2 can flow through where it was)
  2. flood-fill the background inwards from the four corners -- only
     background-connected white is removed, so white *inside* a logo
     (elhelow's lettering, Credit's wordmark) is preserved
  3. trim to the remaining content and save with alpha

Run:  python tools/extract_logos.py
"""
import pathlib

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SRC = pathlib.Path.home() / "Downloads"
OUT = pathlib.Path(__file__).resolve().parent.parent / "assets" / "clients"
OUT.mkdir(parents=True, exist_ok=True)

# filename -> output slug
SOURCES = {
    "IMG_4840.jpeg":     "housh",
    "IMG_4840 (1).jpeg": "credit",
    "IMG_4840 (2).jpeg": "elhelow-style",
    "IMG_4840 (3).jpeg": "cheerfulness-makers",
    "IMG_4840 (4).jpeg": "hub-vet-clinic",
}

SENTINEL = (255, 0, 255)   # colour used to mark flooded background


def strip_ring(rgb: np.ndarray) -> np.ndarray:
    """Paint the lime frame ring white so it drops out with the background.

    Only pixels in the outer annulus are considered: the ring always hugs the
    card edge, while the logo sits central. Cheerfulness Makers has green and
    yellow-green figures of its own, so a whole-image colour key would eat them.
    """
    h, w = rgb.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    cy, cx = (h - 1) / 2, (w - 1) / 2
    dist = np.hypot(yy - cy, xx - cx)
    outer = dist > 0.55 * min(h, w) / 2

    r, g, b = rgb[..., 0].astype(int), rgb[..., 1].astype(int), rgb[..., 2].astype(int)
    # generous key so the ring's anti-aliased falloff goes too
    lime = (g - b > 22) & (r - b > 14) & (b < 225) & (g > 120)

    mask = lime & outer
    # grow it a little to swallow the soft halo either side of the ring
    mask = np.asarray(
        Image.fromarray((mask * 255).astype(np.uint8), "L").filter(ImageFilter.MaxFilter(9))
    ) > 128

    out = rgb.copy()
    out[mask] = (255, 255, 255)
    return out


def extract(path: pathlib.Path, slug: str) -> None:
    im = Image.open(path).convert("RGB")
    arr = strip_ring(np.asarray(im))
    work = Image.fromarray(arr, "RGB")

    # flood the background in from every corner
    w, h = work.size
    for xy in ((1, 1), (w - 2, 1), (1, h - 2), (w - 2, h - 2)):
        ImageDraw.floodfill(work, xy, SENTINEL, thresh=62)

    flooded = np.asarray(work)
    bg = np.all(flooded == np.array(SENTINEL, np.uint8), axis=-1)

    alpha = np.where(bg, 0, 255).astype(np.uint8)
    # soften the cut so edges aren't stair-stepped
    alpha = np.asarray(
        Image.fromarray(alpha, "L").filter(ImageFilter.GaussianBlur(0.6))
    )

    ys, xs = np.where(alpha > 40)
    if len(xs) == 0:
        print(f"  !! {slug}: nothing left after keying")
        return
    pad = 6
    t, bm = max(ys.min() - pad, 0), min(ys.max() + pad, alpha.shape[0] - 1)
    l, r = max(xs.min() - pad, 0), min(xs.max() + pad, alpha.shape[1] - 1)

    rgb = np.asarray(im)[t:bm + 1, l:r + 1]
    a = alpha[t:bm + 1, l:r + 1]
    out = Image.fromarray(np.dstack([rgb, a]), "RGBA")
    out.thumbnail((520, 520), Image.LANCZOS)
    out.save(OUT / f"{slug}.png", optimize=True)

    kept = (a > 40).mean() * 100
    print(f"  {slug:22s} {out.size[0]}x{out.size[1]}  ({kept:.0f}% opaque)")


if __name__ == "__main__":
    print(f"writing to {OUT}")
    for fname, slug in SOURCES.items():
        p = SRC / fname
        if not p.exists():
            print(f"  !! missing {fname}")
            continue
        extract(p, slug)
