# Service hover images

One photograph per service, named after the service slug. Dropping a file here
and re-running `python tools/build_shots.py` is the whole wiring — no code
change.

    competitor-market-analysis.jpg
    content-strategy.jpg
    media-buying.jpg
    photography-reels.jpg
    copywriting.jpg
    brand-identity.jpg
    trend-monitoring.jpg
    performance-reporting.jpg
    web-development.jpg

## Where these came from

All nine are from **Unsplash**, under the [Unsplash
License](https://unsplash.com/license): free to use for commercial purposes,
no permission needed, no attribution required. They were each opened and
checked before being committed — several candidates were rejected along the
way for showing other companies' trademarks or for not matching the service.

They are placeholders in the sense that matters: **WeWave's own work would be
better.** Real photography from a client shoot is more honest, more
distinctive, and proves the service rather than illustrating it. Replace any
file here with the same filename whenever you have one.

## Guidance for replacements

- Landscape, around 760x590, JPEG, under ~60 KB each.
- Composition matters more than subject. The card darkens the image, lifts
  contrast slightly and softens it by 2px behind a readability scrim, so busy
  or high-contrast shots turn to mush. One clear subject reads best.
- Avoid other brands' logos and trademarks — they end up on a commercial page.
- A missing file paints nothing at all: no broken image, no failed request.
  The card simply keeps its line icon. Add them one at a time if easier.

## Loading

`css/service-shots.css` gates every rule behind `.stage-services.live`, so the
browser does not fetch these until the Services stage first appears. That keeps
about a third of a megabyte off the initial page load.
