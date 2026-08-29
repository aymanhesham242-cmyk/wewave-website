"""
Assemble dist/ — the folder that gets deployed to Cloudflare Pages.

Deploys the 3-file source (not the single-file build): on a real host the
relative assets resolve normally, so there's no reason to inline 3MB of
base64. The profile button falls back to its plain link, which works here.

Configured to be shareable but not indexed: robots.txt disallows everything
and _headers sends X-Robots-Tag: noindex.

Run:  python tools/build_dist.py
"""
import pathlib
import shutil

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"

if DIST.exists():
    shutil.rmtree(DIST)
DIST.mkdir()

# --- pages ---------------------------------------------------------------
html = (ROOT / "index.html").read_text(encoding="utf-8")
# ship the web-weight profile (2.1MB) rather than the 6.4MB original
html = html.replace("assets/wewave-profile.pdf", "assets/wewave-profile-web.pdf")
(DIST / "index.html").write_text(html, encoding="utf-8")

for rel in ("css/style.css", "js/main.js"):
    dest = DIST / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(ROOT / rel, dest)

# --- assets --------------------------------------------------------------
(DIST / "assets").mkdir()
shutil.copy2(ROOT / "assets/wewave-mark.png", DIST / "assets/wewave-mark.png")
shutil.copy2(
    ROOT / "assets/wewave-profile-web.pdf", DIST / "assets/wewave-profile-web.pdf"
)
shutil.copytree(ROOT / "assets/clients", DIST / "assets/clients")

# --- keep it out of search results ---------------------------------------
(DIST / "robots.txt").write_text(
    "User-agent: *\nDisallow: /\n", encoding="utf-8"
)
(DIST / "_headers").write_text(
    "/*\n"
    "  X-Robots-Tag: noindex, nofollow, noarchive\n"
    "  X-Content-Type-Options: nosniff\n"
    "  Referrer-Policy: strict-origin-when-cross-origin\n",
    encoding="utf-8",
)

total = sum(f.stat().st_size for f in DIST.rglob("*") if f.is_file())
count = sum(1 for f in DIST.rglob("*") if f.is_file())
print(f"dist/ ready — {count} files, {total/1024/1024:.2f} MB")
for f in sorted(DIST.rglob("*")):
    if f.is_file():
        print(f"  {f.relative_to(DIST).as_posix():42s} {f.stat().st_size/1024:8.1f} KB")
