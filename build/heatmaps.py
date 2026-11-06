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
    return listing
