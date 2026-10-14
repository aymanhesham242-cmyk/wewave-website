# Analytics QA audit — WeWave

Audit date: **14 October 2026**
Scope: the public site and the analytics pipeline behind `/admin/analytics/`.
Method: every claim below is backed by an executed check. Nothing is marked
PASS because a function exists or a page loaded.

Commands used throughout:

```bash
npx wrangler dev --local --port 8899     # in a second terminal
python tools/test_analytics.py           # 80 checks — new in this audit
python tools/test_api.py                 # 46 checks — pre-existing
node  tools/test_case_engine.mjs         # 57 checks — pre-existing
```

**Result: 183 checks executed, 183 passing.** Six defects were found and
fixed, each with a regression test that fails against the old code.

> **Not deployed.** Everything here was found, fixed and verified against a
> local Worker and a local D1 file. Production has not been touched: no
> deploy, no migration, no production query, no configuration change. The
> release checklist at the end is what remains.

---

## 1. Architecture, as discovered

No framework, no bundler, no package manager — a static site behind a single
Cloudflare Worker. Discovered from `wrangler.jsonc`, not assumed.

| Layer | What it actually is |
|---|---|
| Pages | Hand-written `index.html` + five generated `services/*.html` |
| Collector | `js/analytics.js` — one IIFE, no dependencies, `defer` |
| Transport | `POST /api/a`, JSON batches, `sendBeacon` on pagehide |
| Worker | `worker/index.js` routes; `worker/analytics.js` collects and queries |
| Store | **D1** (SQLite), binding `DB`, database `wewave-meetings` |
| Tables | `a_event` (one row per interaction), `a_session` (one row per session) |
| Dashboard | `admin/analytics/` — static shell + `app.js`, token-gated |
| Deploy | Workers Builds from GitHub `main`, assets from `dist/` |

**One database serves both analytics and the booking form.** That is the single
most important fact about this system: a flood of behaviour data can spend the
D1 write allowance that leads depend on. Two independent limits exist for that
reason (per-address rate limit, and a 50 000-event daily ingest cap).

### Verified data flow

Each arrow below was observed, not inferred — request logs, D1 row reads, and
the rendered dashboard.

```
browser (js/analytics.js, defer)
  │  queues events; flushes every 5s, at 15 queued, and on pagehide
  ▼
POST /api/a            ← observed: 200, median 13.2 ms local
  │  rate limit 240 / 5 min per hashed address
  │  daily cap 50 000 events
  ▼
collect()              ← Worker assigns ts, device, browser, os, country
  │  validates type against /^[A-Z][A-Z0-9_]{1,40}$/, truncates, clamps
  ▼
D1: a_event rows + a_session upsert   ← observed via direct SQL, outside the API
  │
  ▼
GET /api/a/*           ← admin token required; 11 routes, all verified 401 anon
  │
  ▼
dashboard renders      ← observed: figures equal independent SQL counts
```

---

## 2. Findings

Severity is about consequence, not effort.

### A1 — Service pages sent no analytics at all · **HIGH** · fixed

`js/analytics.js` was loaded by `index.html` only. The five generated service
pages never included it, so **every visit to `/services/*` produced no session,
no page view and no events.**

The damage is worse than a missing row. A visitor arriving on a service page
straight from an ad and leaving from it was *entirely invisible* — not an
undercount, an absence. The dashboard's Pages and landing-page views were empty
by construction rather than for want of traffic, which reads as "nobody visits
those pages" instead of "those pages are not instrumented".

*Evidence (before):* five failing checks, `/services/… loads the collector`.
*Fix:* `tools/build_services.py` emits the collector on every generated page.
The collector degrades cleanly there — the stage engine, booking modal and
service cards it observes are simply absent, and each watcher returns early.
*Evidence (after):* real browser navigation `/` → `/services/media-buying`
produced one session with two page views, and `/services/media-buying` now
appears in the dashboard's Pages table.

### A2 — `entry_path` recorded the wrong page · **HIGH** (was latent) · fixed

