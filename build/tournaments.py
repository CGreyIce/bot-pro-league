#!/usr/bin/env python3
"""Process scraped Challonge bracket data (data/tournaments/*.json) into the
site-ready tournament structures: champion, runner-up, standings, and a
round-by-round bracket. Called from parse.py; also runnable standalone to debug.
"""
import json, os, re, unicodedata
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TDIR = os.path.join(ROOT, "data", "tournaments")

def norm_key(s):
    s = unicodedata.normalize("NFKD", s or "")
    return re.sub(r"[^a-z0-9]", "", s.lower())

def slugify(s):
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", (s or "").lower())).strip("-")

# slug -> (display name, ISO date, tier)  tier in {major, s, a}
META = {
    "BPLChalS2025": ("BPL Challengers Stage 2025", "2025-10-10", "s"),
    "BPLLStage25": ("BPL Legends Stage 2025", "2025-10-10", "s"),
    "BPLCStage25": ("BPL Conquerors Stage 2025", "2025-10-10", "major"),
    "BPLChalS2024": ("BPL Challengers Stage 2024", "2024-08-03", "s"),
    "BPLLStage24": ("BPL Legends Stage 2024", "2024-08-03", "s"),
    "BPLCStage24": ("BPL Conquerors Stage 2024", "2024-08-03", "major"),
    "BPLCStage23": ("BPL Challengers Stage 2023", "2023-08-25", "s"),
    "BPLLStage23": ("BPL Legends Stage 2023", "2023-08-25", "s"),
    "BPLCONQ2023": ("BPL Conquerors Stage 2023", "2023-08-27", "major"),
    "BPLChallengerStage": ("BPL Challengers Stage 2022", "2022-04-23", "s"),
    "BPLLegendsStage": ("BPL Legends Stage 2022", "2022-05-06", "s"),
    "BPLCONQ2022": ("BPL Conquerors Stage 2022", "2022-04-17", "major"),
    "BPLRR2025": ("BPL Ranking Reshuffle 2025", "2025-06-12", "s"),
    "AUXE2025": ("Audax Esse BPL Invitational 2025", "2025-03-20", "s"),
    "BotProCup2023": ("Bot Pro Cup 2023", "2023-11-12", "s"),
    "AuxEBPL2023": ("Audax Esse BPL Invitational 2023", "2023-07-23", "s"),
    "AuxEBPL2022": ("Audax Esse BPL Invitational 2022", "2022-08-06", "s"),
    "BPLSRR": ("BPL Major SRR", "2022-04-14", "s"),
    "BotProCup2022": ("Bot Pro Cup 2022", "2022-03-25", "s"),
    "BotProLeague15": ("Bot Pro Minor League 15", "2026-07-12", "a"),
    "BotProLeague14": ("Bot Pro Minor League 14", "2026-06-21", "a"),
    "BotProLeague13": ("Bot Pro Minor League 13", "2026-05-28", "a"),
    "BotProLeague12": ("Bot Pro League Minor 12", "2023-05-05", "a"),
    "BotProLeague11": ("Bot Pro League Minor 11", "2023-02-19", "a"),
    "BotProLeague10": ("Bot Pro League Minor 10", "2022-10-23", "a"),
    "BotProLeague9": ("Bot Pro League Minor 9", "2021-10-31", "a"),
    "BotProLeague8": ("Bot Pro League Minor 8", "2021-10-08", "a"),
    "BotProLeague7": ("Bot Pro League Minor 7", "2021-09-10", "a"),
    "BotProLeague6": ("BPL Tournament Minor 6", "2021-04-30", "a"),
    "BotProLeague5": ("BPL Tournament Minor 5", "2021-01-27", "a"),
    "BotProLeague4": ("BPL Tournament Minor 4", "2020-06-09", "a"),
    "BotProLeague3": ("BPL Tournament Minor 3", "2020-05-07", "a"),
    "BotProLeague2": ("BPL Tournament Minor 2", "2020-04-30", "a"),
    "BotProLeague1": ("BPL Tournament Minor 1", "2020-04-26", "a"),
    "BPLTuscanBo1": ("Battle of Tuscan BPL Event (Bo1)", "2022-10-06", "a"),
}
TIER_LABEL = {"major": "Major", "s": "S-Tier", "a": "A-Tier"}
FORMAT_LABEL = {
    "double elimination": "Double Elimination", "single elimination": "Single Elimination",
    "swiss": "Swiss System", "round robin": "Round Robin",
}

