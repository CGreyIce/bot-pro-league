#!/usr/bin/env python3
"""Event wrap-up (admin "Wrap up this event"): apply an event's end-of-event rules in one go, then draft the recap.

Rules, picked per event in the admin (suggested from the event name) and remembered on the event once applied:
  champion_pro  {tag, logo}              the champion becomes a pro team with its event line-up (Challengers rule)
  top_pro       {n, teams:{name:{tag}}}  finishers in the top N without a full pro page become pro teams (Bot Pro Cup rule)
  disband_rest  {n}                      teams outside the top N without a full pro page disband; players become free agents
  seeds         {target, count}          saves the final placements as seeds for the next event (data/next_seeds.json);
                                         the admin's Add Stage form offers them when you build that event
  recap         true                     a recap draft (final, run, MVP, prize money, upset) replaces the short
                                         automatic champion draft in Drafts
Preview runs everything on one in-memory roster, so nothing is saved until Apply.
"""
import hashlib, json, os, re, sys, time
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import roster as roster_mod
import manual

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
SEEDS = os.path.join(DATA, "next_seeds.json")
WRAPS = os.path.join(DATA, "wrapups.json")


def _norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def _load(p, default):
    try:
        return json.load(open(p, encoding="utf-8"))
    except Exception:
        return default


def _event(slug):
    d = json.load(open(os.path.join(ROOT, "site", "data.json"), encoding="utf-8"))
    tr = next((t for t in d["tournaments"] if t["slug"] == slug), None)
    if not tr:
        raise roster_mod.RosterError(f"No event '{slug}'.")
    return d, tr


def standings(tr):
    stl = sorted((s for s in (tr.get("finalStandings") or tr.get("standings") or []) if s.get("rank")), key=lambda s: s["rank"])
    rows = {}
    for r in tr.get("attending", []):
        rows[_norm(r["team"])] = r
        if r.get("teamSlug"):
            rows[r["teamSlug"]] = r
    out = []
    for s in stl:
        name = s.get("name") or s.get("team")
        row = rows.get(s.get("teamSlug")) or rows.get(_norm(name)) or {}
        out.append({"rank": s["rank"], "name": name, "teamSlug": s.get("teamSlug"),
                    "players": [p["name"] for p in row.get("players", []) if p.get("name")]})
    return out


def suggest(slug):
    """Suggested rules + the facts the admin form needs (standings, who already has a pro page)."""
    d, tr = _event(slug)
    teams = {t["slug"]: t for t in d["teams"]}
    st = standings(tr)
    for s in st:
        t = teams.get(s["teamSlug"])
        s["status"] = "pro" if t and not t.get("provisional") else "provisional" if t else "amateur"
    name, year = tr["name"].lower(), (tr.get("date") or "")[:4]
    rules = {"recap": True}
    if "challengers" in name:
        rules["champion_pro"] = {"tag": "", "logo": None}
        rules["seeds"] = {"target": f"BPL Legends Stage {year}", "count": min(10, len(st))}
    elif "pro cup" in name:
        rules["top_pro"] = {"n": 8, "teams": {}}
        rules["disband_rest"] = {"n": 8}
    wrapped = _load(WRAPS, {}).get(slug)
    return {"event": tr["name"], "champion": tr.get("champion"), "standings": st, "rules": rules, "wrapped": wrapped}


def _final(tr):
    second = next((s["name"] for s in standings(tr) if s["rank"] == 2), None)
    champ, ru = _norm(tr.get("champion")), _norm(tr.get("runnerUp") or second)
    ms = ([m for st in tr["stages"] for rd in st["rounds"] for m in rd["matches"]] if tr.get("stages")
          else [m for rd in tr.get("bracket", []) for m in rd["matches"]])
    path, final = [], None
    for m in ms:
        if m.get("w") not in (1, 2) or "(bye)" in (m.get("a"), m.get("b")):
            continue
        w, l = (m["a"], m["b"]) if m["w"] == 1 else (m["b"], m["a"])
        sw, sl = (m.get("sa"), m.get("sb")) if m["w"] == 1 else (m.get("sb"), m.get("sa"))
        if _norm(w) == champ:
            path.append((l, sw, sl))
            if ru and _norm(l) == ru:
                final = path[-1]
    return path, final


