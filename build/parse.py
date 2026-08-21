#!/usr/bin/env python3
"""Bot Pro League — data pipeline.
Reads the raw Google-Sheet CSV exports, the roster .txt, the major-playoff grids
and the team-logo folder, normalizes everything into one dataset, computes a fresh
BPL Rating per player (normalized within each pool), and writes site/data.json.

Run:  python build/parse.py
Re-run any time the source data changes.
"""
import csv, json, os, re, sys, unicodedata
from collections import defaultdict
from datetime import date as _date

# make stdout tolerant of unicode names on Windows consoles
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
SITE = os.path.join(ROOT, "site")
LOGO_DIR = os.path.join(ROOT, "assets", "teams")

# ---------- helpers ----------
def norm_key(s):
    """Loose key for matching names across sources (case/space/punct-insensitive)."""
    s = unicodedata.normalize("NFKD", s or "")
    return re.sub(r"[^a-z0-9]", "", s.lower())

def num(v, default=0.0):
    if v is None:
        return default
    v = str(v).strip().replace(",", "").replace("%", "")
    if v in ("", "-", "—", "N/A", "#DIV/0!"):
        return default
    try:
        return float(v)
    except ValueError:
        return default

def pct(v):
    return num(v) / 100.0

def read_csv(name):
    with open(os.path.join(DATA, name), encoding="utf-8") as f:
        return list(csv.reader(f))

def slug(s):
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", (s or "").lower())).strip("-")

# nationality -> ISO-3166 alpha-2 (for flag images)
COUNTRY_ISO = {
    "singapore":"sg","malaysia":"my","japan":"jp","philippines":"ph","phillipines":"ph",
    "ukraine":"ua","usa":"us","united states":"us","australia":"au","taiwan":"tw",
    "thailand":"th","germany":"de","indonesia":"id","united kingdom":"gb","uk":"gb",
    "france":"fr","netherlands":"nl","korea":"kr","south korea":"kr","canada":"ca",
    "new zealand":"nz","austria":"at","poland":"pl","finland":"fi","italy":"it",
    "belgium":"be","iceland":"is","sweden":"se","kazakhstan":"kz","hong kong":"hk",
    "russia":"neutral","russian":"neutral","land of make believe":"neutral",  # neutral (flagless) flag
}
def load_nat():
    d = {}
    path = os.path.join(DATA, "allplayer.txt")
    if os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            parts = line.rstrip("\n").split("\t")
            nm = parts[0].strip()
            if not nm or nm.lower() == "player":
                continue
            nat = parts[1].strip() if len(parts) > 1 else ""
            d[norm_key(nm)] = {"nat": nat, "iso": COUNTRY_ISO.get(nat.lower(), "")}
    # manual overrides (data/player_nat.json: {name: country}) take precedence
    ov = os.path.join(DATA, "player_nat.json")
    if os.path.exists(ov):
        for nm, nat in json.load(open(ov, encoding="utf-8")).items():
            d[norm_key(nm)] = {"nat": nat, "iso": COUNTRY_ISO.get(nat.lower(), "")}
    return d

# ---------- team logos ----------
logo_files = [f for f in os.listdir(LOGO_DIR) if f.lower().endswith((".png", ".jpg", ".jpeg", ".webp"))]
logo_by_key = {norm_key(os.path.splitext(f)[0]): f for f in logo_files}
# manual aliases: sheet/team name -> logo file stem key
LOGO_ALIAS = {
    "entity": "ntt", "theগigarage": "gigarage", "thegigarage": "gigarage",
    "thenomads": "thenomads", "teamneverseen": "teamnsn", "newjade": "newjade",
    "settingsun": "settingsun", "division20": "div20", "caelumscala": "caelumscala",
    "bloomesports": "bloom", "99lives": "99lives",
}
def find_logo(team_name):
    k = norm_key(team_name)
    if k in logo_by_key:
        return "assets/teams/" + logo_by_key[k]
    ak = LOGO_ALIAS.get(k)
    if ak and ak in logo_by_key:
        return "assets/teams/" + logo_by_key[ak]
    # loose contains match
    for lk, f in logo_by_key.items():
        if lk and (lk in k or k in lk):
            return "assets/teams/" + f
    return None

