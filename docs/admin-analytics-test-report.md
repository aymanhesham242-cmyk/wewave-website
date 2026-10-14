# Admin analytics — test report

Tested: **14 October 2026**

## What was actually tested, and how

| Question | Answer |
|---|---|
| Was the **deployed** dashboard tested directly? | **Partly.** Its unauthenticated behaviour was tested against the live origin. The authenticated UI was **not** opened on production — I do not hold the production admin token, and I will not type a production admin credential into a browser I am driving. See *Blocked*. |
| Was the **production database** independently verified? | **Yes.** `wrangler` is authenticated, so production `a_event` / `a_session` were read directly, read-only, and exported. **937 events / 35 sessions total; 256 events / 17 sessions live**, spanning 16 Sep – 10 Oct 2026. |
| How was the dashboard verified against real data? | The production snapshot was loaded into a **local** D1 and the production query code was run over it. Every metric was then recomputed independently in Python from the raw rows and compared three ways: **independent recomputation ↔ API response ↔ rendered DOM**. |
| Was anything written to production? | **No.** No insert, update, delete, migration or configuration change. Reads only. |

The three-way comparison is the point. Checking the API against its own SQL
would only prove the system agrees with itself. `tools/verify_dashboard.py`
pulls the rows out once and recomputes every figure in a different language
from the documented definition, so a shared mistake cannot hide.

---

## Bug found: the dashboard overstated its own headline numbers

**Severity: HIGH. Found in real production data. Fixed.**

| Counter | Dashboard showed | Rows actually present | Overstated |
|---|---:|---:|---:|
| Page views | 26 | 19 | **+37%** |
| Interactions | 94 | 81 | **+16%** |
| Total events | 363 | 256 | **+42%** |

Two of seventeen "live" sessions were the **owner's own browsing**, counted as
real visitors.

### Cause

The collector decides `test` **per batch**: a visit is flagged as ours when the
admin token is in `localStorage`. The session row set `is_test` once, on
insert, and never updated it.

So this sequence — which is exactly what the owner does — broke it:

1. Owner browses the site. Session created, `is_test = 0`, events `is_test = 0`.
2. Owner opens `/admin/analytics/` and unlocks it. The token lands in
   `localStorage`.
3. Owner returns to the site **inside the 30-minute session window**. Same
   session id. The collector now flags the batch as test.
4. The new event rows get `is_test = 1` and vanish from every view — but the
   session row stays `is_test = 0`, and its `pageviews` / `interactions` /
   `events` counters keep accumulating **all** of it.

The result is a live session whose counters describe rows no view can see. The
overview KPI summed those counters; the Pages table counted the rows. They
disagreed by 37%, and nothing on screen said so.

### Fix

Two changes, because one is the cause and the other is the class of bug:

1. **`is_test` escalates and never goes back.** `MAX(a_session.is_test,
   excluded.is_test)` in the upsert, plus a single indexed update that lifts
   that session's earlier events. Once a session is the owner's, it stays the
   owner's.
2. **The headline counters are counted from the event rows**, not summed from
   the denormalised per-session columns. The overview and the Pages table now
   read the same source, so they cannot drift apart again whatever happens
   upstream.

### Outstanding — needs approval

The **code** is fixed, so no new row can drift. The **existing production rows
are still wrong**: two sessions remain mis-flagged and their counters still
carry inflated values. Repairing them is a production write, which I have not
made. It is two statements, and reversible from the export I already took:

```sql
UPDATE a_session SET is_test = 1
 WHERE is_test = 0
   AND EXISTS (SELECT 1 FROM a_event e WHERE e.session_id = a_session.id AND e.is_test = 1);

UPDATE a_event SET is_test = 1
 WHERE is_test = 0
   AND session_id IN (SELECT id FROM a_session WHERE is_test = 1);
```

Effect: live sessions 17 → 15, and the stale counters stop describing hidden
rows. With fix (2) deployed the **displayed** page-view and interaction figures
are already correct without this repair — they are counted from the rows. The
repair is what removes the owner's two sessions from the session count.

---

## Component-by-component verification

Produced by `python tools/verify_dashboard.py 90` against the production
snapshot. "Expected" is an independent Python recomputation from the raw rows;
"Actual" is what the API returned.

The two FAIL rows are **data integrity on historical rows**, not code defects —
they are the contaminated sessions above, and they are the evidence for it.

