"""
Build the case study simulator as ONE self-contained HTML file.

    python tools/build_case_standalone.py [output.html]

Default output: the user's Desktop, as "Case Study Simulator.html".

Why this exists
---------------
The module under `admin/case-studies/` is a set of ES modules served over HTTP
behind the admin token. That is right for the site, and wrong for "I want to
open a tool and build a case study": browsers refuse to load ES module imports
over `file://`, so double-clicking the source `index.html` shows the page but
no working interface.

This script flattens the same source into a single file that needs no server,
no token, no Worker and no network. It is the same code -- the engine, the
presets, the charts and the interface are not forked -- so a fix in one place
reaches both builds.

How the flattening works
------------------------
Each module becomes an IIFE assigned to a namespace constant, and its `import`
lines are rewritten as destructuring from the namespace it referred to. That
preserves module boundaries (and the `E.` / `Store.` call sites in app.js)
without a bundler, which this project deliberately does not have.

Storage in the single file is browser `localStorage` only, flagged by
`window.__WEWAVE_CASE_STANDALONE__`. See the STANDALONE branches in `store.js`.
"""

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "admin" / "case-studies"

# Namespace constant per module, and the load order (dependencies first).
NS = {
    "engine.js": "__ENGINE",
    "presets.js": "__PRESETS",
    "store.js": "__STORE",
    "charts.js": "__CHARTS",
}
ORDER = ["engine.js", "presets.js", "store.js", "charts.js"]

EXPORT_DECL = re.compile(r"^export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)",
                         re.MULTILINE)
IMPORT_NAMED = re.compile(r"^import\s*\{([^}]*)\}\s*from\s*'\./([\w.-]+)';?\s*$", re.MULTILINE)
IMPORT_STAR = re.compile(r"^import\s*\*\s*as\s+([\w$]+)\s+from\s*'\./([\w.-]+)';?\s*$", re.MULTILINE)


def rewrite_imports(src: str) -> str:
    """`import { a, b } from './x.js'` -> `const { a, b } = __X;`"""
    def named(m):
        names, mod = m.group(1).strip(), m.group(2)
        return "const { %s } = %s;" % (" ".join(names.split()), NS[mod])

    def star(m):
        return "const %s = %s;" % (m.group(1), NS[m.group(2)])

    src = IMPORT_NAMED.sub(named, src)
    src = IMPORT_STAR.sub(star, src)
    return src


def to_namespace(filename: str) -> str:
    """Wrap one module as `const __NS = (function(){ ...; return {...}; })();`"""
    src = (SRC / filename).read_text(encoding="utf-8")
    names = EXPORT_DECL.findall(src)
    if not names:
        raise SystemExit("no exports found in %s -- did the syntax change?" % filename)

    body = rewrite_imports(src)
    body = re.sub(r"^export\s+", "", body, flags=re.MULTILINE)
    returned = ", ".join(sorted(set(names)))

    return (
        "/* ---- %s ---- */\n"
        "const %s = (function () {\n%s\nreturn { %s };\n})();\n"
        % (filename, NS[filename], body, returned)
    )


def build_app() -> str:
    """app.js is the entry point: imports rewritten, nothing exported."""
    src = (SRC / "app.js").read_text(encoding="utf-8")
    return "/* ---- app.js ---- */\n(function () {\n%s\n})();\n" % rewrite_imports(src)


def build_html() -> str:
    html = (SRC / "index.html").read_text(encoding="utf-8")
    css = (SRC / "case-studies.css").read_text(encoding="utf-8")

    # The token gate has nothing to authenticate against here.
    start = html.index('<div id="gate"')
    end = html.index('<div id="app"')
    html = html[:start] + html[end:]
    html = re.sub(r'\s*<button[^>]*id="lockBtn"[\s\S]*?</button>', "", html)

    html = html.replace(
        '<link rel="stylesheet" href="case-studies.css">',
        "<style>\n%s\n</style>" % css,
    )

    bundle = "\n".join(to_namespace(f) for f in ORDER) + "\n" + build_app()
    script = (
        "<script>\n"
        "/* Single-file build -- see tools/build_case_standalone.py.\n"
        "   Storage is this browser only; there is no server behind this page. */\n"
        "window.__WEWAVE_CASE_STANDALONE__ = true;\n"
        "</script>\n"
        "<script>\n%s\n</script>" % bundle
    )
    html = html.replace('<script type="module" src="app.js"></script>', script)

    html = html.replace(
        "<title>Case study analytics — WeWave</title>",
        "<title>Case Study Simulator — WeWave</title>",
    )
    html = html.replace(
        "<!DOCTYPE html>",
        "<!DOCTYPE html>\n<!-- Self-contained build: no server, no account, no network.\n"
        "     Every figure inside is hypothetical and typed in by hand.\n"
        "     Rebuild with: python tools/build_case_standalone.py -->",
    )
    return html


def main():
    out = (
        pathlib.Path(sys.argv[1])
        if len(sys.argv) > 1
        else pathlib.Path.home() / "Desktop" / "Case Study Simulator.html"
    )
    html = build_html()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")

    # A leftover bare import would mean a module failed to flatten, and the file
    # would be silently dead when opened. Catch it here rather than in a browser.
    leftovers = re.findall(r"^\s*(?:import|export)\s", html, re.MULTILINE)
    if leftovers:
        raise SystemExit("FAILED: %d import/export statements survived flattening" % len(leftovers))

    print("%s  (%.1f KB)" % (out, out.stat().st_size / 1024))
    print("Self-contained: open it by double-clicking. No server or token needed.")


if __name__ == "__main__":
    main()