# ---------- rating ----------
TIERS = [  # (min_rating_inclusive, tier name) — calibrated to the shrunk rating scale (~0.81..1.18, mean 1.00)
    (1.155, "Champion"), (1.125, "Grandmaster"), (1.090, "Master"),
    (1.050, "Emerald"), (1.020, "Diamond"), (0.990, "Platinum"),
    (0.950, "Gold"), (0.910, "Silver"), (0.870, "Bronze"), (0.0, "Iron"),
]
def tier_for(rating):
    for lo, name in TIERS:
        if rating >= lo:
            return name
    return "Iron"

RATING_LO, RATING_HI = 0.80, 1.20
def level_for(rating):
    # linear map of rating across [0.80, 1.20] onto BPL Level 1..10
    lvl = int(round(1 + 9 * (rating - RATING_LO) / (RATING_HI - RATING_LO)))
    return max(1, min(10, lvl))

WEIGHTS = {"kdr": 0.40, "kpm": 0.30, "mvppm": 0.15, "apm": 0.10, "wr": 0.05}

# Players that don't belong in a given pool (removed before rating normalization).
EXCLUDE_TEAMS = {
    "pro":     {"ωteamless", "teamless"},                       # teamless bots don't count as pro
    "amateur": {"floodflashers", "xplosiv", "5percent"},        # these are pro teams, not amateurs
    "solo":    {"admin"},                                       # ADMIN = real humans, not bots
}
def _excluded(pool, team):
    k = norm_key(team)
    if pool == "pro" and "teamless" in k:
        return True
    return k in EXCLUDE_TEAMS.get(pool, set())

def parse_player_pool(rows, pool):
    """rows: raw csv rows; header in row 0. Returns list of player dicts (rating filled later)."""
    players = []
    for r in rows[1:]:
        if not r or not r[0].strip():
            continue
        name = r[0].strip()
        if name.upper() in ("ADMIN",):  # skip section markers if any
            pass
        team = r[1].strip() if len(r) > 1 else ""
        kills, assists, deaths = num(r[2]), num(r[3]), num(r[4])
        mvp = num(r[5]); kdr = num(r[6]); wins = num(r[7]); losses = num(r[8])
        winrate = pct(r[9]); ot = num(r[10])
        role = r[14].strip() if len(r) > 14 else ""
        maps = wins + losses
        if kdr == 0 and deaths > 0:
            kdr = kills / deaths
        players.append({
            "name": name, "team": team, "pool": pool,
            "kills": int(kills), "assists": int(assists), "deaths": int(deaths),
            "mvp": int(mvp), "kdr": round(kdr, 2), "wins": int(wins), "losses": int(losses),
            "winrate": round(winrate, 3), "ot": int(ot), "role": role,
            "maps": int(maps),
            "orig_rank": r[11].strip() if len(r) > 11 else "",
            "orig_level": r[12].strip() if len(r) > 12 else "",
            "orig_rating": num(r[13]) if len(r) > 13 else 0,
            "slug": slug(name) + ("" if pool == "pro" else "-" + pool),
        })
    # ---- drop players that don't belong in this pool ----
    removed = [p["name"] for p in players if _excluded(pool, p["team"])]
    players = [p for p in players if not _excluded(pool, p["team"])]
    if removed:
        print(f"  [{pool}] removed {len(removed)}: {', '.join(removed)}")
    return players

