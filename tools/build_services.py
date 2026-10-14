"""
Generate one full page per service into services/.

All copy lives in SERVICES below, so the pages stay consistent and a wording
change is a one-line edit rather than nine.

Case studies: `case` holds real, verified figures. Where a service has no case
study yet the page renders a clearly-labelled slot instead of inventing one --
drop a screenshot at the named path and it appears automatically.

Run:  python tools/build_services.py
"""
import html
import pathlib

from case_data import CASES, check, derive

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "services"
OUT.mkdir(exist_ok=True)

ICON = {
    "analysis": '<circle cx="21" cy="21" r="13"/><path d="M31 31l11 11"/><path d="M15 24v-5M21 26v-11M27 24v-7"/>',
    "calendar": '<rect x="7" y="10" width="34" height="31" rx="3"/><path d="M7 19h34M16 6v8M32 6v8"/><path d="M14 26h5M22 26h5M30 26h4M14 33h5M22 33h5"/>',
    "target": '<circle cx="24" cy="24" r="17"/><circle cx="24" cy="24" r="10"/><circle cx="24" cy="24" r="3"/><path d="M24 7V2M24 46v-5M7 24H2M46 24h-5"/>',
    "camera": '<rect x="5" y="13" width="38" height="26" rx="4"/><path d="M17 13l3-5h8l3 5"/><circle cx="24" cy="26" r="8"/><path d="M21.5 22.5l6 3.5-6 3.5z"/>',
    "pen": '<path d="M8 40l4-11L31 10a4 4 0 0 1 6 6L18 35z"/><path d="M28 13l7 7"/><path d="M8 40l7-2"/>',
    "palette": '<path d="M24 6c-10 0-18 7.6-18 17 0 6 4 10 9 10h3a4 4 0 0 1 0 8c0 .7.7 1 1.5 1C30 42 42 34 42 23 42 13.6 34 6 24 6z"/><circle cx="16" cy="20" r="2.2"/><circle cx="24" cy="15" r="2.2"/><circle cx="32" cy="20" r="2.2"/>',
    "trend": '<path d="M6 34l10-11 7 6 12-15"/><path d="M28 14h9v9"/><path d="M6 41h36"/>',
    "report": '<path d="M11 6h17l9 9v27a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3z"/><path d="M28 6v10h9"/><path d="M15 36v-7M22 36v-12M29 36v-5"/>',
    "code": '<path d="M17 16L7 24l10 8"/><path d="M31 16l10 8-10 8"/><path d="M27 9l-6 30"/>',
}

