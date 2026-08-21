#!/usr/bin/env python3
"""Manual (admin-entered) tournaments — STAGE based.

A tournament is a list of stages; each stage has a format:
  single_elim   auto-advancing bracket (standard seeding, byes)
  round_robin   everyone plays everyone (circle method), standings by record
  swiss         a flat match list you add to by hand, standings by record

Group stage + playoffs = e.g. two round_robin stages ("Group A/B") + a
single_elim stage ("Playoffs"). Editable master: data/manual/<slug>.json.
On save we also write the standard data/tournaments/<slug>.json for parse.py.
"""
import json, math, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANUAL = os.path.join(ROOT, "data", "manual")
TDIR = os.path.join(ROOT, "data", "tournaments")
os.makedirs(MANUAL, exist_ok=True)
os.makedirs(TDIR, exist_ok=True)

def slugify(s):
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", (s or "").lower())).strip("-")

# ---------------- generators ----------------
def seed_order(p):
    order = [1, 2]
    while len(order) < p:
        m = len(order) * 2 + 1
        order = [x for s in order for x in (s, m - s)]
    return order

def default_round_title(r, rounds, n_in_round):
    if r == rounds: return "Final"
    if r == rounds - 1: return "Semifinals"
    if r == rounds - 2: return "Quarterfinals"
    return f"Round of {n_in_round * 2}"

def gen_single_elim(teams):
    n = len(teams)
    p = 1
    while p < max(2, n):
        p *= 2
    order = seed_order(p)
    rounds = int(math.log2(p))
    matches, mid, prev = [], 1, []
    for k in range(0, p, 2):
        matches.append({"id": mid, "round": 1, "fa": {"seed": order[k]}, "fb": {"seed": order[k + 1]},
                        "sa": None, "sb": None}); prev.append(mid); mid += 1
    for r in range(2, rounds + 1):
        cur = []
        for j in range(0, len(prev), 2):
            matches.append({"id": mid, "round": r, "fa": {"match": prev[j]}, "fb": {"match": prev[j + 1]},
                            "sa": None, "sb": None}); cur.append(mid); mid += 1
        prev = cur
    per = {}
    for m in matches:
        per[m["round"]] = per.get(m["round"], 0) + 1
    titles = {str(r): default_round_title(r, rounds, per[r]) for r in per}
    return matches, titles

def gen_round_robin(teams):
    ts = list(teams)
    if len(ts) % 2:
        ts = ts + [None]                         # odd -> phantom bye
    n = len(ts); rounds = n - 1; half = n // 2
    arr = ts[:]; matches = []; mid = 1
    for r in range(rounds):
        for i in range(half):
            a, b = arr[i], arr[n - 1 - i]
            if a is not None and b is not None:
                matches.append({"id": mid, "round": r + 1, "a": a, "b": b, "sa": None, "sb": None}); mid += 1
        arr = [arr[0]] + [arr[-1]] + arr[1:-1]   # rotate keeping first fixed
    titles = {str(r + 1): f"Round {r + 1}" for r in range(rounds)}
    return matches, titles

# ---------------- stage resolution ----------------
def _elim_resolved(stage):
    teams = stage["teams"]; n = len(teams)
    name_by_seed = {i + 1: nm for i, nm in enumerate(teams)}
    by_id = {m["id"]: m for m in stage["matches"]}
    memo = {}
    def is_bye(f): return "seed" in f and f["seed"] > n
    def team_of(f):
        if "seed" in f:
            s = f["seed"]; return name_by_seed.get(s) if s <= n else None
        return winner_of(f["match"])
    def winner_of(mid):
        if mid in memo: return memo[mid]
        memo[mid] = None
        m = by_id[mid]; a, b = team_of(m["fa"]), team_of(m["fb"]); w = None
        if a and b is None and is_bye(m["fb"]): w = a
        elif b and a is None and is_bye(m["fa"]): w = b
        elif a and b and m.get("sa") is not None and m.get("sb") is not None:
            w = a if m["sa"] > m["sb"] else b if m["sb"] > m["sa"] else None
        memo[mid] = w; return w
    res = {}
    for m in stage["matches"]:
        a, b = team_of(m["fa"]), team_of(m["fb"]); w = winner_of(m["id"])
        wi = 1 if (w and w == a) else 2 if (w and w == b) else 0
        walk = (a and is_bye(m["fb"])) or (b and is_bye(m["fa"]))
        res[m["id"]] = {"a": a, "b": b, "w": wi, "bye": walk}
    final_id = max((m["id"] for m in stage["matches"]), default=None)
    champ = winner_of(final_id) if final_id else None
    return res, champ