def compute_ratings(players):
    """Normalize within the pool and compute kdr/winrate/rating/tier/level from the
    CURRENT totals. Call AFTER any recorded-scoreboard stats have been merged in."""
    for p in players:                       # refresh derived fields from (possibly grown) totals
        p["maps"] = p["wins"] + p["losses"]
        p["kdr"] = round(p["kills"] / p["deaths"], 2) if p["deaths"] else 0.0
        p["winrate"] = round(p["wins"] / p["maps"], 3) if p["maps"] else 0.0
    valid = [p for p in players if p["maps"] > 0 and p["deaths"] > 0]
    def avg(key):
        vals = [key(p) for p in valid if key(p) is not None]
        return sum(vals) / len(vals) if vals else 1.0
    a_kdr = avg(lambda p: p["kdr"])
    a_kpm = avg(lambda p: p["kills"] / p["maps"])
    a_mvp = avg(lambda p: p["mvp"] / p["maps"])
    a_apm = avg(lambda p: p["assists"] / p["maps"])
    a_wr  = avg(lambda p: p["winrate"]) or 1.0
    K = 8.0  # shrinkage pseudo-maps: a small sample is pulled toward the league mean (ratio 1.0)
    def shrink(ratio, n):
        return (n * ratio + K * 1.0) / (n + K)
    for p in players:
        if p["maps"] <= 0:
            p["rating"] = None; p["tier"] = None; p["level"] = None
            continue
        n = p["maps"]
        kpm = p["kills"] / n; mvppm = p["mvp"] / n; apm = p["assists"] / n
        r_kdr = shrink(p["kdr"] / a_kdr, n)
        r_kpm = shrink(kpm / a_kpm if a_kpm else 1, n)
        r_mvp = shrink(mvppm / a_mvp if a_mvp else 1, n)
        r_apm = shrink(apm / a_apm if a_apm else 1, n)
        r_wr  = shrink(p["winrate"] / a_wr if a_wr else 1, n)
        rating = (WEIGHTS["kdr"] * r_kdr + WEIGHTS["kpm"] * r_kpm +
                  WEIGHTS["mvppm"] * r_mvp + WEIGHTS["apm"] * r_apm + WEIGHTS["wr"] * r_wr)
        p["rating"] = round(rating, 3)
        p["tier"] = tier_for(rating)
        p["level"] = level_for(rating)
        p["kpm"] = round(kpm, 1)
    return {"kdr": a_kdr, "kpm": a_kpm, "mvp": a_mvp, "apm": a_apm, "wr": a_wr}

# ---------- team ranking points (computed from tournament results) ----------
# BPL Rank Points are computed live from the events on the site, so recording/editing
# a result updates the ladder automatically. Each event awards placement points scaled
# by its tier, faded by recency so current form drives the ranking.
POINTS_HALFLIFE_DAYS = 730             # a result loses half its weight every ~2 years
TIER_POINT_MULT = {"major": 5.0, "s": 2.5, "a": 1.0}   # Major title=500, S=250, A=100
def _placement_points(rank):
    return (100 if rank == 1 else 70 if rank == 2 else 45 if rank <= 4
            else 25 if rank <= 8 else 12 if rank <= 16 else 5)
def _pdate(s):
    y, m, d = (int(x) for x in s.split("-")); return _date(y, m, d)
def compute_team_points(teams, tournaments):
    """Override each team's rank_points with a value derived from completed events:
    Σ placement_points(rank) × tier_mult × recency_decay. Then re-sort + re-rank."""
    dated = [t["date"] for t in tournaments if t.get("date")]
    ref = max((_pdate(d) for d in dated), default=None)   # newest event = "now"
    pts = defaultdict(float)
    breakdown = defaultdict(list)
    for tr in tournaments:
        if not tr.get("championTeam") or not tr.get("date"):
            continue                       # skip in-progress / undecided events
        mult = TIER_POINT_MULT.get(tr["tier"], 1.0)
        w = 0.5 ** ((ref - _pdate(tr["date"])).days / POINTS_HALFLIFE_DAYS) if ref else 1.0
        for s in tr["standings"]:
            if s.get("teamSlug"):
                p = _placement_points(s["rank"]) * mult * w
                pts[s["teamSlug"]] += p
                breakdown[s["teamSlug"]].append({
                    "event": tr["name"], "slug": tr["slug"], "date": tr["date"],
                    "tier": tr["tier"], "placement": s["rank"], "points": round(p, 1)})
    for t in teams:
        t["rank_points"] = round(pts.get(t["slug"], 0))
        t["points_breakdown"] = sorted(breakdown.get(t["slug"], []),
                                       key=lambda b: -b["points"])
    teams.sort(key=lambda t: -t["rank_points"])
    for i, t in enumerate(teams):
        t["rank"] = i + 1