SERVICES = [
    dict(
        slug="competitor-market-analysis", num="01", icon="analysis",
        title="Competitor &amp; Market Analysis",
        lead="Before anything is written or shot, we work out who already holds attention in your category and what is actually earning it for them. That tells us where the opening is.",
        items=[
            "Competitor audit across the platforms your audience actually uses",
            "Content teardown — formats, hooks, and posting cadence that perform",
            "Audience and demand research for your specific market",
            "Positioning gaps: what nobody in your category is claiming",
            "Pricing and offer comparison against direct competitors",
            "A written read of where you stand and what to do about it",
        ],
    ),
    dict(
        slug="media-buying", num="02", icon="target",
        title="Media Buying",
        lead="Paid campaigns run with budget accountability. We build the structure, launch it, and keep cutting what does not earn its spend.",
        items=[
            "Campaign architecture and audience targeting",
            "Creative testing — multiple angles per campaign",
            "Ongoing optimisation against cost per result",
            "Budget pacing and scaling decisions",
            "Catalogue and retargeting setup for e-commerce",
            "Plain-language reporting on what the spend returned",
        ],
    ),
    dict(
        slug="photography-reels", num="03", icon="camera",
        title="Photography &amp; Reels",
        lead="Product and lifestyle shoots produced for the feed, then cut for pacing, sound, colour, and motion — because a still that works on a shelf rarely works on a scroll.",
        items=[
            "Product, lifestyle, and campaign photography",
            "Reel and short-form video production",
            "Editing: pacing, sound design, colour, motion graphics",
            "Formats delivered per platform and aspect ratio",
            "Shot lists built from the content calendar",
            "Retouching and final delivery in usable formats",
        ],
    ),
    dict(
        slug="brand-identity", num="04", icon="palette",
        title="Brand &amp; Visual Identity",
        lead="The system that makes every post recognisably yours before anyone reads the handle — logo, colour, type, and the rules that hold it together.",
        items=[
            "Logo and wordmark design",
            "Colour system and typography",
            "Templates for recurring post formats",
            "Brand guidelines your whole team can apply",
            "Profile, highlight, and packaging assets",
            "Rollout across every channel you run",
        ],
    ),
    dict(
        slug="web-development", num="05", icon="code",
        title="Web Development",
        lead="Storefronts and brand sites built to load fast, read well on a phone, and turn the traffic your campaigns generate into orders.",
        items=[
            "E-commerce storefronts with full product catalogues",
            "Brand and campaign sites",
            "Mobile-first build — most of your traffic arrives on a phone",
            "Arabic and English, including right-to-left layouts",
            "Payment, shipping, and checkout integration",
            "Analytics and pixel setup wired to your ad accounts",
        ],
        # The showcase wheel on the page is built from this list, and so is the
        # plain card grid underneath it. One list, so the two cannot disagree.
        #
        #   name     what the segment and the card say
        #   kind     one line under the name. Left blank where nobody has
        #            written one yet -- the panel simply omits it.
        #   url      where "Visit website" goes
        #   preview  "live"  -> the real site loads in a sandboxed iframe
        #            "thumb" -> the site refuses to be framed; show `thumb`
        #   thumb    a real screenshot of that site, captured with a browser
        #            by tools/save_folio_shot.py. Never a stock image or a
        #            mock-up: it is a picture of the work or it is nothing.
        #
        # `preview` is measured, not guessed. Checked 11 Oct 2026 -- a site
        # sending X-Frame-Options or frame-ancestors cannot be embedded by
        # anyone, and no client-side code changes that. Re-check with:
        #   curl -sI <url> | grep -iE "x-frame-options|content-security-policy"
        # Some servers refuse HEAD; Valle needed a GET to answer at all.
        folio=[
            dict(name="ZREX", kind="Brand site and product catalogue",
                 url="https://zrexeg.com/",
                 preview="thumb", thumb="../assets/folio/zrex.jpg"),
            dict(name="Valle", kind="",
                 url="https://valle.myeasyorders.com/",
                 preview="thumb", thumb="../assets/folio/valle.jpg"),
            dict(name="InstaPro", kind="",
                 url="https://www.instapro.tech/",
                 preview="live", thumb="../assets/folio/instapro.jpg"),
            dict(name="Laro Cosmetics", kind="Cosmetics e-commerce storefront",
                 url="https://laro-cosmetics.com/",
                 preview="thumb", thumb="../assets/folio/laro-cosmetics.jpg"),
            dict(name="Iris", kind="Contemporary womenswear e-commerce",
                 url="https://iris-eg.org/",
                 preview="live", thumb="../assets/folio/iris.jpg"),
            dict(name="Saffa Fashion", kind="Fashion store, Arabic and English",
                 url="https://www.saffafashion.shop/",
                 preview="live", thumb="../assets/folio/saffa-fashion.jpg"),
            dict(name="Royal Watch", kind="Luxury watches, brand storefront",
                 url="https://royalwatch.art/en",
                 preview="live", thumb="../assets/folio/royal-watch.jpg"),

            # To add one: copy a line, capture its screenshot with
            #   python tools/save_folio_shot.py <slug>
            # and check its headers before setting preview="live". The wheel
            # divides itself by however many entries are here.
        ],
    ),
]

HEAD = """<!DOCTYPE html>
<!-- GENERATED by tools/build_services.py - do not edit by hand.
     Edit the SERVICES data in that script and re-run it. -->
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title_plain} — WeWave</title>
<meta name="description" content="{desc}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;500;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../css/service.css">
</head>
<body>

<header class="top">
  <div class="top-in">
    <a class="brand" href="../index.html">
      <span class="brand-mark" aria-hidden="true"></span>
      <span class="brand-word">WeWave</span>
    </a>
    <a class="back" href="../index.html#services">All services</a>
  </div>
</header>

<main>
<section class="hero">
  <svg class="hero-art" viewBox="0 0 48 48" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">{icon}</svg>
  <div class="wrap">
    <p class="eyebrow">Service {num}</p>
    <h1>{title}</h1>
    <p class="lead">{lead}</p>
  </div>
</section>

"""

INCLUDES = """<section>
  <div class="wrap">
    <p class="sec-label">What it includes</p>
    <ul class="includes">{items}</ul>
  </div>
</section>
"""

DASH = """
<section class="cs" data-cs>
  <div class="wrap">
    <p class="sec-label">{label}</p>
{panels}  </div>
</section>
"""

