"""
Case study data for the media buying dashboard.

THE RULE FOR THIS FILE: every number in it comes from a client's account
reporting and nothing else. Not an estimate, not a round-up, not a figure
borrowed from a similar brand, and above all not anything produced by
/admin/case-studies -- that tool builds *hypothetical* Meta-Ads-shaped
figures for presentations and its output must never appear on a public page.
If a field has no evidence behind it, leave it out. The renderer draws what
is here and silently omits the rest, so an empty field costs nothing and an
invented one costs the agency's credibility.

That applies to prose as much as to numbers. `note` describes how an account
was actually run; a case with no documented story leaves it out rather than
carrying a plausible-sounding one.

Every field below is optional except `id`, `brand` and `reported`. Add a
further case study by appending another dict -- the page picks up the
selector and the switching on its own.

    id          slug, used for anchors and the selector
    brand       display name
    industry    e.g. "E-commerce"            (omit if undocumented)
    objective   e.g. "Sales"                 (omit if undocumented)
    window      the reporting period, as written in the report (omit if not
                recorded -- the page then says so rather than guessing)
    note        how the account was actually run, in plain language
    source      where the figures come from, shown to the visitor
    attribution "platform" or "verified" -- platform means the ad platform
                reported it, which is not the same as audited revenue, and
                the page says so
    reported    the figures as the report gives them. key -> dict of
                value / unit / label / sub. Anything not in here that can be
                divided out of what is gets drawn as a *derived* figure,
                visibly marked as such.
    series      optional time series: list of {date, spend, revenue, ...}.
                With none present the timeline charts are simply not drawn
                rather than drawn empty.
    stages      optional campaign story, list of {title, body}
    creative    optional list of documented creative/audience tests
    shot        optional screenshot path, relative to services/
    limits      anything a reader needs in order not to over-read the numbers
"""

CASES = [
    dict(
        id="valle",
        brand="Valle",
        window="13 Jul – 4 Aug 2026",
        source="Meta Ads Manager, account reporting for the period",
        attribution="platform",
        note=(
            "A sales-focused build across six campaigns, weighted toward the "
            "structures that were already converting and scaled through CBO "
            "once the winners were clear. Every figure here is taken directly "
            "from the account's reporting for the period."
        ),
        # Exactly the four figures the report gives. `roas` is reported rather
        # than derived -- the account states it, and 357,777 / 24,561 = 14.5669
        # confirms it agrees with the spend and revenue beside it.
        reported=dict(
            roas=dict(value=14.57, unit="x", label="Purchase ROAS",
                      sub="average across campaigns"),
            revenue=dict(value=357777, unit="EGP", label="Revenue returned",
                         sub="attributed website value"),
            purchases=dict(value=514, unit="", label="Purchases",
                           sub="in the period"),
            spend=dict(value=24561, unit="EGP", label="Media spend",
                       sub="total for the period"),
        ),
        limits=(
            "Revenue is the value Meta attributed to these campaigns over the "
            "reporting window, not audited business revenue, and it carries "
            "the ad account's own attribution settings. It covers paid media "
            "only — organic and returning-customer sales are not in it."
        ),
        # Not supplied yet, so not drawn: `series`, `stages`, `creative`,
        # `industry`, `objective`, `shot`. See README for what each needs.
    ),

    dict(
        id="royal-watch",
        brand="Royal Watch",
        source="Account reporting, supplied by the WeWave media buying team",
        attribution="platform",
        # Spend, revenue and orders as reported. ROAS, cost per purchase and
        # average order value are all left for `derive` to divide out, so the
        # page marks them as this file's arithmetic rather than the account's
        # claims. They land on 9x / 500 EGP / 4,500 EGP.
        #
        # Purchases: the account was reported as "more than 80 orders" without
        # an exact count, and 80 is the figure that reconciles with the stated
        # 4,500 EGP average order value (360,000 / 4,500 = 80 exactly). The
        # lower bound is used, and `limits` says so.
        reported=dict(
            revenue=dict(value=360000, unit="EGP", label="Revenue returned",
                         sub="attributed sales value"),
            purchases=dict(value=80, unit="", label="Purchases",
                           sub="reported as 80+; the lower bound is used"),
            spend=dict(value=40000, unit="EGP", label="Media spend",
                       sub="total for the period"),
        ),
        limits=(
            "No reporting period has been recorded for this account yet, so "
            "the figures are a total rather than a rate. Orders were reported "
            "as more than 80 without an exact count; 80 is used because it is "
            "the lower bound and the only figure that reconciles with the "
            "4,500 EGP average order value stated with it. Revenue is "
            "platform-attributed, not audited business revenue."
        ),
    ),

    dict(
        id="arlux",
        brand="Arlux",
        source="Account reporting, supplied by the WeWave media buying team",
        attribution="platform",
        # Only two figures exist for this account: sales and orders. No media
        # spend has been recorded, so purchase ROAS and cost per purchase
        # cannot be worked out and are not drawn -- there is no honest way to
        # produce them from what is here, and the dashboard is built to show
        # three figures rather than invent a fourth.
        #
        # Average order value is left to `derive`: 265,000 / 36 = 7,361.11.
        # The account was quoted as roughly 7,300, which is this rounded.
        reported=dict(
            revenue=dict(value=265000, unit="EGP", label="Revenue returned",
                         sub="attributed sales value"),
            purchases=dict(value=36, unit="", label="Purchases",
                           sub="total orders"),
        ),
        limits=(
            "No media spend and no reporting period have been recorded for "
            "this account, so purchase ROAS and cost per purchase are not "
            "shown — there is nothing to divide. The average order value is "
            "this page's own arithmetic on the two figures beside it. Revenue "
            "is platform-attributed, not audited business revenue."
        ),
    ),
]


