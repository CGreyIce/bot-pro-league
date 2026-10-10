#!/usr/bin/env python3
"""Yearly awards and Player of the Month (from 2026-10-05).

Yearly awards, for every finished year (2020-2025 now; 2026 only once "BPL Conquerors Stage 2026" has a champion,
the same rule as the Top 20 countdown):
  Player of the Year   the #1 of that year's Top 20 countdown (the published articles), else the formula #1
  Rookie of the Year   the best player whose first BPL event was that year
  Most Improved        the biggest climb on the year's player list versus the year before (top 20 this year)
  Team of the Year     the most placement points won that year (Major 5x, S-Tier 2.5x / sub-tier, A-Tier 1x)
  Best Upset           the winner with the lowest pre-match chance (player-Elo odds where recorded, else the
                       team results Elo from build/team_rank.py)
The player list uses the Top 20 "Balanced" formula: team success x (pre-2026 career rating / 1150)^1.5, with plain
tier weights up to 2025 (as published); from 2026 the prize-pool sub-tier weights and the current Rating Points.

Player of the Month: the best average map rating in a calendar month of recorded scoreboards (match record
time), minimum 8 maps.
"""
import re
from collections import Counter, defaultdict
from datetime import datetime

TIER = {"major": 5.0, "s": 2.5, "a": 1.0}
MAJOR_2026 = "bplconquerorsstage2026"
POTM_MIN_MAPS = 8


def _norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def placement_points(rank):
    return (100 if rank == 1 else 70 if rank == 2 else 45 if rank <= 4 else 25 if rank <= 8 else 12 if rank <= 12
            else 7 if rank <= 16 else 5 if rank <= 24 else 3 if rank <= 32 else 2)


def _matches(tr):
    if tr.get("stages"):
        return [(f"{st['id']}-{m['i']}", m) for st in tr["stages"] for rd in st["rounds"] for m in rd["matches"]]
    return [(str(m.get("i")), m) for rd in tr.get("bracket", []) for m in rd["matches"]]


def _rating(pl, R):
    return (0.44 * (pl.get("k", 0) / R / 0.707) + 0.25 * ((R - pl.get("d", 0)) / R / 0.293)
            + 0.24 * (pl.get("score", 0) / R / 1.793) + 0.07 * (pl.get("a", 0) / R / 0.108))


def _seed(p, year):
    if year >= 2026:
        return p.get("ratingPoints") or 1150
    rh = p.get("rh") or []
    if rh and rh[0][4] == "S":
        return rh[0][1]
    return p.get("ratingPoints") or 1150


def year_list(tournaments, by_slug, year):
    """[(slug, score)] best first, plus {teamSlug: points} for the year."""
    evs = [t for t in tournaments if (t.get("date") or "").startswith(str(year)) and t.get("champion")]
    count = Counter((pl["slug"], _norm(r["team"])) for t in evs for r in t.get("attending", []) for pl in r["players"] if pl.get("slug"))
    score, team_pts = defaultdict(float), defaultdict(float)
    for tr in evs:
        mult = tr.get("pointsMult") if year >= 2026 and tr.get("pointsMult") else TIER.get(tr["tier"], 1.0)
        chosen = {}
        for r in tr.get("attending", []):
            for pl in r["players"]:
                s = pl.get("slug")
                if s and (s not in chosen or count[(s, _norm(r["team"]))] > count[(s, _norm(chosen[s]["team"]))]):
                    chosen[s] = r
        stl = tr.get("finalStandings") or tr.get("standings") or []
        rank = {}
        for x in stl:
            rank[_norm(x.get("name") or x.get("team"))] = x.get("rank")
            if x.get("teamSlug"):
                rank[x["teamSlug"]] = x.get("rank")
                if x.get("rank"):
                    team_pts[x["teamSlug"]] += placement_points(x["rank"]) * mult
        for r in tr.get("attending", []):
            rk = rank.get(r.get("teamSlug")) or rank.get(_norm(r["team"]))
            if not rk:
                continue
            for pl in r["players"]:
                if pl.get("slug") in by_slug and chosen.get(pl["slug"]) is r:
                    score[pl["slug"]] += placement_points(rk) * mult
    ranked = sorted(score, key=lambda s: -(score[s] * (_seed(by_slug[s], year) / 1150) ** 1.5))
    return ranked, team_pts


def _top20_no1(articles, year):
    a = next((x for x in articles if x.get("slug", "").startswith(f"top-20-players-{year}-01-")), None)
    if not a:
        return None
    m = re.search(r"#1 (.+)$", a.get("title", ""))
    return m.group(1).strip() if m else None


def best_upset(tournaments, year):
    best = None
    for tr in tournaments:
        if not (tr.get("date") or "").startswith(str(year)) or not tr.get("champion"):
            continue
        for ref, m in _matches(tr):
            if m.get("w") not in (1, 2) or "(bye)" in (m.get("a"), m.get("b")):
                continue
            pa = m.get("odds") if m.get("odds") is not None else m.get("tE")
            if pa is None:
                continue
            chance = pa if m["w"] == 1 else 1 - pa
            if best is None or chance < best["chance"]:
                win, lose = (m["a"], m["b"]) if m["w"] == 1 else (m["b"], m["a"])
                sw, sl = (m.get("sa"), m.get("sb")) if m["w"] == 1 else (m.get("sb"), m.get("sa"))
                best = {"chance": round(chance, 3), "winner": win, "loser": lose, "score": f"{sw}-{sl}" if sw is not None else "",
                        "winnerSlug": m.get("aTeam") if m["w"] == 1 else m.get("bTeam"),
                        "loserSlug": m.get("bTeam") if m["w"] == 1 else m.get("aTeam"),
                        "event": tr["name"], "slug": tr["slug"], "ref": ref}
    return best