# ---------- roster .txt (team lore) ----------
def parse_rosters():
    path = os.path.join(DATA, "rosters.txt")
    txt = open(path, encoding="utf-8", errors="replace").read()
    teams = {}
    # split into blocks: a header line followed by bot_add lines
    lines = txt.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        # a header is a non-empty line NOT starting with bot_add and followed by a bot_add line
        if line and not line.startswith("bot_add") and not line.startswith("mp_") \
                and not line.startswith("bot_kick") and not line.startswith("☆ for") \
                and not set(line) <= set("- "):
            j = i + 1
            while j < len(lines) and not lines[j].strip():
                j += 1
            if j < len(lines) and lines[j].strip().startswith("bot_add"):
                star = "☆" in line
                om = re.search(r"\(([^)]*)\)", line)      # first (...) = origin
                nm = re.search(r"\[([^\]]*)\]", line)      # first [...] = roster note
                origin = om.group(1).strip() if om else ""
                notes = nm.group(1).strip() if nm else ""
                # name = text before the first of ( [ ☆
                cut = len(line)
                for ch in ("(", "[", "☆"):
                    p = line.find(ch)
                    if p != -1:
                        cut = min(cut, p)
                name = line[:cut].strip()
                tm = re.search(r'bot_add\s+"([^ ]+)\s', lines[j])
                tag = tm.group(1) if tm else ""
                if name:
                    teams[norm_key(name)] = {
                        "roster_name": name, "star": star, "origin": origin,
                        "notes": notes, "tag": tag,
                    }
                i = j
                continue
        i += 1
    return teams

# ---------- major playoff grids ----------
def parse_playoffs():
    rows = read_csv("major_playoffs.csv")
    header = rows[0]
    # three blocks separated by blank columns. Detect block starts where a cell == "Pro Team Name"
    blocks = []
    for ci, cell in enumerate(header):
        if cell.strip() == "Pro Team Name":
            # years are the following non-empty cells until blank
            years = []
            k = ci + 1
            while k < len(header) and header[k].strip():
                years.append(header[k].strip()); k += 1
            blocks.append((ci, years))
    labels = ["Major Playoffs", "Audax Esse Playoffs", "Pro Cup Top 16"]
    result = defaultdict(dict)  # team_key -> {label: {year: status}}
    for bi, (ci, years) in enumerate(blocks):
        label = labels[bi] if bi < len(labels) else f"Block {bi+1}"
        for r in rows[1:]:
            if ci >= len(r):
                continue
            tname = r[ci].strip()
            if not tname:
                continue
            yd = {}
            for yi, yr in enumerate(years):
                cell = r[ci + 1 + yi].strip() if ci + 1 + yi < len(r) else ""
                if cell and cell.lower() != "no":
                    yd[yr] = cell  # "Yes" / "Won"
            if yd:
                result[norm_key(tname)][label] = yd
    return result

# ---------- teams ----------
def parse_teams(roster_meta, playoffs):
    rows = read_csv("pro_team.csv")
    teams = []
    for r in rows[1:]:
        if not r or not r[0].strip():
            continue
        name = r[0].strip()
        k = norm_key(name)
        meta = roster_meta.get(k, {})
        teams.append({
            "name": name, "slug": slug(name), "key": k,
            "logo": find_logo(name),
            "map_wins": int(num(r[1])), "map_losses": int(num(r[2])), "map_ties": int(num(r[3])),
            "total_maps": int(num(r[4])), "wlr": pct(r[5]),
            "a_tier_wins": int(num(r[6])), "s_tier_wins": int(num(r[7])),
            "major_wins": int(num(r[8])), "major_playoffs": int(num(r[9])),
            "events_played": int(num(r[10])), "podiums": int(num(r[11])),
            "major_podiums": int(num(r[12])), "rank_points": int(num(r[13])),
            "tag": meta.get("tag", ""), "origin": meta.get("origin", ""),
            "notes": meta.get("notes", ""), "star": meta.get("star", False),
            "playoffs": playoffs.get(k, {}),
        })
    teams.sort(key=lambda t: -t["rank_points"])
    for i, t in enumerate(teams):
        t["rank"] = i + 1
    return teams