Both `entry_path` and `exit_path` were bound to the same variable, which held
the path of the **last event in the batch**. Since `entry_path` sticks for the
life of the session, the landing page was recorded permanently wrong.

This was invisible while `index.html` was the only instrumented page — every
path in a batch was `/`, so the bug had nothing to express. **Fixing A1 would
have activated it**, which is why the two had to ship together: the first
release with service-page tracking would have attributed every landing to
whichever page the visitor happened to be on when the first batch flushed.

*Evidence (before):* a batch of `/`, `/`, `/`, `/services/media-buying` stored
`entry_path = /services/media-buying`.
*Fix:* track the first and last path against the event timestamps.
*Evidence (after):* same batch stores `entry_path = /`, `exit_path =
/services/media-buying`; confirmed again with a real browser session.

### A3 — Ten wrong guesses locked the owner out · **HIGH** · fixed

`requireAdmin` consulted the failure throttle *before* validating the token, so
once ten failed attempts had been recorded against an address, the correct
token was refused with 429 for fifteen minutes.

The address is shared more often than it looks: an office, a mobile carrier's
CGNAT, a hotel. Anyone sharing an egress address with the owner could lock them
out of the only interface that shows incoming leads, and the owner's own
correct token could not clear it.

*Evidence (before):* after twelve wrong guesses, a request with the correct
token returned 429. This also cascaded through the suite and blocked four
unrelated checks — the failure mode in miniature.
*Fix:* validate the token first; only a failure consults or feeds the throttle.
A brute-forcer still gets 429 and learns nothing new, because the comparison is
constant-time against a secret they do not have.
*Evidence (after):* `a correct token still works after a burst of failed
guesses` passes.

### A4 — Every soft reject in `collect()` was an exception · **LOW** · fixed

`json(data, 204)` cannot work: 204 is a null-body status, so constructing a
`Response` with a body throws. All five "reject quietly" paths in `collect()`
were therefore throwing, and the handler in `worker/index.js` was catching them
and returning the right status **by accident**.

Behaviour was correct, so this is Low. It is listed because the next person to
read those `return json({ ok: false }, 204)` lines would believe them.

*Evidence:* the 200 path returns `Cache-Control: no-store` (set by `json()`);
the 204 path returned no such header, proving a different code path answered.
*Fix:* a `noContent()` helper returning a bodyless 204.

### A5 — Daily chart labelled rolling windows with calendar dates · **MEDIUM** · fixed

Trend buckets were `(now − started_at) / 86 400 000` — 24-hour slices counted
back from the moment the dashboard was opened — and the chart labelled them
with calendar dates in the viewer's local timezone.

A bucket labelled "14 Oct" therefore covered 13 Oct 14:00 → 14 Oct 14:00, and
would have shifted had the page been opened an hour later. Any comparison
against another tool, an invoice or a campaign schedule would disagree, with
nothing on screen to explain why.

*Fix:* group by UTC calendar day in SQL; the chart is now titled
**"Sessions per day (UTC)"** so the boundary is stated rather than guessed.
*Evidence:* `the trend is bucketed by calendar day`, `each bucket is a real
YYYY-MM-DD date`, and `the buckets add up to the session total`.

### A6 — A session count was labelled "Visitors" · **MEDIUM** · fixed

The funnel's first step and the overview chart both called
`COUNT(*) FROM a_session` "Visitors". **Nothing in this system identifies a
visitor across sessions** — the session id is random and expires after 30
minutes of inactivity, so one person returning tomorrow is a second session.
Calling that a visitor count overstates reach, and the error compounds for the
most engaged people, who return most often.

*Fix:* both now say "Sessions". The KPI card already said "Unique sessions" and
was correct.
*Evidence:* `no funnel step calls a session count a visitor`.

### A7 — The dashboard fetched the same endpoint twice every 15s · **LOW** · fixed

`tickActive()` fetched `/api/a/realtime` for the active count, then called
`refreshFeed()`, which fetched the identical response again — two requests and
four D1 reads every fifteen seconds, against the database the booking form
shares. It also kept polling in a hidden tab.

