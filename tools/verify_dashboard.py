"""
Verify every figure the analytics dashboard shows against the rows behind it.

The point of this file is independence. It does not re-run the Worker's SQL and
check that SQL agrees with itself. It pulls the raw `a_event` and `a_session`
rows out of D1 once, recomputes every metric in plain Python from the documented
definition, and compares that with what `/api/a/*` returns. A disagreement means
one of the two is wrong, and either way it is worth knowing.

Run it against a local Worker whose database holds whatever data you want to
check -- an empty one, a seeded one, or a snapshot of production:

    npx wrangler dev --local --port 8899
    python tools/verify_dashboard.py

The admin token is read from .dev.vars and never printed.
"""
import json
import pathlib
import subprocess
import sys
import urllib.error
import urllib.request
from collections import Counter, defaultdict

BASE = "http://127.0.0.1:8899"
ROOT = pathlib.Path(__file__).resolve().parent.parent
DAYS = int(sys.argv[1]) if len(sys.argv) > 1 else 90
TEST = 1 if (len(sys.argv) > 2 and sys.argv[2] == "test") else 0

rows_out = []
ok_n = bad_n = 0


def token():
    f = ROOT / ".dev.vars"
    if not f.exists():
        return ""
    for line in f.read_text(encoding="utf-8").splitlines():
        if line.strip().startswith("ADMIN_TOKEN="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    return ""


TOKEN = token()


def api(path):
    sep = "&" if "?" in path else "?"
    url = f"{BASE}{path}{sep}days={DAYS}&test={TEST}"
    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + TOKEN})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def sql(query):
    p = subprocess.run(
        ["npx", "wrangler", "d1", "execute", "wewave-meetings", "--local",
         "--json", "--command", query],
        cwd=ROOT, capture_output=True, text=True, shell=True)
    out = p.stdout
    return json.loads(out[out.index("["):])[0]["results"]


def near(a, b, tol=0.01):
    if a is None or b is None:
        return a == b
    return abs(float(a) - float(b)) <= tol


def row(component, source, expected, actual, ok):
    global ok_n, bad_n
    ok_n, bad_n = ok_n + (1 if ok else 0), bad_n + (0 if ok else 1)
    rows_out.append((component, source, str(expected), str(actual), "PASS" if ok else "FAIL"))
    print(f"  {'PASS' if ok else 'FAIL'}  {component:38s} expected {str(expected)[:28]:28s} got {str(actual)[:28]}")


# ------------------------------------------------- the raw rows, fetched once
print(f"reading rows (window = last {DAYS} days, is_test = {TEST}) ...")
ov = api("/api/a/overview")
FROM, TO = ov["range"]["from"], ov["range"]["to"]

EV = sql(f"SELECT ts, session_id, type, path, section, element, label, x, y, scroll, "
         f"device, browser, os, country FROM a_event "
         f"WHERE is_test={TEST} AND ts BETWEEN {FROM} AND {TO}")
SE = sql(f"SELECT id, started_at, last_at, engaged_ms, pageviews, events, interactions, "
         f"max_scroll, device, browser, os, country, vw, vh, ref_source, utm_source, "
         f"utm_medium, utm_campaign, utm_content, utm_term, entry_path, exit_path "
         f"FROM a_session WHERE is_test={TEST} AND started_at BETWEEN {FROM} AND {TO}")
print(f"  {len(EV)} events, {len(SE)} sessions in window\n")

INTERACTION = {'CLICK', 'TOUCH', 'CTA_CLICK', 'NAVIGATION_CLICK', 'LOGO_CLICK',
               'EXTERNAL_LINK_CLICK', 'SERVICE_VIEW', 'MEETING_MODAL_OPEN',
               'MEETING_FORM_START', 'MEETING_FORM_SUBMIT'}
CLICKY = ['CLICK', 'CTA_CLICK', 'NAVIGATION_CLICK', 'LOGO_CLICK', 'EXTERNAL_LINK_CLICK']


