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
- **Kill heatmaps** (`#/heatmaps`, linked from Maps; since 6 Nov 2026):
  - **Where the kills come from:** the BPL Bots launcher sends each BPL map it plays with its kills (who killed whom, from where, with what). `manual.save_kills` keeps them in `data/kills/<event>/<match>.json`, not in `match_stats.json`, and keeps a map's stored kills when its scoreboard is edited by hand.
  - **The build:** `build/heatmaps.py` (run by `parse.py`) writes one file per map, `site/heatmaps/<Map>.json`, plus `index.json`. The page loads one map at a time, so `data.json` doesn't grow.
  - **The map:** its floor is drawn from the map's bot navigation mesh (`data/heatmap_nav/<Map>.json`, exported by bpl-bots `tools/heatmap_nav.py`), not Valve's radar images.
  - **Filters:** kills or deaths, side, team, player and event.
- A fan project. Stats from the BPL master sheet; historical brackets imported from Challonge.