def score_pair(sc):
    """sc may be [a,b] ints, or a string like '16-7' or '2-0,1-2'. Return (a,b) ints or (None,None)."""
    if isinstance(sc, list) and len(sc) == 2 and all(isinstance(x, (int, float)) for x in sc):
        return int(sc[0]), int(sc[1])
    if isinstance(sc, str):
        m = re.findall(r"(\d+)\s*-\s*(\d+)", sc)
        if m:
            a = sum(int(x) for x, _ in m); b = sum(int(y) for _, y in m)
            return a, b
    return None, None

def _resolver(team_map, alias):
    def resolve(nm):
        if not nm:
            return ("", None)
        k = alias.get(norm_key(nm), norm_key(nm))
        info = team_map.get(k)
        return (info["name"], info["slug"]) if info else (nm, None)
    return resolve

def process_manual(raw, team_map, alias):
    """Process an admin-built multi-stage tournament (single_elim / round_robin / swiss stages)."""
    resolve = _resolver(team_map, alias)
    slug = raw["slug"]
    name, date, tier = raw.get("name", slug), raw.get("date", ""), raw.get("tier", "a")
    stages_out, combined = [], []
    roff = 0
    for st in raw.get("stages", []):
        # group matches by round
        by_round = defaultdict(list)
        for m in st.get("matches", []):
            by_round[m.get("r", 0)].append(m)
        rounds = []
        for r in sorted(by_round.keys()):
            ms = sorted(by_round[r], key=lambda m: m.get("i", 0))
            rows = []
            for m in ms:
                sa, sb = score_pair(m.get("sc"))
                an, aslug = resolve(m.get("a", ""))
                bn, bslug = resolve(m.get("b", ""))
                row = {"i": m.get("i"), "a": an, "b": bn, "sa": sa, "sb": sb,
                       "w": m.get("w", 0), "aTeam": aslug, "bTeam": bslug,
                       "bo": m.get("bo", st.get("bestOf", 1)), "tp": m.get("tp", False),
                       "ts": m.get("ts")}
                rows.append(row)
                combined.append({**row, "stageId": st["id"]})
            title = st.get("roundTitles", {}).get(str(r), f"Round {r}")
            rounds.append({"round": r, "title": title, "matches": rows})
        standings = []
        for i, s in enumerate(st.get("standings", [])):
            dn, sl = resolve(s["name"])
            standings.append({"rank": i + 1, "name": dn, "teamSlug": sl, "w": s["w"], "l": s["l"]})
        stages_out.append({"id": st["id"], "name": st["name"], "format": st["format"],
                           "bestOf": st.get("bestOf", 1), "rounds": rounds, "standings": standings,
                           "teams": [resolve(t) for t in st.get("teams", [])]})
    # combined bracket for the feeds (results/H2H/records) — one round-group per stage-round
    bracket = []
    for so in stages_out:
        prefix = (so["name"] + " · ") if len(stages_out) > 1 else ""
        for rd in so["rounds"]:
            bracket.append({"round": 1000 * so["id"] + rd["round"], "title": prefix + rd["title"],
                            "matches": rd["matches"]})
    champ_name, champ_slug = resolve(raw.get("champion"))
    seeds_out = {}
    for nm, sd in (raw.get("seeds") or {}).items():
        dn, sl = resolve(nm)
        if sl:
            seeds_out[sl] = sd          # by team-page slug (pro teams)
        seeds_out[dn] = sd              # by resolved display name
        seeds_out[nm] = sd              # by raw name (ad-hoc amateur teams with no page)
    final_standings = []
    for s in raw.get("finalStandings", []):
        dn, sl = resolve(s["name"])
        final_standings.append({"rank": s["rank"], "name": dn, "teamSlug": sl,
                                "result": s["result"], "tie": s.get("tie", False)})
    overall = stages_out[-1]["standings"] if stages_out else []
    # collapse repeated stage formats: e.g. six swiss groups -> "6 Groups (Swiss)"
    fmt_name = {"single_elim": "Single Elim", "round_robin": "Round Robin", "swiss": "Swiss"}
    from collections import Counter as _C
    stages = raw["stages"]
    groups = [s for s in stages if s["format"] in ("swiss", "round_robin")]
    elim   = [s for s in stages if s["format"] == "single_elim"]
    # group stage(s) + optional playoff bracket -> "6 Groups (Swiss) + Playoffs"
    if len(stages) > 1 and groups and len({s["format"] for s in groups}) == 1 \
            and len(groups) + len(elim) == len(stages):
        gname = fmt_name[groups[0]["format"]]
        fmt = f"{len(groups)} Groups ({gname})" if len(groups) > 1 else gname
        if elim:
            fmt += " + Playoffs"
    else:
        fc = _C(fmt_name.get(s["format"], s["format"]) for s in stages)
        fmt = " + ".join((f"{n}× {f}" if n > 1 else f) for f, n in fc.items()) or "—"
    return {
        "slug": slug, "name": name, "date": date, "year": (date[:4] if date else ""),
        "tier": tier, "tierLabel": TIER_LABEL.get(tier, tier),
        "type": raw.get("type", "multi"),
        "format": fmt,
        "participantCount": len(raw.get("participants", [])),
        "champion": champ_name or None, "championTeam": champ_slug,
        "runnerUp": None, "runnerUpTeam": None,
        "standings": overall, "bracket": bracket, "stages": stages_out,
        "finalStandings": final_standings, "seeds": seeds_out,
        "predictionsLocked": bool(raw.get("predictionsLocked")),
        "noHonors": bool(raw.get("noHonors")),
    }