*Fix:* the tick passes its response to the feed, and polling pauses while the
tab is hidden. Halves the dashboard's idle cost and stops it entirely when
nobody is looking.

---

## 3. Issues identified and **not** fixed

These are real but need a decision, so they are documented rather than changed.

| # | Issue | Severity | Why not fixed here |
|---|---|---|---|
| B1 | **No bot or crawler filtering.** `parseUA` buckets device/browser/OS but never classifies a request as automated. A JS-executing crawler is counted as a session. | Medium | Any filter is a policy decision about what counts as a visit. Cheap option: drop known bot user-agents at ingest. Needs your call. |
| B2 | **New vs returning is not measured and cannot be, as built.** The session id resets after 30 minutes idle and there is no durable visitor id. | Medium | Measuring it means a persistent identifier — a privacy change, not a bug fix. The dashboard does not currently claim the metric, which is the honest state. |
| B3 | **`is_test` is client-controlled.** A crafted request can flag itself as test data and vanish from the live figures. | Low | No incentive exists, and the alternative (server-side classification) would misfile the owner's own test traffic. Documented. |
| B4 | **Admin token lives in `localStorage`.** Readable by any script that achieves execution on that origin. | Low — accepted | Mitigated by `script-src 'self'` with no `'unsafe-inline'`, and A-grade escaping verified below. Changing to a cookie session means building session infrastructure this site does not have. |
| B5 | **Query errors return `detail: <D1 error text>`** on `/api/a/*` 500s. | Low | Admin-only and behind the token, and it is the only diagnostic available for a failing query. Flagging it so the choice is deliberate. |
| B6 | **`avg scroll` mixes two meanings.** On `/` it is progress along the stage timeline; on a service page it is document scroll. | Low | Both answer "how far through the page", but the averages are now pooled. Worth splitting if per-page scroll becomes a decision input. |
| B7 | **No alerting.** Nothing notices sustained ingest failure. | Medium | `/api/health` now exists for an external monitor to poll; wiring it to an alerting service is an operational choice with cost implications. |

---

## 4. Security and authentication findings

All executed against the local Worker.

| Check | Result |
|---|---|
| 11 analytics read routes, anonymous | **401** on every one |
| `POST /api/a/purge-test` anonymous | **401** — destructive route is gated |
| `POST /api/a/reset-live?confirm=RESET` anonymous | **401** — and still needs the confirm token |
| Wrong token | **401** |
| Dashboard before unlock | lock screen, **no numbers in the DOM** |
| Token field | `type="password"` |
| Admin token in any shipped JS | **absent** (checked in all four source files) |
| Token echoed in an API response | **no** |
| Stored XSS via a crafted `label` / `element` | **inert** — payload stored verbatim, rendered as text; no tags injected, no execution |
| Client forging `ts` | **ignored** — the Worker clock is authoritative |
| Client forging `country` / `device` | **ignored** — both derived from the request |
| Client clearing `is_test` per event | **ignored** |
| Form values in the collector | **none** — field *names* only; verified by source check |
| IP addresses stored | **none** — hashed into a rate-limit key, never persisted |
| `/api/health` public form | returns `{ok, service, time}` only; DB probe is admin-gated |
| Do-Not-Track | honoured; the collector returns before doing anything |
| Oversized body (70 KB) | refused, no 5xx |
| Nine malformed payload shapes | all handled, **none produced a 5xx** |

The CSP (`script-src 'self'`, no `'unsafe-inline'`) was active during all
browser testing — the dashboard and site both run under it with no violations.

---

## 5. Accuracy: dashboard vs database

The acceptance criterion. Every figure read off the rendered dashboard was
compared with an independent SQL count run **outside the API**, straight
against the D1 file.

| Metric | Dashboard | Independent SQL | Match |
|---|---:|---:|:--:|
| Unique sessions | 1 | 1 | yes |
| Page views | 241 | 241 | yes |
| Interactions | 301 | 301 | yes |
| CTA clicks | 241 | 241 | yes |

