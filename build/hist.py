#!/usr/bin/env python3
"""Parse scraped Challonge descriptions (data/descriptions.json) into historical
rosters, and compute name-change candidates: historical player names that are NOT
in the current master player list (data/allplayer.txt). Those are rename suspects.

Outputs:
  data/hist_rosters.json      {slug: [{team, players:[{name,captain,curSlug}]}]}
  data/name_candidates.json   [{oldName, contexts:[{slug,team,captain}], teamGuess, targetHints}]
Run: python build/hist.py
"""
import json, os, re, unicodedata
from collections import defaultdict, OrderedDict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")

def nk(s):
    s = unicodedata.normalize("NFKD", s or "")
    return re.sub(r"[^a-z0-9]", "", s.lower())

def slugify(s):
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", (s or "").lower())).strip("-")

# ---- current player universe ----
def load_current():
    names = {}
    path = os.path.join(DATA, "allplayer.txt")
    for line in open(path, encoding="utf-8"):
        parts = line.rstrip("\n").split("\t")
        nm = parts[0].strip()
        if not nm or nm.lower() == "player":
            continue
        nat = parts[1].strip() if len(parts) > 1 else ""
        names[nk(nm)] = {"name": nm, "nat": nat}
    return names

# ---- current team rosters + player slugs from data.json ----
def load_site():
    d = json.load(open(os.path.join(ROOT, "site", "data.json"), encoding="utf-8"))
    player_slug = {}
    for pool in ("pro", "amateur", "solo"):
        for p in d["players"][pool]:
            player_slug.setdefault(nk(p["name"]), p["slug"])
    team_by_key = {nk(t["name"]): t for t in d["teams"]}
    team_roster = {t["slug"]: {nk(pl["name"]) for pl in t.get("roster", [])} for t in d["teams"]}
    return player_slug, team_by_key, team_roster

PAREN_RE = re.compile(r"\([^)]*\)")            # any (role) tag
CAP_RE = re.compile(r"captain|leader", re.I)   # which tags mean captain

def split_players(s):
    """From a players line, return list of (name, is_captain) with any shared tag prefix stripped."""
    s = s.replace(". ", ", ")  # a few descriptions use ". " instead of ", " between players
    toks = [t.strip() for t in s.split(",") if t.strip()]
    cleaned = []
    for t in toks:
        cap = bool(CAP_RE.search(" ".join(PAREN_RE.findall(t))))
        t = PAREN_RE.sub("", t).strip().rstrip(".").strip()
        cleaned.append((t, cap))
    if not cleaned:
        return []
    # detect a shared leading team tag by MAJORITY first-token (tolerates one member
    # listed without the tag, e.g. the VSPO! roster). Strip the tag only from members
    # that actually carry it and still have a name left after it.
    from collections import Counter
    firsts = [c[0].split()[0].lower() if c[0].split() else "" for c in cleaned]
    cnt = Counter(f for f in firsts if f)
    if cnt:
        tag, tc = cnt.most_common(1)[0]
        if tc >= 2 and tc >= 0.6 * len(cleaned):
            cleaned = [((" ".join(c[0].split()[1:]), c[1])
                        if len(c[0].split()) >= 2 and c[0].split()[0].lower() == tag else c)
                       for c in cleaned]
    return [(n.strip(), cap) for n, cap in cleaned if n.strip()]

def looks_like_players(line):
    return CAP_RE.search(line) or (line.count(",") >= 3)

def parse_desc(text):
    """Return list of (team_name, [(player,captain)])."""
    lines = [l.strip() for l in text.split("\n") if l.strip()]
    teams = []
    i = 0
    SKIP = re.compile(r"^(mappool|map ?list|map ?pool|max rounds|overtime|seed |pro teams|list of teams|unlisted|show full|runners? up|http|\*|if you)", re.I)
    while i < len(lines):
        line = lines[i]
        # Format A: "Team: players"
        if ":" in line:
            head, rest = line.split(":", 1)
            if looks_like_players(rest) and 1 <= len(head) <= 40 and not SKIP.match(line):
                pl = split_players(rest)
                if pl:
                    teams.append((head.strip(), pl)); i += 1; continue
        # Format B/C: short team-header line, bare players on next line.
        # Guard against prose intro lines and against the next line being a "Team: players" (Format A) row.
        team_head = re.split(r"[\(\[]", line)[0].strip()
        if (not SKIP.match(line) and ":" not in line and not looks_like_players(line)
                and len(line) <= 45 and not line.endswith(".") and len(team_head) <= 30
                and i + 1 < len(lines)):
            nxt = lines[i + 1]
            if (looks_like_players(nxt) and not SKIP.match(nxt)
                    and not re.match(r"^[^,]{1,40}:", nxt)):  # nxt is bare players, not "Team: ..."
                pl = split_players(nxt)
                if team_head and pl:
                    teams.append((team_head, pl)); i += 2; continue
        i += 1
    # drop stray "player" tokens that are actually the team name/tag (e.g. a lone "VSPO!")
    teams = [(tm, [(n, c) for n, c in pls if nk(n) and nk(n) != nk(tm)]) for tm, pls in teams]
    return teams

