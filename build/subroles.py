"""Rifler sub-roles: entry, lurker, anchor, support (data/player_subroles.json).

Every rifler on a team gets one, spread so a team has a mix rather than three entries. IGLs are
the team's support (calling from the back). AWPers keep their AWP role and get none.

The roles stick with the player: each build keeps last build's role, so a transfer doesn't reroll
anyone. When two riflers on the same team hold the same role (after a transfer), the one with the
better stats keeps it and the other moves to a role the team is missing. New riflers get a missing
role at random (seeded by name, so a rebuild picks the same).

data/player_subroles_override.json pins a player's role by hand (admin Roster Tools, Edit player):
pinned roles are placed first and never moved. Both files are keyed by normalized player name.

The BPL Bots launcher reads subRole from data.json: bots play their sub-role in game.
"""
import hashlib
import json
import os

SUBROLES = ["entry", "lurker", "anchor", "support"]
FILE = "player_subroles.json"
OVERRIDE_FILE = "player_subroles_override.json"


def _load(data_dir, name):
    p = os.path.join(data_dir, name)
    try:
        return json.load(open(p, encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _is_awp(role):
    return "awp" in (role or "").lower()


def _is_igl(role):
    return "igl" in (role or "").lower()


def _seeded_choice(options, seed):
    h = int(hashlib.sha1(seed.encode("utf-8")).hexdigest(), 16)
    return options[h % len(options)]


def assign(players, saved, pinned, norm_key, strength):
    """players: player dicts (name, team, role). saved/pinned: {normkey: subrole}.
    strength(p): how good their stats are (who keeps a contested role). Returns {normkey: subrole}."""
    out = {}
    teams = {}
    for p in players:
        if _is_awp(p.get("role")):
            continue
        teams.setdefault(p.get("team") or "", []).append(p)
    for team, members in teams.items():
        if not team:                                  # free agents: their own role, or a seeded one
            for p in members:
                k = norm_key(p["name"])
                out[k] = pinned.get(k) or ("support" if _is_igl(p.get("role")) else None) \
                    or saved.get(k) or _seeded_choice(SUBROLES, k)
            continue
        taken = set()
        todo = []
        # 1. pinned by the admin, then the IGLs (support)
        for p in members:
            k = norm_key(p["name"])
            if pinned.get(k) in SUBROLES:
                out[k] = pinned[k]
                taken.add(pinned[k])
        for p in members:
            k = norm_key(p["name"])
            if k in out:
                continue
            if _is_igl(p.get("role")):
                out[k] = "support"
                taken.add("support")
        # 2. last build's roles, best stats first: a clash goes to the better player
        rest = [p for p in members if norm_key(p["name"]) not in out]
        for p in sorted(rest, key=lambda x: (-strength(x), norm_key(x["name"]))):
            k = norm_key(p["name"])
            r = saved.get(k)
            if r in SUBROLES and r not in taken:
                out[k] = r
                taken.add(r)
            else:
                todo.append(p)
        # 3. everyone else: a role the team is missing (at random), else keep theirs / any
        for p in sorted(todo, key=lambda x: norm_key(x["name"])):
            k = norm_key(p["name"])
            missing = [r for r in SUBROLES if r not in taken]
            if missing:
                r = _seeded_choice(missing, k + "|" + norm_key(team))
            else:
                r = saved.get(k) if saved.get(k) in SUBROLES else _seeded_choice(SUBROLES, k)
            out[k] = r
            taken.add(r)
    return out


def apply(players, data_dir, norm_key, strength):
    """Sets p["subRole"] on every player (None for AWPers) and saves the assignment."""
    saved = _load(data_dir, FILE)
    pinned = {k: v for k, v in _load(data_dir, OVERRIDE_FILE).items() if v in SUBROLES}
    roles = assign(players, saved, pinned, norm_key, strength)
    for p in players:
        p["subRole"] = roles.get(norm_key(p["name"]))
    # players who left the data keep their role in the file, for when they come back
    merged = {**saved, **roles}
    if merged != saved:
        json.dump(dict(sorted(merged.items())), open(os.path.join(data_dir, FILE), "w", encoding="utf-8"),
                  ensure_ascii=False, indent=1)
    return roles
