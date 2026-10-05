#!/usr/bin/env python3
"""Deploy guard: refuse to publish a broken build. Run by the admin Publish button (before it commits)
and by the GitHub Pages workflow (before it deploys), so a bad build never reaches the live site.

Checks: site/data.json parses and has players/teams/tournaments; Site Health has no errors; every
script and stylesheet index.html loads exists. Exit code 1 (and a list of problems) if anything fails.
Warnings and notes from Site Health never block a deploy.
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(ROOT, "site")


def problems():
    out = []
    try:
        with open(os.path.join(SITE, "data.json"), encoding="utf-8") as f:
            d = json.load(f)
    except Exception as e:
        return [f"site/data.json is missing or not valid JSON ({e.__class__.__name__}: {str(e)[:120]})"]
    for key in ("players", "teams", "tournaments"):
        if not d.get(key):
            out.append(f"site/data.json has no {key}; the build looks incomplete.")
    h = d.get("health") or {}
    errs = [i for i in h.get("issues", []) if i.get("level") == "error"]
    for i in errs:
        out.append(f"Site Health ({i.get('check')}): {i.get('msg')}")
    if not h:
        out.append("site/data.json has no Site Health results; run build/parse.py first.")
    try:
        with open(os.path.join(SITE, "index.html"), encoding="utf-8") as f:
            html = f.read()
        for ref in re.findall(r'(?:src|href)="([^"#:]+?)(?:\?[^"]*)?"', html):
            if ref.endswith((".js", ".css")) and not os.path.exists(os.path.join(SITE, ref)):
                out.append(f"index.html loads {ref}, but that file doesn't exist.")
    except OSError:
        out.append("site/index.html is missing.")
    return out


if __name__ == "__main__":
    ps = problems()
    gh = os.environ.get("GITHUB_ACTIONS") == "true"
    for p in ps:
        print(f"::error::{p}" if gh else f"  x {p}")
    print(f"deploy check: {'BLOCKED, ' + str(len(ps)) + ' problem(s)' if ps else 'ok'}")
    sys.exit(1 if ps else 0)
