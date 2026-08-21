# Bot Pro League

A Liquipedia / HLTV-style static website for a customized CS2 **bot** competition — teams, players, tournaments, brackets, rankings, transfers, records, awards, map & league stats.

The site is a vanilla-JS single-page app that reads one generated `site/data.json`. No framework, no build step for the front end.

## Live site

Published via GitHub Pages from the [`site/`](site/) folder (see `.github/workflows/deploy.yml`).

## Structure

| Path | What it is |
|------|------------|
| `site/` | The deployable static site (index.html, `css/`, `js/`, `assets/`, `data.json`). This is what GitHub Pages serves. |
| `build/` | Python data pipeline. `parse.py` reads the sources and writes `site/data.json`. |
| `data/` | Source data: stat CSV exports, rosters, tournament definitions (`data/manual/`), scoreboards, name/team changes. |
| `assets/teams/` | Team logos. |

## Rebuilding the data

```bash
python build/parse.py
```

Reads everything in `data/` and regenerates `site/data.json`.

### Local editing / admin

```bash
python build/admin_server.py 8099
```

Serves the site at `http://localhost:8099/` with the in-browser admin (record scoreboards, edit tournaments, etc.) enabled. Admin is local-only — the calls fail silently on the published static site.

## Notes

- **Team ranking points** are computed from tournament placements (tier-weighted, 2-year recency decay) in `build/parse.py`.
- A fan project. Stats from the BPL master sheet; historical brackets imported from Challonge.