Plus a cross-check that matters: page views computed two different ways —
`SUM(a_session.pageviews)` and `COUNT(*) FROM a_event WHERE type='PAGE_VIEW'` —
agree exactly (241 = 241). A disagreement there would mean the session
counters had drifted from the events they summarise.

Other accuracy checks executed:

- A reload **continues** the session: one session row, `started_at` unchanged,
  page views 1 → 2. Refreshing does not invent visitors.
- Event ordering survives batching (client sends relative offsets).
- Values are clamped: `x`,`y` to 0–1; `scroll` to 0–100; `path` to 300 chars;
  `label` to 120.
- Batches are capped at 60 events; a 200-event batch stored exactly 60.
- Test traffic is fully isolated: a page view flagged `is_test` is absent from
  the live figures and present in the test figures.
- An empty date window returns **zeros and an empty trend**, not fabricated data.
- `days=1` is exactly 86 400 000 ms.
- The date filter genuinely refetches (`overview?days=30` observed on click).
- 8 concurrent sessions: 16/16 events and 8/8 sessions stored, no errors.

**No mock, demo, sample or placeholder data exists anywhere in the analytics
path.** Searched for it explicitly; the only `Math.random` is the session-id
fallback when `crypto.randomUUID` is unavailable.

---

## 6. Performance

Measured locally. **These are local numbers** — no network, local SQLite.
Production D1 will be slower and these are not a production latency claim.

| Endpoint | Median | Max |
|---|---:|---:|
| `POST /api/a` (what a visitor waits for) | 13.2 ms | 15.7 ms |
| `GET /api/a/overview?days=7` | 21.6 ms | 23.8 ms |
| `GET /api/a/realtime` | 10.3 ms | 11.7 ms |
| `GET /api/a/pages?days=7` | 12.1 ms | 12.8 ms |
| `GET /api/a/sessions?days=7` | 7.3 ms | 8.9 ms |
| `GET /api/a/heatmap?days=7` | 14.0 ms | 16.3 ms |

Collector weight: **17 555 B raw, 5 587 B gzipped**, loaded `defer`, so it is
off the critical rendering path. For comparison `js/main.js` is 10 781 B
gzipped and `css/style.css` is 12 404 B.

Network cost of tracking: one `POST /api/a` per 5-second flush window, batched
up to 60 events, plus one beacon at pagehide. Observed on a real page load:
**2 requests** for a visit with a scroll and a click.

Indexes exist for every dashboard query shape (`ts`, `session_id+ts`,
`type+ts`, `type+section+ts`, `started_at`, `last_at`).

Core Web Vitals (LCP/INP/CLS) were **not measured** — see Not Run below.

---

## 7. Files changed

| File | Change |
|---|---|
| `tools/build_services.py` | A1 — emit `js/analytics.js` on every service page |
| `worker/analytics.js` | A2 first/last path by timestamp · A4 `noContent()` helper, 5 call sites · A5 trend by UTC calendar day · A6 funnel label |
| `worker/index.js` | A3 validate the token before consulting the throttle · new `/api/health` (public liveness, admin-gated deep check) |
| `admin/analytics/app.js` | A5 render UTC day buckets, chart retitled · A7 deduplicate the 15s poll, pause when hidden |
| `tools/test_analytics.py` | **new** — 80 end-to-end checks |
| `docs/analytics-qa-audit.md` | **new** — this report |
| `CLAUDE.md` | record the traps so they are not reintroduced |
| `services/*.html`, `dist/**` | regenerated |

---

## 8. Test results

| Suite | Checks | Result |
|---|---:|---|
| `tools/test_analytics.py` | 80 | **PASS** |
| `tools/test_api.py` | 46 | **PASS** |
| `tools/test_case_engine.mjs` | 57 | **PASS** |
| Browser end-to-end (manual, real browser) | — | **PASS** (see below) |
| **Total** | **183** | **183 passing** |

Browser end-to-end, executed against the local Worker with a real Chromium
page and the production CSP active:

1. Load `/?wwtest=1` → collector present, session id issued, test flag set.
2. Scroll and fire a CTA → `POST /api/a` **200**, no console errors.
3. Navigate to `/services/media-buying` → collector present, **same session
   id**, `POST /api/a` **200**.