def tidy(x):
    """Round to two places, and drop a trailing .0 so a whole number stays
    whole. 9.0 should reach the page as 9, not as 9.00."""
    v = round(x, 2)
    return int(v) if float(v).is_integer() else v


def derive(case):
    """Figures that follow arithmetically from the reported ones.

    Only ever division between two numbers the report already states, so
    nothing here is an estimate. Anything whose inputs are missing is simply
    not returned, and a zero denominator returns nothing rather than an
    infinity dressed up as a result. A figure the report states itself is
    never recomputed -- `reported` wins, and `check` makes sure the two agree.
    """
    r = case.get("reported", {})

    def val(k):
        v = r.get(k)
        return v["value"] if v and isinstance(v.get("value"), (int, float)) else None

    spend, revenue, purchases = val("spend"), val("revenue"), val("purchases")
    out = {}

    if "roas" not in r and spend and revenue is not None:
        out["roas"] = dict(value=tidy(revenue / spend), unit="x",
                           label="Purchase ROAS",
                           sub="revenue / spend", formula="revenue / spend")
    if "cpa" not in r and spend is not None and purchases:
        out["cpa"] = dict(value=tidy(spend / purchases), unit="EGP",
                          label="Cost per purchase",
                          sub="spend / purchases", formula="spend / purchases")
    if "aov" not in r and revenue is not None and purchases:
        out["aov"] = dict(value=tidy(revenue / purchases), unit="EGP",
                          label="Average order value",
                          sub="revenue / purchases", formula="revenue / purchases")
    return out


def check(case):
    """Does the report agree with itself?

    Where a case states ROAS *and* the spend and revenue behind it, the three
    have to reconcile. A case that fails this is a transcription error, and it
    is better for the build to say so than for the page to publish it.
    """
    r = case.get("reported", {})
    if not all(k in r for k in ("roas", "revenue", "spend")):
        return None
    spend = r["spend"]["value"]
    if not spend:
        return None
    computed = r["revenue"]["value"] / spend
    stated = r["roas"]["value"]
    return dict(stated=stated, computed=round(computed, 4),
                agrees=abs(computed - stated) < 0.01)
