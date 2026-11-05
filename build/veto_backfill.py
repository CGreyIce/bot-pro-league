"""Fills in the map veto for matches played before BPL Bots recorded it (Nov 2026).

Each team's per-map record and win-loss ratio as they stood just before the match (every result
saved later, by its ts, taken off: the numbers parse.py gave the app then), run through the app's
own veto simulation (BPL Bots ui/app.js simulateVeto, the same as the admin's simulator). A veto is
only kept when it reproduces the maps actually played, in order, over 2+ maps (a Bo1's single map
could match by chance). Pro teams only: teams without a page had estimated stats.
It reproduced 52/53 Conquerors 2026 and 75/87 Legends 2026 Bo3s; earlier events weren't played from
the veto. Run after a build (it reads site/data.json), then build again:
    python build/veto_backfill.py [event-slug ...]        (default: Legends + Conquerors 2026)
Matches that already have a veto (recorded by the app) are left alone."""
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
POOL = ["Mirage", "Dust2", "Inferno", "Cache", "Ancient", "Vertigo", "Anubis"]
STATS_MAPS = POOL + ["Tuscan"]
LEAN = {"Mirage": "CT", "Dust2": "T", "Inferno": "CT", "Cache": "CT", "Ancient": "CT", "Tuscan": "CT", "Vertigo": "CT", "Anubis": "T"}
MAPKEY = {m.lower(): m for m in STATS_MAPS}


def fnv(s):
    """vetoHash / parse._seed: FNV-1a over UTF-16 code units (JS charCodeAt)."""
    h = 2166136261
    for ch in s:
        o = ord(ch)
        for cu in ([o] if o < 0x10000 else [0xD800 + ((o - 0x10000) >> 10), 0xDC00 + ((o - 0x10000) & 0x3FF)]):
            h = ((h ^ cu) * 16777619) & 0xFFFFFFFF
    return h


def pct(v):
    return f"{v * 100:.1f}%"


def asof(d, allm, manual, slug, ts):
    """A pro team as the veto saw it before the result saved at ts: per-map win rates (parse.py's
    rule: 2+ maps = real, else seeded off the team's map win-loss ratio) and its 2 best pool maps."""
    t = next(x for x in d["teams"] if x["slug"] == slug)
    rec = {cm: [t["mapStats"][cm]["w"], t["mapStats"][cm]["l"]] for cm in STATS_MAPS}
    mw, ml = t["map_wins"], t["map_losses"]
    for tr, m in allm:
        if not (m.get("ts") and m["ts"] >= ts) or slug not in (m.get("aTeam"), m.get("bTeam")):
            continue
        on_a = m.get("aTeam") == slug
        for mp in (m.get("stats") or {}).get("maps", []):
            cm = MAPKEY.get((mp.get("map") or "").strip().lower())
            sa, sb = mp.get("scoreA"), mp.get("scoreB")
            if cm and sa is not None and sb is not None and sa != sb:
                rec[cm][0 if (sa > sb) == on_a else 1] -= 1
        if tr["slug"] in manual and m.get("w") in (1, 2) and "(bye)" not in (m.get("a"), m.get("b")):
            sa, sb = m.get("sa"), m.get("sb")
            if sa is not None and sb is not None:
                wa, wb = ((1, 0) if sa > sb else (0, 1)) if max(sa, sb) >= 13 else (sa, sb)
            else:
                wa, wb = (1, 0) if m["w"] == 1 else (0, 1)
            mw, ml = (mw - wa, ml - wb) if on_a else (mw - wb, ml - wa)
    base = (round(mw / (mw + ml), 3) if mw + ml else 0) or 0.5
    wr = {}
    for cm in STATS_MAPS:
        w, l = rec[cm]
        if w + l >= 2:
            wr[cm] = round(w / (w + l), 3)
        else:
            off = (fnv(slug + "|" + cm) % 4200) / 10000.0 - 0.21
            wr[cm] = round(max(0.18, min(0.85, base + off)), 3)
    order = sorted(POOL, key=lambda cm: (-wr[cm], cm))
    return {"name": t["name"], "slug": slug, "wr": wr, "best": order[:2]}


def side_of(chooser, mp, A, B):
    lean = LEAN.get(mp, "CT")
    follow = fnv(chooser["slug"] + "|" + mp + "|" + A["slug"] + "|" + B["slug"]) % 100 < 65
    return lean if follow else ("T" if lean == "CT" else "CT")


