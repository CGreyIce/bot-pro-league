#!/usr/bin/env python3
"""Bot Pro League — data pipeline.
Reads the raw Google-Sheet CSV exports, the roster .txt, the major-playoff grids
and the team-logo folder, normalizes everything into one dataset, computes a fresh
BPL Rating per player (normalized within each pool), and writes site/data.json.

Run:  python build/parse.py
Re-run any time the source data changes.
"""
import csv, hashlib, json, os, re, sys, unicodedata
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
    "brazil":"br","china":"cn","vietnam":"vn",
    "russia":"neutral","russian":"neutral","land of make believe":"neutral",  # neutral (flagless) flag
}
# ISO alpha-2 -> region label (for the region shown on a team profile)
REGION_BY_ISO = {
    "sg":"SEA","my":"SEA","ph":"SEA","id":"SEA","th":"SEA","vn":"SEA",
    "jp":"East Asia","kr":"East Asia","tw":"East Asia","hk":"East Asia","cn":"East Asia",
    "au":"Oceania","nz":"Oceania",
    "us":"North America","ca":"North America",
    "br":"South America",
    "gb":"Europe","fr":"Europe","de":"Europe","nl":"Europe","be":"Europe","at":"Europe",
    "pl":"Europe","fi":"Europe","it":"Europe","is":"Europe","se":"Europe","ua":"Europe",
    "kz":"Central Asia",
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
TIERS = [  # (min_rating_inclusive, tier name) — calibrated to the K=20 shrunk scale (~0.89..1.12, mean 1.00)
    (1.103, "Champion"), (1.081, "Grandmaster"), (1.055, "Master"),
    (1.029, "Diamond"), (1.012, "Emerald"), (0.994, "Platinum"),
    (0.969, "Gold"), (0.945, "Silver"), (0.918, "Bronze"), (0.0, "Iron"),
]
def tier_for(rating):
    for lo, name in TIERS:
        if rating >= lo:
            return name
    return "Iron"

# FACEIT-style Rating Points (ELO-like) derived from the shrunk rating, plus Level 1..10 from
# the points via FACEIT thresholds. Points is the public metric; Level is f(points).
def points_for(rating):
    if rating is None:
        return None
    return int(max(100, min(3500, round(1150 + (rating - 1.0) * 3900))))
_LEVEL_CUTS = [501, 751, 901, 1051, 1201, 1351, 1531, 1751, 2001]   # upper bound of L1..L9
def level_for(rating):
    pts = points_for(rating)
    if pts is None:
        return None
    for i, cut in enumerate(_LEVEL_CUTS):
        if pts < cut:
            return i + 1
    return 10

WEIGHTS = {"kdr": 0.40, "kpm": 0.30, "mvppm": 0.15, "apm": 0.10, "wr": 0.05}

_TIER_TOKEN = re.compile(r"\b(Champion|Grandmaster|Master|Diamond|Emerald|Platinum|Gold|Silver|Bronze|Iron)\b")
def refresh_bio_dynamics(pro, amateur, solo):
    """Keep the volatile parts of each hand-written bio in sync with the live FACEIT-style
    stats: tier language becomes 'Level N', rating values become 'N points', and the
    'highest-rated in the pool' epithet follows the true #1. Every bio references its own
    tier at most once (verified), so a single-token swap is unambiguous. Runs each build."""
    def sync(p):
        bio = p.get("bio")
        if not bio:
            return
        ss = p.get("soloStats") or {}
        lvl = p.get("level") or ss.get("level")                            # fall back to solo-queue standing
        pts = p.get("ratingPoints") if p.get("ratingPoints") is not None else ss.get("ratingPoints")
        if lvl:
            new = re.sub(r"\b(?:Champion|Grandmaster|Master|Diamond|Emerald|Platinum|Gold|Silver|Bronze|Iron)-tier\b",
                         f"Level {lvl}", bio, count=1)                       # "Grandmaster-tier rifler" -> "Level 8 rifler"
            if new == bio:
                new = _TIER_TOKEN.sub(f"Level {lvl}", bio, count=1)         # standalone "Champion" -> "Level 8"
            bio = new
        if pts is not None:
            bio = re.sub(r"\b(at\s+)(?:1\.\d\d|0\.\d\d)\b", lambda m: m.group(1) + f"{pts} points", bio)   # "Level 8 at 1609 points"
            bio = re.sub(r"\b(?:1\.\d\d|0\.\d\d)\s+rating\b", f"{pts} points", bio)                         # "1.14 rating" -> "1609 points"
        p["bio"] = bio
    for pool in (pro, amateur, solo):
        for p in pool:
            sync(p)
    # "highest-rated player in the {pool} pool" epithet follows the true #1 automatically
    for pool, label in ((pro, "pro"), (amateur, "amateur")):
        rated = [p for p in pool if p.get("rating") is not None]
        if not rated:
            continue
        top = max(rated, key=lambda p: p["rating"])
        the = f"the highest-rated player in the {label} pool"
        one = f"one of the highest-rated players in the {label} pool"
        for p in pool:
            b = p.get("bio")
            if not b:
                continue
            p["bio"] = b.replace(one, the) if p is top else b.replace(the, one)

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
    K = 20.0  # shrinkage pseudo-maps: rewards map volume — a small sample is pulled hard toward the
              # league mean (ratio 1.0), so a 13-map player can't outrank a consistent 30-map player
    def shrink(ratio, n):
        return (n * ratio + K * 1.0) / (n + K)
    for p in players:
        if p["maps"] <= 0:
            p["rating"] = None; p["ratingPoints"] = None; p["tier"] = None; p["level"] = None
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
        p["ratingPoints"] = points_for(rating)
        p["tier"] = tier_for(rating)
        p["level"] = level_for(rating)
        p["kpm"] = round(kpm, 1)
    return {"kdr": a_kdr, "kpm": a_kpm, "mvp": a_mvp, "apm": a_apm, "wr": a_wr}

def _rating_value(kills, deaths, assists, mvp, wins, losses, avg):
    """The same rating formula as compute_ratings, for arbitrary totals — used to
    recompute a player's rating for a 'before the last match' snapshot."""
    maps = wins + losses
    if maps <= 0 or deaths <= 0:
        return None
    n = maps; K = 20.0
    def shrink(ratio):
        return (n * ratio + K * 1.0) / (n + K)
    r_kdr = shrink((kills / deaths) / avg["kdr"] if avg["kdr"] else 1)
    r_kpm = shrink((kills / n) / avg["kpm"] if avg["kpm"] else 1)
    r_mvp = shrink((mvp / n) / avg["mvp"] if avg["mvp"] else 1)
    r_apm = shrink((assists / n) / avg["apm"] if avg["apm"] else 1)
    r_wr  = shrink((wins / maps) / avg["wr"] if avg["wr"] else 1)
    return (WEIGHTS["kdr"] * r_kdr + WEIGHTS["kpm"] * r_kpm +
            WEIGHTS["mvppm"] * r_mvp + WEIGHTS["apm"] * r_apm + WEIGHTS["wr"] * r_wr)

def compute_player_deltas(players, avg, contrib):
    """Set p['rankDelta'] = places moved in the pool's rating order vs. before the most
    recent recorded match (whose per-player stat contributions are in `contrib`)."""
    rated = [p for p in players if p.get("rating") is not None]
    if not rated:
        return
    cur_order = sorted(rated, key=lambda p: -p["rating"])
    cur_rank = {p["slug"]: i + 1 for i, p in enumerate(cur_order)}
    prev_val = {}
    for p in rated:
        c = contrib.get(p["slug"])
        if not c:
            prev_val[p["slug"]] = p["rating"]        # not in the last match -> unchanged
        else:
            r = _rating_value(p["kills"] - c["k"], p["deaths"] - c["d"], p["assists"] - c["a"],
                              p["mvp"] - c["mvp"], p["wins"] - c["w"], p["losses"] - c["l"], avg)
            prev_val[p["slug"]] = r if r is not None else p["rating"]
    prev_order = sorted(rated, key=lambda p: (-prev_val[p["slug"]], cur_rank[p["slug"]]))
    prev_rank = {p["slug"]: i + 1 for i, p in enumerate(prev_order)}
    # only the players who actually played the most recent match show a movement arrow
    for p in players:
        p["rankDelta"] = (prev_rank[p["slug"]] - cur_rank[p["slug"]]) \
            if (p.get("rating") is not None and p["slug"] in contrib) else 0

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
    Σ placement_points(rank) × tier_mult × recency_decay. Then re-sort + re-rank, and
    record how each team's rank moved vs. before the most recent completed event."""
    dated = [t["date"] for t in tournaments if t.get("date")]
    ref = max((_pdate(d) for d in dated), default=None)   # newest event = "now"
    completed = [tr for tr in tournaments if tr.get("championTeam") and tr.get("date")]
    latest_date = max((tr["date"] for tr in completed), default=None)  # most recent event

    def tally(exclude_latest):
        pts = defaultdict(float); bd = defaultdict(list)
        for tr in completed:
            if exclude_latest and tr["date"] == latest_date:
                continue
            mult = TIER_POINT_MULT.get(tr["tier"], 1.0)
            w = 0.5 ** ((ref - _pdate(tr["date"])).days / POINTS_HALFLIFE_DAYS) if ref else 1.0
            for s in tr["standings"]:
                if s.get("teamSlug"):
                    p = _placement_points(s["rank"]) * mult * w
                    pts[s["teamSlug"]] += p
                    bd[s["teamSlug"]].append({
                        "event": tr["name"], "slug": tr["slug"], "date": tr["date"],
                        "tier": tr["tier"], "placement": s["rank"], "points": round(p, 1)})
        return pts, bd

    pts, breakdown = tally(False)
    prev_pts, _ = tally(True)
    for t in teams:
        t["rank_points"] = round(pts.get(t["slug"], 0))
        t["points_breakdown"] = sorted(breakdown.get(t["slug"], []), key=lambda b: -b["points"])
    teams.sort(key=lambda t: -t["rank_points"])
    for i, t in enumerate(teams):
        t["rank"] = i + 1
    # rank before the most recent event (tie-break on current rank), for the movement arrow
    prev_order = sorted(teams, key=lambda t: (-prev_pts.get(t["slug"], 0), t["rank"]))
    prev_rank = {t["slug"]: i + 1 for i, t in enumerate(prev_order)}
    for t in teams:
        t["rankDelta"] = prev_rank.get(t["slug"], t["rank"]) - t["rank"]   # + = moved up

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

    # ---- pro "shadow" entries for amateur players competing in S-Tier site events ----
    # Amateur-team players in the Bot Pro Cup (S-Tier) accumulate their tournament stats in the
    # PRO column, under a placeholder team "—" (they aren't pro yet). Each shadow starts empty
    # and is fed ONLY by recorded scoreboards (routed here because pmap prefers the pro pool);
    # any shadow that never gets a recorded pro map is dropped after rating. So a player surfaces
    # in the Pro tab the moment they've played a recorded pro map — with stats ready to carry over
    # if their team is later promoted — while still appearing in the Amateur tab.
    _pro_slugs = {p["slug"] for p in pro}
    _shadow_seen = set()
    for ap in amateur:
        # amateur slug = <clean>-amateur; the pro/clean slug is that minus the suffix
        s = ap["slug"][:-8] if ap["slug"].endswith("-amateur") else ap["slug"]
        if s in _pro_slugs or s in _shadow_seen:
            continue
        _shadow_seen.add(s)
        pro.append({
            "name": ap["name"], "team": "—", "pool": "pro",
            "kills": 0, "assists": 0, "deaths": 0, "mvp": 0, "kdr": 0.0,
            "wins": 0, "losses": 0, "winrate": 0.0, "ot": 0,
            "role": ap.get("role", ""), "maps": 0,
            "orig_rank": "", "orig_level": "", "orig_rating": 0,
            "slug": s, "shadowAmateur": True,
        })

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
    slug_to_team = {t["slug"]: t for t in teams}
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
    sb_matches = []   # (recorded_ts, match) for every match that has a scoreboard
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
                        sb_matches.append((m.get("ts") or 0, m))
        for rd in tr.get("bracket", []):
            for m in rd["matches"]:
                ref = str(m.get("i"))
                if m.get("i") is not None and ref in smap:
                    m["stats"] = resolve_sb(smap[ref]); merge_scoreboard(m)
                    sb_matches.append((m.get("ts") or 0, m))

    # ---- team map record from site-run (manual) events, on top of the sheet base ----
    # Scraped/historical events are already baked into the sheet, so only add the events
    # the league runs on the site (data/manual/*). Derive per-map wins from each match's
    # score: a round score (>=13) is one map (Bo1); small numbers are maps-won (Bo3/Bo5).
    mdir = os.path.join(DATA, "manual")
    manual_slugs = {os.path.splitext(f)[0] for f in os.listdir(mdir)} if os.path.isdir(mdir) else set()
    for tr in tournaments:
        if tr["slug"] not in manual_slugs:
            continue
        for rd in tr.get("bracket", []):
            for m in rd["matches"]:
                if m.get("w") not in (1, 2):
                    continue
                if m.get("a") == "(bye)" or m.get("b") == "(bye)":
                    continue
                ta = slug_to_team.get(m.get("aTeam")); tb = slug_to_team.get(m.get("bTeam"))
                sa, sb = m.get("sa"), m.get("sb")
                if sa is not None and sb is not None:
                    wa, wb = ((1, 0) if sa > sb else (0, 1)) if max(sa, sb) >= 13 else (sa, sb)
                else:
                    wa, wb = (1, 0) if m["w"] == 1 else (0, 1)
                if ta:
                    ta["map_wins"] += wa; ta["map_losses"] += wb
                if tb:
                    tb["map_wins"] += wb; tb["map_losses"] += wa

    # team totals reflect the (sheet base + site-run events) map record
    for t in teams:
        t["total_maps"] = t["map_wins"] + t["map_losses"] + t["map_ties"]
        denom = t["map_wins"] + t["map_losses"]
        if denom:
            t["wlr"] = round(t["map_wins"] / denom, 3)

    # ---- per-team per-map records (for the map veto simulator) ----
    # Active map pool of 7 (Split is a custom 3rd-place-only map and is ignored).
    POOL_MAPS = ["Mirage", "Dust2", "Inferno", "Cache", "Tuscan", "Vertigo", "Anubis"]
    _mapkey = {m.lower(): m for m in POOL_MAPS}
    map_rec = defaultdict(lambda: defaultdict(lambda: [0, 0]))   # slug -> mapName -> [w, l]
    for tr in tournaments:
        mlist = ([m for st in tr.get("stages", []) for rd in st["rounds"] for m in rd["matches"]]
                 if tr.get("stages") else [m for rd in tr.get("bracket", []) for m in rd["matches"]])
        for m in mlist:
            stats = m.get("stats")
            if not stats:
                continue
            aT, bT = m.get("aTeam"), m.get("bTeam")
            for mp in stats.get("maps", []):
                cm = _mapkey.get((mp.get("map") or "").strip().lower())
                if not cm:
                    continue                                     # skips Split + anything off-pool
                sa, sb = mp.get("scoreA"), mp.get("scoreB")
                if sa is None or sb is None or sa == sb:
                    continue
                if aT: map_rec[aT][cm][0 if sa > sb else 1] += 1
                if bT: map_rec[bT][cm][1 if sa > sb else 0] += 1
    def _seed(s):
        h = 2166136261
        for ch in s:
            h = ((h ^ ord(ch)) * 16777619) & 0xFFFFFFFF
        return h
    for t in teams:
        base = t.get("wlr") or 0.5
        stats = {}
        for cm in POOL_MAPS:
            w, l = map_rec[t["slug"]].get(cm, [0, 0]); g = w + l
            if g >= 2:                                           # enough real maps -> real win rate
                wr, real = round(w / g, 3), True
            else:                                                # not enough data -> deterministic seeded rate
                off = (_seed(t["slug"] + "|" + cm) % 4200) / 10000.0 - 0.21   # ~[-0.21, +0.21]
                wr, real = round(max(0.18, min(0.85, base + off)), 3), False
            stats[cm] = {"w": w, "l": l, "g": g, "wr": wr, "real": real}
        order = sorted(POOL_MAPS, key=lambda cm: (-stats[cm]["wr"], cm))
        t["mapStats"] = stats
        t["bestMaps"] = order[:2]
        t["worstMaps"] = [order[-1], order[-2]]

    # ---- solo-queue scoreboards (admin-entered) on top of the competitive_me sheet base ----
    solo_by_name = {}
    for p in solo:
        solo_by_name.setdefault(norm_key(p["name"]), p)
    ssp = os.path.join(DATA, "solo_scoreboards.json")
    solo_sb = json.load(open(ssp, encoding="utf-8")) if os.path.exists(ssp) else []
    for g in solo_sb:
        for pl in g.get("players", []):
            k = norm_key(pl.get("name", "")); nn = old2new.get(k)
            tgt = solo_by_name.get(norm_key(nn) if nn else k)
            if not tgt:
                continue
            tgt["kills"] += int(pl.get("k", 0)); tgt["deaths"] += int(pl.get("d", 0))
            tgt["assists"] += int(pl.get("a", 0)); tgt["mvp"] += int(pl.get("mvp", 0))
            tgt["wins"] += 1 if pl.get("won") else 0; tgt["losses"] += 0 if pl.get("won") else 1

    # ---- ratings (computed AFTER scoreboards are merged into totals) ----
    pro_avg = compute_ratings(pro); am_avg = compute_ratings(amateur); solo_avg = compute_ratings(solo)

    # Drop amateur→pro shadows that never received a recorded pro stat, so the Pro tab isn't
    # padded with empty rows. They return automatically once a scoreboard is entered for them.
    pro = [p for p in pro if not p.get("shadowAmateur") or p.get("maps", 0) > 0]

    # ---- player rank movement vs. before the most recent recorded match ----
    def scoreboard_contrib(m):
        """Per-player stat totals this match's scoreboard added: {slug:{k,a,d,mvp,w,l}}."""
        out = defaultdict(lambda: {"k": 0, "a": 0, "d": 0, "mvp": 0, "w": 0, "l": 0})
        for mp in m["stats"]["maps"]:
            sa, sb = mp.get("scoreA"), mp.get("scoreB")
            for pl in mp["players"]:
                s = pl.get("slug")
                if not s:
                    continue
                o = out[s]
                o["k"] += int(pl.get("k", 0)); o["d"] += int(pl.get("d", 0))
                o["a"] += int(pl.get("a", 0)); o["mvp"] += int(pl.get("mvp", 0))
                on_a = norm_key(pl.get("team", "")) == norm_key(m.get("a", ""))
                if sa is not None and sb is not None and sa != sb:
                    won = (sa > sb) if on_a else (sb > sa)
                elif m.get("w") in (1, 2):
                    won = (m["w"] == 1) if on_a else (m["w"] == 2)
                else:
                    continue
                o["w"] += 1 if won else 0; o["l"] += 0 if won else 1
        return out
    latest_contrib = scoreboard_contrib(max(sb_matches, key=lambda x: x[0])[1]) if sb_matches else {}
    compute_player_deltas(pro, pro_avg, latest_contrib)
    compute_player_deltas(amateur, am_avg, latest_contrib)
    compute_player_deltas(solo, solo_avg, latest_contrib)

    # ---- fold solo-queue stats into tournament profiles; keep only solo-ONLY players standalone ----
    solo_ranked = sorted([p for p in solo if p.get("rating") is not None], key=lambda p: -p["rating"])
    for i, p in enumerate(solo_ranked):
        p["soloRank"] = i + 1
    solo_lookup = {}
    for p in solo:
        solo_lookup.setdefault(norm_key(p["name"]), p)
    def solo_block(sp):
        return {"kills": sp["kills"], "deaths": sp["deaths"], "assists": sp["assists"], "mvp": sp["mvp"],
                "wins": sp["wins"], "losses": sp["losses"], "maps": sp["maps"], "kdr": sp["kdr"],
                "winrate": sp["winrate"], "rating": sp["rating"], "ratingPoints": sp.get("ratingPoints"),
                "tier": sp["tier"], "level": sp["level"], "soloRank": sp.get("soloRank"), "soloTotal": len(solo_ranked)}
    tourney_names = {norm_key(p["name"]) for p in pro} | {norm_key(p["name"]) for p in amateur}
    for pool in (pro, amateur):
        for p in pool:
            sp = solo_lookup.get(norm_key(p["name"]))
            if sp and sp.get("rating") is not None:
                p["soloStats"] = solo_block(sp)
    # standalone Solo Queue pool = players with no pro/amateur (tournament) profile
    solo = [p for p in solo if norm_key(p["name"]) not in tourney_names]

    # ---- player bios (broadcast descriptions; data/player_bios.json from gen_bios.py) ----
    bios_path = os.path.join(DATA, "player_bios.json")
    if os.path.exists(bios_path):
        bios = json.load(open(bios_path, encoding="utf-8"))
        for pool in (pro, amateur, solo):
            for p in pool:
                b = bios.get(norm_key(p["name"]))
                if b:
                    p["bio"] = b.get("bio", "")
                    if b.get("gender") in ("M", "F"):
                        p["gender"] = b["gender"]
    refresh_bio_dynamics(pro, amateur, solo)  # sync tier/rating/#1 language to live stats

    # ---- team profile bios (broadcast descriptions; data/team_bios_override.json) ----
    tbp = os.path.join(DATA, "team_bios_override.json")
    team_bios = json.load(open(tbp, encoding="utf-8")) if os.path.exists(tbp) else {}
    for t in teams:
        b = team_bios.get(t["slug"]) or team_bios.get(t["key"])
        if b:
            t["bio"] = b

    # attach pro players to teams (sorted by rating)
    roster = defaultdict(list)
    for p in pro:
        tk = norm_key(p["team"])
        if tk in team_by_key:
            roster[tk].append(p)
    for t in teams:
        t["roster"] = sorted(roster.get(t["key"], []), key=lambda p: -(p["rating"] or 0))
    # ---- team region + origin country, derived from the roster's nationalities ----
    for t in teams:
        isos = [p.get("iso") for p in t.get("roster", []) if p.get("iso") and p["iso"] != "neutral"]
        if not isos:
            t["region"] = ""; t["originIso"] = ""; t["originCountry"] = ""
            continue
        iso_count = defaultdict(int)
        for i in isos:
            iso_count[i] += 1
        origin_iso = max(iso_count, key=lambda i: (iso_count[i], i))   # most common country
        reg_count = defaultdict(int)
        for i in isos:
            reg_count[REGION_BY_ISO.get(i, "Other")] += 1
        top = max(reg_count.values())
        tied = [r for r, c in reg_count.items() if c == top]
        origin_region = REGION_BY_ISO.get(origin_iso, "Other")
        # plurality region; ties resolve toward the origin country's region so the two agree
        t["region"] = origin_region if origin_region in tied else sorted(tied)[0]
        t["originIso"] = origin_iso
        t["originCountry"] = next((p.get("nat", "") for p in t["roster"] if p.get("iso") == origin_iso), "")
    # attach each team's event history (matched by teamSlug)
    slug_to_team = {t["slug"]: t for t in teams}
    for t in teams:
        t["events"] = []
    for tr in tournaments:
        added = set()
        for s in tr["standings"]:
            tm = slug_to_team.get(s["teamSlug"]) if s.get("teamSlug") else None
            if tm:
                tm["events"].append({
                    "slug": tr["slug"], "name": tr["name"], "date": tr["date"],
                    "tier": tr["tier"], "tierLabel": tr["tierLabel"],
                    "placement": s["rank"], "isChampion": (tr["championTeam"] == tm["slug"]),
                })
                added.add(tm["slug"])
        # Teams eliminated before the final stage (e.g. the group stage) aren't in the
        # playoff standings — surface them from finalStandings so the event still shows on
        # their profile, with a labelled placement ("Group Stage", "Quarterfinals", …).
        # Only for finished events; they earn no ladder points, so the Pts column shows "—".
        if tr.get("champion"):
            for s in (tr.get("finalStandings") or []):
                tslug = s.get("teamSlug")
                if not tslug or tslug in added:
                    continue
                tm = slug_to_team.get(tslug)
                if not tm:
                    continue
                tm["events"].append({
                    "slug": tr["slug"], "name": tr["name"], "date": tr["date"],
                    "tier": tr["tier"], "tierLabel": tr["tierLabel"],
                    "placement": s.get("rank"), "isChampion": False,
                    "placementLabel": s.get("result") or "Group Stage",
                })
                added.add(tslug)
    for t in teams:
        t["events"].sort(key=lambda e: e["date"], reverse=True)

    # ---- team trophy counts recomputed from championships (event tier is source of truth) ----
    # Challengers & Legends stages count as S-Tier; only the Conquerors stage is a Major title.
    for t in teams:
        t["major_wins"] = t["s_tier_wins"] = t["a_tier_wins"] = 0
    for tr in tournaments:
        tm = slug_to_team.get(tr.get("championTeam")) if tr.get("championTeam") else None
        if not tm:
            continue
        tier = tr.get("tier")
        if tier == "major":
            tm["major_wins"] += 1
        elif tier == "s":
            tm["s_tier_wins"] += 1
        elif tier == "a":
            tm["a_tier_wins"] += 1

    # ---- Playoff & S-Tier history: auto-update from completed site-run (manual) S-tier/Major
    # events. Historical scraped events stay in the sheet; a manual event is authoritative for
    # its own (category, year). Categories: Major Playoffs (reached the Conquerors Stage),
    # Audax Esse Playoffs (made the AUXE playoff bracket), Pro Cup Top 16 (top-16 finish). ----
    computed_po = {}  # (label, year) -> set(team slug)
    for tr in tournaments:
        if tr["slug"] not in manual_slugs or tr.get("tier") not in ("s", "major") or not tr.get("champion"):
            continue
        yr = tr.get("year"); nm = tr["name"]; fs = tr.get("finalStandings") or []
        if not yr or not fs:
            continue
        if "Audax Esse" in nm:
            label = "Audax Esse Playoffs"
            makers = {s["teamSlug"] for s in fs if s.get("teamSlug") and s.get("result") != "Group Stage"}
        elif "Conquerors" in nm:
            label = "Major Playoffs"
            makers = {s["teamSlug"] for s in fs if s.get("teamSlug")}
        elif "Pro Cup" in nm:
            label = "Pro Cup Top 16"
            makers = {s["teamSlug"] for s in fs if s.get("teamSlug") and s.get("rank", 99) <= 16}
        else:
            continue
        computed_po[(label, yr)] = (makers, tr.get("championTeam"))
    for (label, yr), (makers, champ_slug) in computed_po.items():
        for t in teams:                       # manual event is authoritative — clear any stale sheet entry
            t.get("playoffs", {}).get(label, {}).pop(yr, None)
        for slug in makers:
            tm = slug_to_team.get(slug)
            if tm:
                tm.setdefault("playoffs", {}).setdefault(label, {})[yr] = "Won" if slug == champ_slug else "Yes"

    # ---- website-computed BPL Rank Points (overrides the sheet value; re-ranks) ----
    compute_team_points(teams, tournaments)

    # ---- historical attending rosters (from scraped Challonge descriptions) ----
    old2new = {}
    ncp = os.path.join(DATA, "name_changes.json")
    if os.path.exists(ncp):
        old2new = {norm_key(k): v for k, v in json.load(open(ncp, encoding="utf-8")).items()}
    # Rosters / team history / former players resolve to a player's real profile — the amateur
    # (or pro) entry — NOT the pro "shadow" (which only exists to hold S-Tier scoreboard stats
    # under team "—"). Skip shadows here so an amateur keeps their amateur profile + team.
    pmap = {}
    for pool in (pro, amateur, solo):
        for p in pool:
            if p.get("shadowAmateur"):
                continue
            pmap.setdefault(norm_key(p["name"]), p)
    hist_path = os.path.join(DATA, "hist_rosters.json")
    hist_rosters = json.load(open(hist_path, encoding="utf-8")) if os.path.exists(hist_path) else {}
    team_by_key2 = {t["key"]: t for t in teams}
    mdir_a = os.path.join(DATA, "manual")
    manual_slugs_a = {os.path.splitext(f)[0] for f in os.listdir(mdir_a)} if os.path.isdir(mdir_a) else set()
    slug_to_team_a = {t["slug"]: t for t in teams}
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
        # site-run (manual) events: fill in any participating team not already covered by a
        # recorded line-up, using that team's current roster (additive, so partial hist_rosters
        # — e.g. only the ad-hoc amateur teams — still leave the pro teams' rosters showing).
        if tr["slug"] in manual_slugs_a:
            # participating team slugs: from stage team lists (works before any game is played)
            # plus standings, so every roster shows even in a brand-new event.
            part = []
            if tr.get("stages"):
                for st in tr["stages"]:
                    part += [t[1] for t in st.get("teams", []) if isinstance(t, (list, tuple)) and t[1]]
                    part += [s.get("teamSlug") for s in st.get("standings", [])]
            else:
                part += [s.get("teamSlug") for s in tr["standings"]]
            seen_t = {a.get("teamSlug") for a in att if a.get("teamSlug")}
            for ts in part:
                if not ts or ts in seen_t:
                    continue
                seen_t.add(ts)
                tm = slug_to_team_a.get(ts)
                if not tm:
                    continue
                att.append({
                    "team": tm["name"], "teamSlug": tm["slug"],
                    "players": [{"hist": rp["name"], "name": rp["name"], "slug": rp["slug"],
                                 "iso": rp.get("iso", ""), "captain": False} for rp in tm.get("roster", [])],
                })
        tr["attending"] = att

    # ---- in-progress ad-hoc tournament teams override a player's displayed team ----
    # While a site-run event is live, show each ad-hoc-team player their tournament team instead
    # of "—" (e.g. amateur free agents on a Bot Pro Cup roster). Ad-hoc = a team with no page
    # (teamSlug is None). Pro players keep their real team. Reverts to "—" once the event finishes
    # (a champion exists), where the promote-to-pro / disband rules then apply.
    for tr in tournaments:
        if tr["slug"] not in manual_slugs_a or tr.get("champion"):
            continue
        for row in tr.get("attending", []):
            if row.get("teamSlug"):
                continue                         # real team page -> keep its own roster/team
            for pl in row["players"]:
                p = slug_to_player.get(pl.get("slug"))
                if p and p.get("pool") != "pro":
                    p["team"] = row["team"]
                    p["teamTourney"] = tr["name"]

    # ---- map profiles for ad-hoc amateur teams (for the veto simulator) — in-progress events ----
    # Same lifecycle as the team override above: available while the event is live, gone once it
    # finishes (unless a team is promoted to pro and gains its own page). Seeded per-map win rates
    # around a base set by the roster's average Rating Points; no real per-map data yet.
    adhoc_map_teams = []
    for tr in tournaments:
        if tr["slug"] not in manual_slugs_a or tr.get("champion"):
            continue
        for row in tr.get("attending", []):
            if row.get("teamSlug"):
                continue
            rs = [slug_to_player[pl["slug"]]["rating"] for pl in row["players"]
                  if pl.get("slug") and slug_to_player.get(pl["slug"]) and slug_to_player[pl["slug"]].get("rating") is not None]
            avg = sum(rs) / len(rs) if rs else 1.0
            base = max(0.38, min(0.60, 0.5 + (avg - 1.0) * 0.9))
            stats = {}
            for cm in POOL_MAPS:
                off = (_seed(row["team"] + "|" + cm) % 4200) / 10000.0 - 0.21
                stats[cm] = {"w": 0, "l": 0, "g": 0, "wr": round(max(0.20, min(0.82, base + off)), 3), "real": False}
            order = sorted(POOL_MAPS, key=lambda cm: (-stats[cm]["wr"], cm))
            adhoc_map_teams.append({"name": row["team"], "slug": "adhoc-" + norm_key(row["team"]),
                                    "mapStats": stats, "bestMaps": order[:2],
                                    "worstMaps": [order[-1], order[-2]], "adhoc": True, "event": tr["name"]})

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
    # ensure each pro player's CURRENT team (from the roster/sheet) is in their career history,
    # even if no historical line-up captured it (e.g. a 2026 move into a manual event)
    cur_year = max((t["year"] for t in tournaments if t.get("year")), default="")
    cur_date = max((t["date"] for t in tournaments if t.get("date")), default="")
    for p in pro:
        tn = p.get("team")
        tm = team_by_key.get(norm_key(tn)) if tn else None
        if not tm:
            continue                                  # teamless / not a known pro team
        existing = next((v for v in player_teams[p["slug"]].values()
                         if v["teamSlug"] == tm["slug"]), None)
        if existing:
            if cur_year:
                existing["years"].add(cur_year)       # already known — ensure current year present
        else:
            player_teams[p["slug"]][tm["name"]] = {
                "teamSlug": tm["slug"], "isPro": True, "first": cur_date,
                "years": {cur_year} if cur_year else set(),
                "roster": [{"name": rp["name"], "slug": rp["slug"], "iso": rp.get("iso", ""),
                            "captain": False} for rp in tm.get("roster", [])]}
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

    # ---- manually-added former players (predate recorded event rosters, e.g. banned) ----
    fpx_path = os.path.join(DATA, "former_players_extra.json")
    fpx = json.load(open(fpx_path, encoding="utf-8")) if os.path.exists(fpx_path) else {}
    for t in teams:
        extra = fpx.get(t["slug"])
        if not extra:
            continue
        have = {f["name"].lower() for f in t["formerPlayers"]}
        for e in extra:
            if not isinstance(e, dict) or not e.get("name") or e["name"].lower() in have:
                continue
            t["formerPlayers"].append({
                "slug": e.get("slug"), "name": e["name"], "iso": e.get("iso", ""),
                "years": [str(y) for y in e.get("years", [])],
                "nowTeam": "", "nowTeamSlug": None,
                "status": e.get("status"), "replacedBy": e.get("replacedBy"),
            })
        t["formerPlayers"].sort(key=lambda x: (x["years"][-1] if x["years"] else "", x["name"].lower()), reverse=True)

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
                if m.get("a") == "(bye)" or m.get("b") == "(bye)":
                    continue                 # a bye isn't a played match — no win, no form entry
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
        "adhocMapTeams": adhoc_map_teams,
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

    # cache-bust js/css so browsers fetch new builds instead of a stale cached copy.
    # The version is a hash of the JS+CSS, so it only changes when those files change.
    try:
        idx_path = os.path.join(SITE, "index.html")
        html = open(idx_path, encoding="utf-8").read()
        h = hashlib.md5()
        for f in ("js/app.js", "css/style.css"):
            p = os.path.join(SITE, f)
            if os.path.exists(p):
                h.update(open(p, "rb").read())
        ver = h.hexdigest()[:8]
        html = re.sub(r'(src="js/app\.js)(\?v=[^"]*)?"', rf'\1?v={ver}"', html)
        html = re.sub(r'(href="css/style\.css)(\?v=[^"]*)?"', rf'\1?v={ver}"', html)
        open(idx_path, "w", encoding="utf-8").write(html)
    except Exception as e:
        print("cache-bust skipped:", e)

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