# One case study. The brand and the period live in here rather than in DASH
# because they change with the panel, and a head that kept saying "Valle"
# over Arlux's figures would be worse than no head at all.
PANEL = """    <div class="cs-panel" data-cs-panel="{id}">
      <div class="cs-head">
        <h2>{brand}</h2>{when}
      </div>
      <div class="cs-kpis">{kpis}</div>
{ratio}    </div>
"""

CASE_REAL = """
<section class="case">
  <div class="wrap">
    <p class="sec-label">Case study</p>
    <div class="case-head">
      <span class="case-client">{client}</span>
      <span class="case-window">{window}</span>
    </div>
    <h2>The numbers</h2>
    <p class="case-note">{note}</p>
    <div class="stats">{stats}</div>
    <figure class="shot">
      <img src="{shot}" alt="{shot_alt}" loading="lazy"
           onerror="this.closest('.shot').innerHTML='<p class=\\'shot-hint\\'>Screenshot slot<br>drop an image at {shot}</p>'">
    </figure>
  </div>
</section>
"""

CASE_SLOT = """
<section class="case">
  <div class="wrap">
    <p class="sec-label">Case study</p>
    <h2>Coming soon</h2>
    <p class="case-note">We have work to show here — it just is not written up yet. Ask us for examples in this area and we will walk you through them.</p>
    <div class="shot">
      <p class="shot-hint">Case study slot<br>add results and a screenshot at assets/cases/{slug}.png</p>
    </div>
  </div>
</section>
"""

SHOWCASE = """
<section class="showcase-sec" hidden>
  <div class="wrap">
    <p class="sec-label">Selected work</p>
    <h2>Our web development portfolio</h2>
    <p class="showcase-intro">Seven sites we have built. Move across the wheel to
      look inside each one — where a client's server allows it, their site loads
      here live. Where it does not, you get a shot of the real thing and a way
      straight there.</p>
    <div class="showcase" data-showcase>
      <div class="sc-wheel" data-sc-wheel></div>
      <div class="sc-panel" data-sc-panel hidden></div>
    </div>
  </div>
</section>
"""

FOLIO = """
<section>
  <div class="wrap">
    <p class="sec-label">Selected work</p>
    <h2>Sites we have built</h2>
    <div class="folio">{cards}</div>
  </div>
</section>
"""

TAIL = """
<section>
  <div class="wrap">
    <p class="sec-label">Other services</p>
    <div class="more-services">{others}</div>
  </div>
</section>

<section class="cta">
  <div class="wrap">
    <h2>Want this for your brand?</h2>
    <p>Tell us what you are building, launching, or rethinking — and we will tell you how WeWave moves it.</p>
    <a class="btn" href="mailto:wewavemarketing@gmail.com">Start a brief</a>
    <a class="btn ghost" href="../index.html">Back to site</a>
  </div>
</section>
</main>

<footer class="foot">
  <div class="foot-in">
    <span>&copy; {year} WeWave</span>
    <a href="https://instagram.com/wewaveagency" target="_blank" rel="noopener">Instagram</a>
  </div>
</footer>
{scripts}</body>
</html>
"""


def plain(s):
    return html.unescape(s)


def num(v):
    """Thousands separators, and no trailing .0 on a whole number."""
    if isinstance(v, float) and not v.is_integer():
        return f"{v:,.2f}"
    return f"{int(v):,}"


# One icon per figure, in the same stroke style as the service icons. The
# revenue and spend marks are banknotes rather than a dollar sign: these
# figures are in EGP, and a $ beside them invites exactly the misreading this
# page is built to avoid.
CS_ICON = {
    "roas": '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    "revenue": '<rect x="2" y="6" width="20" height="12" rx="2"/>'
               '<circle cx="12" cy="12" r="2.6"/><path d="M6 12h.01M18 12h.01"/>',
    "purchases": '<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/>'
                 '<path d="M2 3h3l2.3 11.1a1.8 1.8 0 0 0 1.8 1.4h8.3a1.8 1.8 0 0 0 1.8-1.4L21 7H6"/>',
    "spend": '<rect x="2.5" y="5.5" width="19" height="13" rx="2.5"/>'
             '<path d="M17 11h4v4h-4a2 2 0 0 1 0-4z"/>',
    "cpa": '<path d="M3 11.5V4a1 1 0 0 1 1-1h7.5a1 1 0 0 1 .7.3l8.5 8.5a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 12.2a1 1 0 0 1-.3-.7z"/>'
             '<circle cx="7.6" cy="7.6" r="1.3"/>',
    "aov": '<path d="M5 3h14v18l-2.3-1.6L14.4 21l-2.4-1.6L9.6 21l-2.3-1.6L5 21z"/>'
           '<path d="M9 8h6M9 12h6M9 16h3"/>',
}