def main():
    descs = json.load(open(os.path.join(DATA, "descriptions.json"), encoding="utf-8"))
    current = load_current()
    player_slug, team_by_key, team_roster = load_site()
    rename_map = {}
    rm_path = os.path.join(DATA, "name_changes.json")
    if os.path.exists(rm_path):
        rename_map = {nk(k): v for k, v in json.load(open(rm_path, encoding="utf-8")).items()}

    hist = OrderedDict()
    cand = defaultdict(lambda: {"contexts": [], "teams": set()})
    for slug, text in descs.items():
        parsed = parse_desc(text)
        hist[slug] = []
        for team, players in parsed:
            tkey = nk(team)
            tobj = team_by_key.get(tkey)
            tslug = tobj["slug"] if tobj else None
            plist = []
            for nm, cap in players:
                k = nk(nm)
                cur = k in current or k in player_slug
                # resolve to a current player slug (direct, or via rename map)
                cslug = player_slug.get(k)
                if not cslug and k in rename_map:
                    cslug = player_slug.get(nk(rename_map[k]))
                plist.append({"name": nm, "captain": cap, "curSlug": cslug})
                if not cur and k not in rename_map:
                    cand[k]["contexts"].append({"slug": slug, "team": team, "captain": cap, "name": nm})
                    if tslug:
                        cand[k]["teams"].add(tslug)
            hist[slug].append({"team": team, "teamSlug": tslug, "players": plist})

    # build candidate list with rename target hints (current roster members absent from history)
    candidates = []
    for k, info in cand.items():
        disp = info["contexts"][0]["name"]
        hints = []
        for tslug in info["teams"]:
            cur_names = team_roster.get(tslug, set())
            # current roster members whose name never appears (as itself) in that team's history
            hist_names = set()
            for slug in hist:
                for row in hist[slug]:
                    if row["teamSlug"] == tslug:
                        hist_names |= {nk(p["name"]) for p in row["players"]}
            for cn in cur_names - hist_names:
                # find display + slug
                for row_slug, rows in hist.items():
                    pass
                hints.append(cn)
        candidates.append({
            "oldName": disp,
            "count": len(info["contexts"]),
            "teams": sorted(info["teams"]),
            "contexts": info["contexts"][:6],
            "targetHints": sorted(set(hints)),
        })
    # sort: on a current team first, then by frequency
    candidates.sort(key=lambda c: (-(1 if c["teams"] else 0), -c["count"], c["oldName"].lower()))

    json.dump(hist, open(os.path.join(DATA, "hist_rosters.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    json.dump(candidates, open(os.path.join(DATA, "name_candidates.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    total_hist_players = sum(len(r["players"]) for s in hist.values() for r in s)
    print(f"Parsed rosters: {sum(len(v) for v in hist.values())} team-entries, {total_hist_players} player-slots")
    print(f"Name-change candidates (not in master list): {len(candidates)}")
    on_team = [c for c in candidates if c["teams"]]
    print(f"  ...of which on a current pro team: {len(on_team)}\n")
    print("=== HIGH-SIGNAL candidates (played for a current pro team) ===")
    for c in on_team:
        tnames = ", ".join(c["teams"])
        ctx = c["contexts"][0]
        print(f"  {c['oldName']:22} team={tnames:16} {'(C)' if ctx['captain'] else '   '} in {c['count']} event(s); current-roster gaps: {c['targetHints']}")

if __name__ == "__main__":
    main()
