"""
Slice the supplied transparent logo sheet into one PNG per client.

The sheet already has its background removed, so the logos are just islands of
opaque pixels separated by empty columns. Project the alpha onto the x-axis,
split on the gaps, then trim each slice to its own bounding box.

Run:  python tools/crop_logo_sheet.py "<path to sheet.png>"
"""
import pathlib
import sys

import numpy as np
from PIL import Image

OUT = pathlib.Path(__file__).resolve().parent.parent / "assets" / "clients"
OUT.mkdir(parents=True, exist_ok=True)

# left-to-right order on the sheet
NAMES = ["housh", "cheerfulness-makers", "elhelow-style", "hub-vet-clinic", "credit"]

ALPHA_MIN = 40    # treat below this as empty
MIN_GAP = 26      # empty columns needed to call it a separation
MIN_WIDTH = 40    # ignore slivers (stray specks)
PAD = 8


def runs_of_content(cols: np.ndarray):
    """Yield (start, end) column ranges separated by >= MIN_GAP empty columns."""
    spans, start, gap = [], None, 0
    for x, filled in enumerate(cols):
        if filled:
            if start is None:
                start = x
            gap = 0
        elif start is not None:
            gap += 1
            if gap >= MIN_GAP:
                spans.append((start, x - gap))
                start, gap = None, 0
    if start is not None:
        spans.append((start, len(cols) - 1))
    return [(a, b) for a, b in spans if b - a + 1 >= MIN_WIDTH]


def main(path: pathlib.Path):
    im = Image.open(path).convert("RGBA")
    arr = np.asarray(im)
    mask = arr[..., 3] > ALPHA_MIN

    spans = runs_of_content(mask.any(axis=0))
    print(f"{path.name}: {im.size[0]}x{im.size[1]} -> {len(spans)} logo(s) found")

    if len(spans) != len(NAMES):
        print(f"  !! expected {len(NAMES)}; adjust MIN_GAP. Spans: {spans}")

    for i, (x0, x1) in enumerate(spans):
        name = NAMES[i] if i < len(NAMES) else f"logo-{i + 1}"
        sub = mask[:, x0:x1 + 1]
        ys = np.where(sub.any(axis=1))[0]
        y0, y1 = ys.min(), ys.max()

        l = max(x0 - PAD, 0)
        r = min(x1 + PAD, arr.shape[1] - 1)
        t = max(y0 - PAD, 0)
        b = min(y1 + PAD, arr.shape[0] - 1)

        out = Image.fromarray(arr[t:b + 1, l:r + 1], "RGBA")
        out.thumbnail((360, 360), Image.LANCZOS)
        out.save(OUT / f"{name}.png", optimize=True)
        print(f"  {name:22s} {out.size[0]}x{out.size[1]}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("usage: python tools/crop_logo_sheet.py <sheet.png>")
    main(pathlib.Path(sys.argv[1]))
