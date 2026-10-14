"""
Generate work.html — the portfolio — from tools/work_data.py.

The page is four brand chapters, not one grid. Each chapter is a band of its
own: a number, the brand, one line of context, and then that brand's work shown
large and edge to edge. You scroll through four stories rather than scanning
twenty-nine thumbnails, which is the difference between a portfolio and a
contact sheet.

Run:  python tools/build_work.py
"""
import html
import pathlib

from work_data import BRANDS, CHAPTERS, FILMS, WORK
from work_dimensions import DIMS

ROOT = pathlib.Path(__file__).resolve().parent.parent

HEAD = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Work — WeWave</title>
<meta name="description" content="Campaign creative, product photography, film and storefronts WeWave has built for beauty, fashion and interiors brands.">
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

{viewer}

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

# The viewer markup is shared between work.html and any service page that
# embeds a chapter, so it is built once here and imported by build_services.
VIEWER = """
<div class="wk-view" id="wkView" hidden aria-hidden="true" role="dialog" aria-modal="true" aria-label="Work viewer">
  <div class="wk-view-bar">
    <span class="wk-view-brand" id="wkViewBrand"></span>
    <button class="wk-view-x" id="wkViewClose" type="button" aria-label="Close viewer">
      <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
    </button>
  </div>

  <button class="wk-view-nav wk-view-prev" id="wkViewPrev" type="button" aria-label="Previous">
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>
  </button>
  <button class="wk-view-nav wk-view-next" id="wkViewNext" type="button" aria-label="Next">
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>
  </button>

  <div class="wk-stage" id="wkStage">
    <img id="wkViewImg" alt="">
  </div>

  <div class="wk-view-foot">
    <p class="wk-view-title" id="wkViewTitle"></p>
    <div class="wk-strip" id="wkStrip" role="tablist" aria-label="Jump to a piece"></div>
  </div>
</div>
"""


def esc(s):
    return html.escape(str(s), quote=True)


def piece(item, index, eager=False, prefix=""):
    """One piece of work. The box is reserved from the real pixel size so the
    page never shifts while images arrive."""
    slug = item["slug"]
    w, h = DIMS.get(slug, (1080, 1440))
    brand = BRANDS[item["brand"]]
    wide = w / h > 1.6
    loading = "eager" if eager else "lazy"
    prio = ' fetchpriority="high"' if eager and index == 0 else ""

    return (
        f'<button class="wk-piece{" is-wide" if wide else ""}" type="button" '
        # the full-size path is carried on the element, not built in script:
        # work.html sits at the root and the service pages one level down
        f'data-full="{prefix}assets/work/{esc(slug)}.webp" '
        f'data-brand="{esc(brand["name"])}" '
        f'data-title="{esc(item["title"])}" '
        f'style="--ar:{w}/{h}" '
        f'aria-label="{esc(item["title"])} — {esc(brand["name"])}. View larger">'
        f'<img src="{prefix}assets/work/{esc(slug)}-t.webp" alt="{esc(item["alt"])}" '
        f'width="{w}" height="{h}" loading="{loading}" decoding="async"{prio}>'
        f'<span class="wk-piece-cap"><span class="wk-piece-title">{esc(item["title"])}</span></span>'
        "</button>"
    )


def chapter(num, key, first):
    b = BRANDS[key]
    mine = [w for w in WORK if w["brand"] == key]
    if not mine:
        return ""

    delivers = "".join(f"<li>{esc(d)}</li>" for d in b["delivers"])

    links = ""
    if b.get("site"):
        links += (f'<a class="wk-link" href="{esc(b["site"])}" target="_blank" '
                  f'rel="noopener">Visit the site <span aria-hidden="true">&rarr;</span></a>')
    if b.get("case"):
        links += (f'<a class="wk-link is-case" href="{esc(b["case"])}">'
                  f'{esc(b.get("case_label", "See the case study"))} '
                  f'<span aria-hidden="true">&rarr;</span></a>')

    pieces = "".join(piece(w, i, eager=(first and i < 2)) for i, w in enumerate(mine))

    return f"""
<section class="wk-chapter" data-chapter="{esc(key)}">
  <div class="wrap">
    <div class="wk-ch-head">
      <span class="wk-ch-num">{num:02d}</span>
      <div class="wk-ch-id">
        <h2>{esc(b["name"])}</h2>
        <span class="wk-ch-kind">{esc(b["kind"])}</span>
      </div>
      <p class="wk-ch-blurb">{b["blurb"]}</p>
      <ul class="wk-ch-delivers">{delivers}</ul>
      <div class="wk-ch-links">{links}</div>
    </div>
  </div>
  <div class="wk-ch-work">{pieces}</div>
</section>
"""


