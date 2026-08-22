#!/usr/bin/env python3
"""Generate broadcast-style player bios into data/player_bios.json.

Reads the current site/data.json (player stats, titles, career) plus
data/player_gender.json, and writes one bio per person (keyed by normalized
name). Richness scales with accomplishment. Hand-written overrides in
data/player_bios_override.json win over the generated text. Run once; parse.py
just reads the result. Re-run to refresh after stats change materially.
"""
import json, os, re, unicodedata, hashlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")

def norm(s):
    s = unicodedata.normalize("NFKD", s or "")
    return re.sub(r"[^a-z0-9]", "", s.lower())

NAT_ADJ = {
    "singapore": "Singaporean", "malaysia": "Malaysian", "japan": "Japanese",
    "philippines": "Filipino", "phillipines": "Filipino", "usa": "American",
    "united states": "American", "australia": "Australian", "taiwan": "Taiwanese",
    "thailand": "Thai", "germany": "German", "indonesia": "Indonesian",
    "united kingdom": "British", "uk": "British", "france": "French",
    "netherlands": "Dutch", "korea": "Korean", "south korea": "Korean",
    "canada": "Canadian", "new zealand": "New Zealand", "austria": "Austrian",
    "poland": "Polish", "finland": "Finnish", "italy": "Italian", "belgium": "Belgian",
    "iceland": "Icelandic", "sweden": "Swedish", "kazakhstan": "Kazakh", "hong kong": "Hong Kong",
}

def role_phrase(role):
    r = (role or "").strip().lower()
    return {"igl": "in-game leader", "awper": "AWPer", "rifler": "rifler",
            "fill": "support player", "": ""}.get(r, r)

ONES = {1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six",
        7: "seven", 8: "eight", 9: "nine", 10: "ten"}
def cap(s):
    return s[0].upper() + s[1:] if s else s

def pick(seed, options):
    """Deterministic choice so bios are stable across runs."""
    h = int(hashlib.md5(seed.encode()).hexdigest(), 16)
    return options[h % len(options)]

def title_line(titles):
    """Return 'the <event>' for the standout trophy (event name already carries the year)."""
    if not titles:
        return None
    order = {"major": 0, "s": 1, "a": 2}
    best = sorted(titles, key=lambda t: (order.get(t.get("tier"), 3), -int(t.get("year") or 0)))[0]
    return f"the {best['event']}"

def make_bio(p, gender):
    he, his, him = {"M": ("he", "his", "him"), "F": ("she", "her", "her")}.get(gender, ("they", "their", "them"))
    name, team = p["name"], p.get("team") or ""
    role = role_phrase(p.get("role"))
    nat = NAT_ADJ.get((p.get("nat") or "").lower(), "")
    rating, tier = p.get("rating"), p.get("tier")
    titles = p.get("titles", []) or []
    nt = len(titles)
    mvp_awards = len(p.get("mvpAwards", []) or [])
    kdr = p.get("kdr", 0) or 0
    mvp = p.get("mvp", 0) or 0
    tl = title_line(titles)

    descr = " ".join(x for x in [nat, role] if x)
    subj = f"a {descr}" if descr else "a competitor"
    loc = f" for {team}" if team else ""

    # ---- sentence 1: identity + standing (ratings are normalized within each pool) ----
    pool = p.get("pool", "pro")
    poollbl = {"amateur": " in the amateur pool", "solo": " in the solo-queue pool"}.get(pool, "")
    if rating is None or not tier:
        standing = ""
    elif pool != "pro":
        standing = f"rated {rating:.2f} ({tier}){poollbl}"
    elif tier == "Champion":
        standing = pick(name + "c", [f"one of the league's very best at {rating:.2f} (Champion tier)",
                                     f"the pool's premier talent at {rating:.2f} (Champion tier)"])
    elif tier == "Grandmaster":
        standing = f"one of the pool's elite at {rating:.2f} (Grandmaster)"
    elif tier == "Master":
        standing = f"a Master-tier standout rated {rating:.2f}"
    else:
        standing = f"rated {rating:.2f} ({tier})"
    s1 = f"{name} is {subj}{loc}" + (f", {standing}." if standing else ".")

    # ---- sentence 2: accomplishments ----
    s2 = ""
    if nt >= 2:
        word = ONES.get(nt, str(nt))
        s2 = pick(name + "t", [f"A {word}-time BPL champion, {his} honours include {tl}.",
                               f"{cap(he)} is a {word}-time BPL champion, with {tl} among the highlights."])
    elif nt == 1:
        s2 = f"{cap(he)} won {tl}."
    if mvp_awards:
        s2 = (s2 + " " if s2 else "") + f"{cap(he)} has also been named an event MVP."

    # ---- sentence 3: one flavour/career note, for the more notable players ----
    s3 = ""
    if nt or (rating and rating >= 1.05):
        if kdr >= 1.15:
            s3 = pick(name + "f", [f"On the server {he} pairs that with a {kdr:.2f} K/D.",
                                   f"{cap(he)} backs it up with a {kdr:.2f} career K/D."])
        elif mvp >= 45 and not mvp_awards:
            s3 = f"{cap(he)} has racked up {mvp} MVP rounds over {his} career."
        else:
            th = [t for t in (p.get("teamHistory") or []) if t.get("isPro") and t["team"] != team]
            if th and team:
                s3 = f"{cap(he)} previously represented {th[-1]['team']}."

    bio = " ".join(s for s in (s1, s2, s3) if s)
    return re.sub(r"\s+", " ", bio).replace(" ,", ",").strip()

def main():
    d = json.load(open(os.path.join(ROOT, "site", "data.json"), encoding="utf-8"))
    genders = json.load(open(os.path.join(DATA, "player_gender.json"), encoding="utf-8"))
    ovr_path = os.path.join(DATA, "player_bios_override.json")
    overrides = json.load(open(ovr_path, encoding="utf-8")) if os.path.exists(ovr_path) else {}
    allp = d["players"]["pro"] + d["players"]["amateur"] + d["players"]["solo"]
    poolrank = {"pro": 0, "amateur": 1, "solo": 2}
    best = {}
    for p in allp:
        k = norm(p["name"])
        score = (poolrank.get(p["pool"], 3), -(p.get("rating") or 0))
        if k not in best or score < best[k][0]:
            best[k] = (score, p)
    bios = {}
    for k, (_, p) in best.items():
        if k in overrides:
            bios[k] = {"gender": genders.get(k, "NB"), "bio": overrides[k]}
        else:
            bios[k] = {"gender": genders.get(k, "NB"), "bio": make_bio(p, genders.get(k, "NB"))}
    json.dump(bios, open(os.path.join(DATA, "player_bios.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    print(f"wrote {len(bios)} bios ({len(overrides)} hand-written overrides)")

if __name__ == "__main__":
    main()