def process_one(raw, team_map, alias):
    if raw.get("stages"):
        return process_manual(raw, team_map, alias)
    slug = raw["slug"]
    # meta from the file itself (manual/admin tournaments), else the hardcoded table
    mname, mdate, mtier = META.get(slug, (slug, "", "a"))
    name = raw.get("name") or mname
    date = raw.get("date") or mdate
    tier = raw.get("tier") or mtier
    ttype = raw.get("type", "")
    matches = [m for m in raw.get("matches", []) if m.get("st") == "complete"]
    round_titles = raw.get("roundTitles", {})

    # ---- per-participant W/L + differential ----
    rec = defaultdict(lambda: {"w": 0, "l": 0, "diff": 0, "mw": 0, "ml": 0})
    for m in matches:
        a, b, w = m.get("a"), m.get("b"), m.get("w")
        if not a or not b or w not in (1, 2):
            continue
        sa, sb = score_pair(m.get("sc"))
        win, lose = (a, b) if w == 1 else (b, a)
        rec[win]["w"] += 1; rec[lose]["l"] += 1
        if sa is not None:
            hi, lo = (sa, sb) if w == 1 else (sb, sa)
            rec[win]["diff"] += hi - lo; rec[lose]["diff"] += lo - hi

    # ---- champion / runner-up ----
    champion = runner_up = None
    is_elim = "elimination" in ttype
    # true final = highest-identifier non-group match overall; crown only if it's actually played
    all_ng = [m for m in raw.get("matches", []) if not m.get("grp")]
    if is_elim and all_ng:
        final = max(all_ng, key=lambda m: (m.get("i") or 0))
        if final.get("st") == "complete" and final.get("w") in (1, 2):
            champion, runner_up = (final["a"], final["b"]) if final["w"] == 1 else (final["b"], final["a"])

    # ---- standings ----
    order = sorted(rec.keys(), key=lambda n: (-rec[n]["w"], rec[n]["l"], -rec[n]["diff"], n.lower()))
    if is_elim and champion:
        order = [champion] + ([runner_up] if runner_up else []) + \
                [n for n in order if n not in (champion, runner_up)]
    if not is_elim and not champion and order:   # Swiss/RR: top of standings is the winner
        champion = order[0]
        runner_up = order[1] if len(order) > 1 else None

    def resolve(nm):
        """Return (display_name, slug). Applies team aliases (typos/rebrands) so a
        historical/mistyped name maps to the current team's name + page."""
        if not nm:
            return ("", None)
        k = alias.get(norm_key(nm), norm_key(nm))
        info = team_map.get(k)
        return (info["name"], info["slug"]) if info else (nm, None)

    standings = []
    for i, n in enumerate(order):
        dn, sl = resolve(n)
        standings.append({"rank": i + 1, "name": dn, "w": rec[n]["w"], "l": rec[n]["l"], "teamSlug": sl})

    # ---- bracket, grouped & ordered by round (include pending matches so live brackets show TBD slots) ----
    by_round = defaultdict(list)
    for m in raw.get("matches", []):
        by_round[m.get("r", 0)].append(m)
    # order: winners rounds ascending (1..), then losers rounds (-1..), then group/0
    def round_sort_key(r):
        if r is None: return (2, 0)
        if r > 0: return (0, r)
        if r < 0: return (1, -r)
        return (3, 0)
    bracket = []
    for r in sorted(by_round.keys(), key=round_sort_key):
        ms = sorted(by_round[r], key=lambda m: m.get("i", 0))
        rows = []
        for m in ms:
            sa, sb = score_pair(m.get("sc"))
            an, aslug = resolve(m.get("a", ""))
            bn, bslug = resolve(m.get("b", ""))
            rows.append({
                "i": m.get("i"), "a": an, "b": bn,
                "sa": sa, "sb": sb, "w": m.get("w", 0),
                "aTeam": aslug, "bTeam": bslug, "bo": m.get("bo"),
            })
        bracket.append({"round": r, "title": round_titles.get(str(r), f"Round {r}"), "matches": rows})

    champ_name, champ_slug = resolve(champion)
    ru_name, ru_slug = resolve(runner_up)
    return {
        "slug": slug, "name": name, "date": date, "year": (date[:4] if date else ""),
        "tier": tier, "tierLabel": TIER_LABEL[tier],
        "type": ttype, "format": FORMAT_LABEL.get(ttype, ttype.title()),
        "participantCount": len(raw.get("participants", [])) or len(rec),
        "champion": champ_name or None, "championTeam": champ_slug,
        "runnerUp": ru_name or None, "runnerUpTeam": ru_slug,
        "standings": standings, "bracket": bracket,
    }

def load_team_alias(root):
    """norm(old team name) -> norm(current team name)."""
    path = os.path.join(root, "data", "team_changes.json")
    if not os.path.exists(path):
        return {}
    raw = json.load(open(path, encoding="utf-8"))
    return {norm_key(k): norm_key(v) for k, v in raw.items()}

def process_all(team_map, alias=None):
    alias = alias or {}
    out = []
    if not os.path.isdir(TDIR):
        return out
    for fn in os.listdir(TDIR):
        if not fn.endswith(".json"):
            continue
        raw = json.load(open(os.path.join(TDIR, fn), encoding="utf-8"))
        out.append(process_one(raw, team_map, alias))
    # newest first
    out.sort(key=lambda t: t["date"], reverse=True)
    return out

if __name__ == "__main__":
    res = process_all({}, {})
    print(f"Processed {len(res)} tournaments")
    for t in res:
        print(f"  {t['date']}  {t['tierLabel']:7} {t['name']:34} champ={t['champion']}")
