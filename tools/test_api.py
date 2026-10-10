"""
End-to-end checks for the Worker API.

These are the only tests that cover the lead pipeline, so run them before any
deploy that touches worker/. They exercise validation, both rate limits, the
admin brute-force throttle and the analytics ingest against a real Worker --
not mocks.

Start the Worker first, in a second terminal:

    npx wrangler dev --local --port 8899

then:

    python tools/test_api.py

Everything runs against 127.0.0.1 and the local D1 file under .wrangler/.
Nothing here can reach production. The admin token is read from .dev.vars into
a variable, used only as a header value, and never printed.
"""
import json
import pathlib
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8899"
IP = "203.0.113.9"          # TEST-NET-3; only ever seen by the local instance

tok = ""
for line in pathlib.Path(r"C:\Users\Dell\Desktop\WeWave Website\.dev.vars").read_text(
    encoding="utf-8"
).splitlines():
    if line.strip().startswith("ADMIN_TOKEN"):
        tok = line.split("=", 1)[1].strip().strip('"').strip("'")

passed, failed = [], []


def check(name, got, want):
    (passed if got == want else failed).append((name, got, want))
    print(("  PASS  " if got == want else "  FAIL  ") + f"{name:52} got {got!r}")


def req(path, method="GET", body=None, headers=None, ip=IP):
    h = {"CF-Connecting-IP": ip}
    if body is not None:
        h["Content-Type"] = "application/json"
    h.update(headers or {})
    data = body.encode() if isinstance(body, str) else (
        json.dumps(body).encode() if body is not None else None)
    r = urllib.request.Request(BASE + path, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=25) as resp:
            return resp.status, resp.read().decode("utf-8", "replace"), dict(resp.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace"), dict(e.headers)


def lead(**over):
    d = {"name": "Audit Tester", "brandLink": "https://example.com",
         "phone": "+201117230557", "services": ["Media buying"],
         "meetingDate": "2027-01-15", "message": "automated audit"}
    d.update(over)
    return d


print("\n--- security headers ---")
_, _, h = req("/")
hl = {k.lower(): v for k, v in h.items()}
for key, frag in [("content-security-policy", "frame-ancestors 'none'"),
                  ("content-security-policy", "script-src 'self';"),
                  ("x-frame-options", "DENY"),
                  ("strict-transport-security", "max-age=31536000"),
                  ("permissions-policy", "camera=()"),
                  ("x-content-type-options", "nosniff"),
                  ("x-robots-tag", "noindex")]:
    check(f"/ has {key}: {frag[:34]}", frag in hl.get(key, ""), True)

_, _, h = req("/assets/clients/nasaq.png")
hl = {k.lower(): v for k, v in h.items()}
check("/assets/* is cacheable", "max-age=86400" in hl.get("cache-control", ""), True)

_, _, h = req("/admin/")
hl = {k.lower(): v for k, v in h.items()}
check("/admin/* is no-store", "no-store" in hl.get("cache-control", ""), True)

print("\n--- the site itself still serves ---")
for p in ["/", "/css/style.css", "/js/main.js", "/js/contact.js",
          "/assets/clients/nasaq.webp", "/assets/clients/nasaq.png",
          "/admin/app.js", "/admin/analytics/app.js", "/robots.txt"]:
    st, _, _ = req(p)
    check(f"GET {p}", st, 200)

print("\n--- booking: server-side validation ---")
st, b, _ = req("/api/meeting", "POST", lead(), ip="198.51.100.1")
check("valid booking is accepted", st, 201)
check("booking returns an id", "id" in json.loads(b), True)

cases = [("name too short", lead(name="x")),
         ("no brand link", lead(brandLink="")),
         ("phone too short", lead(phone="12")),
         ("no services", lead(services=[])),
         ("malformed date", lead(meetingDate="15-01-2027")),
         ("date in the past", lead(meetingDate="2020-01-01"))]
for i, (name, payload) in enumerate(cases):
    # a fresh address each time -- the rate limiter counts attempts, not
    # failures, so six rejects from one address would legitimately trip it
    st, _, _ = req("/api/meeting", "POST", payload, ip="198.51.100.%d" % (20 + i))
    check(f"rejected: {name}", st, 400)

st, _, _ = req("/api/meeting", "POST", "not json at all", ip="198.51.100.3")
check("rejected: body is not JSON", st, 400)

st, _, _ = req("/api/meeting", "POST", json.dumps(lead(message="z" * 20000)),
               ip="198.51.100.4")
check("rejected: oversized payload", st, 413)

print("\n--- booking: rate limit (5 per 10 min per address) ---")
codes = [req("/api/meeting", "POST", lead(), ip="198.51.100.77")[0] for _ in range(7)]
check("first five accepted", codes[:5], [201] * 5)
check("sixth and seventh throttled", codes[5:], [429, 429])

print("\n--- admin: auth and brute-force throttling ---")
st, _, _ = req("/api/meetings", ip="198.51.100.5")
check("no token -> 401", st, 401)
st, _, _ = req("/api/meetings", headers={"Authorization": "Bearer wrong-token"},
               ip="198.51.100.5")
check("wrong token -> 401", st, 401)

codes = [req("/api/meetings", headers={"Authorization": "Bearer guess-%d" % i},
             ip="198.51.100.66")[0] for i in range(13)]
check("first ten guesses -> 401", set(codes[:10]), {401})
check("eleventh onward -> 429", set(codes[10:]), {429})

if tok:
    st, b, _ = req("/api/meetings", headers={"Authorization": "Bearer " + tok},
                   ip="198.51.100.6")
    check("correct token -> 200", st, 200)
    # The dashboard polls /api/a/realtime on a timer. If a successful call
    # counted toward the failure budget, the owner would lock themselves out
    # of their own panel within a minute -- so prove it does not.
    codes = [req("/api/a/realtime", headers={"Authorization": "Bearer " + tok},
                 ip="198.51.100.6")[0] for _ in range(25)]
    check("25 successful admin calls never self-throttle", set(codes), {200})
    check("panel sees the bookings just made", len(json.loads(b)["meetings"]) >= 6, True)
    st, _, _ = req("/api/a/overview", headers={"Authorization": "Bearer " + tok},
                   ip="198.51.100.6")
    check("analytics query with token -> 200", st, 200)
else:
    print("  SKIP  no ADMIN_TOKEN in .dev.vars — token-accepted path not exercised")

print("\n--- analytics ingest ---")
ev = {"sid": "auditsession0001", "ctx": {"vw": 1280, "vh": 800},
      "events": [{"type": "PAGE_VIEW", "path": "/", "dt": 0},
                 {"type": "CTA_CLICK", "path": "/", "element": "a.btn", "dt": 10}]}
st, b, _ = req("/api/a", "POST", ev, ip="198.51.100.7")
check("ingest accepts a batch", st, 200)
check("ingest stored both events", json.loads(b).get("stored"), 2)

bad = dict(ev, events=[{"type": "<script>alert(1)</script>", "path": "/"},
                       {"type": "ok_lowercase", "path": "/"},
                       {"type": "GOOD_EVENT", "path": "/"}])
st, b, _ = req("/api/a", "POST", bad, ip="198.51.100.7")
check("malformed event types dropped, good one kept", json.loads(b).get("stored"), 1)

flood = dict(ev, events=[{"type": "CLICK", "path": "/", "dt": i} for i in range(200)])
st, b, _ = req("/api/a", "POST", flood, ip="198.51.100.8")
check("batch capped at 60", json.loads(b).get("stored"), 60)

st, _, _ = req("/api/a", "POST", dict(ev, sid="../../etc/passwd"), ip="198.51.100.9")
check("bad session id rejected", st, 204)

print("\n--- analytics ingest rate limit (240 per 5 min per address) ---")
codes = [req("/api/a", "POST", ev, ip="198.51.100.123")[0] for _ in range(245)]
check("under the limit -> 200", set(codes[:240]), {200})
check("over the limit -> 204 (silent, never an error on the page)",
      set(codes[240:]), {204})

print("\n--- unknown routes ---")
st, _, _ = req("/api/does-not-exist")
check("unknown /api path -> 404", st, 404)

print(f"\n{'=' * 64}\n{len(passed)} passed, {len(failed)} failed")
for n, got, want in failed:
    print(f"  FAILED: {n}\n          got {got!r}, wanted {want!r}")
raise SystemExit(1 if failed else 0)