def recap(tr):
    L = lambda n: f"[[{n}]]" if n and "[" not in n else (n or "")
    champ, ev = tr["champion"], tr["name"]
    path, final = _final(tr)
    body = []
    if final:
        body.append(f"**{L(champ)} are the champions of the {L(ev)}.** They beat {L(final[0])} {final[1]}-{final[2]} in the final.")
    else:
        body.append(f"**{L(champ)} are the champions of the {L(ev)}.**")
    earlier = [p for p in path if p is not final][:5]
    if earlier:
        body.append("**The run.** On the way they beat " + ", ".join(f"{L(n)} {a}-{b}" for n, a, b in earlier) + ".")
    mv = tr.get("mvp")
    if mv:
        how = (f"a {mv['rating']:.2f} rating over {mv.get('maps')} maps" if mv.get("rating") is not None
               else f"{mv.get('mvpRounds')} MVP rounds")
        body.append(f"**The MVP.** {L(mv['name'])} was the standout player of the event, with {how}.")
    pz = tr.get("prizes") or []
    if pz:
        top = pz[0]
        line = f"**The prize money.** The title was worth ${top['amount']:,}" + (f", ${top['perPlayer']:,} for each player" if top.get("perPlayer") else "") + "."
        if len(pz) > 1:
            line += f" {L(pz[1]['name'])} took ${pz[1]['amount']:,} for second place."
        body.append(line)
    best = None
    ms = ([m for st in tr["stages"] for rd in st["rounds"] for m in rd["matches"]] if tr.get("stages")
          else [m for rd in tr.get("bracket", []) for m in rd["matches"]])
    for m in ms:
        if m.get("w") not in (1, 2):
            continue
        pa = m.get("odds") if m.get("odds") is not None else m.get("tE")
        if pa is None:
            continue
        ch = pa if m["w"] == 1 else 1 - pa
        if best is None or ch < best[0]:
            best = (ch, m)
    if best and best[0] < 0.4:
        m = best[1]
        w, l = (m["a"], m["b"]) if m["w"] == 1 else (m["b"], m["a"])
        body.append(f"**The upset.** {L(w)} beat {L(l)} with only a {round(best[0] * 100)}% chance before the match.")
    st = standings(tr)
    if len(st) >= 4:
        body.append("**The top four.** " + ", ".join(f"{s['rank']}. {L(s['name'])}" for s in st[:4]) + ".")
    return f"{champ} win the {ev}", "\n\n".join(body)


def run(slug, rules, dry_run=True):
    d, tr = _event(slug)
    if not tr.get("champion"):
        raise roster_mod.RosterError("This event isn't finished yet: it needs a champion before it can be wrapped up.")
    r = roster_mod.Roster()
    pages = {t["slug"]: t for t in d["teams"]}
    st = standings(tr)
    notes = []
    full_pro = lambda s: bool(s.get("teamSlug") in pages and not pages[s["teamSlug"]].get("provisional"))
    rules = rules or {}

    if rules.get("champion_pro"):
        c = next((s for s in st if s["rank"] == 1), None)
        if c and full_pro(c):
            notes.append(f"{c['name']} are already a pro team, so there's nothing to promote.")
        elif c:
            cp = rules["champion_pro"]
            if not (cp.get("tag") or "").strip():
                raise roster_mod.RosterError(f"Give {c['name']} an in-game tag to promote them.")
            r.promote_team(c["name"], cp["tag"].strip(), c["players"], cp.get("logo"), False, tr["name"], "")
    n_pro = int((rules.get("top_pro") or {}).get("n") or 0)
    if n_pro:
        tags = (rules["top_pro"].get("teams") or {})
        missing = [s["name"] for s in st if s["rank"] <= n_pro and not full_pro(s) and not (tags.get(s["name"], {}).get("tag") or "").strip()]
        if missing:
            raise roster_mod.RosterError("These teams need an in-game tag to turn pro: " + ", ".join(missing) + ".")
        for s in st:
            if s["rank"] <= n_pro and not full_pro(s) and not (rules.get("champion_pro") and s["rank"] == 1):
                t = tags[s["name"]]
                r.promote_team(s["name"], t["tag"].strip(), s["players"], t.get("logo"), False, tr["name"], "")
    n_keep = int((rules.get("disband_rest") or {}).get("n") or 0)
    if n_keep:
        for s in st:
            if s["rank"] > n_keep and not full_pro(s):
                try:
                    r.disband(s["name"])
                except roster_mod.RosterError as e:
                    notes.append(f"{s['name']}: nothing to disband ({e}).")
    seeds = rules.get("seeds")
    if seeds and (seeds.get("target") or "").strip():
        count = int(seeds.get("count") or len(st))
        teams = [s["name"] for s in st[:count]]
        notes.append(f"Seeds for {seeds['target'].strip()}: " + ", ".join(f"{i + 1}. {t}" for i, t in enumerate(teams))
                     + ". The Add Stage form offers them when you build that event.")
    draft = None
    if rules.get("recap"):
        title, body = recap(tr)
        draft = {"id": hashlib.md5(f"champion:{slug}".encode()).hexdigest()[:10], "key": f"champion:{slug}", "kind": "champion",
                 "ts": int(time.time()), "date": r.league_today(),
                 "title": title, "body": body, "note": "Written by the event wrap-up. Edit before publishing."}
        notes.append(f"Recap draft: \"{title}\" goes to Drafts (it replaces the short automatic one).")
    if not dry_run:
        r.write()
        if seeds and (seeds.get("target") or "").strip():
            allseeds = _load(SEEDS, {})
            allseeds[_norm(seeds["target"])] = {"target": seeds["target"].strip(), "from": tr["name"],
                                                "teams": [s["name"] for s in st[:int(seeds.get("count") or len(st))]]}
            json.dump(allseeds, open(SEEDS, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        if draft:
            drafts = [x for x in _load(os.path.join(DATA, "article_drafts.json"), []) if x.get("key") != draft["key"]]
            drafts.append(draft)
            json.dump(drafts, open(os.path.join(DATA, "article_drafts.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        wraps = _load(WRAPS, {})
        keep = {k: v for k, v in rules.items() if k != "champion_pro"} | ({"champion_pro": {"tag": rules["champion_pro"].get("tag")}} if rules.get("champion_pro") else {})
        wraps[slug] = {"date": r.league_today(), "rules": keep}
        json.dump(wraps, open(WRAPS, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return {"changes": r.changes + notes}


def seeds_for(name):
    return _load(SEEDS, {}).get(_norm(name))