def _flat_resolved(stage):
    res = {}
    for m in stage["matches"]:
        a, b = m.get("a"), m.get("b"); w = 0
        if m.get("sa") is not None and m.get("sb") is not None:
            w = 1 if m["sa"] > m["sb"] else 2 if m["sb"] > m["sa"] else 0
        res[m["id"]] = {"a": a, "b": b, "w": w, "bye": False}
    return res

def stage_resolved(stage):
    return _elim_resolved(stage) if stage["format"] == "single_elim" else (_flat_resolved(stage), None)

def stage_standings(stage, res):
    rec = {}
    for mid, r in res.items():
        if r["w"] not in (1, 2):
            continue
        a, b = r["a"], r["b"]
        win, lose = (a, b) if r["w"] == 1 else (b, a)
        for t in (win, lose):
            rec.setdefault(t, {"w": 0, "l": 0, "diff": 0})
        m = next(x for x in stage["matches"] if x["id"] == mid)
        sa, sb = m.get("sa"), m.get("sb")
        rec[win]["w"] += 1; rec[lose]["l"] += 1
        if sa is not None:
            hi, lo = (sa, sb) if r["w"] == 1 else (sb, sa)
            rec[win]["diff"] += hi - lo; rec[lose]["diff"] += lo - hi
    order = sorted(rec.keys(), key=lambda n: (-rec[n]["w"], rec[n]["l"], -rec[n]["diff"], (n or "").lower()))
    if stage["format"] == "single_elim":
        _, champ = _elim_resolved(stage)
        if champ:
            order = [champ] + [n for n in order if n != champ]
    return [{"name": n, "w": rec[n]["w"], "l": rec[n]["l"]} for n in order]

# ---------------- to standard schema ----------------
def stage_to_standard(stage):
    res, _ = stage_resolved(stage)
    rounds = {}
    for m in stage["matches"]:
        rounds.setdefault(m["round"], [])
    out_matches = []
    for m in stage["matches"]:
        rr = res[m["id"]]; a, b = rr["a"], rr["b"]
        out_matches.append({"r": m["round"], "i": m["id"], "a": a or "",
                            "b": b or ("(bye)" if rr.get("bye") else ""),
                            "sc": [m.get("sa"), m.get("sb")] if m.get("sa") is not None else "",
                            "w": rr["w"], "st": "complete" if rr["w"] else "pending",
                            "grp": False, "bo": stage.get("bestOf", 1)})
    return {
        "id": stage["id"], "name": stage["name"], "format": stage["format"],
        "bestOf": stage.get("bestOf", 1), "roundTitles": stage.get("roundTitles", {}),
        "matches": out_matches, "standings": stage_standings(stage, res),
    }

def to_standard(man):
    stages = [stage_to_standard(s) for s in man["stages"]]
    # champion = decisive result of the last stage
    champion = None
    if man["stages"]:
        last = man["stages"][-1]
        if last["format"] == "single_elim":
            _, champion = _elim_resolved(last)
        else:
            st = stages[-1]["standings"]
            # only crown if every match played
            if st and all(m.get("sa") is not None for m in last["matches"]) and last["matches"]:
                champion = st[0]["name"]
    # all participants (unique across stages)
    seen, parts = set(), []
    for s in man["stages"]:
        for t in s["teams"]:
            if t and t not in seen:
                seen.add(t); parts.append({"id": len(parts) + 1, "s": len(parts) + 1, "n": t})
    # flat match list for downstream feeds (results/H2H/records)
    flat = []
    for si, s in enumerate(stages):
        for m in s["matches"]:
            flat.append({**m, "r": (si + 1) * 1000 + (m["r"] or 0), "grp": s["format"] != "single_elim"})
    return {
        "slug": man["slug"], "name": man["name"], "date": man["date"], "tier": man["tier"],
        "type": "multi" if len(stages) != 1 else {"single_elim": "single elimination",
                 "round_robin": "round robin", "swiss": "swiss"}[man["stages"][0]["format"]],
        "manual": True, "champion": champion, "stages": stages,
        "participants": parts, "matches": flat, "roundTitles": {},
    }

# ---------------- persistence ----------------
def path(slug): return os.path.join(MANUAL, slug + ".json")
def load(slug):
    p = path(slug)
    return json.load(open(p, encoding="utf-8")) if os.path.exists(p) else None
