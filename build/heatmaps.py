"""Kill heatmaps (6 Nov 2026). Every kill the BPL Bots launcher recorded in BPL matches
(data/kills/<event slug>/<match ref>.json, filed by manual.save_kills) goes into one file per map
for the site's Heatmaps page, site/heatmaps/<Map>.json:

  {"map", "nav": {"areas": [[x1, y1, x2, y2, z]], "places": [[label, x, y]]},
   "events": [[slug, name]], "teams": [name], "players": [name], "weapons": [name],
   "kills": [[kx, ky, vx, vy, side, killer, victim, killer's team, victim's team, headshot, event, weapon, kz, vz]]}

side is the killer's (0 T, 1 CT); killer/victim/teams/event/weapon index the lists (-1: not a BPL
player of that match). The floor comes from data/heatmap_nav/<Map>.json (bpl-bots
tools/heatmap_nav.py, drawn from the map's nav, not Valve's radar images). site/heatmaps/index.json
lists the maps with their kill counts. Kept out of data.json: the page loads one map at a time."""
import json
import os


def build(root, tournaments):
    kdir = os.path.join(root, "data", "kills")
    ndir = os.path.join(root, "data", "heatmap_nav")
    out = os.path.join(root, "site", "heatmaps")
    names = {t["slug"]: t.get("name", t["slug"]) for t in tournaments or []}
    per = {}

    def index(lst, pos, key):
        if not key:
            return -1
        if key not in pos:
            pos[key] = len(lst)
            lst.append(key)
        return pos[key]

    for slug in sorted(os.listdir(kdir)) if os.path.isdir(kdir) else []:
        sdir = os.path.join(kdir, slug)
        if not os.path.isdir(sdir):
            continue
        for fn in sorted(os.listdir(sdir)):
            if not fn.endswith(".json"):
                continue
            try:
                maps = json.load(open(os.path.join(sdir, fn), encoding="utf-8")).get("maps", [])
            except (OSError, ValueError):
                continue
            for mp in maps:
                name = (mp.get("map") or "").strip()
                if not name or not mp.get("kills"):
                    continue
                e = per.setdefault(name, {"events": [], "teams": [], "players": [], "weapons": [], "kills": [],
                                          "_ev": {}, "_t": {}, "_p": {}, "_w": {}})
                ev = e["_ev"].get(slug)
                if ev is None:
                    ev = e["_ev"][slug] = len(e["events"])
                    e["events"].append([slug, names.get(slug, slug)])
                for k in mp["kills"]:
                    try:
                        r, side, kn, kt, vn, vt, kx, ky, kz, vx, vy, vz, wpn, hs = k[:14]
                    except ValueError:
                        continue
                    e["kills"].append([int(kx), int(ky), int(vx), int(vy), 1 if side == "CT" else 0,
                                       index(e["players"], e["_p"], kn), index(e["players"], e["_p"], vn),
                                       index(e["teams"], e["_t"], kt), index(e["teams"], e["_t"], vt),
                                       1 if hs else 0, ev, index(e["weapons"], e["_w"], wpn), int(kz), int(vz)])

    os.makedirs(out, exist_ok=True)
    written = set()
    listing = []
    for name, e in sorted(per.items()):
        try:
            nav = json.load(open(os.path.join(ndir, name + ".json"), encoding="utf-8"))
        except (OSError, ValueError):
            nav = {"areas": [], "places": []}
        doc = {"map": name, "nav": {"areas": nav.get("areas", []), "places": nav.get("places", [])},
               **{k: v for k, v in e.items() if not k.startswith("_")}}
        fn = name + ".json"
        with open(os.path.join(out, fn), "w", encoding="utf-8") as f:
            json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
        written.add(fn)
        listing.append({"map": name, "kills": len(e["kills"]), "file": fn})
    for fn in os.listdir(out):                       # a map whose kills are all gone
        if fn.endswith(".json") and fn != "index.json" and fn not in written:
            os.remove(os.path.join(out, fn))
    with open(os.path.join(out, "index.json"), "w", encoding="utf-8") as f:
        json.dump({"maps": listing}, f, separators=(",", ":"))
    weapon_records(root, tournaments)
    return listing