def avg(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else 0


def sessions_with(ev_type, section=None):
    return len({e["session_id"] for e in EV if e["type"] == ev_type
                and (section is None or e["section"] == section)})


# ============================================================ OVERVIEW
print("OVERVIEW")
k = ov["kpi"]
row("Unique sessions", "a_session COUNT", len(SE), k["sessions"], len(SE) == k["sessions"])

pv_sessions = sum(s["pageviews"] or 0 for s in SE)
pv_events = sum(1 for e in EV if e["type"] == "PAGE_VIEW")
iv_sessions = sum(s["interactions"] or 0 for s in SE)
iv_events = sum(1 for e in EV if e["type"] in INTERACTION)

row("Page views", "COUNT(PAGE_VIEW rows)", pv_events, k["pageviews"], pv_events == k["pageviews"])
row("Interactions", "COUNT(interaction rows)", iv_events, k["interactions"], iv_events == k["interactions"])

# Data integrity, not code correctness. The denormalised per-session counters
# should describe the same rows. Where they do not, the data was written by a
# build that let a session and its events disagree about being test traffic --
# see C1. New rows cannot drift; old ones need a repair.
row("Integrity: session pageview counters", "SUM(a_session.pageviews) vs rows",
    pv_events, pv_sessions, pv_events == pv_sessions)
row("Integrity: session interaction counters", "SUM(a_session.interactions) vs rows",
    iv_events, iv_sessions, iv_events == iv_sessions)

exp = avg([s["engaged_ms"] / 1000 for s in SE if (s["engaged_ms"] or 0) > 0])
row("Avg engaged time (s)", "AVG(engaged_ms) where > 0", round(exp, 2), round(k["avgSeconds"], 2),
    near(exp, k["avgSeconds"]))

exp = avg([(s["last_at"] - s["started_at"]) / 1000 for s in SE if s["last_at"] > s["started_at"]])
row("Avg tab-open span (s)", "AVG(last_at - started_at)", round(exp, 2), round(k["avgSpan"], 2),
    near(exp, k["avgSpan"]))

exp = avg([s["max_scroll"] for s in SE])
row("Avg scroll depth", "AVG(a_session.max_scroll)", round(exp, 2), round(k["avgScroll"], 2),
    near(exp, k["avgScroll"]))

exp = sum(1 for e in EV if e["type"] == "CTA_CLICK")
row("CTA clicks", "COUNT(CTA_CLICK)", exp, k["ctaClicks"], exp == k["ctaClicks"])

exp = sessions_with("MEETING_FORM_SUBMIT")
row("Meeting requests", "DISTINCT sessions w/ submit", exp, k["meetingRequests"], exp == k["meetingRequests"])

exp = (exp / len(SE)) if SE else 0
row("Conversion rate", "submits / sessions", round(exp, 4), round(k["conversionRate"], 4), near(exp, k["conversionRate"], 1e-6))

bounced = sum(1 for s in SE if (s["interactions"] or 0) == 0 and (s["engaged_ms"] or 0) < 10000)
exp = (bounced / len(SE)) if SE else 0
row("Bounce rate", "no interaction & <10s engaged", round(exp, 4), round(k["bounceRate"], 4), near(exp, k["bounceRate"], 1e-6))

# trend: sessions per UTC calendar day
import datetime
days = Counter(datetime.datetime.fromtimestamp(s["started_at"] / 1000, datetime.timezone.utc)
               .strftime("%Y-%m-%d") for s in SE)
api_days = {r["day"]: r["sessions"] for r in ov["trend"]}
row("Trend: number of days", "GROUP BY UTC day", len(days), len(api_days), len(days) == len(api_days))
row("Trend: per-day counts", "sessions per UTC day", dict(sorted(days.items())) == api_days and "match" or "differ",
    "match" if dict(sorted(days.items())) == api_days else str(api_days)[:28],
    dict(sorted(days.items())) == api_days)
row("Trend: sums to total", "sum(buckets) == sessions", len(SE), sum(api_days.values()), sum(api_days.values()) == len(SE))

dev = Counter(s["device"] or "unknown" for s in SE)
api_dev = {r["device"]: r["n"] for r in ov["devices"]}
row("Overview devices", "a_session GROUP BY device", dict(dev), api_dev, dict(dev) == api_dev)

src = Counter(s["ref_source"] or "direct" for s in SE)
api_src = {r["source"]: r["sessions"] for r in ov["sources"]}
row("Overview sources", "a_session GROUP BY ref_source", dict(src), api_src, dict(src) == api_src)

pv_by_path = Counter(e["path"] or "/" for e in EV if e["type"] == "PAGE_VIEW")
api_pages = {r["path"]: r["views"] for r in ov["pages"]}
row("Overview top pages", "COUNT(PAGE_VIEW) GROUP BY path",
    dict(pv_by_path.most_common(5)), dict(list(api_pages.items())[:5]),
    all(api_pages.get(p) == v for p, v in pv_by_path.items()))

# ============================================================ PAGES
print("\nPAGES")
pg = api("/api/a/pages")
api_pg = {r["path"]: r for r in pg["pages"]}
all_paths = Counter(e["path"] or "/" for e in EV)
row("Pages: path count", "DISTINCT path over all events", len(all_paths), len(api_pg), len(all_paths) == len(api_pg))
mism = [p for p, n in pv_by_path.items() if (api_pg.get(p) or {}).get("views") != n]
row("Pages: views per path", "COUNT(PAGE_VIEW) per path", "all match" if not mism else mism[:3],
    "all match" if not mism else "mismatch", not mism)
sess_per_path = {p: len({e["session_id"] for e in EV if (e["path"] or "/") == p}) for p in all_paths}
mism = [p for p, n in sess_per_path.items() if (api_pg.get(p) or {}).get("sessions") != n]
row("Pages: sessions per path", "DISTINCT session per path", "all match" if not mism else mism[:3],
    "all match" if not mism else "mismatch", not mism)
cta_per_path = Counter(e["path"] or "/" for e in EV if e["type"] == "CTA_CLICK")
mism = [p for p, n in cta_per_path.items() if (api_pg.get(p) or {}).get("cta") != n]
row("Pages: CTA per path", "COUNT(CTA_CLICK) per path", "all match" if not mism else mism[:3],
    "all match" if not mism else "mismatch", not mism)
exits = Counter(s["exit_path"] or "/" for s in SE)
mism = [p for p, n in exits.items() if (api_pg.get(p) or {}).get("exits") != n]
row("Pages: exits per path", "COUNT(a_session.exit_path)", "all match" if not mism else mism[:3],
    "all match" if not mism else "mismatch", not mism)

# ============================================================ FUNNEL
print("\nCONVERSIONS (funnel)")
fn = api("/api/a/funnel")
steps = {s["label"]: s["n"] for s in fn["steps"]}
expected_steps = [
    ("Sessions", len(SE)),
    ("Viewed services", sessions_with("SECTION_VIEW", "services")),
    ("Reached contact", sessions_with("SECTION_VIEW", "contact")),
    ("Clicked a CTA", sessions_with("CTA_CLICK")),
    ("Opened meeting", sessions_with("MEETING_MODAL_OPEN")),
    ("Started form", sessions_with("MEETING_FORM_START")),
    ("Submitted", sessions_with("MEETING_FORM_SUBMIT")),
]
for label, exp in expected_steps:
    row(f"Funnel: {label}", "DISTINCT sessions", exp, steps.get(label), steps.get(label) == exp)
row("Funnel: no 'Visitors' label", "metric naming", "absent",
    "absent" if "Visitors" not in steps else "PRESENT", "Visitors" not in steps)

# ============================================================ SOURCES
print("\nSOURCES")
sc = api("/api/a/sources")
grp = Counter((s["ref_source"] or "direct", s["utm_medium"] or "", s["utm_campaign"] or "",
               s["utm_content"] or "", s["utm_term"] or "") for s in SE)
api_grp = {(r["source"], r["medium"], r["campaign"], r["content"], r["term"]): r["sessions"]
           for r in sc["sources"]}
row("Sources: group count", "GROUP BY source+utm", len(grp), len(api_grp), len(grp) == len(api_grp))
row("Sources: sessions per group", "COUNT per group", "all match" if dict(grp) == api_grp else "differ",
    "all match" if dict(grp) == api_grp else "differ", dict(grp) == api_grp)
row("Sources: sums to total", "sum == sessions", len(SE), sum(api_grp.values()), sum(api_grp.values()) == len(SE))

# ============================================================ DEVICES
print("\nDEVICES")
dv = api("/api/a/devices")
for key, col in [("devices", "device"), ("browsers", "browser"), ("os", "os"), ("countries", "country")]:
    exp = Counter(s[col] or "unknown" for s in SE)
    got = {r["k"]: r["n"] for r in dv[key]}
    row(f"Devices: {key}", f"a_session GROUP BY {col}", dict(exp), got, dict(exp) == got)
screens = Counter((s["vw"], s["vh"]) for s in SE if s["vw"] is not None)
got = {(r["vw"], r["vh"]): r["n"] for r in dv["screens"]}
row("Devices: screen sizes", "GROUP BY vw, vh", len(screens), len(got), dict(screens) == got)

# ============================================================ SCROLL
print("\nSCROLL DEPTH")
sd = api("/api/a/scroll")
row("Scroll: session total", "COUNT(a_session)", len(SE), sd["total"], len(SE) == sd["total"])
row("Scroll: average", "AVG(max_scroll)", round(avg([s["max_scroll"] for s in SE]), 3),
    round(sd["avg"], 3), near(avg([s["max_scroll"] for s in SE]), sd["avg"]))
for mark in (25, 50, 75, 90, 100):
    exp = sum(1 for s in SE if (s["max_scroll"] or 0) >= mark - 0.001)
    got = next((r["sessions"] for r in sd["reached"] if r["depth"] == mark), None)
    row(f"Scroll: reached {mark}%", "max_scroll >= mark", exp, got, exp == got)
secs = Counter()
for e in EV:
    if e["type"] == "SECTION_VIEW" and e["section"]:
        secs[e["section"]] = 0
for sname in list(secs):
    secs[sname] = len({e["session_id"] for e in EV
                       if e["type"] == "SECTION_VIEW" and e["section"] == sname})
got = {r["section"]: r["sessions"] for r in sd["sections"]}
row("Scroll: sections reached", "DISTINCT sessions per SECTION_VIEW", dict(secs), got, dict(secs) == got)

# ============================================================ HEATMAP
print("\nHEATMAPS")
hm = api("/api/a/heatmap?mode=clicks")
clicks = [e for e in EV if e["type"] in CLICKY and e["x"] is not None and e["y"] is not None]
row("Heatmap: click total", "COUNT(click-like with x,y)", len(clicks), hm["total"], len(clicks) == hm["total"])
row("Heatmap: sessions", "DISTINCT sessions", len({c["session_id"] for c in clicks}), hm["sessions"],
    len({c["session_id"] for c in clicks}) == hm["sessions"])
row("Heatmap: points sum to total", "SUM(point weights)", len(clicks), sum(p["w"] for p in hm["points"]),
    sum(p["w"] for p in hm["points"]) == len(clicks))
top = Counter((c["element"] or "(unknown)", c["label"] or "") for c in clicks)
got_top = [(r["element"], r["label"], r["n"]) for r in hm["top"]]
row("Heatmap: top element", "most-clicked element",
    top.most_common(1)[0][1] if top else 0, got_top[0][2] if got_top else 0,
    (not top and not got_top) or (top.most_common(1)[0][1] == got_top[0][2]))
mv = api("/api/a/heatmap?mode=move")
moves = [e for e in EV if e["type"] == "MOVE" and e["x"] is not None]
row("Heatmap: move mode", "COUNT(MOVE with x,y)", len(moves), mv["total"], len(moves) == mv["total"])
tc = api("/api/a/heatmap?mode=touch")
touches = [e for e in EV if e["type"] == "TOUCH" and e["x"] is not None]
row("Heatmap: touch mode", "COUNT(TOUCH with x,y)", len(touches), tc["total"], len(touches) == tc["total"])

# ============================================================ EVENTS
print("\nEVENTS")
ec = api("/api/a/events")
types = Counter(e["type"] for e in EV)
got = {r["type"]: r["n"] for r in ec["types"]}
row("Events: type counts", "COUNT GROUP BY type", dict(types), got, dict(types) == got)
row("Events: total", "sum of type counts", len(EV), sum(got.values()), sum(got.values()) == len(EV))
row("Events: recent feed cap", "LIMIT 100", min(100, len(EV)), len(ec["recent"]), len(ec["recent"]) == min(100, len(EV)))
if ec["recent"]:
    desc = all(ec["recent"][i]["ts"] >= ec["recent"][i + 1]["ts"] for i in range(len(ec["recent"]) - 1))
    row("Events: recent is newest-first", "ORDER BY ts DESC", True, desc, desc)

# ============================================================ SESSIONS
print("\nSESSIONS")
ss = api("/api/a/sessions")
row("Sessions: row count", "a_session in window", min(len(SE), 100), len(ss["sessions"]),
    len(ss["sessions"]) == min(len(SE), 100))
if ss["sessions"]:
    desc = all(ss["sessions"][i]["started_at"] >= ss["sessions"][i + 1]["started_at"]
               for i in range(len(ss["sessions"]) - 1))
    row("Sessions: newest first", "ORDER BY started_at DESC", True, desc, desc)
    one = ss["sessions"][0]
    mine = next(s for s in SE if s["id"] == one["id"])
    same = all(one[f] == mine[f] for f in ("pageviews", "events", "interactions", "entry_path", "exit_path"))
    row("Sessions: row matches the table", "field-by-field", "identical",
        "identical" if same else "differs", same)
    det = api(f"/api/a/session/{one['id']}".replace("?", ""))
    mine_ev = [e for e in EV if e["session_id"] == one["id"]]
    row("Session detail: event count", "a_event for that session", len(mine_ev), len(det["events"]),
        len(det["events"]) == len(mine_ev))

# ============================================================ REALTIME
print("\nREALTIME")
rt = api("/api/a/realtime")
import time
now = int(time.time() * 1000)
active = sum(1 for s in SE if s["last_at"] >= now - 5 * 60 * 1000)
row("Realtime: active now", "last_at within 5 min", active, rt["active"], active == rt["active"])
recent30 = [e for e in EV if e["ts"] >= now - 30 * 60 * 1000]
row("Realtime: feed size", "events in last 30 min (cap 40)", min(40, len(recent30)), len(rt["feed"]),
    len(rt["feed"]) == min(40, len(recent30)))

# ============================================================ summary
print("\n" + "=" * 70)
print(f"{ok_n} matched, {bad_n} mismatched  ({len(EV)} events / {len(SE)} sessions, last {DAYS} days)")

out = ROOT / "docs" / "_dashboard-verification.md"
out.parent.mkdir(exist_ok=True)
lines = ["| Dashboard component | Data source | Expected (recomputed) | Actual (API) | Status |",
         "|---|---|---|---|---|"]
for c, s_, e, a, st in rows_out:
    e = e.replace("|", "/")[:70]
    a = a.replace("|", "/")[:70]
    lines.append(f"| {c} | {s_} | `{e}` | `{a}` | **{st}** |")
out.write_text("\n".join(lines) + "\n", encoding="utf-8")
print(f"table written to {out.relative_to(ROOT).as_posix()}")
sys.exit(1 if bad_n else 0)
