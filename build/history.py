#!/usr/bin/env python3
"""Rating / ranking history, rebuilt from the recorded data on every build (no snapshots needed).

Players: the Elo replay in build/elo.py leaves each player's per-match trajectory (points + rank
after every recorded match, and their starting point) on p["_traj"]; this turns it into the
compact chart series. The last point always equals the live profile numbers.

Teams: build/team_rank.py recomputes the team table as of every completed event date (placements x
field x core rule + results Elo, 2-year half-life) and leaves it on t["_rh"]; this converts it.

Output (compact, to keep data.json small):
  data["historyEvents"]  = [[slug, name, date], ...]                 shared event table
  player["rh"] = [[eventIdx, pts, rank, opponent, result], ...]    result W/L/D, "S" = start, eventIdx -1 = now
  team["rh"]   = [[eventIdx, pts, rank, played], ...]               played 1 = the team played that event
  team["peak"] = {"rank", "date"}   best rank + the first date it was reached (players' peak comes from elo.py)
"""


def build(pro, teams):
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

    # ------------------------------------------------------------------ teams (from build/team_rank.py)
    for tm in teams:
        tr = tm.pop("_rh", None)
        if not tr:
            continue
        h = [[ev(slug, name, d), pts, rk, played] for slug, name, d, pts, rk, played in tr]
        # "now": the live table decays to the newest event date, so finish on the team page's own numbers
        if h[-1][1] != tm.get("rank_points") or h[-1][2] != tm.get("rank"):
            h.append([-1, tm.get("rank_points"), tm.get("rank"), 0])
        tm["rh"] = h

    # team peak rank: best rank across the as-of-each-event tables (first date reached); "now" = newest event
    now_date = max((e[2] for e in events if e[2]), default="")
    for tm in teams:
        best = None
        for e, pts, rk, played in tm.get("rh") or []:
            if rk and (best is None or rk < best[0]):
                best = (rk, events[e][2] if e >= 0 else now_date)
        if best:
            tm["peak"] = {"rank": best[0], "date": best[1]}

    return {"events": events}