# ---- weapon records (Records tab, site/weapons.json): who got the kills with what, from the same kill feed ----
WEAPON_NAMES = {"ak47": "AK-47", "m4a1": "M4A4", "m4a1_silencer": "M4A1-S", "awp": "AWP", "ssg08": "SSG 08", "aug": "AUG", "sg556": "SG 553",
                "galilar": "Galil AR", "famas": "FAMAS", "glock": "Glock-18", "hkp2000": "P2000", "usp_silencer": "USP-S", "usp_silencer_off": "USP-S",
                "p250": "P250", "deagle": "Desert Eagle", "fiveseven": "Five-SeveN", "tec9": "Tec-9", "cz75a": "CZ75-Auto", "elite": "Dual Berettas",
                "revolver": "R8 Revolver", "mac10": "MAC-10", "mp9": "MP9", "mp7": "MP7", "mp5sd": "MP5-SD", "ump45": "UMP-45", "p90": "P90", "bizon": "PP-Bizon",
                "nova": "Nova", "xm1014": "XM1014", "sawedoff": "Sawed-Off", "mag7": "MAG-7", "negev": "Negev", "m249": "M249", "scar20": "SCAR-20", "g3sg1": "G3SG1",
                "hegrenade": "HE Grenade", "inferno": "Fire", "taser": "Zeus x27", "knife_t": "Knife", "knife": "Knife"}
_PISTOLS = {"glock", "hkp2000", "usp_silencer", "usp_silencer_off", "p250", "deagle", "fiveseven", "tec9", "cz75a", "elite", "revolver"}
_GROUPS = [("AK-47", {"ak47"}), ("M4", {"m4a1", "m4a1_silencer"}), ("AWP", {"awp"}), ("Scout", {"ssg08"}), ("AUG & SG", {"aug", "sg556"}),
           ("SMGs", {"mac10", "mp9", "mp7", "mp5sd", "ump45", "p90", "bizon"}), ("Pistols", _PISTOLS), ("Desert Eagle", {"deagle"}),
           ("Grenades", {"hegrenade", "inferno", "molotov", "incgrenade", "flashbang", "smokegrenade", "decoy"})]
PISTOL_ROUNDS = {0, 12}       # MR12: the first round of each half (the feed counts rounds from 0)


def _groups_of(wpn, rnd):
    out = [g for g, ws in _GROUPS if wpn in ws]
    if wpn.startswith("knife") or wpn == "bayonet":
        out.append("Knife")
    if rnd in PISTOL_ROUNDS:
        out.append("Pistol Rounds")
    return out


def weapon_records(root, tournaments):
    """{"maps", "kills", "weapons": [[name, kills, headshots]], "groups": {group: {"players": [[name, kills, headshots]], "maps":
    [[kills, name, map, event]]}}}: the top 50 players per group, and the top 15 single-map hauls."""
    kdir = os.path.join(root, "data", "kills")
    names = {t["slug"]: t.get("name", t["slug"]) for t in tournaments or []}
    weapons, players, hauls = {}, {}, {}
    n_maps = n_kills = 0
    for slug in sorted(os.listdir(kdir)) if os.path.isdir(kdir) else []:
        sdir = os.path.join(kdir, slug)
        if not os.path.isdir(sdir):
            continue
        for fn in sorted(os.listdir(sdir)):
            if not fn.endswith(".json"):
                continue
            try:
                maps = json.load(open(os.path.join(sdir, fn), encoding="utf-8")).get("maps", [])
            except (OSError, ValueError):
                continue
            for i, mp in enumerate(maps):
                if not mp.get("kills"):
                    continue
                n_maps += 1
                for k in mp["kills"]:
                    try:
                        rnd, _, kn, _, _, _, _, _, _, _, _, _, wpn, hs = k[:14]
                    except ValueError:
                        continue
                    if not kn or not wpn:
                        continue
                    n_kills += 1
                    hs = 1 if hs else 0
                    w = weapons.setdefault(WEAPON_NAMES.get(wpn, wpn), [0, 0])
                    w[0] += 1
                    w[1] += hs
                    for g in _groups_of(wpn, rnd):
                        p = players.setdefault(g, {}).setdefault(kn, [0, 0])
                        p[0] += 1
                        p[1] += hs
                        h = hauls.setdefault(g, {})
                        key = (slug, fn, i, kn)
                        h[key] = h.get(key, 0) + 1
                        hauls[g] = h
    groups = {}
    for g, ps in players.items():
        top = sorted(([n, v[0], v[1]] for n, v in ps.items()), key=lambda x: (-x[1], x[0].lower()))[:50]
        best = sorted(hauls[g].items(), key=lambda kv: (-kv[1], kv[0]))[:15]
        groups[g] = {"players": top, "maps": [[c, key[3], _map_name(kdir, key), names.get(key[0], key[0])] for key, c in best]}
    doc = {"maps": n_maps, "kills": n_kills, "groups": groups,
           "weapons": sorted(([n, v[0], v[1]] for n, v in weapons.items()), key=lambda x: -x[1])}
    with open(os.path.join(root, "site", "weapons.json"), "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
    return doc


def _map_name(kdir, key):
    slug, fn, i, _ = key
    try:
        return json.load(open(os.path.join(kdir, slug, fn), encoding="utf-8"))["maps"][i].get("map") or ""
    except (OSError, ValueError, IndexError, KeyError):
        return ""
