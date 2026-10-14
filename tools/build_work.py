"""
Generate work.html — the portfolio gallery — from tools/work_data.py.

Same shape as build_services.py: all the copy and all the data live in one
place, the page is output, and nothing here is written by hand.

Run:  python tools/build_work.py
"""
import html
import pathlib

from work_data import BRANDS, CATEGORIES, FEATURED, WORK, by_cat, counts
from work_dimensions import DIMS

ROOT = pathlib.Path(__file__).resolve().parent.parent

HEAD = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Work — WeWave</title>
<meta name="description" content="Campaign creative, product photography and storefronts WeWave has built for beauty, fashion and interiors brands.">
<link rel="icon" href="assets/wewave-mark.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;500;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="css/service.css">
<link rel="stylesheet" href="css/work.css">
</head>
<body class="work-body">

<header class="svc-top">
  <a class="svc-brand" href="index.html">
    <img src="assets/wewave-mark.png" alt="" width="34" height="34">
    <span>WEWAVE</span>
  </a>
  <a class="svc-back" href="index.html">&larr; Back to site</a>
</header>

<main>

<section class="wk-hero">
  <div class="wrap">
    <p class="sec-label">Selected work</p>
    <h1>Creative that makes brands<br>impossible to ignore.</h1>
    <p class="wk-lead">{lead}</p>
    <div class="wk-stats">{stats}</div>
  </div>
</section>
"""

FILTERS = """
<section class="wk-filters-sec">
  <div class="wrap">
    <div class="wk-filters" role="tablist" aria-label="Filter the work">{chips}</div>
  </div>
</section>
"""

GRID = """
<section class="wk-grid-sec">
  <div class="wrap">
    <div class="wk-grid" id="wkGrid">{tiles}</div>
    <p class="wk-empty" id="wkEmpty" hidden>Nothing in this category yet.</p>
  </div>
</section>
"""

FEATURE = """
    <article class="wk-feature">
      <div class="wk-feature-head">
        <h3>{name}</h3>
        <span class="wk-kind">{kind}</span>
      </div>
      <p class="wk-blurb">{blurb}</p>
      <ul class="wk-delivers">{delivers}</ul>
      <div class="wk-links">{links}</div>
    </article>
"""

TAIL = """
<section class="wk-cta">
  <div class="wrap">
    <h2>Your brand could be our next case study.</h2>
    <p>Tell us what you are building, launching or rethinking, and we will
       tell you how WeWave moves it.</p>
    <div class="wk-cta-row">
      <a class="btn" href="index.html#book">Request a meeting</a>
      <a class="btn ghost" href="services/media-buying">See the numbers</a>
    </div>
  </div>
</section>

</main>

<div class="wk-box" id="wkBox" hidden aria-hidden="true" role="dialog" aria-modal="true" aria-label="Project viewer">
  <button class="wk-x" id="wkClose" type="button" aria-label="Close">&times;</button>
  <button class="wk-nav wk-prev" id="wkPrev" type="button" aria-label="Previous">&#8249;</button>
  <button class="wk-nav wk-next" id="wkNext" type="button" aria-label="Next">&#8250;</button>
  <figure class="wk-box-in">
    <img id="wkImg" alt="">
    <figcaption>
      <span class="wk-box-brand" id="wkBoxBrand"></span>
      <span class="wk-box-title" id="wkBoxTitle"></span>
      <span class="wk-box-count" id="wkBoxCount"></span>
    </figcaption>
  </figure>
</div>

<footer class="foot">
  <div class="foot-in">
    <span>&copy; 2026 WeWave</span>
    <a href="https://instagram.com/wewaveagency" target="_blank" rel="noopener">Instagram</a>
  </div>
</footer>