def player_of_month(tournaments, by_slug):
    agg = defaultdict(lambda: defaultdict(lambda: {"maps": 0, "rt": 0.0, "team": ""}))
    for tr in tournaments:
        for _, m in _matches(tr):
            maps = (m.get("stats") or {}).get("maps") or []
            if not maps:
                continue
            when = datetime.fromtimestamp(m["ts"]).strftime("%Y-%m") if m.get("ts") else (tr.get("date") or "")[:7]
            if not when:
                continue
            for mp in maps:
                R = (mp.get("scoreA") or 0) + (mp.get("scoreB") or 0)
                if not R:
                    continue
                for pl in mp.get("players", []):
                    s = pl.get("slug")
                    if s in by_slug:
                        a = agg[when][s]
                        a["maps"] += 1; a["rt"] += _rating(pl, R); a["team"] = pl.get("team") or a["team"]
    out = []
    for month in sorted(agg):
        pool = {s: a for s, a in agg[month].items() if a["maps"] >= POTM_MIN_MAPS}
        if not pool:
            continue
        s, a = max(pool.items(), key=lambda kv: kv[1]["rt"] / kv[1]["maps"])
        p = by_slug[s]
        out.append({"month": month, "slug": s, "name": p["name"], "iso": p.get("iso", ""), "team": a["team"],
                    "rating": round(a["rt"] / a["maps"], 2), "maps": a["maps"]})
    return out


def run(tournaments, players, teams, articles):
    by_slug = {p["slug"]: p for p in players}
    team_by = {t["slug"]: t for t in teams}
    for p in players:
        p.pop("awards", None)
    def give(slug, award, year):
        if slug in by_slug:
            by_slug[slug].setdefault("awards", []).append({"award": award, "year": year})

    debut = {}
    for tr in tournaments:
        y = (tr.get("date") or "")[:4]
        for r in tr.get("attending", []):
            for pl in r["players"]:
                if pl.get("slug") and y and (pl["slug"] not in debut or y < debut[pl["slug"]]):
                    debut[pl["slug"]] = y
    years = sorted({int(t["date"][:4]) for t in tournaments if t.get("date") and t.get("champion")})
    major26 = any(_norm(t["name"]) == MAJOR_2026 and t.get("champion") for t in tournaments)
    out, prev_rank = {}, {}
    for y in years:
        if y >= 2026 and not (y == 2026 and major26):
            continue
        ranked, team_pts = year_list(tournaments, by_slug, y)
        if not ranked:
            continue
        rank = {s: i + 1 for i, s in enumerate(ranked)}
        aw = {}
        name1 = _top20_no1(articles, y)
        poy = next((s for s in ranked if name1 and _norm(by_slug[s]["name"]) == _norm(name1)), ranked[0])
        aw["poy"] = {"slug": poy, "name": by_slug[poy]["name"]}
        rook = next((s for s in ranked if debut.get(s) == str(y)), None) if y != years[0] else None   # year one: everyone debuted
        if rook:
            aw["rookie"] = {"slug": rook, "name": by_slug[rook]["name"], "rank": rank[rook]}
        if prev_rank:
            cands = [(prev_rank[s] - rank[s], s) for s in ranked[:20] if s in prev_rank and prev_rank[s] > rank[s]]
            if cands:
                gain, s = max(cands)
                aw["improved"] = {"slug": s, "name": by_slug[s]["name"], "from": prev_rank[s], "to": rank[s]}
        if team_pts:
            ts = max(team_pts, key=team_pts.get)
            if ts in team_by:
                aw["team"] = {"slug": ts, "name": team_by[ts]["name"], "pts": round(team_pts[ts])}
        up = best_upset(tournaments, y)
        if up:
            aw["upset"] = up
        out[str(y)] = aw
        for key, label in (("poy", "Player of the Year"), ("rookie", "Rookie of the Year"), ("improved", "Most Improved Player")):
            if key in aw:
                give(aw[key]["slug"], label, y)
        prev_rank = rank
    potm = player_of_month(tournaments, by_slug)
    for x in potm:
        give(x["slug"], "Player of the Month", x["month"])
    # Top 20 Players of the Year (the published countdown articles): every listed player gets their placing.
    # The #1 already holds Player of the Year for that year, so they don't get a second chip for it.
    by_name = {}
    for p in players:
        for nm in [p["name"]] + list(p.get("aka") or []):
            by_name.setdefault(_norm(nm), p["slug"])
    t20 = 0
    for a in articles:
        m = re.match(r"top-20-players-(\d{4})-(\d{2})-", a.get("slug", ""))
        nm = re.search(r"#\d+ (.+)$", a.get("title", ""))
        if not m or not nm:
            continue
        year, rank, slug = int(m.group(1)), int(m.group(2)), by_name.get(_norm(nm.group(1)))
        if not slug:
            continue
        if rank == 1 and any(x["award"] == "Player of the Year" and x["year"] == year for x in by_slug[slug].get("awards", [])):
            continue
        by_slug[slug].setdefault("awards", []).append({"award": f"Top 20 Players of {year}", "year": year, "rank": rank,
                                                       "link": f"#/article/{a['slug']}"})
        t20 += 1
    print(f"awards: {len(out)} years of awards, {len(potm)} Players of the Month, {t20} Top 20 placings")
    return {"yearAwards": out, "playerOfMonth": potm}
