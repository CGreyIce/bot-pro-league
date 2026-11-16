"""Solo Queue games for the site's Solo Queue tab (#/solo, 17 Nov 2026, user request).

Every game in data/solo_scoreboards.json, newest first, written to site/solo_games.json. Only that
tab reads the file (like site/scrims.json), so data.json doesn't grow with every game.

The two sides of a solo game are random, so each is named after its highest-rated player going
into the game: "team_<name>" (the user's pick). "Going in" = their Solo Queue rating points from
their totals without this game and every later one, so an old game keeps its names as ratings move
on. Humans (data/solo_humans.json) count by their own Solo Queue points, on the bots' scale.

The score isn't stored, so it comes from the MVP stars: a team's stars equal the rounds it won
(this held on every recorded BPL map). With the rounds played recorded (BPL Bots' advanced stats),
the winners get whatever the losers didn't.
"""
import json
import os

XS_KEYS = ("dmg", "ud", "hs", "fk", "fd", "tk", "kast", "rnd", "xk", "k2", "k3", "k4", "k5",
           "c1", "c2", "c3", "c4", "c5")


def _score(players):
    won = sum(int(p.get("mvp", 0)) for p in players if p.get("won"))
    lost = sum(int(p.get("mvp", 0)) for p in players if not p.get("won"))
    rnd = max([int(p.get("rnd") or 0) for p in players] or [0])
    if rnd > lost:
        won = rnd - lost
    if won <= lost:                       # stars missing: at least a regulation win
        won = max(13, lost + 2)
    return won, lost


def build(solo_sb, resolve, rating_fn, points_for, avg, gains, norm_key, site_dir):
    """resolve(name) -> (current name, totals) or None, totals = {kills, deaths, assists, mvp, wins, losses}.
    gains: parse.py's solo_game_stats ({game id: {norm name: {gain, ...}}}). Returns the game count."""
    later = {}                            # name -> this game's and later games' contributions
    out = []
    for g in reversed(solo_sb):           # newest first: the list is in the order games were saved
        players = g.get("players", [])
        lines = []
        for pl in players:
            r = resolve(pl.get("name", ""))
            name = r[0] if r else pl.get("name", "")
            if r:
                c = later.setdefault(name, [0, 0, 0, 0, 0, 0])
                c[0] += int(pl.get("k", 0)); c[1] += int(pl.get("d", 0)); c[2] += int(pl.get("a", 0))
                c[3] += int(pl.get("mvp", 0)); c[4] += 1 if pl.get("won") else 0; c[5] += 0 if pl.get("won") else 1
            lines.append((pl, name, r))
        going_in = {}
        for pl, name, r in lines:
            if not r:
                continue
            t, c = r[1], later[name]
            before = rating_fn(t["kills"] - c[0], t["deaths"] - c[1], t["assists"] - c[2], t["mvp"] - c[3],
                               t["wins"] - c[4], t["losses"] - c[5], avg)
            going_in[name] = points_for(before) if before is not None else None
        sides = {}
        for won in (True, False):
            side = [(pl, name) for pl, name, _ in lines if bool(pl.get("won")) == won]
            ranked = sorted(side, key=lambda x: (-(going_in.get(x[1]) or 0), x[1].lower()))
            cap = ranked[0][1] if ranked else "?"
            sides[won] = {"name": "team_" + cap, "cap": cap, "capPts": going_in.get(cap)}
        sw, sl = _score(players)
        gid = str(g.get("id"))
        gs = gains.get(gid, {})
        out.append({
            "id": g.get("id"), "date": g.get("date") or "", "map": g.get("map") or "",
            "a": sides[True]["name"], "b": sides[False]["name"], "scoreA": sw, "scoreB": sl,
            "capA": [sides[True]["cap"], sides[True]["capPts"]], "capB": [sides[False]["cap"], sides[False]["capPts"]],
            "players": [dict({"name": name, "team": sides[bool(pl.get("won"))]["name"],
                              "k": int(pl.get("k", 0)), "d": int(pl.get("d", 0)), "a": int(pl.get("a", 0)),
                              "mvp": int(pl.get("mvp", 0)), "won": bool(pl.get("won")),
                              "gain": (gs.get(norm_key(pl.get("name", ""))) or gs.get(norm_key(name)) or {}).get("gain"),
                              "pts": going_in.get(name)},
                             **{k: pl[k] for k in XS_KEYS if k in pl})
                        for pl, name, _ in lines],
        })
    with open(os.path.join(site_dir, "solo_games.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    return len(out)
