# WeWave — studio site

A single-page site built as scroll choreography: seven fixed full-viewport
"stages" that crossfade against a tall scroll driver, rather than a normal
document that scrolls past. One interpolated timeline drives stage opacity and
travel, the palette (dark → cream → dark), the glowing ribbon canvas, the
services rail, and the process steps — so everything moves on the same clock.

**Live preview:** https://wewave-preview.proximal-aristosuchus-829.workers.dev

## Editing

Only three files matter:

| File | What's in it |
|---|---|
| `index.html` | All copy and page structure |
| `css/style.css` | All styling, responsive rules, reduced-motion fallback |
| `js/main.js` | The scroll engine, palette interpolation, ribbon canvas |

To preview locally, serve the folder (opening `index.html` directly works, but
serving avoids browser file:// restrictions):

```bash
python -m http.server 8000
```

Then open http://localhost:8000

### Tuning the motion

Two tables at the top of `js/main.js` control almost all of the pacing:

- `STAGES` — where each section starts and ends on the 0→1 timeline. Widen a
  window to give a section more scroll before it hands over.
- `PALETTE` — background, text, and accent colours at each point in the
  timeline. Values interpolate between entries.

## Deploying

`dist/` is the deployable folder and is committed, so no build step is needed
in CI. Configure the host with **no build command** and output directory
`dist`. It carries `robots.txt` and `_headers` (`X-Robots-Tag: noindex`) so the
preview stays out of search results — remove both when the site goes public.

Regenerate `dist/` after editing the source:

```bash
python tools/build_dist.py
```

## Scripts

| Script | Purpose |
|---|---|
| `tools/build_dist.py` | Builds `dist/` for hosting |
| `tools/crop_logo_sheet.py` | Slices a transparent logo sheet into one PNG per client |
| `tools/extract_logos.py` | Keys logos off white cards (used for the first batch) |
| `build.py` | Builds `wewave-standalone.html`, a single self-contained file |

Adding client logos: drop a background-removed sheet of them side by side, then

```bash
python tools/crop_logo_sheet.py "path/to/sheet.png"
```

Update the `NAMES` list in that script to match the left-to-right order, then
add matching `.chip` rules in `css/style.css` and markup in `index.html`.

## Still to do

- Real testimonials — the three quotes are placeholders
- Confirm the contact address (`hello@wewave.studio` is a guess)
- Remaining client logos: Khalid Khoory Cargo, Mersal, Maleha, Swimfit, Chowze
- Real social links
