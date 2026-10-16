"""Build the 1200x630 social card.

Everything on it is the site's own: the deep-green ground, the green glow, the
real logo mark, the title from <title>, and the hero's own line. No invented
claims, no numbers -- the hero numbers were deliberately removed from the site
because the work behind them isn't uploaded yet, so they must not reappear here.

Type is set in Impact, which is literally the site's declared fallback for
--display ('Bebas Neue',Impact,sans-serif). Bebas Neue is not installed on this
machine and the card has to be a real rendered file, so the fallback is what
ships -- it is condensed uppercase like Bebas, and it is what a visitor without
the webfont already sees.
"""
import pathlib
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = pathlib.Path(r"C:\Users\Dell\Desktop\WeWave Website")
W, H = 1200, 630

DEEP = (12, 42, 28)      # --deep  #0C2A1C
GLOW = (46, 139, 87)     # --glow  #2E8B57
INK  = (255, 255, 255)   # --ink

F = "C:/Windows/Fonts"
impact = lambda s: ImageFont.truetype(f"{F}/impact.ttf", s)
narrow = lambda s: ImageFont.truetype(f"{F}/ARIALN.TTF", s)
narrowb = lambda s: ImageFont.truetype(f"{F}/ARIALNB.TTF", s)

# ---------------------------------------------------------------- the ground
card = Image.new("RGB", (W, H), DEEP)

# the hero's glow: a soft radial bloom off the lower right, drawn large and
# blurred rather than computed per pixel
bloom = Image.new("L", (W, H), 0)
ImageDraw.Draw(bloom).ellipse((W - 520, H - 430, W + 290, H + 230), fill=120)
ImageDraw.Draw(bloom).ellipse((-180, -260, 420, 200), fill=52)
bloom = bloom.filter(ImageFilter.GaussianBlur(165))
card = Image.composite(Image.new("RGB", (W, H), GLOW), card, bloom)

d = ImageDraw.Draw(card)

# a hairline frame, the same chrome the site uses around its panels
d.rectangle((44, 44, W - 45, H - 45), outline=(255, 255, 255, 0))
for i, a in ((0, 30), (1, 14)):
    d.rectangle((44 + i, 44 + i, W - 45 - i, H - 45 - i),
                outline=tuple(int(c + (255 - c) * a / 255) for c in DEEP))


def tracked(draw, xy, text, font, fill, track=0):
    """Draw text with letter-spacing, which PIL has no option for."""
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=font, fill=fill)
        x += draw.textlength(ch, font=font) + track
    return x - xy[0] - (track if text else 0)


def tracked_width(draw, text, font, track=0):
    if not text:
        return 0
    return sum(draw.textlength(c, font=font) for c in text) + track * (len(text) - 1)

# ----------------------------------------------------------------- the mark
# The PNG is pure black artwork carried on its alpha channel -- the site never
# paints its pixels either, it uses the file as a CSS mask (css/style.css:73)
# and pours --ink through it. Painting it as-is onto the deep ground gives a
# black mark on dark green, which is what the first draft of this card did.
# So: take the alpha as a stencil and fill it with --ink, exactly as the mask
# rule does in the browser.
src = Image.open(ROOT / "assets/wewave-mark.png").convert("RGBA")
mh = 104
src = src.resize((round(src.width * mh / src.height), mh), Image.LANCZOS)
stencil = src.getchannel("A")
mark = Image.new("RGBA", src.size, INK + (0,))
mark.putalpha(stencil)
LEFT, TOP = 96, 92
card.paste(mark, (LEFT, TOP), mark)

# -------------------------------------------------------------- the wordmark
# "WEWAVE" as the one big thing on the card -- at 1200x630 a social preview is
# shown as small as ~260px wide in a chat list, so only one element can be
# legible at that size, and it has to be the name.
wm = impact(188)
d.text((LEFT - 4, TOP + mh + 44), "WEWAVE", font=wm, fill=INK)

# ------------------------------------------------------------- the two lines
# the eyebrow: the site's own <title> subtitle, tracked like the site's --mono
eb = narrowb(27)
tracked(d, (LEFT, TOP + mh + 266), "SOCIAL & CONTENT STUDIO", eb,
        tuple(int(GLOW[i] + (255 - GLOW[i]) * .42) for i in range(3)), track=4.6)

# the hero's own line, verbatim
hl = narrow(40)
d.text((LEFT, TOP + mh + 312), "Attention, engineered.", font=hl,
       fill=tuple(int(c * .80 + 255 * .20) for c in (210, 225, 216)))

# --------------------------------------------------------- the accent corner
# the same green rule the service cards wear across their top edge
d.rectangle((LEFT, TOP + mh + 24, LEFT + 92, TOP + mh + 28), fill=GLOW)

out = ROOT / "assets/og-card.png"
card.save(out, "PNG", optimize=True)
print(f"  wrote {out.relative_to(ROOT)}  {card.size[0]}x{card.size[1]}  "
      f"{out.stat().st_size/1024:.1f} KB")
