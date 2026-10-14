"""
The portfolio. Every entry here points at a real file produced for a real
client, and nothing in it is decorative.

THE RULE FOR THIS FILE, same as case_data.py: say only what the work itself
shows. A tile may carry the brand, what the piece is, and what was delivered.
It may not carry invented results, invented objectives, invented testimonials,
or a client name we are not showing work for. Where a brand has verified
numbers they live in `tools/case_data.py` and the brand links to that page --
they are never retyped here, so the two can never disagree.

Adding work is a data change:

  1. drop the file in ~/Downloads (or edit SOURCES in build_work_assets.py)
  2. map it to a slug there, run `python tools/build_work_assets.py`
  3. add an entry below, run `python tools/build_work.py`

    slug      matches assets/work/<slug>.webp and <slug>-t.webp
    brand     key into BRANDS
    title     what the piece is. Not a slogan
    cat       one of CATEGORIES
    span      column span on the desktop grid, for rhythm. 2 is the default
    alt       a real description, for screen readers and for a failed load
"""

CATEGORIES = [
    ("all",      "All work"),
    ("creative", "Campaign creative"),
    ("product",  "Product photography"),
    ("web",      "Web development"),
]

BRANDS = {
    "laro": dict(
        name="LARO Cosmetics",
        kind="Beauty & personal care",
        site="https://laro-cosmetics.com/",
        blurb=(
            "A pink-world beauty range — body splashes, dry oils, tints and "
            "scented lotions. We shoot the products and build the campaign "
            "creative around them, in the feed and banner formats the ad "
            "accounts actually run."
        ),
        delivers=["Product photography", "Campaign creative",
                  "Feed and banner adaptation", "Art direction"],
    ),
    "iris": dict(
        name="IRIS",
        kind="Fashion — quiet luxury, softly worn",
        site="https://iris-eg.org/",
        blurb=(
            "An essentials label built on one garment done properly. The "
            "campaign had to carry a bodysuit in three colourways across "
            "portrait and wide placements without ever looking like a "
            "catalogue page."
        ),
        delivers=["Campaign creative", "Art direction",
                  "Multi-format adaptation", "Editorial typography"],
    ),
    "arlux": dict(
        name="Arlux",
        kind="Lighting & interiors",
        site="",
        # The only brand here with published figures, and they are not
        # repeated -- the link goes to the page that owns them.
        case="../services/media-buying",
        case_label="See the media buying case study",
        blurb=(
            "The Bamboo Aura collection — woven pendants shot in the rooms "
            "they are meant to light. Warm, dark, and built so the light "
            "itself is the subject."
        ),
        delivers=["Product creative", "Collection art direction",
                  "Media buying"],
    ),
    "clients": dict(
        name="Client storefronts",
        kind="Web design & development",
        site="",
        blurb=(
            "Storefronts and brand sites built to load fast on a phone and "
            "turn campaign traffic into orders. Arabic and English, including "
            "right-to-left layouts."
        ),
        delivers=["E-commerce build", "Mobile-first front end",
                  "Payment and shipping integration", "Analytics and pixels"],
    ),
}