<script src="js/work.js" defer></script>
</body>
</html>
"""


def esc(s):
    return html.escape(str(s), quote=True)


def tile(item, index):
    slug = item["slug"]
    w, h = DIMS.get(slug, (1080, 1440))
    brand = BRANDS[item["brand"]]
    span = item.get("span", 2)
    shape = "wide" if w / h > 1.6 else "tall"
    link = item.get("link", "")

    # The aspect box is reserved from the real pixel size, so nothing moves
    # while the image arrives. The first few load eagerly: lazy-loading what
    # is already on screen only delays the largest paint.
    loading = "eager" if index < 4 else "lazy"
    prio = ' fetchpriority="high"' if index < 2 else ""

    out = (
        f'<button class="wk-item is-{shape}" type="button" '
        f'data-cat="{esc(item["cat"])}" data-slug="{esc(slug)}" '
        f'style="--span:{span};--ar:{w}/{h}" '
        f'aria-label="{esc(item["title"])} — {esc(brand["name"])}. Open larger">'
        f'<img src="assets/work/{esc(slug)}-t.webp" alt="{esc(item["alt"])}" '
        f'width="{w}" height="{h}" loading="{loading}" decoding="async"{prio}>'
        f'<span class="wk-meta">'
        f'<span class="wk-brand">{esc(brand["name"])}</span>'
        f'<span class="wk-title">{esc(item["title"])}</span>'
        f"</span>"
    )
    if link:
        out += '<span class="wk-flag">Live site</span>'
    out += "</button>"
    return out


def build():
    n_pieces = len(WORK)
    n_brands = len({w["brand"] for w in WORK if w["brand"] != "clients"})
    n_sites = len(by_cat("web"))

    lead = (
        "Campaign creative, product photography and storefronts for beauty, "
        "fashion and interiors brands. Everything on this page was made by "
        "WeWave for a paying client &mdash; no mockups, no stock, no filler."
    )

    stats = "".join(
        f'<span class="wk-stat"><b>{v}</b>{k}</span>'
        for k, v in (("pieces of work", n_pieces),
                     ("brands", n_brands + 1),
                     ("sites built", n_sites))
    )

    c = counts()
    chips = "".join(
        f'<button class="wk-chip{" is-on" if key == "all" else ""}" type="button" '
        f'role="tab" aria-selected="{"true" if key == "all" else "false"}" '
        f'data-filter="{key}">{esc(label)}<span class="wk-n">{c[key]}</span></button>'
        for key, label in CATEGORIES if c[key]
    )

    tiles = "".join(tile(w, i) for i, w in enumerate(WORK))

    features = ""
    for key in FEATURED:
        b = BRANDS[key]
        delivers = "".join(f"<li>{esc(d)}</li>" for d in b["delivers"])
        links = ""
        if b.get("site"):
            links += (f'<a class="wk-link" href="{esc(b["site"])}" target="_blank" '
                      f'rel="noopener">Visit the site</a>')
        if b.get("case"):
            links += (f'<a class="wk-link is-case" href="{esc(b["case"])}">'
                      f'{esc(b.get("case_label", "See the case study"))}</a>')
        features += FEATURE.format(
            name=esc(b["name"]), kind=esc(b["kind"]),
            blurb=b["blurb"], delivers=delivers, links=links)

    body = HEAD.format(lead=lead, stats=stats)
    body += FILTERS.format(chips=chips)
    body += GRID.format(tiles=tiles)
    body += ('\n<section class="wk-features-sec">\n  <div class="wrap">\n'
             '    <p class="sec-label">The brands behind the work</p>\n'
             f'    <div class="wk-features">{features}</div>\n'
             "  </div>\n</section>\n")
    body += TAIL

    out = ROOT / "work.html"
    out.write_text(body, encoding="utf-8")
    return out, n_pieces, c


if __name__ == "__main__":
    path, n, c = build()
    print(f"  {path.relative_to(ROOT).as_posix()}  —  {n} pieces")
    for key, label in CATEGORIES:
        if c[key]:
            print(f"    {label:22s} {c[key]}")
    missing = [w["slug"] for w in WORK
               if not (ROOT / "assets" / "work" / f"{w['slug']}-t.webp").exists()]
    if missing:
        print("\n  MISSING ASSETS (tile will be blank):")
        for m in missing:
            print("    " + m)
