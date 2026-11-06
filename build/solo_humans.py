"""Human players in Solo Queue: people who play solo-queue games against the BPL bots.

They're listed in data/solo_humans.json:
    [{"name": "CGreyIce", "kind": "admin", "ingame": ["Ice"]}, ...]
  name    the profile name, and the name their lines carry on the solo scoreboards. It can't be a
          BPL player's name (a line under that name counts for the bot).
  kind    "admin" or "human": the tag shown next to the name.
  ingame  the names they use in game (the BPL Bots app saves their line under `name`).

  team    (optional) the BPL team they play for, from `joined` (an in-world date) to `left`
  role    (optional) their role on that team, e.g. "AWPer"

They're kept apart from DATA.players so nothing else (rankings, awards, market values, bios,
BPL-dle...) ever picks them up. Their games still count for the bots in them as usual, but they
don't move the pools' averages or the bots' ranks: each human is rated with the bots' averages,
like a guest on the bots' scale.

A human on a team (2026-11-06, the user on Eiromancers): they're on that team's page and on its
line-up at the site's own events dated from `joined` on (parse.py adds them to the attending row,
flagged "human"), their tournament scoreboard lines (the BPL Bots app saves them under `name`) go to
their own Pro block (attach_pro), and their share of a prize goes to their profile.
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
        row = {"name": name, "kind": kind if kind in KINDS else "human",
               "ingame": [str(x).strip() for x in r.get("ingame", []) if str(x).strip()],
               "iso": str(r.get("iso", "")).lower()[:2]}
        for k in ("team", "role", "joined", "left"):
            if str(r.get(k) or "").strip():
                row[k] = str(r[k]).strip()
        out.append(row)
    return out


def on_team(h, team_key, date, norm_key):
    """Is human h on that team (normalized name) for an event on that date?"""
    if not h.get("team") or norm_key(h["team"]) != team_key:
        return False
    if h.get("joined") and (date or "") < h["joined"]:
        return False
    return not (h.get("left") and (date or "") >= h["left"])


def attending_entry(h):
    """A human's line on an event's attending roster (beside the bots' {hist, name, slug, iso, captain})."""
    return {"hist": h["name"], "name": h["name"], "slug": h["slug"], "iso": h.get("iso", ""),
            "captain": False, "human": True, "kind": h["kind"], **({"role": h["role"]} if h.get("role") else {})}


def _scoreboard_matches(tr):
    """(ref, match) for every match of an event with a recorded scoreboard, each match once."""
    seen = set()
    for st in tr.get("stages", []) or []:
        for rd in st.get("rounds", []):
            for m in rd.get("matches", []):
                if m.get("stats") and id(m["stats"]) not in seen:
                    seen.add(id(m["stats"])); yield f"{st['id']}-{m.get('i')}", m
    for rd in tr.get("bracket", []) or []:
        for m in rd.get("matches", []):
            if m.get("stats") and id(m["stats"]) not in seen:
                seen.add(id(m["stats"])); yield str(m.get("i")), m


def attach_pro(humans, tournaments, norm_key, rating_fn, avg, points_for, tier_for, level_for,
               taken_names, add_xs, adv_block):
    """Each human's tournament (Pro) block: their lines on recorded scoreboards, i.e. lines that
    match no BPL player (slug None) under their profile name, or an in-game name no BPL player has.
    The lines are marked (human, hslug, kind) so the match pages link them to the human's profile.
    Rated with the pro pool's averages (avg), like the bots' career rating; no Elo."""
    by_key = {}
    for h in humans:
        for n in [h["name"]] + [x for x in h.get("ingame", []) if norm_key(x) not in taken_names]:
            by_key.setdefault(norm_key(n), h)
        h["pro"] = {"kills": 0, "deaths": 0, "assists": 0, "mvp": 0, "wins": 0, "losses": 0, "games": []}
    for tr in tournaments:
        for ref, m in _scoreboard_matches(tr):
            for mi, mp in enumerate(m["stats"].get("maps", [])):
                sa, sb = mp.get("scoreA"), mp.get("scoreB")
                for pl in mp.get("players", []):
                    if pl.get("slug"):
                        continue
                    h = by_key.get(norm_key(pl.get("name", "")))
                    if not h:
                        continue
                    pl.update({"name": h["name"], "human": True, "hslug": h["slug"], "kind": h["kind"], "iso": h.get("iso", "")})
                    b = h["pro"]
                    k, d, a, mv = (int(pl.get(x) or 0) for x in ("k", "d", "a", "mvp"))
                    b["kills"] += k; b["deaths"] += d; b["assists"] += a; b["mvp"] += mv
                    add_xs(b, pl)
                    on_a = norm_key(pl.get("team", "")) == norm_key(m.get("a", ""))
                    if sa is not None and sb is not None and sa != sb:
                        won = (sa > sb) if on_a else (sb > sa)
                    elif m.get("w") in (1, 2):
                        won = (m["w"] == 1) if on_a else (m["w"] == 2)
                    else:
                        won = None
                    if won is not None:
                        b["wins"] += 1 if won else 0; b["losses"] += 0 if won else 1
                    b["games"].append({"event": tr["name"], "slug": tr["slug"], "ref": ref, "date": tr.get("date"),
                                       "ts": m.get("ts"), "mapNo": mi + 1, "map": mp.get("map"), "team": pl.get("team"),
                                       "opp": m.get("b") if on_a else m.get("a"),
                                       "score": [sa, sb] if on_a else [sb, sa], "won": won, "k": k, "d": d, "a": a, "mvp": mv})
    for h in humans:
        b = h["pro"]
        b["maps"] = b["wins"] + b["losses"]
        b["kdr"] = round(b["kills"] / b["deaths"], 2) if b["deaths"] else 0.0
        b["winrate"] = round(b["wins"] / b["maps"], 3) if b["maps"] else 0.0
        b["games"] = sorted(b["games"], key=lambda g: (g["ts"] or 0, g["mapNo"]), reverse=True)[:MAX_GAMES]
        if "_xs" in b:
            b["adv"] = adv_block(b.pop("_xs"))
        if b["maps"] and b["deaths"]:
            r = rating_fn(b["kills"], b["deaths"], b["assists"], b["mvp"], b["wins"], b["losses"], avg)
            b["rating"] = round(r, 3)
            b["ratingPoints"] = points_for(r)
            b["tier"] = tier_for(r)
            b["level"] = level_for(r)
            b["kpm"] = round(b["kills"] / b["maps"], 1)
        else:
            b["rating"] = b["ratingPoints"] = b["tier"] = b["level"] = None
        if not h.get("team") and not b["maps"]:
            h.pop("pro")                        # Solo Queue only: no Pro block
    return humans


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
             **{k: pr[k] for k in ("team", "role", "joined", "left") if pr.get(k)},
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