# ---------- main ----------
def main():
    roster_meta = parse_rosters()
    playoffs = parse_playoffs()
    teams = parse_teams(roster_meta, playoffs)
    team_by_key = {t["key"]: t for t in teams}

    pro = parse_player_pool(read_csv("bot_tourney_stats.csv"), "pro")
    amateur = parse_player_pool(read_csv("bot_amateur_tourney_stats.csv"), "amateur")
    solo = parse_player_pool(read_csv("bot_competitive_me.csv"), "solo")

    # nationalities / flags
    nat = load_nat()
    for pool in (pro, amateur, solo):
        for p in pool:
            info = nat.get(norm_key(p["name"]), {})
            p["nat"] = info.get("nat", ""); p["iso"] = info.get("iso", "")

    # shared lookups
    pmap = {}
    for pool in (pro, amateur, solo):
        for p in pool:
            pmap.setdefault(norm_key(p["name"]), p)
    slug_to_player = {p["slug"]: p for pool in (pro, amateur, solo) for p in pool}
    ncp = os.path.join(DATA, "name_changes.json")
    old2new = {norm_key(k): v for k, v in json.load(open(ncp, encoding="utf-8")).items()} if os.path.exists(ncp) else {}

    # ---- tournaments (built early so recorded scoreboards can feed player stats) ----
    import tournaments as tourney_mod
    team_map = {t["key"]: {"name": t["name"], "slug": t["slug"]} for t in teams}
    team_alias = tourney_mod.load_team_alias(ROOT)  # norm(old team) -> norm(current team)
    tournaments = tourney_mod.process_all(team_map, team_alias)

    # ---- per-match scoreboards: attach to matches AND merge into player career totals ----
    msp = os.path.join(DATA, "match_stats.json")
    match_stats = json.load(open(msp, encoding="utf-8")) if os.path.exists(msp) else {}
    def resolve_sb_players(players):
        out = []
        for p in players:
            k = norm_key(p["name"]); tgt = old2new.get(k)
            cur = pmap.get(norm_key(tgt) if tgt else k)
            info = nat.get(norm_key(cur["name"]) if cur else k, {})
            out.append({**p, "name": cur["name"] if cur else p["name"],
                        "slug": cur["slug"] if cur else None, "iso": info.get("iso", "")})
        return out
    def resolve_sb(rec):
        maps = rec["maps"] if "maps" in rec else [{"map": rec.get("map", ""), "players": rec.get("players", [])}]
        return {"maps": [{"map": mp.get("map", ""), "scoreA": mp.get("scoreA"), "scoreB": mp.get("scoreB"),
                          "players": resolve_sb_players(mp.get("players", []))} for mp in maps]}
    def merge_scoreboard(m):
        for mp in m["stats"]["maps"]:
            sa, sb = mp.get("scoreA"), mp.get("scoreB")
            for pl in mp["players"]:
                tgt = slug_to_player.get(pl.get("slug"))
                if not tgt:
                    continue
                tgt["kills"] += int(pl.get("k", 0)); tgt["deaths"] += int(pl.get("d", 0))
                tgt["assists"] += int(pl.get("a", 0)); tgt["mvp"] += int(pl.get("mvp", 0))
                on_a = norm_key(pl.get("team", "")) == norm_key(m.get("a", ""))
                if sa is not None and sb is not None and sa != sb:
                    won = (sa > sb) if on_a else (sb > sa)
                elif m.get("w") in (1, 2):
                    won = (m["w"] == 1) if on_a else (m["w"] == 2)
                else:
                    continue
                tgt["wins"] += 1 if won else 0
                tgt["losses"] += 0 if won else 1
    for tr in tournaments:
        smap = match_stats.get(tr["slug"], {})
        if not smap:
            continue
        for st in tr.get("stages", []):
            for rd in st["rounds"]:
                for m in rd["matches"]:
                    ref = f"{st['id']}-{m.get('i')}"
                    if ref in smap:
                        m["stats"] = resolve_sb(smap[ref]); merge_scoreboard(m)
        for rd in tr.get("bracket", []):
            for m in rd["matches"]:
                ref = str(m.get("i"))
                if m.get("i") is not None and ref in smap:
                    m["stats"] = resolve_sb(smap[ref]); merge_scoreboard(m)

    # ---- ratings (computed AFTER scoreboards are merged into totals) ----
    pro_avg = compute_ratings(pro); am_avg = compute_ratings(amateur); solo_avg = compute_ratings(solo)

    # attach pro players to teams (sorted by rating)
    roster = defaultdict(list)
    for p in pro:
        tk = norm_key(p["team"])
        if tk in team_by_key:
            roster[tk].append(p)
    for t in teams:
        t["roster"] = sorted(roster.get(t["key"], []), key=lambda p: -(p["rating"] or 0))
    # attach each team's event history (matched by teamSlug)
    slug_to_team = {t["slug"]: t for t in teams}
    for t in teams:
        t["events"] = []
    for tr in tournaments:
        for s in tr["standings"]:
            tm = slug_to_team.get(s["teamSlug"]) if s.get("teamSlug") else None
            if tm:
                tm["events"].append({
                    "slug": tr["slug"], "name": tr["name"], "date": tr["date"],
                    "tier": tr["tier"], "tierLabel": tr["tierLabel"],
                    "placement": s["rank"], "isChampion": (tr["championTeam"] == tm["slug"]),
                })
    for t in teams:
        t["events"].sort(key=lambda e: e["date"], reverse=True)

    # ---- website-computed BPL Rank Points (overrides the sheet value; re-ranks) ----
    compute_team_points(teams, tournaments)

    # ---- historical attending rosters (from scraped Challonge descriptions) ----
    old2new = {}
    ncp = os.path.join(DATA, "name_changes.json")
    if os.path.exists(ncp):
        old2new = {norm_key(k): v for k, v in json.load(open(ncp, encoding="utf-8")).items()}
    pmap = {}
    for pool in (pro, amateur, solo):
        for p in pool:
            pmap.setdefault(norm_key(p["name"]), p)
    hist_path = os.path.join(DATA, "hist_rosters.json")
    hist_rosters = json.load(open(hist_path, encoding="utf-8")) if os.path.exists(hist_path) else {}
    team_by_key2 = {t["key"]: t for t in teams}
    for tr in tournaments:
        att = []
        for row in hist_rosters.get(tr["slug"], []):
            pls = []
            for pl in row["players"]:
                k = norm_key(pl["name"])
                tgt = old2new.get(k)
                cur = pmap.get(norm_key(tgt) if tgt else k)
                pls.append({
                    "hist": pl["name"],
                    "name": cur["name"] if cur else (tgt or pl["name"]),
                    "slug": cur["slug"] if cur else None,
                    "iso": cur.get("iso", "") if cur else "",
                    "captain": pl.get("captain", False),
                })
            # resolve team via alias (typo/rebrand -> current team name + page)
            tkey = team_alias.get(norm_key(row["team"]), norm_key(row["team"]))
            tm = team_by_key2.get(tkey)
            att.append({
                "team": tm["name"] if tm else row["team"],
                "teamSlug": tm["slug"] if tm else None,
                "players": pls,
            })
        tr["attending"] = att

    # ---- per-player team history (chronological, from attending rosters) ----
    player_teams = defaultdict(dict)  # player slug -> {teamName: {teamSlug, isPro, first, years}}
    for tr in sorted(tournaments, key=lambda t: t["date"]):
        for row in tr["attending"]:
            for pl in row["players"]:
                if not pl["slug"]:
                    continue
                e = player_teams[pl["slug"]].setdefault(row["team"], {
                    "teamSlug": row["teamSlug"], "isPro": bool(row["teamSlug"]),
                    "first": tr["date"], "years": set(), "roster": []})
                e["first"] = min(e["first"], tr["date"])
                if tr["year"]:
                    e["years"].add(tr["year"])
                e["roster"] = row["players"]  # loop is date-ascending, so this ends as the latest lineup
    slug_to_player = {}
    for pool in (pro, amateur, solo):
        for p in pool:
            slug_to_player.setdefault(p["slug"], p)
    transfers = []   # chronological roster-move feed (player left team A -> joined team B)
    for slug, teams_map in player_teams.items():
        p = slug_to_player.get(slug)
        if not p:
            continue
        ordered = sorted(teams_map.items(), key=lambda kv: kv[1]["first"])
        p["teamHistory"] = [{
            "team": name, "teamSlug": e["teamSlug"], "isPro": e["isPro"],
            "years": sorted(e["years"]), "roster": e["roster"],
        } for name, e in ordered]
        prev = None
        for name, e in ordered:
            entry = {"team": name, "teamSlug": e["teamSlug"], "isPro": e["isPro"], "date": e["first"]}
            transfers.append({
                "type": "transfer" if prev else "debut",
                "player": p["name"], "playerSlug": p["slug"], "iso": p.get("iso", ""),
                "fromTeam": prev["team"] if prev else None,
                "fromSlug": prev["teamSlug"] if prev else None,
                "toTeam": name, "toSlug": e["teamSlug"], "toPro": e["isPro"],
                "date": e["first"],
            })
            prev = entry
    transfers.sort(key=lambda t: t["date"], reverse=True)

    # ---- per-team former players (inverted from historical attending rosters) ----
    team_seen = defaultdict(dict)   # teamSlug -> {playerSlug: {name, iso, years:set()}}
    for tr in tournaments:
        yr = tr.get("year")
        for row in tr["attending"]:
            ts = row.get("teamSlug")
            if not ts:
                continue
            for pl in row["players"]:
                if not pl.get("slug"):
                    continue
                e = team_seen[ts].setdefault(pl["slug"],
                        {"name": pl["name"], "iso": pl.get("iso", ""), "years": set()})
                if yr:
                    e["years"].add(yr)
    for t in teams:
        cur = {p["slug"] for p in t.get("roster", [])}
        former = []
        for pslug, info in team_seen.get(t["slug"], {}).items():
            if pslug in cur:
                continue                          # still on the roster
            cp = slug_to_player.get(pslug)
            now = team_by_key2.get(norm_key(cp["team"])) if cp and cp.get("team") else None
            former.append({
                "slug": pslug, "name": info["name"], "iso": info["iso"],
                "years": sorted(info["years"]),
                "nowTeam": now["name"] if now else (cp["team"] if cp else ""),
                "nowTeamSlug": now["slug"] if now else None,
            })
        former.sort(key=lambda x: (x["years"][-1] if x["years"] else "", x["name"].lower()), reverse=True)
        t["formerPlayers"] = former

    # ---- also-known-as (former names) per current player ----
    nc_raw = json.load(open(ncp, encoding="utf-8")) if os.path.exists(ncp) else {}
    aka = defaultdict(list)
    for old, cur in nc_raw.items():
        pp = pmap.get(norm_key(cur))
        if pp and norm_key(old) != norm_key(cur):
            aka[pp["slug"]].append(old)
    for slug, olds in aka.items():
        if slug in slug_to_player:
            seen, uniq = set(), []
            for o in olds:
                if norm_key(o) not in seen:
                    seen.add(norm_key(o)); uniq.append(o)
            slug_to_player[slug]["aka"] = uniq

    # ---- player honors: titles won (on the champion's event roster) + event MVPs ----
    for tr in tournaments:
        ct = tr.get("championTeam")
        if ct:
            row = next((r for r in tr["attending"] if r.get("teamSlug") == ct), None)
            if row:
                for pl in row["players"]:
                    p = slug_to_player.get(pl.get("slug"))
                    if p:
                        p.setdefault("titles", []).append({
                            "event": tr["name"], "slug": tr["slug"], "tier": tr["tier"],
                            "tierLabel": tr["tierLabel"], "year": tr["year"], "team": row["team"]})
        # event MVP from any recorded scoreboards
        agg = {}
        def _scan(rounds):
            for rd in rounds:
                for m in rd["matches"]:
                    for mp in m.get("stats", {}).get("maps", []):
                        for pl in mp.get("players", []):
                            s = pl.get("slug")
                            if not s:
                                continue
                            a = agg.setdefault(s, {"mvp": 0, "k": 0})
                            a["mvp"] += int(pl.get("mvp", 0)); a["k"] += int(pl.get("k", 0))
        for st in tr.get("stages", []):
            _scan(st["rounds"])
        _scan(tr.get("bracket", []))
        if agg:
            best = max(agg.items(), key=lambda kv: (kv[1]["mvp"], kv[1]["k"]))
            p = slug_to_player.get(best[0])
            if p:
                p.setdefault("mvpAwards", []).append({
                    "event": tr["name"], "slug": tr["slug"], "year": tr["year"]})
    for p in (pro + amateur + solo):
        if p.get("titles"):
            p["titles"].sort(key=lambda x: x["year"], reverse=True)

    # ---- head-to-head team records + per-team chronological results (form/streak) ----
    h2h = defaultdict(lambda: defaultdict(lambda: {"w": 0, "l": 0}))
    team_matches = defaultdict(list)
    for tr in tournaments:
        ri = 0
        for rd in tr["bracket"]:
            for m in rd["matches"]:
                a, b, w = m.get("aTeam"), m.get("bTeam"), m.get("w")
                if w not in (1, 2):
                    continue
                if a and b:  # both current teams -> head-to-head
                    if w == 1:
                        h2h[a][b]["w"] += 1; h2h[b][a]["l"] += 1
                    else:
                        h2h[a][b]["l"] += 1; h2h[b][a]["w"] += 1
                base = {"date": tr["date"], "event": tr["name"], "eventSlug": tr["slug"], "ord": ri}
                if a:
                    team_matches[a].append({**base, "opp": m.get("b"), "oppSlug": b,
                                            "result": "W" if w == 1 else "L", "sf": m.get("sa"), "sa2": m.get("sb")})
                if b:
                    team_matches[b].append({**base, "opp": m.get("a"), "oppSlug": a,
                                            "result": "W" if w == 2 else "L", "sf": m.get("sb"), "sa2": m.get("sa")})
                ri += 1
    for t in teams:
        recs = h2h.get(t["slug"], {})
        t["h2h"] = sorted(
            [{"opp": o, "oppName": slug_to_team[o]["name"], "w": r["w"], "l": r["l"]}
             for o, r in recs.items() if o in slug_to_team and o != t["slug"]],
            key=lambda x: (-(x["w"] + x["l"]), -x["w"]))
        ms = sorted(team_matches.get(t["slug"], []), key=lambda x: (x["date"], x["ord"]))
        t["recentResults"] = [{"date": m["date"], "event": m["event"], "eventSlug": m["eventSlug"],
                               "opp": m["opp"], "oppSlug": m["oppSlug"], "result": m["result"],
                               "sf": m["sf"], "sa": m["sa2"]} for m in ms[-10:]]
        last, streak = None, 0
        for m in reversed(ms):
            if last is None:
                last, streak = m["result"], 1
            elif m["result"] == last:
                streak += 1
            else:
                break
        t["streak"] = (last + str(streak)) if last else ""

    data = {
        "teams": teams,
        "players": {"pro": pro, "amateur": amateur, "solo": solo},
        "pool_avg": {"pro": pro_avg, "amateur": am_avg, "solo": solo_avg},
        "weights": WEIGHTS,
        "tiers": [t[1] for t in TIERS],
        "tournaments": tournaments,
        "transfers": transfers,
    }
    os.makedirs(SITE, exist_ok=True)
    with open(os.path.join(SITE, "data.json"), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)

    # sync team logos into the deployable site folder so site/ is self-contained
    import shutil
    site_logos = os.path.join(SITE, "assets", "teams")
    os.makedirs(site_logos, exist_ok=True)
    for f in os.listdir(LOGO_DIR):
        if f.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
            shutil.copy2(os.path.join(LOGO_DIR, f), os.path.join(site_logos, f))

    # ---------- validation report ----------
    print(f"Teams parsed:        {len(teams)}")
    missing_logo = [t['name'] for t in teams if not t['logo']]
    print(f"Teams missing logo:  {len(missing_logo)} {missing_logo if missing_logo else ''}")
    no_meta = [t['name'] for t in teams if not t['origin']]
    print(f"Teams missing origin:{len(no_meta)} {no_meta if no_meta else ''}")
    empty_roster = [t['name'] for t in teams if not t['roster']]
    print(f"Teams w/ 0 players:  {len(empty_roster)} {empty_roster if empty_roster else ''}")
    print(f"Pro players:         {len(pro)}")
    print(f"Amateur players:     {len(amateur)}")
    print(f"Solo-queue players:  {len(solo)}")
    print(f"Pool avg (pro):      KDR {pro_avg['kdr']:.2f}  KPM {pro_avg['kpm']:.1f}  MVP/map {pro_avg['mvp']:.2f}")
    top = sorted([p for p in pro if p['rating']], key=lambda p: -p['rating'])[:12]
    print("\nTop 12 pro players by new BPL Rating:")
    for p in top:
        print(f"  {p['rating']:.2f}  L{p['level']:<2} {p['tier']:<12} {p['name']:<22} {p['team']:<16} "
              f"KDR {p['kdr']:.2f}  {p['kills']}k/{p['deaths']}d  {p['mvp']}mvp")
    # tier distribution
    dist = defaultdict(int)
    for p in pro:
        if p['tier']:
            dist[p['tier']] += 1
    print("\nPro tier distribution:")
    for _, name in TIERS:
        if dist[name]:
            print(f"  {name:<12} {dist[name]}")

if __name__ == "__main__":
    main()