def save(man):
    json.dump(man, open(path(man["slug"]), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    json.dump(to_standard(man), open(os.path.join(TDIR, man["slug"] + ".json"), "w", encoding="utf-8"),
              ensure_ascii=False)
def delete(slug):
    for d in (MANUAL, TDIR):
        p = os.path.join(d, slug + ".json")
        if os.path.exists(p): os.remove(p)
def list_manual():
    out = []
    for fn in sorted(os.listdir(MANUAL)):
        if fn.endswith(".json"):
            m = json.load(open(os.path.join(MANUAL, fn), encoding="utf-8"))
            out.append({"slug": m["slug"], "name": m["name"], "tier": m["tier"], "date": m["date"],
                        "stages": len(m.get("stages", []))})
    return out

# ---------------- mutations ----------------
def create(name, tier, date):
    man = {"slug": slugify(name), "name": name.strip(), "tier": tier, "date": date, "stages": []}
    save(man); return man

def _next_stage_id(man):
    return (max([s["id"] for s in man["stages"]], default=0) + 1)

def add_stage(slug, name, fmt, teams, best_of=1):
    man = load(slug)
    if not man: return None
    teams = [t.strip() for t in teams if t and t.strip()]
    if fmt == "single_elim":
        matches, titles = gen_single_elim(teams)
    elif fmt == "round_robin":
        matches, titles = gen_round_robin(teams)
    else:  # swiss — start empty, add matches by hand
        matches, titles = [], {}
    man["stages"].append({"id": _next_stage_id(man), "name": name.strip() or fmt,
                          "format": fmt, "bestOf": int(best_of or 1), "teams": teams,
                          "matches": matches, "roundTitles": titles})
    save(man); return man

def _stage(man, sid):
    return next((s for s in man["stages"] if s["id"] == int(sid)), None)

def set_score(slug, sid, mid, sa, sb):
    man = load(slug); st = _stage(man, sid) if man else None
    if not st: return None
    for m in st["matches"]:
        if m["id"] == int(mid):
            m["sa"] = None if sa in ("", None) else int(sa)
            m["sb"] = None if sb in ("", None) else int(sb)
    save(man); return man

def add_match(slug, sid, rnd, a, b):
    man = load(slug); st = _stage(man, sid) if man else None
    if not st: return None
    nid = max([m["id"] for m in st["matches"]], default=0) + 1
    st["matches"].append({"id": nid, "round": int(rnd or 1), "a": a, "b": b, "sa": None, "sb": None})
    st["roundTitles"].setdefault(str(int(rnd or 1)), f"Round {int(rnd or 1)}")
    save(man); return man

def del_match(slug, sid, mid):
    man = load(slug); st = _stage(man, sid) if man else None
    if not st: return None
    st["matches"] = [m for m in st["matches"] if m["id"] != int(mid)]
    save(man); return man

def rename_round(slug, sid, rnd, title):
    man = load(slug); st = _stage(man, sid) if man else None
    if not st: return None
    st.setdefault("roundTitles", {})[str(rnd)] = title
    save(man); return man

def set_bestof(slug, sid, bo):
    man = load(slug); st = _stage(man, sid) if man else None
    if not st: return None
    st["bestOf"] = int(bo or 1); save(man); return man

def rename_stage(slug, sid, name):
    man = load(slug); st = _stage(man, sid) if man else None
    if not st: return None
    st["name"] = name.strip() or st["name"]; save(man); return man

def reseed(slug, sid, teams):
    man = load(slug); st = _stage(man, sid) if man else None
    if not st: return None
    teams = [t.strip() for t in teams if t and t.strip()]
    st["teams"] = teams
    if st["format"] == "single_elim":
        st["matches"], st["roundTitles"] = gen_single_elim(teams)
    elif st["format"] == "round_robin":
        st["matches"], st["roundTitles"] = gen_round_robin(teams)
    save(man); return man

def del_stage(slug, sid):
    man = load(slug)
    if not man: return None
    man["stages"] = [s for s in man["stages"] if s["id"] != int(sid)]
    save(man); return man

# ---------- per-match player scoreboards ----------
MSFILE = os.path.join(ROOT, "data", "match_stats.json")
def save_match_stats(slug, ref, maps):
    data = json.load(open(MSFILE, encoding="utf-8")) if os.path.exists(MSFILE) else {}
    data.setdefault(slug, {})
    maps = [m for m in (maps or []) if m.get("players")]
    if maps:
        data[slug][str(ref)] = {"maps": maps}
    else:
        data[slug].pop(str(ref), None)
        if not data[slug]:
            data.pop(slug, None)
    json.dump(data, open(MSFILE, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
