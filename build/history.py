#!/usr/bin/env python3
"""Rating / ranking history, rebuilt from the recorded data on every build (no snapshots needed).

Players: the Elo replay in build/elo.py leaves each player's per-match trajectory (points + rank
after every recorded match, and their starting point) on p["_traj"]; this turns it into the
compact chart series. The last point always equals the live profile numbers.

Teams: team points come from completed, dated events (placement points x tier x a 2-year
half-life). Recomputing that table as of every completed event date gives each team's points
and rank back to the first recorded event.

Output (compact, to keep data.json small):
  data["historyEvents"]  = [[slug, name, date], ...]                 shared event table
  player["rh"] = [[eventIdx, pts, rank, opponent, result], ...]    result W/L/D, "S" = start, eventIdx -1 = now
  team["rh"]   = [[eventIdx, pts, rank, played], ...]               played 1 = the team played that event
"""
from collections import defaultdict


def build(pro, teams, tournaments, team_fns):
    ev_index, events = {}, []

    def ev(slug, name, date):
        if slug not in ev_index:
            ev_index[slug] = len(events)
            events.append([slug, name, date or ""])
        return ev_index[slug]

    # ------------------------------------------------------------------ players (from the Elo replay)
    ladder = sorted(pro, key=lambda p: -(p["ratingPoints"] if p.get("ratingPoints") is not None else -1))
    page_rank = {p["slug"]: i + 1 for i, p in enumerate(ladder)}          # = the Players page order
    for p in pro:
        tr = p.pop("_traj", None)
        if not tr:
            continue
        h = [[ev(slug, name, date), pts, rk, opp, res] for slug, name, date, pts, rk, opp, res in tr]
        r_now = page_rank.get(p["slug"])
        if p.get("ratingPoints") is not None and (h[-1][1] != p["ratingPoints"] or h[-1][2] != r_now):
            h.append([-1, p["ratingPoints"], r_now, "", "N"])          # others kept playing after their last match
        p["rh"] = h

    # ------------------------------------------------------------------ teams
    placement_points, group_points, tier_mult, halflife, pdate = team_fns
    done = sorted((tr for tr in tournaments if tr.get("champion") and tr.get("date")), key=lambda t: t["date"])
    ranked_slugs = {t["slug"] for t in teams if not t.get("provisional")}
    by_date = defaultdict(list)
    for tr in done:
        by_date[tr["date"]].append(tr)

    def table(asof, counted):
        ref = pdate(asof)
        out = defaultdict(float)
        for tr in counted:
            w = 0.5 ** ((ref - pdate(tr["date"])).days / halflife)
            mult = tier_mult.get(tr["tier"], 1.0)
            stlist = tr.get("finalStandings") or tr.get("standings") or []
            grp = sorted(s["rank"] for s in stlist if str(s.get("result") or "").startswith("Group") and s.get("rank") is not None)
            gpos = {r: i for i, r in enumerate(grp)}
            for s in stlist:
                if not s.get("teamSlug"):
                    continue
                is_g = str(s.get("result") or "").startswith("Group")
                base = group_points(gpos.get(s["rank"], 0)) if is_g else placement_points(s["rank"])
                out[s["teamSlug"]] += base * mult * w
        return out

    thist = defaultdict(list)
    counted = []
    for d in sorted(by_date):
        counted += by_date[d]
        tbl = table(d, counted)
        ranked = sorted((s for s in tbl if s in ranked_slugs and tbl[s] > 0), key=lambda s: (-tbl[s], s))
        rk = {s: i + 1 for i, s in enumerate(ranked)}
        playing = {row.get("teamSlug") for tr in by_date[d] for row in (tr.get("finalStandings") or tr.get("standings") or [])}
        last = by_date[d][-1]
        e = ev(last["slug"], last["name"], last.get("date"))
        for s, v in tbl.items():
            if v > 0:
                thist[s].append([e, round(v), rk.get(s), 1 if s in playing else 0])
    for t in teams:
        h = thist.get(t["slug"])
        if not h:
            continue
        # "now": the live table decays to the newest event date, so finish on the team page's own numbers
        if h[-1][1] != t.get("rank_points") or h[-1][2] != t.get("rank"):
            h.append([-1, t.get("rank_points"), t.get("rank"), 0])
        t["rh"] = h

    return {"events": events}
