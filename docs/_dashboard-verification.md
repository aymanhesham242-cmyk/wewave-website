| Dashboard component | Data source | Expected (recomputed) | Actual (API) | Status |
|---|---|---|---|---|
| Unique sessions | a_session COUNT | `1` | `1` | **PASS** |
| Page views | COUNT(PAGE_VIEW rows) | `241` | `241` | **PASS** |
| Interactions | COUNT(interaction rows) | `301` | `301` | **PASS** |
| Integrity: session pageview counters | SUM(a_session.pageviews) vs rows | `241` | `241` | **PASS** |
| Integrity: session interaction counters | SUM(a_session.interactions) vs rows | `301` | `301` | **PASS** |
| Avg engaged time (s) | AVG(engaged_ms) where > 0 | `0` | `0` | **PASS** |
| Avg tab-open span (s) | AVG(last_at - started_at) | `5.8` | `5.8` | **PASS** |
| Avg scroll depth | AVG(a_session.max_scroll) | `0.0` | `0` | **PASS** |
| CTA clicks | COUNT(CTA_CLICK) | `241` | `241` | **PASS** |
| Meeting requests | DISTINCT sessions w/ submit | `0` | `0` | **PASS** |
| Conversion rate | submits / sessions | `0.0` | `0` | **PASS** |
| Bounce rate | no interaction & <10s engaged | `0.0` | `0` | **PASS** |
| Trend: number of days | GROUP BY UTC day | `1` | `1` | **PASS** |
| Trend: per-day counts | sessions per UTC day | `match` | `match` | **PASS** |
| Trend: sums to total | sum(buckets) == sessions | `1` | `1` | **PASS** |
| Overview devices | a_session GROUP BY device | `{'desktop': 1}` | `{'desktop': 1}` | **PASS** |
| Overview sources | a_session GROUP BY ref_source | `{'direct': 1}` | `{'direct': 1}` | **PASS** |
| Overview top pages | COUNT(PAGE_VIEW) GROUP BY path | `{'/': 241}` | `{'/': 241}` | **PASS** |
| Pages: path count | DISTINCT path over all events | `1` | `1` | **PASS** |
| Pages: views per path | COUNT(PAGE_VIEW) per path | `all match` | `all match` | **PASS** |
| Pages: sessions per path | DISTINCT session per path | `all match` | `all match` | **PASS** |
| Pages: CTA per path | COUNT(CTA_CLICK) per path | `all match` | `all match` | **PASS** |
| Pages: exits per path | COUNT(a_session.exit_path) | `all match` | `all match` | **PASS** |
| Funnel: Sessions | DISTINCT sessions | `1` | `1` | **PASS** |
| Funnel: Viewed services | DISTINCT sessions | `0` | `0` | **PASS** |
| Funnel: Reached contact | DISTINCT sessions | `0` | `0` | **PASS** |
| Funnel: Clicked a CTA | DISTINCT sessions | `1` | `1` | **PASS** |
| Funnel: Opened meeting | DISTINCT sessions | `0` | `0` | **PASS** |
| Funnel: Started form | DISTINCT sessions | `0` | `0` | **PASS** |
| Funnel: Submitted | DISTINCT sessions | `0` | `0` | **PASS** |
| Funnel: no 'Visitors' label | metric naming | `absent` | `absent` | **PASS** |
| Sources: group count | GROUP BY source+utm | `1` | `1` | **PASS** |
| Sources: sessions per group | COUNT per group | `all match` | `all match` | **PASS** |
| Sources: sums to total | sum == sessions | `1` | `1` | **PASS** |
| Devices: devices | a_session GROUP BY device | `{'desktop': 1}` | `{'desktop': 1}` | **PASS** |
| Devices: browsers | a_session GROUP BY browser | `{'Chrome': 1}` | `{'Chrome': 1}` | **PASS** |
| Devices: os | a_session GROUP BY os | `{'Windows': 1}` | `{'Windows': 1}` | **PASS** |
| Devices: countries | a_session GROUP BY country | `{'EG': 1}` | `{'EG': 1}` | **PASS** |
| Devices: screen sizes | GROUP BY vw, vh | `1` | `1` | **PASS** |
| Scroll: session total | COUNT(a_session) | `1` | `1` | **PASS** |
| Scroll: average | AVG(max_scroll) | `0.0` | `0` | **PASS** |
| Scroll: reached 25% | max_scroll >= mark | `0` | `0` | **PASS** |
| Scroll: reached 50% | max_scroll >= mark | `0` | `0` | **PASS** |
| Scroll: reached 75% | max_scroll >= mark | `0` | `0` | **PASS** |
| Scroll: reached 90% | max_scroll >= mark | `0` | `0` | **PASS** |
| Scroll: reached 100% | max_scroll >= mark | `0` | `0` | **PASS** |
| Scroll: sections reached | DISTINCT sessions per SECTION_VIEW | `{}` | `{}` | **PASS** |
| Heatmap: click total | COUNT(click-like with x,y) | `0` | `0` | **PASS** |
| Heatmap: sessions | DISTINCT sessions | `0` | `0` | **PASS** |
| Heatmap: points sum to total | SUM(point weights) | `0` | `0` | **PASS** |
| Heatmap: top element | most-clicked element | `0` | `0` | **PASS** |
| Heatmap: move mode | COUNT(MOVE with x,y) | `0` | `0` | **PASS** |
| Heatmap: touch mode | COUNT(TOUCH with x,y) | `0` | `0` | **PASS** |
| Events: type counts | COUNT GROUP BY type | `{'CTA_CLICK': 241, 'PAGE_VIEW': 241, 'CLICK': 60, 'GOOD_EVENT': 1}` | `{'PAGE_VIEW': 241, 'CTA_CLICK': 241, 'CLICK': 60, 'GOOD_EVENT': 1}` | **PASS** |
| Events: total | sum of type counts | `543` | `543` | **PASS** |
| Events: recent feed cap | LIMIT 100 | `100` | `100` | **PASS** |
| Events: recent is newest-first | ORDER BY ts DESC | `True` | `True` | **PASS** |
| Sessions: row count | a_session in window | `1` | `1` | **PASS** |
| Sessions: newest first | ORDER BY started_at DESC | `True` | `True` | **PASS** |
| Sessions: row matches the table | field-by-field | `identical` | `identical` | **PASS** |
| Session detail: event count | a_event for that session | `543` | `543` | **PASS** |
| Realtime: active now | last_at within 5 min | `1` | `1` | **PASS** |
| Realtime: feed size | events in last 30 min (cap 40) | `40` | `40` | **PASS** |
