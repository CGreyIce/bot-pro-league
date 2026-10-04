#!/usr/bin/env python3
"""Pro player Rating Points: opponent-aware Elo + individual performance (from 2026-10-05).

Seed: each player's pre-2026 career rating (their sheet stats before any recorded scoreboard,
scored with the old stat formula), or the league average (1150) for players with no career data.
Then every recorded map is replayed in the order it was entered. Per player, per map:

  result = K_RES  * (won - expected)              expected = Elo win chance, team avg points vs opponents'
  perf   = K_PERF * ((map rating - opponents' avg map rating) - expected edge)
           expected edge = EDGE * (own Elo win chance vs those opponents - 0.5)
  change = clamp(result + perf, +-CAP)            (x PLACEMENT for a new player's first PLACE_MAPS maps)

So beating a stronger team pays more than beating a weaker one, losing to a weaker team costs more,
and out-playing stronger opponents earns points even in a loss.

SCALE and EDGE were calibrated on the 519 recorded maps (2026-10-05): favourites on paper win only
~55% of maps in this league, so a points gap is worth far less than in chess (SCALE 2000, not 400).
Players with no recorded maps keep their career rating. Levels/tiers follow the points as before.
"""
from collections import defaultdict
from datetime import datetime

K_RES, K_PERF, EDGE, CAP, SCALE = 24, 30, 0.8, 60, 2000
DEFAULT, PLACEMENT, PLACE_MAPS = 1150, 1.5, 8


def match_rating(k, a, d, score, R):
    """HLTV-style map rating (same as the site's matchRating); ~1.00 = average."""
    if not R:
        return None
    return 0.44 * (k / R / 0.707) + 0.25 * ((R - d) / R / 0.293) + 0.24 * (score / R / 1.793) + 0.07 * (a / R / 0.108)


def expect(a, b):
    return 1 / (1 + 10 ** ((b - a) / SCALE))


def _key(tr, m):
    if m.get("ts"):
        return m["ts"]
    try:
        return datetime.fromisoformat(tr.get("date") or "2000-01-01").timestamp()
    except ValueError:
        return 0


