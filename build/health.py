#!/usr/bin/env python3
"""Site health check: run at the end of every build (parse.py) over the finished data.

Each check guards against a bug class that has actually bitten the site (a free agent missing from
an ad-hoc roster and the veto bot_add lines, Events Played drifting, bio ranks disagreeing with the
Players page, a Swiss round that never drafted...). Results go to the build log and into
data["health"] for the admin page's Site Health panel.

Levels:  error   = something on the site is visibly wrong right now
         warning = probably wrong / worth a look
         info    = FYI
"""
import json, os, re, sys, unicodedata
from datetime import datetime

def norm(s):
    s = unicodedata.normalize("NFKD", s or "")
    return re.sub(r"[^a-z0-9]", "", s.lower())

LINK_RE = re.compile(r"\]\(#/(player|team|tournament|article)/([^)\s]+)\)")


class Health:
    def __init__(self):
        self.issues = []

    def add(self, level, check, msg, link=None):
        self.issues.append({"level": level, "check": check, "msg": msg, "link": link})


def typo_checks(h, tr, m, ref, mi, mp):
    """Likely typos in a saved map scoreboard (the same rules the admin Quick entry checks as you type).
    They held on 500+ recorded maps: a team's kills never exceed the other team's deaths (deaths can be a
    little higher: bomb, fall and self damage), and a team's MVP stars equal the rounds it won."""
    sa, sb = mp.get("scoreA"), mp.get("scoreB")
    A = [p for p in mp.get("players", []) if norm(p.get("team")) == norm(m.get("a"))]
    B = [p for p in mp.get("players", []) if norm(p.get("team")) == norm(m.get("b"))]
    if sa is None or sb is None or len(A) != 5 or len(B) != 5:
        return
    sm = lambda rs, c: sum(p.get(c) or 0 for p in rs)
    where = f"{tr['name']}: {m.get('a')} vs {m.get('b')}, map {mi + 1}{' (' + mp['map'] + ')' if mp.get('map') else ''} {sa}-{sb}"
    link = f"#/match/{tr['slug']}/{ref}"
    mA, mB = sm(A, "mvp"), sm(B, "mvp")
    if mA == sb and mB == sa and mA != mB:
        win = m.get("a") if mA > mB else m.get("b")
        h.add("warning", "Scoreboards", f"{where}: the MVP stars say {win} won {max(mA, mB)}-{min(mA, mB)}. "
              "The map score may be the wrong way round, which would change the result.", link)
        return
    notes = []
    for x, k, y, d in ((m.get("a"), sm(A, "k"), m.get("b"), sm(B, "d")), (m.get("b"), sm(B, "k"), m.get("a"), sm(A, "d"))):
        if k > d:
            notes.append(f"{x}'s kills ({k}) are more than {y}'s deaths ({d})")
        elif d - k >= 4:
            notes.append(f"{y} have {d - k} deaths that weren't kills by {x}")
    if mA != sa or mB != sb:
        notes.append(f"MVP stars ({mA}-{mB}) don't match the rounds won")
    if notes:
        h.add("info", "Scoreboards", f"Possible typo · {where}: " + "; ".join(notes) + ".", link)


