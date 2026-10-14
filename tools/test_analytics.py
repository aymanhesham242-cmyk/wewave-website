"""
End-to-end checks on the analytics pipeline: browser -> /api/a -> D1 ->
/api/a/* -> dashboard.

Every figure the dashboard shows is also counted straight out of D1 with a
second, independent query, and the two are compared. A test that only asked
the API to agree with itself would pass just as happily on a broken pipeline.

Run it against a local Worker, never production:

    npx wrangler dev --local --port 8899        # in another terminal
    python tools/test_analytics.py

`--local` needs no Cloudflare login and touches nothing remote. Every row this
file writes carries is_test = 1 and a session id prefixed `t<run>`, so it can
never be mistaken for a visitor, and `purge-test` clears it.

The admin token is read from .dev.vars and never printed.
"""
import json
import pathlib
import random
import string
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8899"
ROOT = pathlib.Path(__file__).resolve().parent.parent
RUN = "".join(random.choice(string.ascii_lowercase) for _ in range(6))

passed, failed, blocked = [], [], []


def token():
    f = ROOT / ".dev.vars"
    if not f.exists():
        return ""
    for line in f.read_text(encoding="utf-8").splitlines():
        if line.strip().startswith("ADMIN_TOKEN="):
            # wrangler reads .dev.vars with dotenv semantics, so a quoted value
            # reaches the Worker unquoted. Matching that here cost an hour of
            # chasing a 401 that was this harness's fault, not the Worker's.
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    return ""


TOKEN = token()


# --------------------------------------------------------------- plumbing

def post(path, payload=None, raw=None, auth=False, ctype="application/json"):
    data = raw if raw is not None else json.dumps(payload or {}).encode()
    h = {"Content-Type": ctype}
    if auth:
        h["Authorization"] = "Bearer " + TOKEN
    req = urllib.request.Request(BASE + path, data=data, method="POST", headers=h)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            body = r.read().decode()
            return r.status, (json.loads(body) if body.strip() else None)
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        try:
            return e.code, json.loads(body)
        except Exception:
            return e.code, body[:200]


