"""
Build the single-file version of the site from the 3-file source.

    python build.py [profile_url]

Inlines css/style.css and js/main.js, embeds the logo mask as a data URI, and
rewrites the company-profile link to `profile_url` (needed for the hosted
artifact, which cannot reach a local PDF). Output: wewave-standalone.html
"""
import base64
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).parent
PROFILE_URL = sys.argv[1] if len(sys.argv) > 1 else "assets/wewave-profile.pdf"

html = (ROOT / "index.html").read_text(encoding="utf-8")
css = (ROOT / "css/style.css").read_text(encoding="utf-8")
js = (ROOT / "js/main.js").read_text(encoding="utf-8")

# logo -> data URI so the page carries its own artwork
mark_b64 = base64.b64encode((ROOT / "assets/wewave-mark-sm.png").read_bytes()).decode()
css = css.replace("../assets/wewave-mark.png", f"data:image/png;base64,{mark_b64}")

# client logos -> data URIs (the hosted page can't reach assets/ either)
for logo in sorted((ROOT / "assets/clients").glob("*.png")):
    b64 = base64.b64encode(logo.read_bytes()).decode()
    html = html.replace(
        f'src="assets/clients/{logo.name}"', f'src="data:image/png;base64,{b64}"'
    )

# the web-weight profile rides along so the hosted page can still hand it over
pdf = ROOT / "assets/wewave-profile-web.pdf"
pdf_b64 = base64.b64encode(pdf.read_bytes()).decode()
profile_payload = f'<script>window.__PROFILE_PDF="{pdf_b64}";</script>'

# artifacts supply their own <!doctype>/<head>/<body>, so keep only the content
head = re.search(r"<title>.*?</title>", html, re.S).group(0)
fonts = "\n".join(re.findall(r'<link[^>]*fonts\.[^>]*>', html))
body = re.search(r"<body>(.*)</body>", html, re.S).group(1)

# swap external references for inlined equivalents
body = re.sub(r'<script src="js/main\.js"></script>', "", body)
body = body.replace('href="assets/wewave-profile.pdf"', f'href="{PROFILE_URL}"')

out = f"""{head}
{fonts}

<style>
{css}
</style>
{body}
{profile_payload}
<script>
{js}
</script>
"""

target = ROOT / "wewave-standalone.html"
target.write_text(out, encoding="utf-8")
kb = target.stat().st_size / 1024
print(f"built {target.name}  ({kb:.0f} KB)  profile -> {PROFILE_URL}")