def simulate(A, B, fmt):
    """simulateVeto, step for step (bans/picks, reasons, sides). Returns (steps, maps in play order)."""
    wr = lambda t, mp: t["wr"].get(mp, 0.5)
    rem, steps = POOL[:], []
    seq = ([(A, "ban"), (B, "ban")] * 3 if fmt == "bo1" else
           [(A, "ban"), (B, "ban"), (A, "pick"), (B, "pick"), (A, "pick"), (B, "pick")] if fmt == "bo5" else
           [(A, "ban"), (B, "ban"), (A, "pick"), (B, "pick"), (A, "ban"), (B, "ban")])
    for team, action in seq:
        opp = B if team is A else A
        if action == "ban":
            c = [mp for mp in rem if mp not in team["best"]] or rem[:]
            mp = sorted(c, key=lambda x: (-wr(opp, x), wr(team, x)))[0]
            if mp in opp["best"]:
                reason = f"removes {opp['name']}'s best map ({pct(wr(opp, mp))})"
            elif wr(opp, mp) >= 0.55:
                reason = f"{opp['name']} are strong here ({pct(wr(opp, mp))})"
            else:
                reason = f"{team['name']} are weakest here ({pct(wr(team, mp))})"
        else:
            mp = sorted(rem, key=lambda x: -wr(team, x))[0]
            reason = (f"{team['name']}'s best map ({pct(wr(team, mp))})" if mp in team["best"]
                      else f"{team['name']}'s strongest left ({pct(wr(team, mp))})")
        rem.remove(mp)
        st = {"side": "a" if team is A else "b", "action": action, "map": mp, "reason": reason, "wrA": wr(A, mp), "wrB": wr(B, mp)}
        if action == "pick":                       # the picker's opponent elects the side
            st.update(sideAB="a" if opp is A else "b", startSide=side_of(opp, mp, A, B), coin=False)
        steps.append(st)
    dec = rem[0]
    kwin = A if fnv(A["slug"] + "|" + B["slug"] + "|" + dec) % 2 == 0 else B
    steps.append({"side": "d", "action": "decider", "map": dec, "reason": "the map left after all vetoes",
                  "wrA": wr(A, dec), "wrB": wr(B, dec), "sideAB": "a" if kwin is A else "b",
                  "startSide": side_of(kwin, dec, A, B), "coin": True})
    played = [dec] if fmt == "bo1" else [s["map"] for s in steps if s["action"] == "pick"] + [dec]
    return steps, played


def main(events):
    d = json.load(open(os.path.join(ROOT, "site", "data.json"), encoding="utf-8"))
    manual = {os.path.splitext(f)[0] for f in os.listdir(os.path.join(ROOT, "data", "manual"))}
    pro = {t["slug"] for t in d["teams"]}
    allm = [(tr, m) for tr in d["tournaments"] for m in
            ([m for st in tr.get("stages", []) for rd in st["rounds"] for m in rd["matches"]] if tr.get("stages")
             else [m for rd in tr.get("bracket", []) for m in rd["matches"]])]
    msfile = os.path.join(ROOT, "data", "match_stats.json")
    ms = json.load(open(msfile, encoding="utf-8"))
    filled = tried = 0
    for tr in d["tournaments"]:
        if tr["slug"] not in events:
            continue
        for st in tr.get("stages", []):
            for rd in st["rounds"]:
                for m in rd["matches"]:
                    e = ms.get(tr["slug"], {}).get(f"{st['id']}-{m['i']}")
                    maps = [mp["map"] for mp in (m.get("stats") or {}).get("maps", [])]
                    if (not e or e.get("veto") or m.get("w") not in (1, 2) or not m.get("ts") or len(maps) < 2
                            or m.get("tp") or m.get("aTeam") not in pro or m.get("bTeam") not in pro):
                        continue
                    tried += 1
                    fmt = f"bo{m.get('bo') or 1}"
                    steps, played = simulate(asof(d, allm, manual, m["aTeam"], m["ts"]), asof(d, allm, manual, m["bTeam"], m["ts"]), fmt)
                    if [p.lower() for p in played[:len(maps)]] == [x.lower() for x in maps]:
                        e["veto"] = {"fmt": fmt, "steps": steps, "rebuilt": True}
                        filled += 1
    json.dump(ms, open(msfile, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"filled {filled} of {tried} matches without a veto")


if __name__ == "__main__":
    main(set(sys.argv[1:]) or {"bpl-legends-stage-2026", "bpl-conquerors-stage-2026"})