def get(path, auth=True, tok=None):
    h = {}
    if auth:
        h["Authorization"] = "Bearer " + (tok if tok is not None else TOKEN)
    req = urllib.request.Request(BASE + path, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        try:
            return e.code, json.loads(body)
        except Exception:
            return e.code, body[:200]


_sql_cache = []


def sql(query):
    """Read D1 directly, bypassing the Worker entirely. This is what makes the
    comparisons independent rather than circular."""
    p = subprocess.run(
        ["npx", "wrangler", "d1", "execute", "wewave-meetings", "--local",
         "--json", "--command", query],
        cwd=ROOT, capture_output=True, text=True, shell=True)
    out = p.stdout
    try:
        return json.loads(out[out.index("["):])[0]["results"]
    except Exception:
        raise RuntimeError("d1 read failed: " + (out[-300:] + p.stderr[-300:]))


def scalar(query):
    r = sql(query)
    return list(r[0].values())[0] if r else None


def check(name, ok, detail=""):
    (passed if ok else failed).append(name)
    print(("  PASS  " if ok else "  FAIL  ") + name + (("  -- " + str(detail)) if detail and not ok else ""))
    return ok


def block(name, why):
    blocked.append(name)
    print("  BLOCK " + name + "  -- " + why)


def sid(tag):
    """Session ids must match ^[A-Za-z0-9_-]{8,64}$ and be unique per run."""
    return ("t" + RUN + tag + "x" * 8)[:40]


def send(session, events, ctx=None, test=1):
    return post("/api/a", {"sid": session, "test": test,
                           "ctx": ctx or {"vw": 1280, "vh": 800}, "events": events})


# ------------------------------------------------------------------ tests

def t_ingest():
    print("\n[1] ingest and storage")
    s = sid("a")
    st, body = send(s, [
        {"type": "SESSION_START", "dt": 9000, "path": "/"},
        {"type": "PAGE_VIEW", "dt": 8900, "path": "/", "label": "Home"},
        {"type": "CTA_CLICK", "dt": 5000, "path": "/", "x": 0.5, "y": 0.4},
        {"type": "SCROLL", "dt": 3000, "path": "/", "scroll": 50},
        {"type": "PAGE_VIEW", "dt": 1000, "path": "/services/media-buying"},
    ])
    check("ingest accepts a well-formed batch", st == 200 and body.get("stored") == 5,
          f"{st} {body}")

    rows = sql(f"SELECT type, path, scroll, x, y FROM a_event WHERE session_id='{s}' ORDER BY ts")
    check("every event in the batch is persisted", len(rows) == 5, f"{len(rows)} rows")
    check("event order survives the batch (dt offsets honoured)",
          [r["type"] for r in rows] == ["SESSION_START", "PAGE_VIEW", "CTA_CLICK", "SCROLL", "PAGE_VIEW"],
          [r["type"] for r in rows])

    ses = sql(f"SELECT * FROM a_session WHERE id='{s}'")
    check("one session row per session id", len(ses) == 1, len(ses))
    if ses:
        r = ses[0]
        check("session counts pageviews", r["pageviews"] == 2, r["pageviews"])
        check("session counts interactions", r["interactions"] == 1, r["interactions"])
        check("session records max scroll", r["max_scroll"] == 50, r["max_scroll"])
        # REGRESSION: entry_path was bound to the last path in the batch.
        check("entry_path is the FIRST path of the session",
              r["entry_path"] == "/", r["entry_path"])
        check("exit_path is the LAST path of the session",
              r["exit_path"] == "/services/media-buying", r["exit_path"])


def t_clock_and_derived():
    print("\n[2] the server owns the facts the client must not set")
    s = sid("b")
    before = int(time.time() * 1000)
    send(s, [{"type": "PAGE_VIEW", "dt": 0, "path": "/",
              "ts": 1, "country": "ZZ", "device": "mainframe", "is_test": 0}])
    after = int(time.time() * 1000)
    r = sql(f"SELECT ts, country, device, is_test FROM a_event WHERE session_id='{s}'")[0]
    check("client-supplied ts is ignored; the Worker clock is used",
          before - 2000 <= r["ts"] <= after + 2000, r["ts"])
    check("client cannot set its own country", r["country"] != "ZZ", r["country"])
    check("client cannot set its own device string",
          r["device"] in ("desktop", "mobile", "tablet"), r["device"])
    check("client cannot clear the test flag per-event", r["is_test"] == 1, r["is_test"])


def t_validation():
    print("\n[3] malformed input is refused without a 5xx")
    s = sid("c")
    cases = [
        ("invalid JSON",        dict(raw=b"{not json")),
        ("empty body",          dict(raw=b"")),
        ("no session id",       dict(payload={"events": [{"type": "PAGE_VIEW"}]})),
        ("session id charset",  dict(payload={"sid": "../../etc/pw!", "events": [{"type": "PAGE_VIEW"}]})),
        ("session id too short", dict(payload={"sid": "abc", "events": [{"type": "PAGE_VIEW"}]})),
        ("events not a list",   dict(payload={"sid": s, "events": "many"})),
        ("oversized body",      dict(raw=b'{"sid":"' + b"a" * 70000 + b'"}')),
        ("null events",         dict(payload={"sid": s, "events": None})),
        ("event not an object", dict(payload={"sid": s, "events": [42, None, "x"]})),
    ]
    worst = 0
    for name, kw in cases:
        st, _ = post("/api/a", kw.get("payload"), raw=kw.get("raw"))
        worst = max(worst, st)
        check(f"'{name}' is handled without a server error", st < 500, st)
    check("no malformed request produced a 5xx", worst < 500, worst)

    # a bad event type must be dropped, not stored
    s2 = sid("d")
    send(s2, [{"type": "drop me", "path": "/"},
              {"type": "WAY_TOO_LONG_" + "X" * 60, "path": "/"},
              {"type": "GOOD_EVENT", "path": "/"}])
    types = [r["type"] for r in sql(f"SELECT type FROM a_event WHERE session_id='{s2}'")]
    check("event types outside the pattern are dropped", types == ["GOOD_EVENT"], types)


def t_clamping():
    print("\n[4] out-of-range values are clamped, not stored raw")
    s = sid("e")
    send(s, [{"type": "CLICK", "path": "/", "x": 99, "y": -5, "scroll": 5000},
             {"type": "CLICK", "path": "/" + "p" * 500, "label": "L" * 500}])
    rows = sql(f"SELECT x, y, scroll, path, label FROM a_event WHERE session_id='{s}' ORDER BY id")
    check("x is clamped to 0..1", rows[0]["x"] == 1, rows[0]["x"])
    check("y is clamped to 0..1", rows[0]["y"] == 0, rows[0]["y"])
    check("scroll is clamped to 0..100", rows[0]["scroll"] == 100, rows[0]["scroll"])
    check("path is truncated", len(rows[1]["path"] or "") <= 300, len(rows[1]["path"] or ""))
    check("label is truncated", len(rows[1]["label"] or "") <= 120, len(rows[1]["label"] or ""))


def t_batch_cap():
    print("\n[5] batch and body caps")
    s = sid("f")
    st, body = send(s, [{"type": "PAGE_VIEW", "path": "/"} for _ in range(200)])
    n = scalar(f"SELECT COUNT(*) FROM a_event WHERE session_id='{s}'")
    check("a batch is capped at 60 events", n == 60, n)


def t_session_continuity():
    print("\n[6] a reload continues the session; it does not create one")
    s = sid("g")
    send(s, [{"type": "SESSION_START", "dt": 2000, "path": "/"},
             {"type": "PAGE_VIEW", "dt": 2000, "path": "/"}])
    first_started = scalar(f"SELECT started_at FROM a_session WHERE id='{s}'")
    time.sleep(1.2)
    send(s, [{"type": "PAGE_VIEW", "dt": 0, "path": "/"}])          # the reload
    rows = sql(f"SELECT started_at, pageviews, events FROM a_session WHERE id='{s}'")
    check("a reload does not create a second session row", len(rows) == 1, len(rows))
    check("started_at sticks to the first batch", rows[0]["started_at"] == first_started,
          f"{rows[0]['started_at']} vs {first_started}")
    check("a reload is counted as a page view, not a session", rows[0]["pageviews"] == 2,
          rows[0]["pageviews"])
    check("event counter accumulates across batches", rows[0]["events"] == 3, rows[0]["events"])


def t_concurrency():
    print("\n[7] concurrent visitors")
    sids = [sid("h" + str(i)) for i in range(8)]
    errs = []

    def worker(sess):
        try:
            send(sess, [{"type": "PAGE_VIEW", "path": "/"},
                        {"type": "CLICK", "path": "/", "x": 0.2, "y": 0.2}])
        except Exception as e:
            errs.append(str(e))

    ts = [threading.Thread(target=worker, args=(x,)) for x in sids]
    [t.start() for t in ts]
    [t.join() for t in ts]
    inlist = "','".join(sids)
    n_ev = scalar(f"SELECT COUNT(*) FROM a_event WHERE session_id IN ('{inlist}')")
    n_se = scalar(f"SELECT COUNT(*) FROM a_session WHERE id IN ('{inlist}')")
    check("no request errored under concurrency", not errs, errs[:2])
    check("every concurrent event was stored", n_ev == 16, n_ev)
    check("every concurrent session was stored", n_se == 8, n_se)


def t_api_matches_db():
    print("\n[8] the dashboard's figures match the database")
    st, ov = get("/api/a/overview?days=1&test=1")
    if st != 200:
        return block("overview vs database", f"overview returned {st}")
    frm, to = ov["range"]["from"], ov["range"]["to"]

    db_sessions = scalar(
        f"SELECT COUNT(*) FROM a_session WHERE is_test=1 AND started_at BETWEEN {frm} AND {to}")
    db_views = scalar(
        f"SELECT COUNT(*) FROM a_event WHERE is_test=1 AND type='PAGE_VIEW' AND ts BETWEEN {frm} AND {to}")
    db_cta = scalar(
        f"SELECT COUNT(*) FROM a_event WHERE is_test=1 AND type='CTA_CLICK' AND ts BETWEEN {frm} AND {to}")

    check("overview session count matches the database",
          ov["kpi"]["sessions"] == db_sessions, f"api={ov['kpi']['sessions']} db={db_sessions}")
    check("overview CTA clicks match the database",
          ov["kpi"]["ctaClicks"] == db_cta, f"api={ov['kpi']['ctaClicks']} db={db_cta}")
    # pageviews on the overview is SUM(a_session.pageviews), which is a different
    # path to the same number -- they have to agree or one of them is wrong.
    check("overview page views match a straight count of PAGE_VIEW rows",
          ov["kpi"]["pageviews"] == db_views, f"api={ov['kpi']['pageviews']} db={db_views}")

    st, pg = get("/api/a/pages?days=1&test=1")
    paths = {r["path"]: r["views"] for r in pg["pages"]}
    db_mb = scalar("SELECT COUNT(*) FROM a_event WHERE is_test=1 AND type='PAGE_VIEW' "
                   f"AND path='/services/media-buying' AND ts BETWEEN {frm} AND {to}")
    check("per-page views match the database",
          paths.get("/services/media-buying", 0) == db_mb,
          f"api={paths.get('/services/media-buying', 0)} db={db_mb}")


def t_isolation():
    print("\n[9] test traffic never reaches the live figures")
    s = sid("i")
    send(s, [{"type": "PAGE_VIEW", "path": "/isolation-probe"}], test=1)
    st, live = get("/api/a/pages?days=1")              # no &test=1 -> live only
    live_paths = [r["path"] for r in live["pages"]]
    check("a test page view is absent from the live figures",
          "/isolation-probe" not in live_paths, live_paths[:5])
    st, t = get("/api/a/pages?days=1&test=1")
    check("the same page view is present in the test figures",
          "/isolation-probe" in [r["path"] for r in t["pages"]])


def t_windows():
    print("\n[10] date ranges")
    st, a = get("/api/a/overview?days=1&test=1")
    st, b = get("/api/a/overview?days=30&test=1")
    check("a wider window returns at least as many sessions",
          b["kpi"]["sessions"] >= a["kpi"]["sessions"],
          f"30d={b['kpi']['sessions']} 1d={a['kpi']['sessions']}")
    span = a["range"]["to"] - a["range"]["from"]
    check("days=1 really means 24 hours", abs(span - 86400000) < 1000, span)

    far = int(time.time() * 1000) - 400 * 86400000
    st, c = get(f"/api/a/overview?from={far}&to={far + 86400000}&test=1")
    check("an empty window returns zeros, not an error",
          st == 200 and c["kpi"]["sessions"] == 0, f"{st} {c.get('kpi', {}).get('sessions')}")
    check("an empty window is an empty state, not fabricated data",
          c["kpi"]["pageviews"] == 0 and c["trend"] == [], c["trend"][:2])


def t_trend_and_labels():
    print(chr(10) + "[10b] trend buckets and metric labels")
    st, ov = get("/api/a/overview?days=7&test=1")
    rows = ov.get("trend", [])
    # REGRESSION: buckets were rolling 24h slices counted back from "now",
    # then labelled with calendar dates.
    check("the trend is bucketed by calendar day",
          all("day" in r for r in rows) and not any("days_ago" in r for r in rows),
          rows[:2])
    check("each bucket is a real YYYY-MM-DD date",
          all(len(r["day"]) == 10 and r["day"][4] == "-" for r in rows), rows[:2])
    total = sum(r["sessions"] for r in rows)
    check("the buckets add up to the session total",
          total == ov["kpi"]["sessions"], f"buckets={total} kpi={ov['kpi']['sessions']}")

    st, fn = get("/api/a/funnel?days=7&test=1")
    labels = [x["label"] for x in fn["steps"]]
    # REGRESSION: a count of sessions was labelled "Visitors". Nothing in this
    # system identifies a visitor across sessions, so the label was a claim the
    # data cannot support.
    check("no funnel step calls a session count a visitor",
          "Visitors" not in labels, labels)
    check("the funnel starts from the session count",
          fn["steps"][0]["n"] == ov["kpi"]["sessions"],
          f"funnel={fn['steps'][0]['n']} overview={ov['kpi']['sessions']}")


def t_auth():
    print("\n[11] authentication")
    routes = ["/api/a/overview", "/api/a/heatmap", "/api/a/scroll", "/api/a/sessions",
              "/api/a/pages", "/api/a/funnel", "/api/a/sources", "/api/a/devices",
              "/api/a/events", "/api/a/realtime", "/api/a/session/" + sid("a")]
    codes = set()
    for r in routes:
        st, _ = get(r, auth=False)
        codes.add(st)
    check("every analytics read route refuses an anonymous request",
          codes <= {401, 429}, codes)

    for r in ["/api/a/purge-test", "/api/a/reset-live?confirm=RESET"]:
        st, _ = post(r)
        check(f"anonymous POST {r.split('?')[0]} is refused", st in (401, 429), st)

    st, _ = get("/api/a/overview", tok="not-the-token")
    check("a wrong token is refused", st in (401, 429), st)

    # REGRESSION: the owner must still get in after someone else's failures.
    for _ in range(12):
        get("/api/a/overview", tok="guess-" + str(random.random()))
    st, _ = get("/api/a/overview?days=1&test=1")
    check("a correct token still works after a burst of failed guesses", st == 200, st)

    # That burst left the failure bucket full; drain it so the checks after
    # this one are not measuring the throttle instead of what they test.
    sql("DELETE FROM submit_log")

    st, body = get("/api/a/overview")
    check("an authorised read succeeds", st == 200, st)
    check("the response carries no token or secret",
          TOKEN and TOKEN not in json.dumps(body), "token echoed in response")


def t_no_leaks():
    print("\n[12] what the public can see")
    st, _ = get("/api/a", auth=False)
    check("GET /api/a is not a public read path", st in (404, 401, 405), st)

    for f in ["js/analytics.js", "admin/analytics/app.js", "worker/index.js", "worker/analytics.js"]:
        txt = (ROOT / f).read_text(encoding="utf-8")
        check(f"{f} contains no literal admin token",
              not TOKEN or TOKEN not in txt)

    txt = (ROOT / "js/analytics.js").read_text(encoding="utf-8")
    for bad in ["ev.target.value", ".value)", "password"]:
        check(f"the collector never reads {bad!r}", bad not in txt)

    st, err = get("/api/a/session/" + ("z" * 40))
    check("an unknown session id is not a server error", st == 200, st)


def t_site_survives():
    print("\n[13] the site survives analytics failing")
    st, _ = post("/api/a", raw=b"garbage")
    r = urllib.request.urlopen(BASE + "/", timeout=20)
    check("the homepage still serves after a rejected ingest", r.status == 200, r.status)
    html = r.read().decode("utf-8", "replace")
    check("the homepage loads the collector", "js/analytics.js" in html)

    for page in ["/services/media-buying", "/services/web-development",
                 "/services/brand-identity", "/services/photography-reels",
                 "/services/competitor-market-analysis"]:
        rr = urllib.request.urlopen(BASE + page, timeout=20)
        body = rr.read().decode("utf-8", "replace")
        # REGRESSION: the service pages shipped without the collector, so every
        # visit to one of them was invisible to the dashboard.
        check(f"{page} loads the collector", "js/analytics.js" in body)


def t_health():
    print(chr(10) + "[15] health and readiness")
    st, b = get("/api/health", auth=False)
    check("liveness is public and answers 200", st == 200 and b.get("ok") is True, f"{st} {b}")
    check("liveness leaks nothing about the environment",
          set(b or {}) <= {"ok", "service", "time"}, list(b or {}))

    st, b = get("/api/health?deep=1", auth=False)
    check("the deep check is not public", st in (401, 429), st)

    st, b = get("/api/health?deep=1")
    check("the deep check reports the database as up", st == 200 and b.get("db") == "up",
          f"{st} {b}")


def t_ratelimit():
    print("\n[14] ingest rate limiting")
    s = sid("r")
    codes = []
    for _ in range(14):
        st, _ = send(s, [{"type": "PAGE_VIEW", "path": "/"}])
        codes.append(st)
    check("ingest keeps answering under a burst (never 5xx)", max(codes) < 500, max(codes))


def main():
    if not TOKEN:
        print("ADMIN_TOKEN not found in .dev.vars — the admin half cannot run.")
    try:
        urllib.request.urlopen(BASE + "/", timeout=5)
    except Exception as e:
        print(f"No Worker on {BASE} — start `npx wrangler dev --local --port 8899` first.")
        print(f"  ({e})")
        sys.exit(2)

    print(f"analytics pipeline checks — run id {RUN}, all rows flagged is_test=1")
    for fn in (t_ingest, t_clock_and_derived, t_validation, t_clamping, t_batch_cap,
               t_session_continuity, t_concurrency, t_api_matches_db, t_isolation,
               t_windows, t_trend_and_labels, t_auth, t_no_leaks, t_site_survives, t_health, t_ratelimit):
        try:
            fn()
        except Exception as e:
            failed.append(fn.__name__)
            print(f"  ERROR in {fn.__name__}: {e}")

    print("\n" + "=" * 62)
    print(f"{len(passed)} passed, {len(failed)} failed, {len(blocked)} blocked")
    if failed:
        print("\nfailed:")
        for f in failed:
            print("  - " + f)
    if blocked:
        print("\nblocked:")
        for b in blocked:
            print("  - " + b)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
