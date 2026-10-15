"""Human players in Solo Queue: people who play solo-queue games against the BPL bots.

They're listed in data/solo_humans.json:
    [{"name": "CGreyIce", "kind": "admin", "ingame": ["Ice"]}, ...]
  name    the profile name, and the name their lines carry on the solo scoreboards. It can't be a
          BPL player's name (a line under that name counts for the bot).
  kind    "admin" or "human": the tag shown next to the name.
  ingame  the names they use in game (the BPL Bots app saves their line under `name`).

Humans exist for Solo Queue only. They're kept apart from DATA.players so nothing else (rankings,
awards, market values, bios, BPL-dle...) ever picks them up. Their games still count for the bots
in them as usual, but they don't move the solo pool's averages or the bots' ranks: each human is
rated with the bots' averages, like a guest on the bots' scale.
"""
import json
import os
import re

KINDS = ("admin", "human")
MAX_GAMES = 30   # recent solo games kept on each profile


def load(data_dir):
    path = os.path.join(data_dir, "solo_humans.json")
    if not os.path.exists(path):
        return []
    try:
        rows = json.load(open(path, encoding="utf-8"))
    except (OSError, ValueError) as e:
        print(f"  ! solo_humans.json unreadable: {e}")
        return []
    out = []
    for r in rows if isinstance(rows, list) else []:
        name = str(r.get("name", "")).strip()
        if not name:
            continue
        kind = str(r.get("kind", "human")).lower()
        out.append({"name": name, "kind": kind if kind in KINDS else "human",
                    "ingame": [str(x).strip() for x in r.get("ingame", []) if str(x).strip()],
                    "iso": str(r.get("iso", "")).lower()[:2]})
    return out


def slug_for(name):
    return "h-" + (re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "player")


def build(profiles, solo_sb, avg, rating_fn, points_for, tier_for, level_for, norm_key,
          taken_names, bot_ratings, min_maps):
    """One entry per profile: solo totals, rating on the bots' scale, recent games.
    taken_names: normalized names of every BPL player (a profile can't share one).
    bot_ratings: the rated solo bots' ratings, to show where a human would place among them."""
    by_key, out = {}, []
    for pr in profiles:
        k = norm_key(pr["name"])
        if k in taken_names:
            print(f"  ! solo_humans.json: '{pr['name']}' is a BPL player's name, so it's skipped "
                  f"(pick another profile name; their in-game name can stay)")
            continue
        if k in by_key:
            continue
        h = {"name": pr["name"], "slug": slug_for(pr["name"]), "kind": pr["kind"], "ingame": pr["ingame"],
             "iso": pr["iso"], "pool": "solo", "human": True,
             "kills": 0, "deaths": 0, "assists": 0, "mvp": 0, "wins": 0, "losses": 0, "games": []}
        by_key[k] = h
        out.append(h)
    if not out:
        return []

    for g in solo_sb:
        for pl in g.get("players", []):
            h = by_key.get(norm_key(pl.get("name", "")))
            if not h:
                continue
            won = bool(pl.get("won"))
            k, d, a, m = (int(pl.get(x, 0)) for x in ("k", "d", "a", "mvp"))
            h["kills"] += k; h["deaths"] += d; h["assists"] += a; h["mvp"] += m
            h["wins"] += 1 if won else 0; h["losses"] += 0 if won else 1
            h["games"].append({"id": g.get("id"), "date": g.get("date"), "map": g.get("map"),
                               "k": k, "d": d, "a": a, "mvp": m, "won": won})

    ranked_bots = sorted(bot_ratings, reverse=True)
    for h in out:
        h["maps"] = h["wins"] + h["losses"]
        h["kdr"] = round(h["kills"] / h["deaths"], 2) if h["deaths"] else 0.0
        h["winrate"] = round(h["wins"] / h["maps"], 3) if h["maps"] else 0.0
        h["games"] = sorted(h["games"], key=lambda x: (x["date"] or "", str(x["id"])), reverse=True)[:MAX_GAMES]
        h["provisional"] = 0 < h["maps"] < min_maps
        if h["maps"] < max(min_maps, 1) or not h["deaths"]:
            h["rating"] = h["ratingPoints"] = h["tier"] = h["level"] = None
            h["placeAmongBots"] = None
            continue
        r = rating_fn(h["kills"], h["deaths"], h["assists"], h["mvp"], h["wins"], h["losses"], avg)
        h["rating"] = round(r, 3)
        h["ratingPoints"] = points_for(r)
        h["tier"] = tier_for(r)
        h["level"] = level_for(r)
        h["kpm"] = round(h["kills"] / h["maps"], 1)
        # where they'd sit on the bots' Solo Queue board: one more than the bots rated higher
        h["placeAmongBots"] = 1 + sum(1 for br in ranked_bots if br > r)
    out.sort(key=lambda h: (h["ratingPoints"] is None, -(h["ratingPoints"] or 0), h["name"].lower()))
    return out
