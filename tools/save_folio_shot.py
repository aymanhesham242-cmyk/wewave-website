"""
Save the most recent browser screenshot as a client thumbnail.

The showcase falls back to a still for any client whose server refuses to be
framed. Those stills have to be the real site -- a stock photo or a mocked-up
browser window would be a lie about the work -- so they are captured by
pointing a real browser at the real URL and screenshotting it.

This takes the newest capture the browser tool wrote and files it:

    python tools/save_folio_shot.py <slug>

It crops to the top of the page (the part a visitor recognises), resizes to
the width the panel actually renders at, and prints what it did. Nothing here
invents an image; if no capture is waiting it says so and stops.
"""
import pathlib
import sys

from PIL import Image

BLOBS = pathlib.Path(
    r"C:\Users\Dell\.claude\projects\C--Users-Dell-Desktop"
    r"\b596b209-4721-4f12-bb64-163b19337adc\tool-results"
)
OUT = pathlib.Path(__file__).resolve().parent.parent / "assets" / "folio"
WIDTH = 880          # ~2x the 420px panel, so it stays sharp on a retina screen
RATIO = 16 / 10      # matches .sc-view's aspect-ratio

if len(sys.argv) < 2:
    raise SystemExit("usage: python tools/save_folio_shot.py <slug>")
slug = sys.argv[1]

shots = sorted(BLOBS.glob("*.jpg"), key=lambda p: p.stat().st_mtime, reverse=True)
if not shots:
    raise SystemExit("no browser capture found — take a screenshot first")
src = shots[0]

im = Image.open(src).convert("RGB")
# Keep the top of the page and crop to the panel's shape rather than squashing
# the site into it.
keep_h = min(im.height, round(im.width / RATIO))
im = im.crop((0, 0, im.width, keep_h))
im = im.resize((WIDTH, round(WIDTH / RATIO)), Image.LANCZOS)

OUT.mkdir(parents=True, exist_ok=True)
dest = OUT / f"{slug}.jpg"
im.save(dest, "JPEG", quality=78, optimize=True, progressive=True)

print(f"  {src.name}  ->  assets/folio/{slug}.jpg"
      f"  {im.width}x{im.height}  {dest.stat().st_size/1024:.0f} KB")
