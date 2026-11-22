"""Solo Queue seasons (build/parse.py; 23 Nov 2026, user).

A season is a stretch of dated solo games. The dates live in data/solo_seasons.json: each season ends the day
before the next one starts, and a new season starts every `months` months on its own ("Season N").
The Preseason is everything before Season 1: the old solo sheet's totals plus every solo game up to its end.

The rules, the same for everyone:
- Placement: a player's final rating last season, one Level down, at the same spot inside the lower Level
  (Level 1 stays Level 1). Only players who were ranked last season get one; anyone else starts at the
  average.
- Season rating: the usual solo formula on this season's own games, plus the placement, which fades as
  they play: rating = formula(season) + (placement - 1) * K / (games + K), K = 15. So the placement is
  half of it after 15 games and a quarter after 45.
- Ranked once they've played MIN games this season. Until then they're "in placements".
- Peak: their best rating points and their best rank while ranked, each with the date it happened, checked
  after every game of the season (a human's rank is where they'd sit on the bots' board).
- Final standings lock GRACE_DAYS after a season ends (data/solo_season_finals.json) and never change.

Career solo stats never reset: the Overall views and BPL Bots' play rating (which reads them) stay all-time.
"""
import bisect
import calendar
import datetime as dt
import json
import os

GRACE_DAYS = 3          # late games (a PC that synced late) still count this long after a season ends
PLACEMENT_K = 15.0      # the solo formula's own win-rate half-weight, so the placement fades as the results come in
LEVEL_CUTS = [501, 751, 901, 1051, 1201, 1351, 1531, 1751, 2001]   # parse.py _LEVEL_CUTS: Level 2..10 start here
TOTALS = ("kills", "deaths", "assists", "mvp", "wins", "losses")


def _date(s):
    return dt.date.fromisoformat(s)


def _add_months(d, m):
    y, mo = divmod(d.month - 1 + m, 12)
    y += d.year
    mo += 1
    return dt.date(y, mo, min(d.day, calendar.monthrange(y, mo)[1]))


def load_seasons(data_dir, today):
    """[{id, name, start, end}], oldest first. The Preseason has no start. Seasons past the listed ones are
    added every `months` months, so the list always reaches today."""
    path = os.path.join(data_dir, "solo_seasons.json")
    cfg = json.load(open(path, encoding="utf-8")) if os.path.exists(path) else \
        {"months": 6, "seasons": [{"id": 0, "name": "Preseason"}, {"id": 1, "name": "Season 1", "start": today.isoformat()}]}
    months = int(cfg.get("months") or 6)
    out = [{"id": s["id"], "name": s["name"], "start": s.get("start")} for s in cfg["seasons"]]
    while True:
        last = out[-1]
        end = _add_months(_date(last["start"]), months) - dt.timedelta(days=1)
        if today <= end:
            break
        out.append({"id": last["id"] + 1, "name": f"Season {last['id'] + 1}", "start": (end + dt.timedelta(days=1)).isoformat()})
    for i, s in enumerate(out):
        if i + 1 < len(out):
            s["end"] = (_date(out[i + 1]["start"]) - dt.timedelta(days=1)).isoformat()
        else:
            s["end"] = (_add_months(_date(s["start"]), months) - dt.timedelta(days=1)).isoformat()
    return out


def season_of(seasons, date):
    """The season a game dated `date` belongs to (undated games are the Preseason's)."""
    if not date:
        return seasons[0]["id"]
    for s in seasons:
        if (not s.get("start") or date >= s["start"]) and date <= s["end"]:
            return s["id"]
    return seasons[-1]["id"] if date > seasons[-1]["end"] else seasons[0]["id"]


def drop_level(rating, points_for):
    """One Level down, keeping the spot inside the Level (Level 10's spot is read off a band as wide as
    Level 9's, and Level 1's band below Level 2 is as wide as Level 2's). Level 1 stays where it is."""
    pts = 1150 + (rating - 1.0) * 3900
    lvl = 1 + sum(1 for c in LEVEL_CUTS if points_for(rating) >= c)
    if lvl <= 1:
        return rating
    bands = [(LEVEL_CUTS[0] - 250, LEVEL_CUTS[0])] + list(zip(LEVEL_CUTS, LEVEL_CUTS[1:])) + [(LEVEL_CUTS[-1], LEVEL_CUTS[-1] + 250)]
    lo, hi = bands[lvl - 1]
    plo, phi = bands[lvl - 2]
    frac = min(max((pts - lo) / (hi - lo), 0.0), 0.999)
    return 1.0 + (plo + frac * (phi - plo) - 1150) / 3900


