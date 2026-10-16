# WeWave — studio site

A single-page site built as scroll choreography: seven fixed full-viewport
"stages" that crossfade against a tall scroll driver, rather than a normal
document that scrolls past. One interpolated timeline drives stage opacity and
travel, the palette (dark → cream → dark), the glowing ribbon canvas, the
services rail and the process steps — so everything moves on the same clock.

In front of the static files sits a Cloudflare Worker that adds a booking API,
visitor analytics and two token-gated internal tools.

**Live:** https://wewave-website.aymanhesham242.workers.dev

Read `CLAUDE.md` before changing anything. It records the failures this project
has already had, which is cheaper than repeating them.

## What is here

| Path | What it is |
|---|---|
| `index.html` | The whole public page — all copy and structure |
| `css/style.css` | All main-page styling |
| `js/main.js` | The scroll engine: timeline, palette, ribbon, lamp, rail, nav |
| `js/meeting-modal.js` · `voice.js` · `contact.js` · `analytics.js` | Self-contained features, each loading after `main.js` |
| `worker/index.js` | API, auth, rate limiting, static passthrough |
| `worker/analytics.js` | Analytics ingest and dashboard queries |
| `worker/case-studies.js` | Case study storage |
| `admin/` | Meeting-request panel, analytics dashboard, case study simulator |
| `schema/*.sql` | Readable DDL for every table (the Worker also creates them lazily) |
| `tools/*.py`, `tools/*.mjs` | Generators and tests |
| `dist/` | **Generated and deployed. Never edit by hand.** |

## Running it locally

The site is plain HTML, CSS and JavaScript — no framework, no bundler, no
package manager, nothing to install. For the static page alone:

```bash
python -m http.server 8000
```

To run the API, the database and the admin panels, you need the Worker:

```bash
npx wrangler dev --local --port 8899
```

`--local` keeps everything on your machine: a SQLite file under `.wrangler/`
stands in for D1, and no Cloudflare login is needed. The tables build
themselves on first use, so an empty database is fine.

Put local secrets in `.dev.vars` (gitignored — see `.dev.vars.example`).

## Configuration

Everything secret is a Worker secret. Nothing secret belongs in
`wrangler.jsonc`, in `vars`, in the frontend, or in this repository.

| Name | Required | What it does |
|---|---|---|
| `ADMIN_TOKEN` | **yes** | Guards every admin route. With it unset, all of them fail closed and the panels stay empty — which is safe, but means nobody can read the leads either. |
| `LEAD_WEBHOOK_URL` | no | Where to announce a new booking. Unset, the Worker is silent and the only way to learn about a lead is to open `/admin`. See **Lead notifications** below. |

```bash
npx wrangler secret put ADMIN_TOKEN          # prompts; the value is never echoed
npx wrangler secret list                     # names only
```

Setting a secret in the Cloudflare **dashboard** creates a new version but does
not deploy it — you have to promote that version, or it silently has no effect.
This has cost an hour before.

### Bindings

| Binding | Kind | Name |
|---|---|---|
| `DB` | D1 | `wewave-meetings` |
| `ASSETS` | static assets | `./dist` |

One database holds everything: `meetings`, `submit_log`, the `a_*` analytics
tables and `case_study`.

## Lead notifications

A submitted booking is written to D1 and that is all that happens. Nothing is
emailed, so without this configured the only way to find out a lead arrived is
to open `/admin` and look.

Set `LEAD_WEBHOOK_URL` to any HTTPS endpoint that accepts a JSON POST — a Slack
or Discord incoming webhook, or a free Make / Zapier / n8n scenario that turns
it into an email or a WhatsApp message. The payload carries `text` and
`content` (so Slack and Discord both render it) plus structured fields.

The notification deliberately leaves out the visitor's **phone number and
message**. Those stay in D1 behind the admin token rather than being copied
into a chat history; the notification says who got in touch and points at the
panel holding the rest. To include them, edit `notifyLead` in
`worker/index.js` — and consider where that chat history actually lives first.

The webhook is never the system of record. If it fails, the lead is already
stored and the failure is a log line.

## Testing

There is no linter or type checker. There are three checks, and they are quick:

```bash
python tools/build_dist.py          # rebuild dist/ — must succeed
node tools/test_case_engine.mjs     # 57 checks on the case study arithmetic
python tools/test_api.py            # 46 checks on the API (Worker must be running)
```

`tools/test_api.py` needs `npx wrangler dev --local --port 8899` in another
terminal. It covers booking validation, both rate limits, the admin
brute-force throttle and the analytics ingest, against a real Worker. Run it
before any deploy that touches `worker/`.

`node --check` catches syntax only, and it silently passes anything in
`admin/case-studies/` because it parses those as CommonJS. After editing
`js/main.js`, load the page and confirm it renders — that is the real test.

Then check by hand: the page renders, no console errors, scrolling moves
through all seven stages, a service card reveals its image on hover, the
booking modal opens and validates, and the lamp lights and goes dark.

## Deploying

Cloudflare Workers Builds deploys `main` automatically, usually within a
minute. `dist/` is committed because it is what gets served — so **edit the
source, run `python tools/build_dist.py`, and commit both**. Editing `dist/`
directly puts a change live once and loses it on the next build.

```bash
python tools/build_dist.py
git add -A && git commit && git push      # Workers Builds takes it from here
```

Verify against the live URL afterwards rather than assuming: a queued build
looks identical to a finished one from here.

### Rolling back

Cloudflare keeps previous versions. Dashboard → Workers & Pages → the Worker →
**Deployments**, then roll back to the last good one. That is faster than a
revert commit and does not wait for a build. Follow it with a `git revert` so
the repository matches what is live.

### Watching it

`observability.enabled` is on in `wrangler.jsonc`, so `console.error` and
`console.warn` from the Worker are retained and searchable in the dashboard
under the Worker's **Logs** tab (included free: 200k events/day, 3 days). The
Worker logs on faults only — a failed booking insert, a failed lead webhook,
the analytics daily cap being hit. For a live stream: `npx wrangler tail`.

## Going public

The site is currently closed to search engines on purpose: `robots.txt`
disallows everything and every response carries `X-Robots-Tag: noindex`.

One switch opens it. In `tools/build_dist.py`:

```python
SITE_URL = "https://the-real-domain.example"   # no trailing slash
```

Rebuild and the same script emits canonical URLs, Open Graph and Twitter cards
on all ten public pages, writes `sitemap.xml`, and flips robots and the
noindex header. `/admin` stays disallowed and noindex either way. Leave
`SITE_URL` empty and nothing changes.

Do not point it at the workers.dev address unless that really is the address
the business will publish — a canonical URL is a promise about where a page
permanently lives.

Before flipping it, replace the Open Graph image: it currently falls back to
`assets/wewave-mark.png`, which is the logo mark, not a 1200×630 social card.

## Known and deliberate

- All five service images load eagerly (190 KB). Accepted: it keeps the first
  hover instant. The client logos ship as lossless WebP with a PNG fallback.
- `MEETING_MAILTO` in `js/meeting-modal.js` is the fallback address used when
  the API is unreachable. Confirm it is the right inbox.
- `build.py` and `wewave-standalone.html` (a single-file copy for sharing
  outside a web host) were deleted on 2026-10-16. The generator only knew
  `index.html`, `css/style.css` and `js/main.js`, so it could not produce a
  current copy -- the last one it made had no case studies, no gallery and the
  old service cards. Recover from git history if a single-file copy is ever
  wanted again, but expect to rewrite the generator.