| Dashboard component | Data source | Expected (recomputed) | Actual (API) | Status |
|---|---|---|---|---|
| Unique sessions | a_session COUNT | `17` | `17` | **PASS** |
| Page views | COUNT(PAGE_VIEW rows) | `19` | `19` | **PASS** |
| Interactions | COUNT(interaction rows) | `81` | `81` | **PASS** |
| Integrity: session pageview counters | SUM(a_session.pageviews) vs rows | `19` | `26` | **FAIL** |
| Integrity: session interaction counters | SUM(a_session.interactions) vs rows | `81` | `94` | **FAIL** |
| Avg engaged time (s) | AVG(engaged_ms) where > 0 | `25.72` | `25.72` | **PASS** |
| Avg tab-open span (s) | AVG(last_at - started_at) | `3226.22` | `3226.22` | **PASS** |
| Avg scroll depth | AVG(a_session.max_scroll) | `23.59` | `23.59` | **PASS** |
| CTA clicks | COUNT(CTA_CLICK) | `2` | `2` | **PASS** |
| Meeting requests | DISTINCT sessions w/ submit | `0` | `0` | **PASS** |
| Conversion rate | submits / sessions | `0.0` | `0` | **PASS** |
| Bounce rate | no interaction & <10s engaged | `0.1176` | `0.1176` | **PASS** |
| Trend: number of days | GROUP BY UTC day | `9` | `9` | **PASS** |
| Trend: per-day counts | sessions per UTC day | `match` | `match` | **PASS** |
| Trend: sums to total | sum(buckets) == sessions | `17` | `17` | **PASS** |
| Overview devices | a_session GROUP BY device | `{'desktop': 7, 'mobile': 10}` | `{'mobile': 10, 'desktop': 7}` | **PASS** |
| Overview sources | a_session GROUP BY ref_source | `{'direct': 17}` | `{'direct': 17}` | **PASS** |
| Overview top pages | COUNT(PAGE_VIEW) GROUP BY path | `{'/': 19}` | `{'/': 19}` | **PASS** |
| Pages: path count | DISTINCT path over all events | `1` | `1` | **PASS** |
| Pages: views per path | COUNT(PAGE_VIEW) per path | `all match` | `all match` | **PASS** |
| Pages: sessions per path | DISTINCT session per path | `all match` | `all match` | **PASS** |
| Pages: CTA per path | COUNT(CTA_CLICK) per path | `all match` | `all match` | **PASS** |
| Pages: exits per path | COUNT(a_session.exit_path) | `all match` | `all match` | **PASS** |
| Funnel: Sessions | DISTINCT sessions | `17` | `17` | **PASS** |
| Funnel: Viewed services | DISTINCT sessions | `3` | `3` | **PASS** |
| Funnel: Reached contact | DISTINCT sessions | `3` | `3` | **PASS** |
| Funnel: Clicked a CTA | DISTINCT sessions | `2` | `2` | **PASS** |
| Funnel: Opened meeting | DISTINCT sessions | `2` | `2` | **PASS** |
| Funnel: Started form | DISTINCT sessions | `0` | `0` | **PASS** |
| Funnel: Submitted | DISTINCT sessions | `0` | `0` | **PASS** |
| Funnel: no 'Visitors' label | metric naming | `absent` | `absent` | **PASS** |
| Sources: group count | GROUP BY source+utm | `1` | `1` | **PASS** |
| Sources: sessions per group | COUNT per group | `all match` | `all match` | **PASS** |
| Sources: sums to total | sum == sessions | `17` | `17` | **PASS** |
| Devices: devices | a_session GROUP BY device | `{'desktop': 7, 'mobile': 10}` | `{'mobile': 10, 'desktop': 7}` | **PASS** |
| Devices: browsers | a_session GROUP BY browser | `{'Chrome': 11, 'Safari': 6}` | `{'Chrome': 11, 'Safari': 6}` | **PASS** |
| Devices: os | a_session GROUP BY os | `{'Windows': 5, 'Android': 4, 'iOS': 6, 'macOS': 2}` | `{'iOS': 6, 'Windows': 5, 'Android': 4, 'macOS': 2}` | **PASS** |
| Devices: countries | a_session GROUP BY country | `{'EG': 13, 'NL': 3, 'BE': 1}` | `{'EG': 13, 'NL': 3, 'BE': 1}` | **PASS** |
| Devices: screen sizes | GROUP BY vw, vh | `8` | `8` | **PASS** |
| Scroll: session total | COUNT(a_session) | `17` | `17` | **PASS** |
| Scroll: average | AVG(max_scroll) | `23.59` | `23.59` | **PASS** |
| Scroll: reached 25% | max_scroll >= mark | `5` | `5` | **PASS** |
| Scroll: reached 50% | max_scroll >= mark | `4` | `4` | **PASS** |
| Scroll: reached 75% | max_scroll >= mark | `3` | `3` | **PASS** |
| Scroll: reached 90% | max_scroll >= mark | `3` | `3` | **PASS** |
| Scroll: reached 100% | max_scroll >= mark | `3` | `3` | **PASS** |
| Scroll: sections reached | DISTINCT sessions per SECTION_VIEW | `{'hero': 14, 'manifesto': 3, 'services': 3, 'process': 4, 'clients': 3` | `{'hero': 14, 'process': 4, 'voices': 3, 'services': 3, 'manifesto': 3,` | **PASS** |
| Heatmap: click total | COUNT(click-like with x,y) | `10` | `10` | **PASS** |
| Heatmap: sessions | DISTINCT sessions | `5` | `5` | **PASS** |
| Heatmap: points sum to total | SUM(point weights) | `10` | `10` | **PASS** |
| Heatmap: top element | most-clicked element | `4` | `4` | **PASS** |
| Heatmap: move mode | COUNT(MOVE with x,y) | `53` | `53` | **PASS** |
| Heatmap: touch mode | COUNT(TOUCH with x,y) | `41` | `41` | **PASS** |
| Events: type counts | COUNT GROUP BY type | `{'SESSION_START': 18, 'PAGE_VIEW': 19, 'SECTION_VIEW': 33, 'SERVICE_VI` | `{'MOVE': 53, 'TOUCH': 41, 'SECTION_VIEW': 33, 'SERVICE_VIEW': 28, 'HEA` | **PASS** |
| Events: total | sum of type counts | `256` | `256` | **PASS** |
| Events: recent feed cap | LIMIT 100 | `100` | `100` | **PASS** |
| Events: recent is newest-first | ORDER BY ts DESC | `True` | `True` | **PASS** |
| Sessions: row count | a_session in window | `17` | `17` | **PASS** |
| Sessions: newest first | ORDER BY started_at DESC | `True` | `True` | **PASS** |
| Sessions: row matches the table | field-by-field | `identical` | `identical` | **PASS** |
| Session detail: event count | a_event for that session | `7` | `7` | **PASS** |
| Realtime: active now | last_at within 5 min | `0` | `0` | **PASS** |
| Realtime: feed size | events in last 30 min (cap 40) | `0` | `0` | **PASS** |