def _means(totals):
    """The pool means compute_solo_ratings uses ({kdr, kpm, mvp}), over the bots with a game and a death."""
    valid = [t for t in totals if t["wins"] + t["losses"] > 0 and t["deaths"] > 0]
    if not valid:
        return {"kdr": 1.0, "kpm": 1.0, "mvp": 1.0}
    n = len(valid)
    return {"kdr": sum(round(t["kills"] / t["deaths"], 2) for t in valid) / n,
            "kpm": sum(t["kills"] / (t["wins"] + t["losses"]) for t in valid) / n,
            "mvp": (sum(t["mvp"] / (t["wins"] + t["losses"]) for t in valid) / n) or 1.0}


def run(data_dir, today, *, bots, base, humans, games, resolve, rating_fn, points_for, tier_for, level_for,
        min_maps, xs_keys, adv_block, game_stats, old2new, norm_key, extra=()):
    """Works out every season. bots: {key: solo entry}; base: {key: the solo sheet's own totals} (the Preseason
    starts from them); humans: {key: human entry}; resolve(scoreboard name) -> ("bot"|"human", key) or None.
    extra: the totals of the sheet's duplicate rows, which the career means count, so the Preseason's do too.
    Season games' entries in game_stats (the game popups' ±Pts) are switched to that season's points.
    Returns (meta, records): records = {("bot"|"human", key): [season record, newest first]}."""
    seasons = load_seasons(data_dir, today)
    cur = next(s for s in seasons if (not s.get("start") or s["start"] <= today.isoformat()) and today.isoformat() <= s["end"])
    fpath = os.path.join(data_dir, "solo_season_finals.json")
    finals = json.load(open(fpath, encoding="utf-8")) if os.path.exists(fpath) else {}
    # frozen standings are keyed by the name at the time: follow later renames
    for sid, fin in finals.items():
        fin["players"] = {(norm_key(old2new[k]) if k in old2new else k): v for k, v in fin["players"].items()}
    by_season = {s["id"]: [] for s in seasons}
    for i, g in enumerate(games):
        by_season[season_of(seasons, g.get("date"))].append((g.get("date") or "", i, g))
    for v in by_season.values():
        v.sort(key=lambda x: (x[0], x[1]))

    records, meta, wrote = {}, [], False
    prev_final = None
    for s in seasons:
        sid = s["id"]
        if s["start"] and s["start"] > today.isoformat():
            break
        ended = s["end"] < today.isoformat()
        lock_on = (_date(s["end"]) + dt.timedelta(days=GRACE_DAYS + 1)).isoformat()
        frozen = finals.get(str(sid))
        if frozen:
            res = frozen["players"]
        else:
            res = _season(s, prev_final, by_season[sid], bots, base, humans, resolve, rating_fn, points_for,
                          tier_for, level_for, min_maps, xs_keys, adv_block, game_stats, extra)
            if ended and today.isoformat() >= lock_on:
                finals[str(sid)] = {"name": s["name"], "locked": today.isoformat(), "players": res}
                wrote = True
        total = sum(1 for r in res.values() if r.get("rank"))
        for key, r in res.items():
            r = dict(r, id=sid, name=s["name"], total=total, final=ended)
            records.setdefault(("human" if r.get("human") else "bot", key), []).append(r)
        meta.append({"id": sid, "name": s["name"], "start": s.get("start"), "end": s["end"], "ranked": total,
                     "status": "live" if not ended else ("final" if (frozen or str(sid) in finals) else "locking"),
                     "locks": None if (frozen or str(sid) in finals) else lock_on, "games": len(by_season[sid])})
        prev_final = res
    if wrote:
        json.dump(finals, open(fpath, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    for v in records.values():
        v.reverse()
    return {"current": cur["id"], "seasons": meta, "minMaps": min_maps, "placementK": PLACEMENT_K}, records


def _season(s, prev_final, games, bots, base, humans, resolve, rating_fn, points_for, tier_for, level_for,
            min_maps, xs_keys, adv_block, game_stats, extra):
    """One season, game by game: {key: record}."""
    pre = s["id"] == 0
    zero = lambda: {k: 0 for k in TOTALS}
    tot = {("bot", k): (dict(base.get(k) or zero()) if pre else zero()) for k in (bots if pre else ())}
    xs = {}
    # placements, from last season's final standings (bots ranked there; humans with enough games)
    seed = {}
    if prev_final:
        for key, r in prev_final.items():
            if r.get("rating") is not None and (r.get("rank") or (r.get("human") and r.get("maps", 0) >= min_maps)):
                who = ("human", key) if r.get("human") else ("bot", key)
                if (who[0] == "bot" and key in bots) or (who[0] == "human" and key in humans):
                    seed[who] = (drop_level(r["rating"], points_for), r)
                    tot.setdefault(who, zero())

    def value(who, t, avg):
        n = t["wins"] + t["losses"]
        prior = seed[who][0] if who in seed else None
        if n == 0:
            return prior
        if pre:
            return rating_fn(t["kills"], t["deaths"], t["assists"], t["mvp"], t["wins"], t["losses"], avg)
        r = rating_fn(t["kills"], max(1, t["deaths"]), t["assists"], t["mvp"], t["wins"], t["losses"], avg)
        return r + (prior - 1.0) * PLACEMENT_K / (n + PLACEMENT_K) if prior is not None else r

    def board():
        """(ratings {who: r}, ranks {bot who: rank}) for the season so far."""
        avg = _means([t for w, t in tot.items() if w[0] == "bot"] + (list(extra) if pre else []))
        rt = {w: value(w, t, avg) for w, t in tot.items()}
        ranked = sorted((w for w, t in tot.items() if w[0] == "bot" and rt[w] is not None
                         and t["wins"] + t["losses"] >= min_maps), key=lambda w: -rt[w])
        return rt, {w: i + 1 for i, w in enumerate(ranked)}

    peak = {}

    def note_peaks(rt, rk, date):
        bot_r = sorted(rt[w] for w in rk)            # the ranked bots' ratings, for where a human would sit
        for w, r in rt.items():
            if r is None:
                continue
            t = tot[w]
            if t["wins"] + t["losses"] < min_maps:
                continue
            pts = points_for(r)
            p = peak.get(w)
            if p is None or pts > p["ratingPoints"]:
                peak[w] = p = {"ratingPoints": pts, "level": level_for(r), "date": date,
                               "rank": (p or {}).get("rank"), "rankDate": (p or {}).get("rankDate")}
            pos = rk.get(w) if w[0] == "bot" else 1 + len(bot_r) - bisect.bisect_right(bot_r, r)
            if pos is not None and (p.get("rank") is None or pos < p["rank"]):
                p["rank"], p["rankDate"] = pos, date

    rt, rk = board()
    note_peaks(rt, rk, None)
    prev_rk = dict(rk)
    for date, _i, g in games:
        who_in = []
        for pl in g.get("players", []):
            w = resolve(pl.get("name", ""))
            if not w:
                continue
            t = tot.setdefault(w, zero())
            t["kills"] += int(pl.get("k", 0)); t["deaths"] += int(pl.get("d", 0))
            t["assists"] += int(pl.get("a", 0)); t["mvp"] += int(pl.get("mvp", 0))
            won = bool(pl.get("won"))
            t["wins"] += 1 if won else 0; t["losses"] += 0 if won else 1
            if int(pl.get("rnd") or 0) > 0:
                x = xs.setdefault(w, {k: 0 for k in xs_keys + ["k", "maps"]})
                for k in xs_keys:
                    x[k] += int(pl.get(k) or 0)
                x["k"] += int(pl.get("k") or 0); x["maps"] += 1
            who_in.append(w)
        before = rt
        prev_rk = rk
        rt, rk = board()
        note_peaks(rt, rk, date or None)
        if not pre:          # the game popups' ±Pts: how this game moved each player's season points
            gs = game_stats.setdefault(str(g.get("id")), {})
            for w in who_in:
                b = before.get(w)
                a = rt.get(w)
                if a is None:
                    continue
                gk = w[1]
                old = gs.get(gk) or {}
                gs[gk] = {**{k: v for k, v in old.items() if k == "human"}, "season": s["id"],
                          "gain": points_for(a) - points_for(b if b is not None else 1.0),
                          "ratingPoints": points_for(a), "soloRank": rk.get(w)}
    last_players = {resolve(pl.get("name", "")) for pl in games[-1][2].get("players", [])} if games else set()
    bots_ranked = sorted(r for w, r in rt.items() if w[0] == "bot" and w in rk)
    out = {}
    for w, t in tot.items():
        n = t["wins"] + t["losses"]
        if n == 0 and w not in seed:
            continue
        r = rt.get(w)
        rec = {k: t[k] for k in TOTALS}
        rec.update(maps=n, kdr=round(t["kills"] / t["deaths"], 2) if t["deaths"] else 0.0,
                   winrate=round(t["wins"] / n, 3) if n else 0.0,
                   rating=round(r, 3) if r is not None else None,
                   ratingPoints=points_for(r) if r is not None else None,
                   level=level_for(r) if r is not None else None, tier=tier_for(r) if r is not None else None,
                   ranked=n >= min_maps and r is not None)
        if w[0] == "bot":
            rec["rank"] = rk.get(w)
            rec["rankDelta"] = (prev_rk[w] - rk[w]) if (w in rk and w in prev_rk and w in last_players) else 0
        else:
            rec["human"] = humans[w[1]].get("kind") or "human"
            # where they'd sit on the bots' board (humans aren't ranked against the bots)
            rec["place"] = 1 + sum(1 for x in bots_ranked if x > r) if rec["ranked"] else None
        if w in seed:
            sr, last = seed[w]
            rec["placement"] = {"ratingPoints": points_for(sr), "level": level_for(sr),
                                "fromPoints": last.get("ratingPoints"), "fromLevel": last.get("level"),
                                "fromRank": last.get("rank")}
        if w in peak:
            rec["peak"] = peak[w]
        if w in xs:
            rec["adv"] = adv_block(xs[w])
        out[w[1]] = rec
    return out
