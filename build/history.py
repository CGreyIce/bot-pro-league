#!/usr/bin/env python3
"""Rating / ranking history, REBUILT from the recorded data on every build (no snapshots needed).

Players: a player's tournament stats only grow through recorded per-map scoreboards, so replaying
those matches in the order they were recorded gives their exact Rating Points and league rank
after every recorded match (the site-run era). The replay uses the same formula and league
averages as the live rating, so the last point always equals the profile.

Teams: team points come from completed, dated events (placement points x tier x a 2-year
half-life). Recomputing that table as of every completed event date gives each team's points
and rank back to the first recorded event.

Output (compact, to keep data.json small):
  data["historyEvents"]  = [[slug, name, date], ...]                 shared event table
  player["rh"] = [[eventIdx, pts, rank, opponent, result], ...]    result W/L/D, "S" = start, eventIdx -1 = now
  team["rh"]   = [[eventIdx, pts, rank, played], ...]               played 1 = the team played that event
"""
from collections import defaultdict
from datetime import datetime


def _ts_key(tr, m):
    """Chronological key: when the result was recorded (real time); events without a record
    time fall back to their date."""
    if m.get("ts"):
        return m["ts"]
    try:
        return datetime.fromisoformat(tr.get("date") or "2000-01-01").timestamp()
    except ValueError:
        return 0


def _matches(tr):
    if tr.get("stages"):                       # stages OR bracket, never both (shared objects)
        return [m for st in tr["stages"] for rd in st["rounds"] for m in rd["matches"]]
    return [m for rd in tr.get("bracket", []) for m in rd["matches"]]


def build(pro, teams, tournaments, avg, weights, points_fn, contrib_fn, norm_key, team_fns, now_ts=None):
    """-> {"events": shared event table, "climbers": biggest rank gains over the last 7 days of play}"""
    ev_index, events = {}, []

    def ev(tr):
        if tr["slug"] not in ev_index:
            ev_index[tr["slug"]] = len(events)
            events.append([tr["slug"], tr["name"], tr.get("date", "")])
        return ev_index[tr["slug"]]

    # ------------------------------------------------------------------ players
    K = 20.0

    def rating_pts(st):
        """Exactly compute_ratings' formula (incl. its K/D and win-rate rounding) for totals st."""
        k, d, a, mvp, w, l = st
        n = w + l
        if n <= 0:
            return None
        kdr = round(k / d, 2) if d else 0.0
        wr = round(w / n, 3)
        shrink = lambda ratio: (n * ratio + K * 1.0) / (n + K)
        r = (weights["kdr"] * shrink(kdr / avg["kdr"]) +
             weights["kpm"] * shrink((k / n) / avg["kpm"] if avg["kpm"] else 1) +
             weights["mvppm"] * shrink((mvp / n) / avg["mvp"] if avg["mvp"] else 1) +
             weights["apm"] * shrink((a / n) / avg["apm"] if avg["apm"] else 1) +
             weights["wr"] * shrink(wr / avg["wr"] if avg["wr"] else 1))
        return points_fn(r)

    order = [p["slug"] for p in pro]                  # final list order = the Players page tie order
    idx = {s: i for i, s in enumerate(order)}
    final = {p["slug"]: [p["kills"], p["deaths"], p["assists"], p["mvp"], p["wins"], p["losses"]] for p in pro}

    recorded = []
    for tr in tournaments:
        for m in _matches(tr):
            if m.get("stats") and m.get("w") in (1, 2):
                recorded.append((_ts_key(tr, m), tr, m))
    recorded.sort(key=lambda x: x[0])
    contribs = [(k, tr, m, contrib_fn(m)) for k, tr, m in recorded]

    cur = {s: list(v) for s, v in final.items()}      # start = final totals minus every recorded match
    for _, _, _, c in contribs:
        for s, o in c.items():
            if s in cur:
                st = cur[s]
                st[0] -= o["k"]; st[1] -= o["d"]; st[2] -= o["a"]; st[3] -= o["mvp"]; st[4] -= o["w"]; st[5] -= o["l"]
    pts = {s: rating_pts(st) for s, st in cur.items()}

    def rank_of(s):
        p = pts.get(s)
        if p is None:
            return None
        i = idx[s]
        return 1 + sum(1 for o in order if pts[o] is not None and (pts[o] > p or (pts[o] == p and idx[o] < i)))

    hist = defaultdict(list)
    started = set()
    cutoff = (now_ts - 7 * 86400) if now_ts else None
    snap = None                                       # every player's rank just before the 7-day window
    for k, tr, m, c in contribs:
        if cutoff is not None and snap is None and k > cutoff:
            snap = {s: rank_of(s) for s in order}
        e = ev(tr)
        played = [s for s in c if s in cur]
        for s in played:                              # the point before a player's first recorded match
            if s not in started:
                started.add(s)
                if pts[s] is not None:
                    hist[s].append([e, pts[s], rank_of(s), "", "S"])
        for s in played:
            o, st = c[s], cur[s]
            st[0] += o["k"]; st[1] += o["d"]; st[2] += o["a"]; st[3] += o["mvp"]; st[4] += o["w"]; st[5] += o["l"]
            pts[s] = rating_pts(st)
        for s in played:
            o = c[s]
            res = "W" if o["w"] > o["l"] else "L" if o["l"] > o["w"] else "D"
            # opponent = the other team in the match, by the team the player was listed on
            side_a = any(norm_key(pl.get("team", "")) == norm_key(m.get("a", ""))
                         for mp in m["stats"]["maps"] for pl in mp["players"] if pl.get("slug") == s)
            opp = m.get("b") if side_a else m.get("a")
            if pts[s] is not None:
                hist[s].append([e, pts[s], rank_of(s), opp or "", res])
    for p in pro:
        h = hist.get(p["slug"])
        if not h:
            continue
        r_now = rank_of(p["slug"])                    # others kept playing after this player's last match
        if p.get("ratingPoints") is not None and (h[-1][1] != p["ratingPoints"] or h[-1][2] != r_now):
            h.append([-1, p["ratingPoints"], r_now, "", "N"])
        p["rh"] = h

    climbers = []
    if snap:
        maps = {p["slug"]: p.get("maps") or 0 for p in pro}
        for s in order:
            before, now_r = snap.get(s), rank_of(s)
            if before and now_r and before > now_r and maps[s] >= 5:
                climbers.append({"slug": s, "from": before, "to": now_r, "gain": before - now_r})
        climbers.sort(key=lambda x: (-x["gain"], x["to"]))

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
        e = ev(by_date[d][-1])
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

    return {"events": events, "climbers": climbers[:5]}
