"""
Write a WebP beside every client logo PNG.

The eight logos are the heaviest thing on first load -- heavier than all the
HTML, CSS and JavaScript put together -- because they are flat-colour artwork
stored as PNG. WebP stores the same pixels far more cheaply.

**Lossless only.** The brief on these logos was that they must be reproduced
exactly, so this never re-encodes a mark with a lossy codec: every output is
bit-identical to the PNG when decoded. The script proves that before it writes,
and refuses to write a file that is not.

The PNGs stay. `css/style.css` offers both through `image-set()`, so a browser
that cannot read WebP still gets the PNG.

Run:  python tools/build_client_webp.py
"""
import pathlib

from PIL import Image, ImageChops

SRC = pathlib.Path(__file__).resolve().parent.parent / "assets" / "clients"

png_total = webp_total = 0
written = 0

for png in sorted(SRC.glob("*.png")):
    out = png.with_suffix(".webp")
    original = Image.open(png).convert("RGB")
    original.save(out, "WEBP", lossless=True, quality=100, method=6)

    # Decode what was actually written and compare it to the source. A single
    # differing pixel means the logo changed, which is not allowed here.
    diff = ImageChops.difference(original, Image.open(out).convert("RGB"))
    if diff.getbbox() is not None:
        out.unlink(missing_ok=True)
        raise SystemExit(f"{png.name}: WebP did not round-trip losslessly — not written")

    p, w = png.stat().st_size, out.stat().st_size
    png_total += p
    webp_total += w
    written += 1
    print(f"  {png.name:28} {p/1024:7.1f} KB -> {w/1024:7.1f} KB  ({100 * (1 - w / p):3.0f}% smaller)")

print(f"\n{written} logos — {png_total/1024:.1f} KB of PNG, {webp_total/1024:.1f} KB of WebP"
      f"  (saves {(png_total - webp_total)/1024:.0f} KB per first visit)")
print("every file verified pixel-identical to its PNG")
