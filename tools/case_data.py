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

Every field below is optional except `id`, `brand` and `reported`. Add a
second case study by appending another dict -- the page picks up the selector
and the switching on its own.

    id          slug, used for anchors and the selector
    brand       display name
    industry    e.g. "E-commerce"            (omit if undocumented)
    objective   e.g. "Sales"                 (omit if undocumented)
    window      the reporting period, as written in the report
    note        how the account was actually run, in plain language
    source      where the figures come from, shown to the visitor
    attribution "platform" or "verified" -- platform means the ad platform
                reported it, which is not the same as audited revenue, and
                the page says so
    reported    the figures as the report gives them. key -> dict of
                value / unit / label / sub
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
        id="velora",
        brand="Velora",
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
]


def derive(case):
    """Figures that follow arithmetically from the reported ones.

    Only ever division between two numbers the report already states, so
    nothing here is an estimate. Anything whose inputs are missing is simply
    not returned, and a zero denominator returns nothing rather than an
    infinity dressed up as a result.
    """
    r = case.get("reported", {})

    def val(k):
        v = r.get(k)
        return v["value"] if v and isinstance(v.get("value"), (int, float)) else None

    spend, revenue, purchases = val("spend"), val("revenue"), val("purchases")
    out = {}

    if spend is not None and purchases:
        out["cpa"] = dict(value=round(spend / purchases, 2), unit="EGP",
                          label="Cost per purchase",
                          sub="spend / purchases", formula="spend / purchases")
    if revenue is not None and purchases:
        out["aov"] = dict(value=round(revenue / purchases, 2), unit="EGP",
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