### Rendered dashboard vs API vs recomputation

KPI cards read out of the live DOM with the production snapshot loaded, in both
buckets:

| KPI card | DOM (live) | API (live) | DOM (test) | API (test) |
|---|---:|---:|---:|---:|
| Unique sessions | 17 | 17 | 18 | 18 |
| Page views | 19 | 19 | 36 | 36 |
| Interactions | 81 | 81 | 72 | 72 |
| CTA clicks | 2 | 2 | 11 | 11 |
| Avg engaged time | 26s | 25.72s | 1m 00s | 59.61s |
| Avg scroll depth | 24% | 23.59% | 49% | 49.37% |
| Meeting requests | 0 | 0 | 0 | 0 |
| Conversion rate | 0% | 0 | 0% | 0 |

Before the fix the live "Page views" card read **26**.

### Every view renders

All nine navigation targets clicked and inspected in the DOM.

| View | Renders | Stuck loading | Tables | Charts | Rows |
|---|---|---|---:|---:|---:|
| overview | yes | no | 1 | 1 | 2 |
| heatmaps | yes | no | 1 | 0 | 3 |
| sessions | yes | no | 1 | 0 | 18 |
| pages | yes | no | 1 | 0 | 2 |
| conversions | yes | no | 0 | 0 | 0 |
| sources | yes | no | 1 | 0 | 2 |
| devices | yes | no | 5 | 0 | 24 |
| events | yes | no | 1 | 0 | 13 |
| settings | yes | no | 1 | 0 | 7 |

No JavaScript console errors in any view. Nothing stuck loading. No hardcoded,
mock or placeholder figures — searched for explicitly; the only `Math.random`
in the analytics path is the session-id fallback.