WORK = [
    # ---------------------------------------------------- IRIS, campaign
    dict(slug="iris-white-bodysuit", brand="iris", cat="creative", span=3,
         title="The White Bodysuit", featured=True,
         alt="IRIS campaign image: a model in a white bodysuit reaching toward "
             "the camera under hard sun, with the headline The White Bodysuit."),
    dict(slug="iris-black-bodysuit", brand="iris", cat="creative", span=3,
         title="The Black Bodysuit",
         alt="IRIS campaign image: a model in a black bodysuit on a rocky "
             "shoreline at golden hour, headline The Black Bodysuit."),
    dict(slug="iris-essentials", brand="iris", cat="creative", span=2,
         title="The Essentials, Made Different",
         alt="IRIS colourway line-up: three models in black, beige and white "
             "bodysuits against matching colour panels."),
    dict(slug="iris-own-everyday", brand="iris", cat="creative", span=6,
         title="Own Your Everyday — wide placement",
         alt="IRIS wide banner: two models against a blue sky with the "
             "headline Own Your Everyday and an Available Now button."),
    dict(slug="iris-everyday-better", brand="iris", cat="creative", span=6,
         title="Everyday, But Better — wide placement",
         alt="IRIS wide banner: two models shot from below against a blue sky "
             "with the headline Everyday, But Better."),
    dict(slug="iris-campaign-board", brand="iris", cat="creative", span=2,
         title="Campaign board",
         alt="The full IRIS campaign laid out as one board: two wide banners "
             "and three portrait creatives together."),

    # ------------------------------------------- LARO, campaign creative
    dict(slug="laro-your-glow", brand="laro", cat="creative", span=3,
         title="Your Skin, Your Glow", featured=True,
         alt="LARO campaign image: a model holding the Marshmallow Musk serum "
             "beside her face, headline Your Skin, Your Glow."),
    dict(slug="laro-but-brighter", brand="laro", cat="creative", span=2,
         title="Your Skin, But Brighter",
         alt="LARO campaign image: the Sparkle body dry oil held against pink "
             "satin, headline Your Skin, But Brighter."),
    dict(slug="laro-shimmer-night", brand="laro", cat="creative", span=2,
         title="Shimmer Into The Night",
         alt="LARO campaign image: the Night Shimmer body splash held at the "
             "shoulder, headline Shimmer Into The Night."),
    dict(slug="laro-reveal-banner", brand="laro", cat="creative", span=6,
         title="Reveal Your Natural Glow — wide placement",
         alt="LARO wide banner: a torn-paper reveal across a model's face "
             "between grey and colour, headline Reveal Your Natural Glow."),
    dict(slug="laro-skin-glow-banner", brand="laro", cat="creative", span=6,
         title="Let Your Skin Glow — wide placement",
         alt="LARO wide banner: a model touching her cheek against pink "
             "arches, headline Let Your Skin Glow."),
    dict(slug="laro-campaign-board", brand="laro", cat="creative", span=2,
         title="Campaign board",
         alt="The full LARO campaign laid out as one board: wide banners and "
             "three product creatives together."),

    # ------------------------------------------ LARO, product photography
    dict(slug="laro-body-splash", brand="laro", cat="product", span=2,
         title="Night Shimmer body splash",
         alt="Product photograph: the marbled Night Shimmer body splash held "
             "in two hands against a pink arch, rose petals on the ledge."),
    dict(slug="laro-sparkle-oil", brand="laro", cat="product", span=2,
         title="Sparkle body dry oil",
         alt="Product photograph: the pink Sparkle body dry oil bottle on "
             "pink satin."),
    dict(slug="laro-tint-pots", brand="laro", cat="product", span=2,
         title="Lip and cheek tint",
         alt="Product photograph: an open red lip and cheek tint pot with its "
             "applicator, reflected on a glossy surface."),
    dict(slug="laro-candy-glow-lotion", brand="laro", cat="product", span=2,
         title="Candy Glow body lotion",
         alt="Product photograph: the Candy Glow scented body lotion pump "
             "bottle against pink fabric."),
    dict(slug="laro-candy-heavenly-duo", brand="laro", cat="product", span=2,
         title="Candy Glow and Heavenly",
         alt="Product photograph: the Candy Glow and Heavenly body splashes "
             "side by side on a stone ledge."),

    # ------------------------------------------- Arlux, Bamboo Aura
    dict(slug="arlux-bamboo-bliss", brand="arlux", cat="product", span=3,
         title="Bamboo Bliss", featured=True,
         alt="Arlux lighting: the Bamboo Bliss woven pendant lit from within "
             "against a dark wall."),
    dict(slug="arlux-boho-beam", brand="arlux", cat="product", span=2,
         title="Boho Beam",
         alt="Arlux lighting: the Boho Beam flat woven pendant above a warm "
             "interior with a palm leaf."),
    dict(slug="arlux-lumicane", brand="arlux", cat="product", span=3,
         title="LumiCane",
         alt="Arlux lighting: three LumiCane cane pendants over a sofa in a "
             "dim living room."),
    dict(slug="arlux-solara-weave", brand="arlux", cat="product", span=2,
         title="Solara Weave",
         alt="Arlux lighting: the Solara Weave pendant glowing against a warm "
             "textured wall."),
    dict(slug="arlux-terralume", brand="arlux", cat="product", span=2,
         title="TerraLume",
         alt="Arlux lighting: the TerraLume tiered pendant lit in a dark "
             "room beside a plant."),

    # ------------------------------------------------- client storefronts
    dict(slug="site-zrex", brand="clients", cat="web", span=3,
         title="ZREX", link="https://zrexeg.com/",
         alt="Screenshot of the ZREX storefront."),
    dict(slug="site-laro-cosmetics", brand="clients", cat="web", span=3,
         title="LARO Cosmetics", link="https://laro-cosmetics.com/",
         alt="Screenshot of the LARO Cosmetics storefront."),
    dict(slug="site-iris", brand="clients", cat="web", span=3,
         title="IRIS", link="https://iris-eg.org/",
         alt="Screenshot of the IRIS storefront."),
    dict(slug="site-royal-watch", brand="clients", cat="web", span=3,
         title="Royal Watch", link="https://royalwatch.art/en",
         alt="Screenshot of the Royal Watch storefront."),
    dict(slug="site-valle", brand="clients", cat="web", span=2,
         title="Valle", link="https://valle.myeasyorders.com/",
         alt="Screenshot of the Valle storefront."),
    dict(slug="site-instapro", brand="clients", cat="web", span=2,
         title="InstaPro", link="https://www.instapro.tech/",
         alt="Screenshot of the InstaPro site."),
    dict(slug="site-saffa-fashion", brand="clients", cat="web", span=2,
         title="Saffa Fashion", link="https://www.saffafashion.shop/",
         alt="Screenshot of the Saffa Fashion storefront."),
]

# Brands given a block of their own under the grid, in this order. A brand
# only earns one when there is enough real work and real context to fill it.
FEATURED = ["laro", "iris", "arlux", "clients"]


def by_cat(cat):
    return [w for w in WORK if cat == "all" or w["cat"] == cat]


def counts():
    return {key: len(by_cat(key)) for key, _ in CATEGORIES}
