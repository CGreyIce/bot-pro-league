#!/usr/bin/env python3
"""Prize pools, S-Tier sub-tiers and earnings (from 2026-10-05).

data/prize_pools.json = {event slug: prize pool in US dollars}, set per event in the admin (Site Health lists
every event still missing one). An event without a prize pool keeps its plain tier weight until it gets one.

S-Tier events are split by prize pool (Majors and A-Tier are not):
    $1,000,000+   S-Tier 1   2.5x ranking points
    $250,000+     S-Tier 2   1.75x
    below that    S-Tier 3   1.25x
Major 5x and A-Tier 1x, whatever their prize pool.

Payouts (HLTV-style) by final placement: 1st 40%, 2nd 18%, 3rd-4th 9% each, 5th-8th 4% each, 9th-16th 1% each.
Teams tied on a placement share the slots they cover. If fewer than 16 teams finish, the shares are scaled up
so the whole pool is paid out. A team's prize is split equally between the players on its line-up at that event.
"""
import json, os, re

TIER_MULT = {"major": 5.0, "s": 2.5, "a": 1.0}
S_SUBTIERS = [(1_000_000, 1, 2.5), (250_000, 2, 1.75), (0, 3, 1.25)]      # (minimum pool, sub-tier, points)
SLOTS = [40, 18, 9, 9, 4, 4, 4, 4] + [1] * 8                             # % of the pool for places 1..16


def _norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def load(data_dir):
    p = os.path.join(data_dir, "prize_pools.json")
    if not os.path.exists(p):
        return {}
    raw = json.load(open(p, encoding="utf-8"))
    return {k: int(v) for k, v in raw.items() if isinstance(v, (int, float)) and v > 0}


def apply_tiers(tournaments, pools):
    """Sets prizePool, subTier, tierLabel ("S-Tier 2") and pointsMult on every event. Runs right after the
    tournaments are built, before anything copies tierLabel or scores placements."""
    for tr in tournaments:
        pool = pools.get(tr["slug"])
        tr["prizePool"] = pool
        tr["pointsMult"] = TIER_MULT.get(tr["tier"], 1.0)
        if pool and tr["tier"] == "s":
            for minimum, sub, mult in S_SUBTIERS:
                if pool >= minimum:
                    tr["subTier"], tr["pointsMult"] = sub, mult
                    tr["tierLabel"] = f"S-Tier {sub}"
                    break


def payout_shares(standings):
    """[(standing, share 0..1)] for the teams that get paid, from a ranked standings list."""
    rows = sorted((s for s in standings if s.get("rank") is not None), key=lambda s: s["rank"])
    out, pos, i = [], 0, 0
    while i < len(rows):
        j = i
        while j < len(rows) and rows[j]["rank"] == rows[i]["rank"]:
            j += 1
        block = rows[i:j]
        covered = [SLOTS[k] if k < len(SLOTS) else 0 for k in range(pos, pos + len(block))]
        each = sum(covered) / len(block)
        out += [(s, each) for s in block]
        pos += len(block)
        i = j
    total = sum(sh for _, sh in out)
    if not total:
        return []
    return [(s, sh / total) for s, sh in out if sh > 0]


def apply_earnings(tournaments, players, teams):
    """Needs the attending rosters. Sets tr["prizes"], player["earnings"] / ["prizeHistory"], team["earnings"]."""
    by_player = {p["slug"]: p for p in players}
    by_team = {t["slug"]: t for t in teams}
    for p in players:
        p["earnings"], p["prizeHistory"] = 0, []
    for t in teams:
        t["earnings"] = 0
    for tr in sorted(tournaments, key=lambda t: t.get("date") or ""):
        tr.pop("prizes", None)
        pool = tr.get("prizePool")
        if not pool or not tr.get("champion"):
            continue
        stl = tr.get("finalStandings") or tr.get("standings") or []
        rosters = {}
        for r in tr.get("attending", []):
            rosters[_norm(r["team"])] = r
            if r.get("teamSlug"):
                rosters[r["teamSlug"]] = r
        prizes = []
        for s, share in payout_shares(stl):
            amount = round(pool * share)
            name = s.get("name") or s.get("team")
            row = rosters.get(s.get("teamSlug")) or rosters.get(_norm(name))
            pls = [pl for pl in (row or {}).get("players", []) if pl.get("name")]
            each = round(amount / len(pls)) if pls else None
            prizes.append({"rank": s["rank"], "name": name, "teamSlug": s.get("teamSlug"), "amount": amount, "perPlayer": each})
            if s.get("teamSlug") in by_team:
                by_team[s["teamSlug"]]["earnings"] += amount
            for pl in pls:
                p = by_player.get(pl.get("slug"))
                if p and each:
                    p["earnings"] += each
                    p["prizeHistory"].append({"event": tr["name"], "slug": tr["slug"], "date": tr.get("date"),
                                              "place": s["rank"], "team": row["team"], "amount": each})
        tr["prizes"] = prizes
    for p in players:
        p["prizeHistory"].sort(key=lambda h: h.get("date") or "", reverse=True)
        if not p["prizeHistory"]:
            p.pop("prizeHistory")
    priced = sum(1 for tr in tournaments if tr.get("prizes"))
    print(f"prizes: {priced} events with prize pools, ${sum(t.get('prizePool') or 0 for t in tournaments):,} in total")