---

## Endpoints tested

| Endpoint | Anonymous | Authorised | Verified against rows |
|---|---|---|---|
| `POST /api/a` | public ingest | — | yes |
| `GET /api/a/overview` | 401 | 200 | yes — 11 figures |
| `GET /api/a/pages` | 401 | 200 | yes — views, sessions, CTA, exits per path |
| `GET /api/a/funnel` | 401 | 200 | yes — all 7 steps |
| `GET /api/a/sources` | 401 | 200 | yes — grouping and totals |
| `GET /api/a/devices` | 401 | 200 | yes — device, browser, OS, country, screens |
| `GET /api/a/scroll` | 401 | 200 | yes — total, average, 5 marks, sections |
| `GET /api/a/heatmap` | 401 | 200 | yes — clicks, moves, touches, top element |
| `GET /api/a/events` | 401 | 200 | yes — type counts, ordering, cap |
| `GET /api/a/sessions` | 401 | 200 | yes — count, ordering, field-by-field |
| `GET /api/a/session/:id` | 401 | 200 | yes — event count per session |
| `GET /api/a/realtime` | 401 | 200 | yes — active count, feed window |
| `POST /api/a/purge-test` | 401 | not executed | — |
| `POST /api/a/reset-live` | 401 | not executed | — |
| `GET /api/health` | 200 public | — | yes |
| `GET /api/health?deep=1` | 401 | 200 | yes |

The two destructive routes were tested **only** for authentication. Neither was
executed against data.

---

## Test commands and results

```bash
npx wrangler dev --local --port 8899     # second terminal

python tools/test_analytics.py        # 88 passed, 0 failed, 0 blocked
python tools/test_api.py              # 46 passed, 0 failed
node  tools/test_case_engine.mjs      # all 57 engine checks passed
python tools/verify_dashboard.py 90   # 61 matched, 2 mismatched (both = the historical data finding)
```

**191 automated checks pass.** Regression tests added for this bug:

- *the owner's session, before and after opening the dashboard* — replays the
  exact production sequence and asserts the session and all its events end up
  on the same side of the flag;
- *page views equal the PAGE_VIEW rows* and *interactions equal the interaction
  rows*, in both buckets;
- *no session written by this run straddles the test flag*.

Each fails against the pre-fix code.

---

## Status summary

| Area | Status |
|---|---|
| Dashboard reads the correct data | **PASS** (after fix) |
| Every displayed metric verified against rows | **PASS** — 61 of 63; the 2 FAILs are historical data |
| Deployed dashboard, unauthenticated behaviour | **PASS** |
| Deployed dashboard, authenticated UI | **BLOCKED** — no production token |
| Production database independently verified | **PASS** |
| Access control on all 16 endpoints | **PASS** |
| Filters, date ranges, view navigation | **PASS** |
| Empty states | **PASS** |
| No mock or hardcoded data | **PASS** |
| Console errors | **PASS** — none |
| Historical production data repair | **NOT RUN** — needs approval |
| Playwright suite | **NOT RUN** — needs npm, against this project's no-dependency rule |
| Cross-browser (Firefox / Safari / Edge) | **BLOCKED** — only Chromium available |
| Export function | **NOT RUN** — the dashboard has no export control |
| Search / pagination / sorting | **NOT RUN** — the dashboard implements none |

---

## Blocked, and exactly what is needed

**Authenticated production dashboard.** I do not hold the production
`ADMIN_TOKEN`, and I would not type one into a driven browser session even if
given it. What this leaves open is small: production runs the same code over
the same data verified here, and the deployed build was confirmed to match. To
close it, open the dashboard yourself and check the Page views card against
this report.

**Cross-browser.** Only Chromium is available in this environment.

---

## Remaining risks

- The dashboard counts **sessions, not people**. There is no durable visitor
  identity, so new-vs-returning does not exist. The labels are honest about it.
- **No bot filtering.** A JavaScript-executing crawler counts as a session.
  Unchanged by this audit.
- The **live data is thin** — 17 sessions over 25 days and nothing since
  10 October. Bounce rate (11.8%) and conversion (0%) carry very little signal.
- `avg scroll` pools two meanings now that service pages report: timeline
  progress on `/`, document scroll elsewhere.
- The historical counter drift stays in the table until the repair is approved.