def run(data, data_dir):
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import manual

    h = Health()
    players = data["players"]["pro"] + data["players"]["amateur"] + data["players"]["solo"]
    by_slug = {p["slug"]: p for p in players}
    teams = data["teams"]
    team_slugs = {t["slug"] for t in teams}
    tours = data["tournaments"]
    tour_slugs = {t["slug"] for t in tours}
    manual_slugs = {f[:-5] for f in os.listdir(os.path.join(data_dir, "manual")) if f.endswith(".json")}
    live = [t for t in tours if t["slug"] in manual_slugs and not t.get("champion")]

    # ---- 1. live-event rosters: every player has a profile, 5 per team, and the profile shows
    #         the team (ad-hoc teams resolve their line-up — and the veto bot_add lines — that way)
    for tr in live:
        nations = "nations-cup" in tr["slug"]
        seen = {}
        for row in tr.get("attending", []):
            team, pls = row.get("team"), row.get("players", [])
            link = f"#/tournament/{tr['slug']}"
            if len(pls) != 5 and not nations:
                h.add("warning", "Live rosters", f"{team} has {len(pls)} players at {tr['name']} (expected 5).", link)
            for pl in pls:
                if not pl.get("slug"):
                    h.add("error", "Live rosters", f"{pl.get('name')} ({team}, {tr['name']}) has no player profile.", link)
                    continue
                if pl["slug"] in seen and seen[pl["slug"]] != team:
                    h.add("error", "Live rosters", f"{pl['name']} is on two teams at {tr['name']}: {seen[pl['slug']]} and {team}.", link)
                seen[pl["slug"]] = team
                p = by_slug.get(pl["slug"])
                if not p or nations:
                    continue
                if not row.get("teamSlug") and norm(p.get("team")) != norm(team):
                    shown = p.get("team") or "free agent"
                    h.add("error", "Live rosters", f"{p['name']} plays for {team} at {tr['name']} but their profile shows "
                          f"{shown}, so they're missing from {team}'s line-up and veto bot_add lines.", f"#/player/{p['slug']}")
        # 2. two different team names that collapse to the same key would merge on the site
        keys = {}
        for row in tr.get("attending", []):
            k = norm(row.get("team"))
            if k in keys and keys[k] != row.get("team"):
                h.add("error", "Live rosters", f"Team names '{keys[k]}' and '{row.get('team')}' at {tr['name']} look identical to the site.", f"#/tournament/{tr['slug']}")
            keys[k] = row.get("team")

    # ---- 3. Swiss / playoff progression (manual events)
    for slug in sorted(manual_slugs):
        man = manual.load(slug)
        if not man:
            continue
        tname = man.get("name", slug)
        for st in man.get("stages", []):
            if st.get("format") == "swiss" and st["matches"]:
                total = st.get("rounds", manual.SWISS_DEFAULT_ROUNDS)
                cur = max(m["round"] for m in st["matches"])
                cm = [m for m in st["matches"] if m["round"] == cur]
                if cur < total and all(m.get("sa") is not None and m.get("sb") is not None for m in cm):
                    h.add("error", "Event progress", f"{tname} · {st['name']}: round {cur} is complete but round {cur + 1} was never drafted.",
                          f"#/tournament/{slug}")
            if st.get("autoSeed") and not any(t for t in st.get("teams", [])):
                groups = [g for g in man["stages"] if g.get("format") == "swiss"]
                if groups and all(manual._group_complete(g) for g in groups):
                    h.add("error", "Event progress", f"{tname}: every group is complete but the {st['name']} bracket is still unseeded "
                          "(re-save any score to trigger seeding).", f"#/tournament/{slug}")

    # ---- 4. scoreboards vs the recorded result
    for tr in tours:
        for st in tr.get("stages") or []:
            for rd in st["rounds"]:
                for m in rd["matches"]:
                    maps = (m.get("stats") or {}).get("maps") or []
                    derived = manual._derive_match_score(maps) if maps else None
                    if derived and m.get("sa") is not None and (m["sa"], m["sb"]) != tuple(derived):
                        h.add("warning", "Scoreboards", f"{tr['name']}: {m.get('a')} vs {m.get('b')} is recorded as {m['sa']}-{m['sb']} "
                              f"but its map scoreboards add up to {derived[0]}-{derived[1]}.", f"#/tournament/{tr['slug']}")
                    for mi, mp in enumerate(maps):
                        typo_checks(h, tr, m, f"{st['id']}-{m['i']}", mi, mp)
                        for pl in mp.get("players", []):
                            if not pl.get("slug") and tr.get("date", "") >= "2026":
                                h.add("warning", "Scoreboards", f"{tr['name']}: scoreboard player '{pl.get('name')}' ({mp.get('map')}) "
                                      "doesn't match any profile, so their stats aren't counted.", f"#/tournament/{tr['slug']}")

    # ---- 5. articles: every link resolves; house style (no em dashes, "team" not "side")
    art_slugs = {a.get("slug") for a in data.get("articles", [])}
    targets = {"player": set(by_slug), "team": team_slugs, "tournament": tour_slugs, "article": art_slugs}
    for a in data.get("articles", []):
        body, link = a.get("body", ""), f"#/article/{a.get('slug')}"
        for kind, slug in LINK_RE.findall(body):
            if slug not in targets[kind]:
                h.add("error", "Articles", f"'{a.get('title')}' links to a {kind} that doesn't exist: {slug}", link)
        for nm in a.get("unresolved", []):
            h.add("error", "Articles", f"'{a.get('title')}' has a [[{nm}]] link that doesn't match any player, team or event.", link)
        for nm in a.get("ambiguous", []):
            h.add("warning", "Articles", f"'{a.get('title')}': [[{nm}]] matches more than one page (linked the team). "
                  f"Write [[player:{nm}]] or [[event:{nm}]] to pick another.", link)
        if "—" in body or "–" in body:
            h.add("warning", "Articles", f"'{a.get('title')}' contains an em/en dash (house style: none).", link)
        if re.search(r"\bsides?\b", body, re.I):
            h.add("warning", "Articles", f"'{a.get('title')}' uses 'side/sides' (house style: 'team').", link)

    # ---- 6. teams & Hall of Fame
    for t in teams:
        if not t.get("provisional") and not t.get("logo"):
            h.add("warning", "Teams", f"{t['name']} has no logo.", f"#/team/{t['slug']}")
        if int(t.get("events_played") or 0) < len(t.get("events") or []):
            h.add("error", "Teams", f"{t['name']} shows {t.get('events_played')} events played but has {len(t['events'])} recorded.", f"#/team/{t['slug']}")
    hof = data.get("hallOfFame") or {}
    for e in hof.get("players", []):
        if e.get("slug") not in by_slug:
            h.add("error", "Hall of Fame", f"Hall of Fame player '{e.get('slug')}' has no profile.")
    for e in hof.get("teams", []):
        if e.get("slug") not in team_slugs:
            h.add("error", "Hall of Fame", f"Hall of Fame team '{e.get('slug')}' has no team page.")

    # ---- 7. players: duplicates, bio rank vs the Players page, profile gaps for active players
    seen_k = {}
    for p in data["players"]["pro"]:
        k = norm(p["name"])
        if k in seen_k:
            h.add("error", "Players", f"Two profiles look identical to the site: '{seen_k[k]}' and '{p['name']}'.", f"#/player/{p['slug']}")
        seen_k[k] = p["name"]
    ladder = sorted(data["players"]["pro"], key=lambda p: -(p["ratingPoints"] if p.get("ratingPoints") is not None else -1))
    page_rank = {p["slug"]: i + 1 for i, p in enumerate(ladder)}
    for p in data["players"]["pro"]:
        mm = re.search(r"#(\d+)(?: of \d+)? (?:in the league|at )|#(\d+) of \d+", p.get("bio") or "")
        if mm and p.get("maps"):
            n = int(mm.group(1) or mm.group(2))
            if n != page_rank.get(p["slug"]):
                h.add("error", "Players", f"{p['name']}'s bio says #{n} but the Players page shows #{page_rank.get(p['slug'])}.", f"#/player/{p['slug']}")
    active = {pl.get("slug") for tr in live for row in tr.get("attending", []) for pl in row.get("players", [])}
    recent = {p["slug"] for p in players if any(str(y) >= "2026" for h_ in (p.get("teamHistory") or []) for y in h_.get("years", []))}
    gp = os.path.join(data_dir, "player_gender.json")
    genders = json.load(open(gp, encoding="utf-8")) if os.path.exists(gp) else {}
    for p in players:
        if p["slug"] not in active and p["slug"] not in recent:
            continue
        if not p.get("iso"):
            h.add("warning", "Players", f"{p['name']} has no country, so no flag or nationality in their bio.", f"#/player/{p['slug']}")
        if p.get("gender") not in ("M", "F") and genders.get(norm(p["name"])) != "NB":   # NB = chosen they/them
            h.add("info", "Players", f"{p['name']} has no gender on file, so their bio uses they/them.", f"#/player/{p['slug']}")
            h.issues[-1]["fix"] = {"kind": "gender", "player": p["name"], "slug": p["slug"]}

    # ---- 8. name changes point at real players
    ncp = os.path.join(data_dir, "name_changes.json")
    if os.path.exists(ncp):
        names = {norm(p["name"]) for p in players}
        for old, new in json.load(open(ncp, encoding="utf-8")).items():
            if norm(new) not in names:
                h.add("warning", "Players", f"Name change '{old}' -> '{new}': no player called '{new}' exists.")

    order = {"error": 0, "warning": 1, "info": 2}
    h.issues.sort(key=lambda i: (order[i["level"]], i["check"]))
    counts = {lv: sum(1 for i in h.issues if i["level"] == lv) for lv in order}
    print(f"health: {counts['error']} error(s), {counts['warning']} warning(s), {counts['info']} info")
    for i in [i for i in h.issues if i["level"] != "info"][:25]:
        print(f"  [{i['level'].upper()}] {i['check']}: {i['msg']}")
    return {"generated": datetime.now().isoformat(timespec="seconds"), "counts": counts, "issues": h.issues}