def apply(pro, tournaments, avg, weights, tier_fn, level_cuts, contrib_fn, norm_key, now_ts=None):
    """Replace pro players' rating/ratingPoints/tier/level/rankDelta with the Elo system.
    Leaves p["_traj"] (per-match trajectory) for history.py, and returns {"climbers": [...]}."""
    K = 20.0

    def career_pts(st):                       # the old stat formula, exactly (incl. its rounding)
        k, d, a, mvp, w, l = st
        n = w + l
        if n <= 0:
            return None
        kdr = round(k / d, 2) if d else 0.0
        wr = round(w / n, 3)
        sh = lambda ratio: (n * ratio + K * 1.0) / (n + K)
        r = (weights["kdr"] * sh(kdr / avg["kdr"]) + weights["kpm"] * sh((k / n) / avg["kpm"] if avg["kpm"] else 1) +
             weights["mvppm"] * sh((mvp / n) / avg["mvp"] if avg["mvp"] else 1) +
             weights["apm"] * sh((a / n) / avg["apm"] if avg["apm"] else 1) + weights["wr"] * sh(wr / avg["wr"] if avg["wr"] else 1))
        return max(100, min(3500, 1150 + (r - 1.0) * 3900))

    by = {p["slug"]: p for p in pro}
    order = [p["slug"] for p in pro]
    idx = {s: i for i, s in enumerate(order)}

    # recorded matches, in the order they were entered
    recorded = []
    for tr in tournaments:
        ms = ([m for st in tr["stages"] for rd in st["rounds"] for m in rd["matches"]] if tr.get("stages")
              else [m for rd in tr.get("bracket", []) for m in rd["matches"]])
        for m in ms:
            if m.get("stats") and m.get("w") in (1, 2):
                recorded.append((_key(tr, m), tr, m))
    recorded.sort(key=lambda x: x[0])

    # seeds: career totals before any recorded scoreboard
    base = {p["slug"]: [p["kills"], p["deaths"], p["assists"], p["mvp"], p["wins"], p["losses"]] for p in pro}
    for _, _, m in recorded:
        for s, o in contrib_fn(m).items():
            if s in base:
                b = base[s]
                b[0] -= o["k"]; b[1] -= o["d"]; b[2] -= o["a"]; b[3] -= o["mvp"]; b[4] -= o["w"]; b[5] -= o["l"]
    plays = {s for _, _, m in recorded for s in contrib_fn(m) if s in by}
    elo, seeded, played = {}, {}, defaultdict(int)
    for p in pro:                               # everyone ranked (with or without recorded maps)
        s = p["slug"]
        if s in plays:
            sp = career_pts(base[s])
            elo[s], seeded[s] = (sp, True) if sp is not None else (DEFAULT, False)
        elif p.get("ratingPoints") is not None:
            elo[s] = p["ratingPoints"]           # no recorded maps: keeps the career rating

    def rank_of(s):
        v = elo.get(s)
        if v is None:
            return None
        rv, i = round(v), idx[s]
        return 1 + sum(1 for o in order if o in elo and (round(elo[o]) > rv or (round(elo[o]) == rv and idx[o] < i)))

    # peak rank (osu!-style "Highest Rank"): the whole ladder is re-ranked after every recorded match,
    # so a player can peak when rivals lose too. Ties keep the FIRST date the rank was reached.
    peak = {}
    def update_peaks(when):
        lad = sorted((s for s in order if s in elo), key=lambda s: (-round(elo[s]), idx[s]))
        for i, s in enumerate(lad):
            if s not in peak or i + 1 < peak[s][0]:
                peak[s] = (i + 1, when)
    # tracking starts with the first match that has a real record time: a stray old scoreboard without
    # one must not backdate the (career-seeded) starting ladder to years ago
    start_n = next((i for i, (_, _, m) in enumerate(recorded) if m.get("ts")), None)

    cutoff = (now_ts - 7 * 86400) if now_ts else None
    snap, last_prev, last_players = None, {}, set()
    traj = defaultdict(list)
    started = set()
    for n, (key, tr, m) in enumerate(recorded):
        if n == start_n:
            update_peaks(tr.get("date", ""))                 # the ladder when recorded play began
        if cutoff is not None and snap is None and key > cutoff:
            snap = {s: rank_of(s) for s in order}           # ranks just before the 7-day window
        in_match = {}
        maps_won = defaultdict(lambda: [0, 0])
        before = {}
        for mp in m["stats"]["maps"]:
            sa, sb = mp.get("scoreA"), mp.get("scoreB")
            if sa is None or sb is None:
                continue
            R = sa + sb
            sides = {"a": [], "b": []}
            for pl in mp.get("players", []):
                s = pl.get("slug")
                if s not in elo or s not in by:
                    continue
                side = "a" if norm_key(pl.get("team", "")) == norm_key(m.get("a", "")) else "b"
                sides[side].append((s, match_rating(pl.get("k", 0), pl.get("a", 0), pl.get("d", 0), pl.get("score", 0), R)))
            if not sides["a"] or not sides["b"]:
                continue
            for side in sides:
                for s, _ in sides[side]:
                    before.setdefault(s, elo[s])
                    if s not in started:
                        started.add(s)
                        if seeded.get(s):
                            traj[s].append([tr["slug"], tr["name"], tr.get("date", ""), round(elo[s]), rank_of(s), "", "S"])
            avg_pts = {k: sum(elo[s] for s, _ in v) / len(v) for k, v in sides.items()}
            rt = {k: [r for _, r in v if r is not None] for k, v in sides.items()}
            avg_rt = {k: (sum(v) / len(v) if v else None) for k, v in rt.items()}
            won_a = 1 if sa > sb else 0 if sb > sa else 0.5
            deltas = {}
            for side, opp in (("a", "b"), ("b", "a")):
                S = won_a if side == "a" else 1 - won_a
                E = expect(avg_pts[side], avg_pts[opp])
                for s, r in sides[side]:
                    res = K_RES * (S - E)
                    perf = 0.0
                    if r is not None and avg_rt[opp] is not None:
                        perf = K_PERF * ((r - avg_rt[opp]) - EDGE * (expect(elo[s], avg_pts[opp]) - 0.5))
                    d = res + perf
                    if not seeded.get(s) and played[s] < PLACE_MAPS:
                        d *= PLACEMENT
                    deltas[s] = max(-CAP, min(CAP, d))
                    in_match[s] = m.get("b") if side == "a" else m.get("a")
                    maps_won[s][0 if S == 1 else 1] += 1 if S in (0, 1) else 0
            for s, d in deltas.items():
                elo[s] += d
                played[s] += 1
        for s, opp in in_match.items():
            w, l = maps_won[s]
            traj[s].append([tr["slug"], tr["name"], tr.get("date", ""), round(elo[s]), rank_of(s), opp or "",
                            "W" if w > l else "L" if l > w else "D"])
        if in_match and start_n is not None and n >= start_n:
            update_peaks(tr.get("date", ""))
        if n == len(recorded) - 1:                         # the most recent match drives the rank arrows
            last_prev, last_players = before, set(in_match)

    for p in pro:
        if p["slug"] in peak:
            p["peak"] = {"rank": peak[p["slug"]][0], "date": peak[p["slug"]][1]}

    # write the new numbers onto the players
    for p in pro:
        s = p["slug"]
        if s not in plays:
            continue
        v = elo[s]
        r = 1.0 + (v - 1150) / 3900
        p["ratingPoints"] = int(round(v))
        p["rating"] = round(r, 3)
        p["tier"] = tier_fn(r)
        p["level"] = next((i + 1 for i, cut in enumerate(level_cuts) if p["ratingPoints"] < cut), 10)
        p["eloMaps"] = played[s]
        p["_traj"] = traj.get(s, [])

    # rank movement vs. before the most recent recorded match (only its players get an arrow)
    cur = sorted((s for s in order if by[s].get("ratingPoints") is not None), key=lambda s: (-by[s]["ratingPoints"], idx[s]))
    cur_rank = {s: i + 1 for i, s in enumerate(cur)}
    prev_val = {s: (round(last_prev[s]) if s in last_prev else by[s]["ratingPoints"]) for s in cur}
    prev_order = sorted(cur, key=lambda s: (-prev_val[s], cur_rank[s]))
    prev_rank = {s: i + 1 for i, s in enumerate(prev_order)}
    for p in pro:
        s = p["slug"]
        p["rankDelta"] = (prev_rank[s] - cur_rank[s]) if (s in cur_rank and s in last_players) else 0

    climbers = []
    if snap:
        for s in order:
            b, now_r = snap.get(s), rank_of(s)
            if b and now_r and b > now_r and (by[s].get("maps") or 0) >= 5:
                climbers.append({"slug": s, "from": b, "to": now_r, "gain": b - now_r})
        climbers.sort(key=lambda x: (-x["gain"], x["to"]))
    print(f"elo: {len(plays)} players rated from {len(recorded)} recorded matches")
    return {"climbers": climbers[:5]}