def cs_icon(key):
    d = CS_ICON.get(key)
    if not d:
        return ""
    return ('<svg class="cs-i" viewBox="0 0 24 24" aria-hidden="true" fill="none" '
            'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" '
            f'stroke-linejoin="round">{d}</svg>')


def kpi(k, d, derived=False, hero=False):
    """One figure. `derived` ones are marked, because a number this page
    worked out itself is not the same promise as one the report states."""
    unit = f'<span class="cs-u">{d["unit"]}</span>' if d.get("unit") else ""
    tag = '<span class="cs-tag">derived</span>' if derived else ""
    # The value is in the HTML, not written in by script: the page has to read
    # correctly with no JavaScript, and the counter only animates up to it.
    return (
        f'<div class="cs-kpi{" is-derived" if derived else ""}{" is-hero" if hero else ""}">'
        f"{cs_icon(k)}"
        f'<div class="cs-v" data-count="{d["value"]}">{num(d["value"])}{unit}</div>'
        f'<div class="cs-k">{d["label"]}{tag}</div>'
        f'<div class="cs-s">{d.get("sub", "")}</div>'
        f"</div>"
    )


def ratio_bar(case):
    """Spend against what came back, drawn to scale.

    Only rendered when both figures exist. The bars are in true proportion --
    at 14.57x the spend bar really is that small, and shrinking the gap to
    make it look tidier would be a lie told in pixels.
    """
    r = case.get("reported", {})
    if not ("spend" in r and "revenue" in r):
        return ""
    spend, rev = r["spend"]["value"], r["revenue"]["value"]
    if not rev:
        return ""
    pct = max(spend / rev * 100, 0.6)      # a floor, or the bar is invisible
    return f'''
    <div class="cs-ratio">
      <div class="cs-row">
        <span class="cs-rl">Spent</span>
        <div class="cs-track"><i class="cs-fill is-spend" style="width:{pct:.2f}%"></i></div>
        <span class="cs-rv">{num(spend)} EGP</span>
      </div>
      <div class="cs-row">
        <span class="cs-rl">Returned</span>
        <div class="cs-track"><i class="cs-fill is-rev" style="width:100%"></i></div>
        <span class="cs-rv">{num(rev)} EGP</span>
      </div>
      <p class="cs-rn">Drawn to scale — the bars are in the same proportion as the figures.</p>
    </div>'''


# The order figures are read in, which is not the order they happen to sit in
# the data. It is fixed here so the headline is always the first card: Royal
# Watch's ROAS is divided out rather than reported, and left to dict order it
# would land last -- behind the two numbers it is the ratio of.
FIG_ORDER = ["roas", "revenue", "purchases", "spend", "cpa", "aov"]


def figures(case):
    """Every figure for one case, in reading order, each tagged with whether
    the report stated it or this build divided it out of what the report said.

    A reported figure always wins over a derivable one -- `derive` refuses to
    recompute anything already in `reported`, and `check` is what makes sure
    the two would have agreed anyway.
    """
    r = case.get("reported", {})
    d = derive(case)
    out = []
    for k in FIG_ORDER:
        if k in r:
            out.append((k, r[k], False))
        elif k in d:
            out.append((k, d[k], True))
    # anything outside the known order still gets drawn, after the rest
    out += [(k, v, False) for k, v in r.items() if k not in FIG_ORDER]
    out += [(k, v, True) for k, v in d.items() if k not in FIG_ORDER and k not in r]
    return out


def panel(case):
    """One case study's panel. Fields with nothing behind them are left out
    rather than printed empty: an account with no recorded reporting period
    should show no period, not a blank pill beside the brand name."""
    cells = "".join(
        kpi(k, d, derived, hero=(i == 0))
        for i, (k, d, derived) in enumerate(figures(case))
    )

    window = case.get("window", "")

    return PANEL.format(
        id=case["id"],
        brand=case["brand"],
        when=f'<span class="cs-when">{window}</span>' if window else "",
        kpis=cells,
        ratio=ratio_bar(case),
    )