4. D1 row inspected directly: `entry_path=/`, `exit_path=/services/media-buying`,
   `pageviews=2`, device/browser/OS/country all server-derived.
5. Open `/admin/analytics/` → lock screen, no data in the DOM.
6. Unlock → KPIs render; all four match independent SQL counts.
7. Change range to 30 days → `overview?days=30` refetched.
8. Pages view → `/services/media-buying` listed.
9. Stored-XSS payload renders as inert text; no execution.

### Not run, and why

| Item | Status | What it needs |
|---|---|---|
| Playwright suite | **NOT RUN** | The project has no package manager and a standing rule against adding dependencies. Adding Playwright means npm plus a browser download. The equivalent flow was executed manually in a real browser (above) and the deterministic parts live in `test_analytics.py`. Say the word if you want the dependency. |
| Firefox / Safari / Edge | **BLOCKED** | Only Chromium is available here. Chromium-family verified. |
| Core Web Vitals (LCP/INP/CLS) | **NOT RUN** | Needs a production origin and field data; local numbers would be meaningless. |
| Production pipeline verification | **BLOCKED** | Requires deploy approval. Everything is verified locally. |
| Load/scale testing | **NOT RUN** | 8 concurrent sessions passed; real load testing against production would consume D1 allowance and needs approval. |
| D1 outage simulation | **BLOCKED** | `--local` has no way to drop the binding mid-run. The `!env.DB` path is code-reviewed, not executed. |
| Geographic accuracy | **NOT VERIFIABLE** | `country` comes from Cloudflare request metadata; correctness is Cloudflare's. Verified only that it is server-derived and not client-settable. |

---

## 9. Deployment and rollback

**Nothing has been deployed.** To release:

```bash
python tools/build_services.py
python tools/build_dist.py
git add -A && git commit && git push          # Workers Builds deploys main
```

Then verify against the live origin — a queued build looks identical to a
finished one from here:

```bash
curl -s https://wewave-website.aymanhesham242.workers.dev/api/health
curl -s https://wewave-website.aymanhesham242.workers.dev/services/media-buying | grep -c analytics.js   # expect 1
curl -s -o /dev/null -w "%{http_code}\n" https://wewave-website.aymanhesham242.workers.dev/api/a/overview  # expect 401
```

**Rollback:** `git revert <sha> && git push`. No migration is involved — the
schema is unchanged, so rolling back the code rolls back everything. Rows
written in the meantime stay valid under both versions.

**No destructive operation was run or is required.** `purge-test` and
`reset-live` were tested only for their authentication, never executed against
data.

---

## 10. Release checklist

- [x] Real events reach the intended store — verified browser → D1
- [x] Dashboard figures equal independent counts of the stored events
- [x] Metric definitions honest (sessions are not called visitors)
- [x] Date filters and bucket boundaries correct and labelled
- [x] Refreshes and retries do not inflate counts
- [x] Protected data unreachable without authorisation
- [x] All High-severity findings fixed, each with a regression test
- [x] All automated suites pass (183 checks)
- [x] No console errors or unexplained failed requests in tested flows
- [x] Site remains functional when analytics fails
- [x] Collector off the critical path (5.6 KB gzipped, `defer`)
- [ ] **Deploy approval** — not given, not taken
- [ ] Post-deploy verification against the live origin (commands above)
- [ ] Decide B1 (bot filtering) and B7 (alerting)
- [ ] `LEAD_WEBHOOK_URL` still unset — booking requests are stored and
      **nobody is notified**. Unrelated to analytics, but it is the highest-value
      gap in the system: `npx wrangler secret put LEAD_WEBHOOK_URL`

---

## 11. Honest summary of limitations

- Everything was verified **locally**. The fixes are not proven in production
  because production has not been deployed to.
- Performance figures are local and understate real latency.
- One browser engine was tested.
- Bot traffic is not filtered, so session counts include any JS-executing
  crawler. This was true before the audit and remains true.
- There is still no measure of unique people, only sessions — by design, and
  the dashboard no longer implies otherwise.
