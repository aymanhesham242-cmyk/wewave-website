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
        case=dict(
            client="Velora", window="13 Jul – 4 Aug 2026",
            note="A sales-focused build across six campaigns, weighted toward the structures that were already converting and scaled through CBO once the winners were clear. Every figure below is taken directly from the account's reporting for the period.",
            stats=[
                ("14.57×", "Purchase ROAS", "average across campaigns"),
                ("357,777", "EGP returned", "attributed website value"),
                ("514", "Purchases", "in the period"),
                ("24,561", "EGP spent", "total media spend"),
            ],
            shot="../assets/cases/velora-media-buying.png",
            shot_alt="Velora campaign results in Meta Ads Manager",
        ),
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
        #   kind     one line under the name
        #   url      where "Visit website" goes
        #   preview  "live"  -> the real site loads in a sandboxed iframe
        #            "thumb" -> the site refuses to be framed; show `thumb`
        #   thumb    optional still, e.g. "../assets/folio/laro.jpg".
        #            Left empty, the panel shows a clean host-and-reason card
        #            rather than a broken image.
        #
        # `preview` is not a guess. Checked against each server's headers on
        # 11 Oct 2026 -- a site sending X-Frame-Options or frame-ancestors
        # cannot be embedded by anyone, and no amount of client code changes
        # that. Re-check with:
        #   curl -sI <url> | grep -iE "x-frame-options|content-security-policy"
        folio=[
            dict(name="Laro Cosmetics", kind="Cosmetics e-commerce storefront",
                 url="https://laro-cosmetics.com", preview="thumb", thumb=""),
            dict(name="Saffa Fashion", kind="Fashion store, Arabic and English",
                 url="https://www.saffafashion.shop", preview="live", thumb=""),
            dict(name="Zrex", kind="Brand site and product catalogue",
                 url="https://zrexeg.com", preview="thumb", thumb=""),
            dict(name="Royal Watch", kind="Luxury watches, brand storefront",
                 url="https://royalwatch.art/", preview="live", thumb=""),

            # IRIS is out until its domain comes back. iris-eg.net stopped
            # resolving -- not a timeout, no DNS record at all -- so the link
            # that used to sit here led nowhere. Uncomment when it returns.
            # dict(name="IRIS", kind="Contemporary womenswear e-commerce",
            #      url="https://iris-eg.net/", preview="thumb", thumb=""),

            # To add one, copy a line above. The wheel divides itself evenly
            # by however many entries are here, so nothing else needs editing.
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

<section>
  <div class="wrap">
    <p class="sec-label">What it includes</p>
    <ul class="includes">{items}</ul>
  </div>
</section>
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
<section class="showcase-sec">
  <div class="wrap">
    <p class="sec-label">Explore the work</p>
    <h2>Every site, one turn away</h2>
    <p class="showcase-intro">Open the wheel and move across it. Where a client's
      server allows it, their site loads here live — not a screenshot of one.
      Where it does not, you get the next best thing and a way straight there.</p>
    <div class="showcase" data-showcase hidden>
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


def build(svc, others):
    items = "".join(f"<li>{i}</li>" for i in svc["items"])

    body = HEAD.format(
        title_plain=plain(svc["title"]),
        desc=plain(svc["lead"])[:150],
        icon=ICON[svc["icon"]],
        num=svc["num"],
        title=svc["title"],
        lead=svc["lead"],
        items=items,
    )

    if svc.get("case"):
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
    scripts = (
        '<script src="../js/showcase.js" defer></script>\n'
        if svc.get("folio") else ""
    )
    body += TAIL.format(others=links, year=2026, scripts=scripts)

    path = OUT / f"{svc['slug']}.html"
    path.write_text(body, encoding="utf-8")
    return path


if __name__ == "__main__":
    (ROOT / "assets" / "cases").mkdir(parents=True, exist_ok=True)
    for svc in SERVICES:
        others = [o for o in SERVICES if o["slug"] != svc["slug"]]
        p = build(svc, others)
        tag = "case study" if svc.get("case") else "slot"
        print(f"  {p.relative_to(ROOT).as_posix():46s} ({tag})")
    print(f"\n{len(SERVICES)} pages -> {OUT.relative_to(ROOT).as_posix()}/")