def dashboard(cases):
    """The whole section, one panel per case study."""
    for case in cases:
        agree = check(case)
        if agree and not agree["agrees"]:
            raise SystemExit(
                f"{case['brand']}: reported ROAS {agree['stated']} does not match "
                f"revenue / spend = {agree['computed']}. Fix the data, do not publish it."
            )

    # Every case study is on the page, one under the next. They were behind a
    # tab strip once and two of the three went unfound -- by the owner of the
    # site, on his own page. Scrolling is the one navigation nobody misses, so
    # the section uses it and offers no control at all.
    return DASH.format(
        label="Case studies" if len(cases) > 1 else "Case study",
        panels="".join(panel(c) for c in cases),
    )


def build(svc, others):
    items = "".join(f"<li>{i}</li>" for i in svc["items"])

    body = HEAD.format(
        title_plain=plain(svc["title"]),
        desc=plain(svc["lead"])[:150],
        icon=ICON[svc["icon"]],
        num=svc["num"],
        title=svc["title"],
        lead=svc["lead"],
    )

    # A page with the showcase wheel leads with the work itself. The bullet
    # list and the case-study block both sat between the hero and the wheel,
    # pushing it below the fold and saying less than it does. Pages without a
    # wheel keep both -- without them there would be nothing left on the page.
    wheel_page = bool(svc.get("folio"))
    if not wheel_page:
        body += INCLUDES.format(items=items)

    cases = [c for c in CASES if c.get("service") == svc["slug"]] or (
        CASES if svc["slug"] == "media-buying" else []
    )

    if wheel_page:
        pass                      # the wheel is the case study
    elif cases:
        body += dashboard(cases)
        scripts_extra = True
    elif svc.get("case"):
        c = svc["case"]
        stats = "".join(
            f'<div class="stat"><div class="stat-v">{v}</div>'
            f'<div class="stat-k">{k}</div><div class="stat-sub">{s}</div></div>'
            for v, k, s in c["stats"]
        )
        body += CASE_REAL.format(
            client=c["client"], window=c["window"], note=c["note"],
            stats=stats, shot=c["shot"], shot_alt=c["shot_alt"],
        )
    else:
        body += CASE_SLOT.format(slug=svc["slug"])

    if svc.get("folio"):
        # Each card carries its own preview settings. The wheel reads them off
        # these elements, so there is no second copy of the data to drift.
        cards = "".join(
            f'<a href="{f["url"]}" target="_blank" rel="noopener"'
            f' data-preview="{f.get("preview", "thumb")}"'
            f' data-thumb="{f.get("thumb", "")}">'
            f'<span class="folio-name">{f["name"]}</span>'
            f'<span class="folio-kind">{f["kind"]}</span>'
            f'<span class="folio-url">'
            f'{f["url"].replace("https://", "").replace("http://", "").rstrip("/")}'
            f'</span></a>'
            for f in svc["folio"]
        )
        body += SHOWCASE + FOLIO.format(cards=cards)

    links = "".join(
        f'<a href="{o["slug"]}.html">{plain(o["title"])}</a>' for o in others
    )
    # Every page carries the collector. It shipped on index.html only, so a
    # visit to a service page -- including one that landed there straight from
    # an ad -- produced no session and no page view at all, and the dashboard's
    # per-page figures were blank by construction rather than by traffic.
    # The collector no-ops cleanly here: the stage engine, the booking modal
    # and the service cards it watches for are all absent from these pages.
    scripts = '<script src="../js/analytics.js" defer></script>\n'
    scripts += (
        '<script src="../js/showcase.js" defer></script>\n'
        if svc.get("folio") else ""
    )
    if cases:
        scripts += '<script src="../js/casestudy.js" defer></script>\n'
    body += TAIL.format(others=links, year=2026, scripts=scripts)

    path = OUT / f"{svc['slug']}.html"
    path.write_text(body, encoding="utf-8")
    return path


if __name__ == "__main__":
    (ROOT / "assets" / "cases").mkdir(parents=True, exist_ok=True)
    for svc in SERVICES:
        others = [o for o in SERVICES if o["slug"] != svc["slug"]]
        p = build(svc, others)
        n = len([c for c in CASES if c.get("service") == svc["slug"]] or
                (CASES if svc["slug"] == "media-buying" else []))
        tag = (f"{n} case stud" + ("y" if n == 1 else "ies")) if n else (
            "wheel" if svc.get("folio") else
            "case study" if svc.get("case") else "slot")
        print(f"  {p.relative_to(ROOT).as_posix():46s} ({tag})")
    print(f"\n{len(SERVICES)} pages -> {OUT.relative_to(ROOT).as_posix()}/")