def films_section(num):
    """Motion & film. Only rendered when the files are actually on disk --
    a play button over nothing is worse than no section."""
    ready = [f for f in FILMS
             if (ROOT / "assets" / "work" / f"{f['slug']}.mp4").exists()]
    if not ready:
        return ""

    cards = ""
    for f in ready:
        poster = f"assets/work/{f['slug']}-poster.webp"
        has_poster = (ROOT / poster).exists()
        cards += (
            f'<button class="wk-film" type="button" '
            f'data-src="assets/work/{esc(f["slug"])}.mp4" '
            f'data-title="{esc(f["title"])}" data-brand="{esc(f.get("brand", ""))}" '
            f'aria-label="Play {esc(f["title"])}, {esc(f["length"])}">'
            + (f'<img src="{poster}" alt="{esc(f["alt"])}" width="720" height="1280" '
               f'loading="lazy" decoding="async">' if has_poster else '<span class="wk-film-blank"></span>')
            + '<span class="wk-film-play" aria-hidden="true">'
              '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg></span>'
              f'<span class="wk-film-meta">'
              f'<span class="wk-film-title">{esc(f["title"])}</span>'
              f'<span class="wk-film-len">{esc(f["length"])}</span></span>'
            "</button>"
        )

    return f"""
<section class="wk-chapter wk-films" data-chapter="film">
  <div class="wrap">
    <div class="wk-ch-head">
      <span class="wk-ch-num">{num:02d}</span>
      <div class="wk-ch-id">
        <h2>Motion &amp; film</h2>
        <span class="wk-ch-kind">Production, editing and motion</span>
      </div>
      <p class="wk-ch-blurb">Short films cut for brands and campaigns. Shot,
         edited, graded and scored in house.</p>
    </div>
    <div class="wk-film-grid">{cards}</div>
  </div>
</section>
"""


def embed(slugs, title, blurb, prefix="../"):
    """A band of chosen pieces for another page to drop in.

    Renders through the same `piece()` as /work, so a change to the tile is a
    change in one place. `prefix` is what makes the asset paths resolve from a
    page that is not at the root.
    """
    chosen = [w for s in slugs for w in WORK if w["slug"] == s]
    if not chosen:
        return ""
    tiles = "".join(piece(w, i, prefix=prefix) for i, w in enumerate(chosen))
    return f"""
<section class="wk-chapter wk-embed" data-chapter="embed">
  <div class="wrap">
    <div class="wk-ch-head">
      <span class="wk-ch-num">&#9679;</span>
      <div class="wk-ch-id">
        <h2>{esc(title)}</h2>
        <span class="wk-ch-kind">Selected visual identity work</span>
      </div>
      <p class="wk-ch-blurb">{blurb}</p>
      <div class="wk-ch-links">
        <a class="wk-link" href="{prefix}work">See all the work <span aria-hidden="true">&rarr;</span></a>
      </div>
    </div>
  </div>
  <div class="wk-ch-work">{tiles}</div>
</section>
"""


def build():
    n_pieces = len(WORK)
    films_ready = [f for f in FILMS
                   if (ROOT / "assets" / "work" / f"{f['slug']}.mp4").exists()]

    lead = (
        "Campaign creative, product photography, film and storefronts for "
        "beauty, fashion and interiors brands. Everything here was made by "
        "WeWave for a paying client &mdash; no mockups, no stock, no filler."
    )

    stats = [("pieces of work", n_pieces + len(films_ready)),
             ("brands", len(CHAPTERS)),
             ("sites built", len([w for w in WORK if w["brand"] == "clients"]))]
    if films_ready:
        stats.insert(2, ("films", len(films_ready)))

    stat_html = "".join(f'<span class="wk-stat"><b>{v}</b>{k}</span>' for k, v in stats)

    body = HEAD.format(lead=lead, stats=stat_html)

    n = 1
    for key in CHAPTERS:
        body += chapter(n, key, first=(n == 1))
        n += 1
    body += films_section(n)

    body += TAIL.format(viewer=VIEWER)

    out = ROOT / "work.html"
    out.write_text(body, encoding="utf-8")
    return out, n_pieces, len(films_ready)


if __name__ == "__main__":
    path, n, nf = build()
    print(f"  {path.relative_to(ROOT).as_posix()}")
    print(f"    {len(CHAPTERS)} chapters, {n} pieces, {nf} films")
    for key in CHAPTERS:
        c = len([w for w in WORK if w["brand"] == key])
        print(f"      {BRANDS[key]['name']:22s} {c}")
    missing = [w["slug"] for w in WORK
               if not (ROOT / "assets" / "work" / f"{w['slug']}-t.webp").exists()]
    if missing:
        print("\n  MISSING ASSETS:")
        for m in missing:
            print("    " + m)
    if not nf:
        print("\n  No films on disk yet — the Motion & film section is not rendered.")
