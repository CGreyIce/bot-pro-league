#!/usr/bin/env python3
"""Storylines + auto news drafts, run at the end of every build.

Each build is compared with the last one (data/storyline_state.json) to spot what just happened:
records broken, champions crowned, teams promoted, transfers, a new #1 player or team, career
milestones and big upsets. Those go to a rolling log (data/storyline_log.json) that feeds the home
page Storylines strip, and the article-worthy ones become DRAFTS (data/article_drafts.json) that
the admin can edit and publish, or discard. Drafts are written with [[wiki links]] and follow the
house style (no em dashes, "team" never "side").

The very first run only records the current state (no flood of drafts for old news), except for a
record set within the last 7 days.
"""
import hashlib, json, os, re, time
from datetime import date

import wikilinks
from bio_engine import NAT_ADJ

DAY = 86400
TIER_PTS = {"major": 500, "s": 250, "a": 100}
MILESTONES = {"maps": [50, 100, 150, 200, 250, 300, 400, 500],
              "kills": [500, 1000, 1500, 2000, 2500, 3000, 4000, 5000],
              "mvp": [100, 150, 200, 250, 300, 400, 500]}
UPSET_CARD, UPSET_DRAFT = 60, 200          # rating-point gap between line-ups for a card / a draft
ROLE = {"igl": "in-game leader", "awper": "AWPer", "awp": "AWPer", "rifler": "rifler", "fill": "support player"}


def _load(path, default):
    try:
        return json.load(open(path, encoding="utf-8"))
    except Exception:
        return default


def _save(path, obj):
    json.dump(obj, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


def _pick(seed, options):
    return options[int(hashlib.md5(seed.encode()).hexdigest(), 16) % len(options)]


def _clean(s):
    """House style: no em/en dashes, even inside event names."""
    return (s or "").replace(" — ", ": ").replace("—", "-").replace("–", "-")


def _join(xs):
    xs = [x for x in xs if x]
    return xs[0] if len(xs) == 1 else ", ".join(xs[:-1]) + " and " + xs[-1] if xs else ""


def _iter_matches(tr):
    """-> (ref, round title, match) like the match pages use (stage matches: '<stageId>-<i>')."""
    if tr.get("stages"):
        for st in tr["stages"]:
            for rd in st["rounds"]:
                for m in rd["matches"]:
                    yield f"{st['id']}-{m.get('i')}", rd.get("title", ""), st, m
    else:
        for rd in tr.get("bracket", []):
            for m in rd["matches"]:
                yield str(m.get("i")), rd.get("title", ""), None, m


def _played(m):
    return m.get("w") in (1, 2) and m.get("a") != "(bye)" and m.get("b") != "(bye)"


def _ot_periods(sa, sb):
    if sa is None or sb is None:
        return 0
    hi, lo = max(sa, sb), min(sa, sb)
    return 0 if lo < 12 or hi == lo else max(1, round((hi - 13) / 3.0))


# ---------------------------------------------------------------- records (mirror the Records page)
def compute_records(data):
    T = data["tournaments"]
    recs = {}
    hs = topk = topot = None
    for tr in T:
        for ref, rtitle, st, m in _iter_matches(tr):
            if not _played(m):
                continue
            maps = [mp for mp in ((m.get("stats") or {}).get("maps") or [])
                    if mp.get("scoreA") not in (None, "") and mp.get("scoreB") not in (None, "")]
            ctx = {"event": tr["name"], "eventSlug": tr["slug"], "ts": m.get("ts"), "link": f"#/match/{tr['slug']}/{ref}",
                   "a": m.get("a"), "b": m.get("b")}
            scores = [(int(mp["scoreA"]), int(mp["scoreB"]), mp.get("map") or "", mp) for mp in maps]
            if not scores and m.get("sa") is not None and m.get("sb") is not None and m["sa"] + m["sb"] >= 13:
                scores = [(m["sa"], m["sb"], "", None)]
            for sa, sb, mapname, mp in scores:
                tot = sa + sb
                if hs is None or tot > hs["value"]:
                    hs = {**ctx, "value": tot, "sa": sa, "sb": sb, "map": mapname,
                          "holder": f"{m.get('a')} vs {m.get('b')}", "valueText": f"{tot} rounds ({sa}-{sb})"}
                ot = _ot_periods(sa, sb)
                if ot and (topot is None or ot > topot["value"]):
                    topot = {**ctx, "value": ot, "sa": sa, "sb": sb, "map": mapname,
                             "holder": f"{m.get('a')} vs {m.get('b')}", "valueText": f"{ot} overtime{'s' if ot != 1 else ''}"}
                for pl in (mp or {}).get("players", []):
                    k = pl.get("k")
                    if k is not None and (topk is None or k > topk["value"]):
                        on_a = wikilinks.norm(pl.get("team")) == wikilinks.norm(m.get("a"))
                        topk = {**ctx, "value": k, "map": mapname, "holder": pl.get("name"), "slug": pl.get("slug"),
                                "opp": m.get("b") if on_a else m.get("a"), "team": pl.get("team"), "valueText": f"{k} kills"}
    if hs:
        recs["highestMap"] = {**hs, "label": "Highest-scoring map"}
    if topk:
        recs["mostKillsMap"] = {**topk, "label": "Most kills in a map"}
    if topot:
        recs["mostOT"] = {**topot, "label": "Most overtimes in a map"}
    streak = None
    for t in data["teams"]:
        ls = t.get("longestWinStreak")
        if ls and (streak is None or ls["len"] > streak["value"]):
            streak = {"value": ls["len"], "holder": t["name"], "link": f"#/team/{t['slug']}", "valueText": f"{ls['len']} wins in a row",
                      "event": ls.get("endEvent"), "eventSlug": ls.get("endSlug")}
    if streak:
        recs["longestWinStreak"] = {**streak, "label": "Longest win streak"}
    titles = {}
    for tr in T:
        if tr.get("championTeam"):
            titles[tr["championTeam"]] = titles.get(tr["championTeam"], 0) + 1
    if titles:
        slug, n = max(titles.items(), key=lambda kv: kv[1])
        tm = next((t for t in data["teams"] if t["slug"] == slug), {"name": slug})
        recs["mostTitlesTeam"] = {"label": "Most event titles (team)", "value": n, "holder": tm["name"],
                                  "link": f"#/team/{slug}", "valueText": f"{n} titles"}
    pro = data["players"]["pro"]
    best = max(pro, key=lambda p: len(p.get("titles") or []), default=None)
    if best and best.get("titles"):
        recs["mostTitlesPlayer"] = {"label": "Most titles (player)", "value": len(best["titles"]), "holder": best["name"],
                                    "link": f"#/player/{best['slug']}", "valueText": f"{len(best['titles'])} titles"}
    rc = data.get("rankClimbRecord")
    if rc and rc.get("delta"):
        recs["rankClimb"] = {"label": "Biggest rank climb", "value": rc["delta"], "holder": rc["name"],
                             "link": f"#/player/{rc['slug']}", "valueText": f"+{rc['delta']} places"}
    return recs


# ---------------------------------------------------------------- the engine
class Storylines:
    def __init__(self, data, data_dir, climbers, now):
        self.d, self.dir, self.now = data, data_dir, now
        self.climbers = climbers or []
        self.players = data["players"]["pro"] + data["players"]["amateur"] + data["players"]["solo"]
        self.pby = {p["slug"]: p for p in self.players}
        self.tby = {t["slug"]: t for t in data["teams"]}
        self.tbyname = {wikilinks.norm(t["name"]): t for t in data["teams"]}
        self.ix = wikilinks.Index(self.players, data["teams"], data["tournaments"], data_dir)
        self.state = _load(os.path.join(data_dir, "storyline_state.json"), {})
        self.log = _load(os.path.join(data_dir, "storyline_log.json"), [])
        self.drafts = _load(os.path.join(data_dir, "article_drafts.json"), [])
        self.first = not self.state.get("v")
        self.logged = {e["id"] for e in self.log}
        self.drafted = set(self.state.get("drafted", []))
        moves = _load(os.path.join(data_dir, "roster_moves.json"), [])
        self.moves = moves
        dates = [date.today().isoformat()] + [m.get("date", "") for m in moves] + [a.get("date", "") for a in data.get("articles", [])]
        self.today = max(x for x in dates if x)
        self.manual = {f[:-5] for f in os.listdir(os.path.join(data_dir, "manual")) if f.endswith(".json")}

    # ---- helpers
    def L(self, name, label=None):
        return wikilinks.link(name, self.ix, _clean(label) if label else (_clean(name) if name and _clean(name) != name else None))

    def player_line(self, p):
        nat = NAT_ADJ.get((p.get("nat") or "").lower(), "")
        role = ROLE.get((p.get("role") or "").lower(), "player")
        rank = self.page_rank().get(p["slug"])
        bits = f"{'an' if (nat or role)[:1].lower() in 'aeiou' else 'a'} {' '.join(x for x in (nat, role) if x)}"
        if p.get("maps"):
            return (f"{self.L(p['name'])} is {bits} ranked #{rank} in the league ({p.get('ratingPoints')} points), "
                    f"with a {p.get('kdr', 0):.2f} K/D across {p['maps']} maps.")
        return f"{self.L(p['name'])} is {bits} yet to play a recorded tournament map."

    _rank_cache = None

    def page_rank(self):
        if self._rank_cache is None:
            lad = sorted(self.d["players"]["pro"], key=lambda p: -(p["ratingPoints"] if p.get("ratingPoints") is not None else -1))
            self._rank_cache = {p["slug"]: i + 1 for i, p in enumerate(lad)}
        return self._rank_cache

    def roster_of(self, team_name):
        k = wikilinks.norm(team_name)
        return [p for p in self.d["players"]["pro"] if wikilinks.norm(p.get("team")) == k]

    def emit(self, key, kind, title, text, link, ts=None, draft=None):
        if key in self.logged:
            return
        self.logged.add(key)
        self.log.append({"id": key, "type": kind, "ts": int(ts or self.now), "date": self.today,
                         "title": title, "text": text, "link": link})
        if draft and key not in self.drafted:
            self.drafted.add(key)
            t, body, note = draft
            self.drafts.append({"id": hashlib.md5(key.encode()).hexdigest()[:10], "key": key, "kind": kind,
                                "ts": int(self.now), "date": self.today, "title": _clean(t), "body": _clean(body), "note": note or ""})

    # ---- detectors
    def detect_records(self):
        cur = compute_records(self.d)
        old = self.state.get("records", {})
        broken = []
        for key, r in cur.items():
            prev = old.get(key)
            recent = r.get("ts") and r["ts"] > self.now - 7 * DAY
            if (prev is None and self.first and recent) or (prev is not None and r["value"] > prev["value"]):
                broken.append((key, r, prev, recent))
        groups = {}
        for b in broken:                                   # records set in the same match = one story
            g = b[1].get("link") if (b[1].get("link") or "").startswith("#/match/") else b[0]
            groups.setdefault(g, []).append(b)
        for g, items in groups.items():
            key, r, prev, recent = items[0]
            link = r.get("link") or (f"#/tournament/{r['eventSlug']}" if r.get("eventSlug") else "#/records")
            if len(items) == 1:
                self.emit(f"record:{key}:{r['value']}", "record", f"New record: {r['label'].lower()}",
                          f"{r['holder']}: {r['valueText']}" + (f" ({_clean(r['event'])})" if r.get("event") else ""),
                          link, ts=r.get("ts") if recent else None, draft=self.record_draft(key, r, prev))
            else:
                self.emit("record:" + "+".join(f"{k}:{x['value']}" for k, x, _, _ in items), "record",
                          f"{len(items)} records broken in one map",
                          "; ".join(f"{x['label']}: {x['valueText']}" + (f" ({x['holder']})" if k == "mostKillsMap" else "")
                                    for k, x, _, _ in items),
                          link, ts=r.get("ts") if recent else None, draft=self.records_draft(items))
        self.state["records"] = {k: {"value": r["value"], "holder": r["holder"], "valueText": r["valueText"]} for k, r in cur.items()}

    def _was(self, r, prev):
        if not prev:
            return ""
        if wikilinks.norm(prev["holder"]) == wikilinks.norm(r["holder"]):
            return f" That extends their own previous record of {prev['valueText']}."
        return f" The previous record was {prev['valueText']} ({_clean(prev['holder'])})."

    def records_draft(self, items):
        """Several records from ONE match: lead with the map, then the individual feats."""
        by = {k: (r, prev) for k, r, prev, _ in items}
        r0 = items[0][1]
        ev = self.L(r0["event"]) if r0.get("event") else ""
        paras = []
        if "highestMap" in by:
            r, prev = by["highestMap"]
            w, l = (r["a"], r["b"]) if r["sa"] > r["sb"] else (r["b"], r["a"])
            ot = _ot_periods(r["sa"], r["sb"])
            paras.append(f"{self.L(r['a'])} and {self.L(r['b'])} have played the longest map in BPL history: {r['sa']}-{r['sb']}"
                         f"{' on ' + r['map'] if r['map'] else ''} at {ev}, {r['value']} rounds in total.{self._was(r, prev)}")
            tail = f"{self.L(w)} finally closed it out"
            if "mostOT" in by:
                r2, prev2 = by["mostOT"]
                tail += f" after {r2['value']} overtimes, another league record.{self._was(r2, prev2)}"
            elif ot:
                tail += f" after {ot} overtimes."
            else:
                tail += "."
            paras.append(tail + f" {self.L(l)} will not forget it in a hurry.")
        elif "mostOT" in by:
            r, prev = by["mostOT"]
            paras.append(f"{self.L(r['a'])} and {self.L(r['b'])} needed {r['value']} overtimes to finish {r['sa']}-{r['sb']}"
                         f"{' on ' + r['map'] if r['map'] else ''} at {ev}, a new BPL record.{self._was(r, prev)}")
        if "mostKillsMap" in by:
            r, prev = by["mostKillsMap"]
            paras.append(f"**The star of the show.** {self.L(r['holder'])} dropped {r['value']} kills on that map, the most by any "
                         f"player in a single map.{self._was(r, prev)}")
            p = self.pby.get(r.get("slug"))
            if p:
                paras.append(self.player_line(p))
        hm = by.get("highestMap", (r0, None))[0]
        title = (f"{hm['a']} vs {hm['b']}: one map, {len(items)} BPL records" if "highestMap" in by
                 else f"{len(items)} BPL records fall in one map")
        return (title, "\n\n".join(paras), "")

    def record_draft(self, key, r, prev):
        was = self._was(r, prev)
        ev = self.L(r["event"]) if r.get("event") else ""
        if key == "highestMap":
            w, l = (r["a"], r["b"]) if r["sa"] > r["sb"] else (r["b"], r["a"])
            hi, lo = max(r["sa"], r["sb"]), min(r["sa"], r["sb"])
            ot = _ot_periods(r["sa"], r["sb"])
            body = (f"{self.L(r['a'])} and {self.L(r['b'])} have played the longest map in BPL history: "
                    f"{r['sa']}-{r['sb']}{' on ' + r['map'] if r['map'] else ''} at {ev}, {r['value']} rounds in total.{was}\n\n"
                    f"{self.L(w)} finally closed it out {hi}-{lo}" + (f" after {ot} overtimes." if ot else ".") +
                    f" It is the kind of map nobody involved will forget, and {self.L(l)} can at least say they were part of history.")
            return (f"New record: {r['sa']}-{r['sb']} is the highest-scoring map ever", body, "")
        if key == "mostKillsMap":
            body = (f"{self.L(r['holder'])} dropped {r['value']} kills{' on ' + r['map'] if r['map'] else ''} against "
                    f"{self.L(r['opp'])} at {ev}, the most by any player in a single map.{was}")
            p = self.pby.get(r.get("slug"))
            if p:
                body += "\n\n" + self.player_line(p)
            return (f"{r['holder']} sets a new single-map kill record", body, "")
        if key == "mostOT":
            return (f"New record: {r['value']} overtimes on one map",
                    f"{self.L(r['a'])} and {self.L(r['b'])} needed {r['value']} overtimes to finish "
                    f"{r['sa']}-{r['sb']}{' on ' + r['map'] if r['map'] else ''} at {ev}, a new BPL record.{was}", "")
        if key == "longestWinStreak":
            return (f"{r['holder']} set a new win-streak record",
                    f"{self.L(r['holder'])} have now won {r['value']} matches in a row, the longest win streak in BPL history.{was}", "")
        if key == "mostTitlesTeam":
            return (f"{r['holder']} now hold the most titles in BPL history",
                    f"With {r['value']} event titles, {self.L(r['holder'])} have won more events than any team in BPL history.{was}", "")
        if key == "mostTitlesPlayer":
            return (f"{r['holder']} now holds the most titles of any player",
                    f"{self.L(r['holder'])} has won {r['value']} BPL titles, the most of any player in league history.{was}", "")
        if key == "rankClimb":
            return (f"{r['holder']} makes the biggest rank climb ever",
                    f"{self.L(r['holder'])} climbed {r['value']} places in the player rankings after a single match, "
                    f"the biggest jump the league has ever seen.{was}", "")
        return None

    @staticmethod
    def runner_up(tr):
        if tr.get("runnerUp"):
            return tr["runnerUp"]
        return next((s["name"] for s in (tr.get("finalStandings") or []) if s.get("rank") == 2), None)

    def detect_champions(self):
        champs = [tr for tr in self.d["tournaments"] if tr.get("champion")]
        seen = set(self.state.get("champions", []))
        if not self.first:
            for tr in champs:
                if tr["slug"] not in seen:
                    ts = max((m.get("ts") or 0 for _, _, _, m in _iter_matches(tr)), default=0) or None
                    self.emit(f"champion:{tr['slug']}", "champion", f"{tr['champion']} win {_clean(tr['name'])}",
                              f"Champions of {_clean(tr['name'])}" + (f", beating {self.runner_up(tr)} in the final" if self.runner_up(tr) else ""),
                              f"#/tournament/{tr['slug']}", ts=ts, draft=self.champion_draft(tr))
        self.state["champions"] = [tr["slug"] for tr in champs]

    def champion_draft(self, tr):
        champ, ev = tr["champion"], tr["name"]
        k = wikilinks.norm(champ)
        po = [st for st in (tr.get("stages") or []) if st["format"] == "single_elim"]
        mine = []
        for st in (po[-1:] if po else [None]):
            rounds = st["rounds"] if st else tr.get("bracket", [])
            for rd in rounds:
                for m in rd["matches"]:
                    if not _played(m) or m.get("pl") or m.get("tp"):
                        continue
                    if k in (wikilinks.norm(m.get("a")), wikilinks.norm(m.get("b"))):
                        on_a = wikilinks.norm(m.get("a")) == k
                        opp = m.get("b") if on_a else m.get("a")
                        sf, sa = (m.get("sa"), m.get("sb")) if on_a else (m.get("sb"), m.get("sa"))
                        mine.append((rd.get("title", ""), opp, sf, sa, (m.get("w") == 1) == on_a))
        final = next((x for x in reversed(mine) if x[4]), None)
        lead = _pick(champ + ev, [f"{self.L(champ)} are the {self.L(ev)} champions.",
                                  f"{self.L(ev)} has a winner, and it is {self.L(champ)}."])
        body = [lead + (f" They beat {self.L(final[1])} {final[2]}-{final[3]} in the final to lift the trophy." if final and final[0].lower() == "final" else "")]
        wins = [x for x in mine if x[4]]
        if len(wins) > 1:
            path = [f"{self.L(o)} {f}-{a} ({t.lower()})" for t, o, f, a, w in wins if t.lower() != "final"]
            if path:
                body.append(f"**The run.** On the way to the final they got past {_join(path)}.")
        if tr.get("mvp"):
            mv = tr["mvp"]
            body.append(f"**The MVP.** {self.L(mv['name'])} was the standout player of the event, with {mv.get('mvpRounds')} "
                        f"MVP rounds and {mv.get('kills')} kills.")
        row = next((r for r in tr.get("attending", []) if wikilinks.norm(r.get("team")) == k), None)
        if row and row.get("players"):
            body.append(f"**The roster.** The title-winning line-up: {_join([self.L(p['name']) for p in row['players']])}.")
        pts = TIER_PTS.get(tr.get("tier"))
        team = self.tbyname.get(k)
        tail = []
        if pts:
            tail.append(f"The title is worth {pts} BPL points")
        if team and team.get("rank"):
            tail.append(f"{'and ' if tail else ''}{champ} now sit #{team['rank']} in the BPL ranking")
        if tail:
            body.append(" ".join(tail) + ".")
        note = ""
        if not team:
            note = (f"{champ} has no team page yet. If they are going pro, use Roster Tools, Promote to pro"
                    + (" (Challengers rule: the champion becomes a pro team)." if "challengers" in tr["slug"] else "."))
        return (_pick(ev + champ, [f"{champ} win {ev}", f"{champ} are the {ev} champions"]), "\n\n".join(body), note)

    def detect_promotions(self):
        cur = [t for t in self.d["teams"] if not t.get("provisional")]
        seen = set(self.state.get("proTeams", []))
        self.new_pro = set()
        if not self.first:
            for t in cur:
                if t["slug"] not in seen:
                    self.new_pro.add(wikilinks.norm(t["name"]))
                    roster = t.get("roster") or self.roster_of(t["name"])
                    self.emit(f"promotion:{t['slug']}", "promotion", f"{t['name']} join the pro ranks",
                              f"New pro team" + (f" [{t['tag']}]" if t.get("tag") else "") + (f", {len(roster)} players" if roster else ""),
                              f"#/team/{t['slug']}", draft=self.promotion_draft(t, roster))
        self.state["proTeams"] = [t["slug"] for t in cur]

    def promotion_draft(self, t, roster):
        tag = t.get("tag") or ""
        body = [f"{self.L(t['name'])} are officially a pro team" + (f", playing under the tag {tag}" if tag else "")
                + ("" if tag.endswith(".") else ".")]
        if t.get("origin"):
            body.append(f"They earned their place through {_clean(t['origin'])}.")
        if roster:
            pr = self.page_rank()
            body.append("**The roster.** " + _join([f"{self.L(p['name'])}" + (f" (#{pr[p['slug']]})" if p.get("maps") and p["slug"] in pr else "")
                                                     for p in roster]) + ".")
            best = max((p for p in roster if p.get("maps")), key=lambda p: p.get("ratingPoints") or 0, default=None)
            if best:
                body.append(f"The headline name is {self.L(best['name'])}, currently #{pr[best['slug']]} in the league. " +
                            "Their first ranking points will come at their next event.")
        return (f"{t['name']} join the pro ranks", "\n\n".join(body), "")

    def detect_transfers(self):
        seen = self.state.get("movesSeen", 0)
        if seen > len(self.moves):
            seen = 0
        new = self.moves[seen:] if not self.first else []
        self.state["movesSeen"] = len(self.moves)
        groups = {}                                        # (team, date) -> {"in": [...], "out": [...]}
        for mv in new:
            to, frm = mv.get("to") or "", mv.get("from") or ""
            if wikilinks.norm(to) in self.new_pro:
                continue                                   # the promotion story covers these
            if wikilinks.norm(to) in ("freeagent", ""):
                if wikilinks.norm(frm) in self.tbyname:    # releases from a team page
                    groups.setdefault((self.tbyname[wikilinks.norm(frm)]["name"], mv.get("date")), {"in": [], "out": []})["out"].append(mv)
            elif wikilinks.norm(to) in self.tbyname:       # signings (a move between teams is the buyer's story)
                groups.setdefault((self.tbyname[wikilinks.norm(to)]["name"], mv.get("date")), {"in": [], "out": []})["in"].append(mv)
        for (team, dt), g in groups.items():
            t = self.tbyname.get(wikilinks.norm(team))
            title = self.transfer_title(team, g)
            ins, outs = [m["player"] for m in g["in"]], [m["player"] for m in g["out"]]
            text = "; ".join(x for x in (f"in: {_join(ins)}" if ins else "", f"out: {_join(outs)}" if outs else "") if x)
            key = f"transfer:{wikilinks.norm(team)}:{dt}:{'+'.join(sorted(map(wikilinks.norm, ins + outs)))}"
            self.emit(key, "transfer", title, text, f"#/team/{t['slug']}" if t else "#/transfers",
                      draft=self.transfer_draft(team, g))

    @staticmethod
    def transfer_title(team, g):
        ins, outs = [m["player"] for m in g["in"]], [m["player"] for m in g["out"]]
        few = lambda xs, word: _join(xs) if len(xs) <= 2 else f"{len(xs)} {word}"
        if ins and outs:
            return f"{team} swap {few(outs, 'players')} for {few(ins, 'new faces')}"
        if ins:
            return f"{team} sign {few(ins, 'new players')}"
        return f"{team} part ways with {few(outs, 'players')}"

    def transfer_draft(self, team, g):
        find = lambda nm: next((x for x in self.players if wikilinks.norm(x["name"]) == wikilinks.norm(nm)), None)
        body = []
        outs, ins = g["out"], g["in"]
        if outs and ins:
            body.append(f"{self.L(team)} have reshaped their roster: {_join([self.L(m['player']) for m in outs])} "
                        f"{'is' if len(outs) == 1 else 'are'} out, and {_join([self.L(m['player']) for m in ins])} "
                        f"{'comes' if len(ins) == 1 else 'come'} in.")
        for mv in ins:
            frm = mv.get("from") or ""
            src = "free agency" if wikilinks.norm(frm) in ("freeagent", "") else self.L(frm)
            p = find(mv["player"])
            body.append((f"{self.L(mv['player'])} arrives from {src}." if outs else
                         f"{self.L(team)} have signed {self.L(mv['player'])} from {src}.") + (" " + self.player_line(p) if p else ""))
        for mv in outs:
            p = find(mv["player"])
            body.append((f"{self.L(mv['player'])} leaves as a free agent." if ins else
                         f"{self.L(team)} have released {self.L(mv['player'])}, who is now a free agent.")
                        + (" " + self.player_line(p).replace(f"{self.L(mv['player'])} is ", "They are ", 1) if p else ""))
        roster = self.roster_of(team)
        if roster:
            body.append(f"The updated roster: {_join([self.L(p['name']) for p in roster])}.")
        return (self.transfer_title(team, g), "\n\n".join(body), "")

    def detect_top(self):
        lad = sorted(self.d["players"]["pro"], key=lambda p: -(p["ratingPoints"] if p.get("ratingPoints") is not None else -1))
        top_p = lad[0] if lad else None
        top_t = next((t for t in self.d["teams"] if t.get("rank") == 1), None)
        old = self.state.get("top", {})
        if not self.first:
            if top_p and old.get("player") and old["player"] != top_p["slug"]:
                prev = self.pby.get(old["player"])
                self.emit(f"top:player:{top_p['slug']}:{self.today}", "top", f"{top_p['name']} is the new #1",
                          f"Top of the player rankings at {top_p['ratingPoints']} points" + (f", passing {prev['name']}" if prev else ""),
                          f"#/player/{top_p['slug']}",
                          draft=(f"{top_p['name']} is the new #1",
                                 f"{self.L(top_p['name'])} has taken over the #1 spot in the BPL player rankings with "
                                 f"{top_p['ratingPoints']} rating points" + (f", moving past {self.L(prev['name'])}" if prev else "") + ".\n\n"
                                 + self.player_line(top_p).replace(" ranked #1 in the league (", ", now the top-ranked player in the league (", 1), ""))
            if top_t and old.get("team") and old["team"] != top_t["slug"]:
                prev = self.tby.get(old["team"])
                self.emit(f"top:team:{top_t['slug']}:{self.today}", "top", f"{top_t['name']} take over #1",
                          f"Top of the BPL ranking with {top_t.get('rank_points')} points", f"#/team/{top_t['slug']}",
                          draft=(f"{top_t['name']} take over #1 in the BPL ranking",
                                 f"{self.L(top_t['name'])} now lead the BPL ranking with {top_t.get('rank_points')} points" +
                                 (f", ahead of {self.L(prev['name'])} ({prev.get('rank_points')} points)" if prev else "") + ".", ""))
        self.state["top"] = {"player": top_p["slug"] if top_p else None, "team": top_t["slug"] if top_t else None}

    def detect_milestones(self):
        old = self.state.get("milestones", {})
        new = {}
        for p in self.d["players"]["pro"]:
            cur = {"maps": p.get("maps") or 0, "kills": p.get("kills") or 0, "mvp": p.get("mvp") or 0}
            new[p["slug"]] = cur
            prev = old.get(p["slug"])
            if self.first or not prev:
                continue
            for metric, steps in MILESTONES.items():
                for s in steps:
                    if prev[metric] < s <= cur[metric]:
                        what = {"maps": "maps played", "kills": "career kills", "mvp": "MVP rounds"}[metric]
                        self.emit(f"milestone:{p['slug']}:{metric}:{s}", "milestone", f"{p['name']}: {s} {what}",
                                  f"{p['name']} reached {s} {what}", f"#/player/{p['slug']}")
        self.state["milestones"] = new

    # ---- live (recomputed every build; not logged)
    def strengths(self, tr):
        out = {}
        for row in tr.get("attending", []):
            pts = [self.pby[pl["slug"]].get("ratingPoints") for pl in row.get("players", [])
                   if pl.get("slug") in self.pby and self.pby[pl["slug"]].get("ratingPoints") is not None]
            if len(pts) >= 3:
                out[wikilinks.norm(row["team"])] = sum(pts) / len(pts)
        return out

    def upsets(self, since):
        out = []
        for tr in self.d["tournaments"]:
            st_ = None
            for ref, rtitle, st, m in _iter_matches(tr):
                if not _played(m) or not m.get("ts") or m["ts"] <= since:
                    continue
                st_ = st_ or self.strengths(tr)
                w, l = (m["a"], m["b"]) if m["w"] == 1 else (m["b"], m["a"])
                sw, sl = st_.get(wikilinks.norm(w)), st_.get(wikilinks.norm(l))
                if sw is None or sl is None or sl - sw < UPSET_CARD:
                    continue
                score = f"{m['sa']}-{m['sb']}" if m["w"] == 1 else f"{m['sb']}-{m['sa']}"
                where = f"{st['name']}, {rtitle.lower()}" if st and st.get("format") == "swiss" else rtitle.lower()
                out.append({"gap": round(sl - sw), "w": w, "l": l, "score": score, "event": tr["name"], "slug": tr["slug"],
                            "ref": ref, "round": where, "ts": m["ts"], "wa": round(sw), "la": round(sl), "m": m})
        out.sort(key=lambda x: -x["gap"])
        return out

    def detect_upsets(self):
        seen = set(self.state.get("upsetsSeen", []))
        for u in self.upsets(self.now - 7 * DAY):
            key = f"upset:{u['slug']}:{u['ref']}"
            if u["gap"] >= UPSET_DRAFT and key not in seen and not self.first:
                top = None
                for mp in (u["m"].get("stats") or {}).get("maps", []):
                    for pl in mp.get("players", []):
                        if wikilinks.norm(pl.get("team")) == wikilinks.norm(u["w"]):
                            if top is None or (pl.get("k") or 0) > top[1]:
                                top = (pl.get("name"), pl.get("k") or 0)
                body = (f"{self.L(u['w'])} beat {self.L(u['l'])} {u['score']} at {self.L(u['event'])}"
                        f"{' (' + u['round'] + ')' if u['round'] else ''}. On paper it was a mismatch: {u['l']}'s line-up "
                        f"averages {u['la']} rating points, {u['w']}'s just {u['wa']}.")
                if top:
                    body += f"\n\n{self.L(top[0])} led the way with {top[1]} kills."
                self.emit(key, "upset", f"{u['w']} stun {u['l']}", f"{u['score']} at {_clean(u['event'])}",
                          f"#/match/{u['slug']}/{u['ref']}", ts=u["ts"], draft=(f"{u['w']} stun {u['l']}", body, ""))
            seen.add(key)
        self.state["upsetsSeen"] = sorted(seen)[-300:]

    def live_cards(self):
        cards = []
        for tr in self.d["tournaments"]:
            if tr["slug"] not in self.manual or tr.get("champion") or not tr.get("stages"):
                continue
            man = _load(os.path.join(self.dir, "manual", tr["slug"] + ".json"), {})
            po = next((st for st in reversed(tr["stages"]) if st["format"] == "single_elim"), None)
            seeded = po and any((t[0] if isinstance(t, (list, tuple)) else t) for t in po.get("teams", []))
            if po and seeded:
                pend = [(rd, m) for rd in po["rounds"] for m in rd["matches"]
                        if not m.get("w") and m.get("a") and m.get("b") and m.get("b") != "(bye)" and not (m.get("pl") or m.get("tp"))]
                if pend:
                    rd0 = min(pend, key=lambda x: x[0]["round"])[0]
                    ms = [m for rd, m in pend if rd is rd0]
                    if rd0.get("title", "").lower() == "final" and len(ms) == 1:
                        cards.append({"kind": "live", "label": "Grand final", "title": f"{ms[0]['a']} vs {ms[0]['b']}",
                                      "text": f"{_clean(tr['name'])}: one match for the title", "link": f"#/tournament/{tr['slug']}"})
                    else:
                        cards.append({"kind": "live", "label": "Playoffs", "title": f"{_clean(tr['name'])}: {rd0.get('title')}",
                                      "text": "; ".join(f"{m['a']} vs {m['b']}" for m in ms[:4]), "link": f"#/tournament/{tr['slug']}"})
                continue
            groups = [st for st in tr["stages"] if st["format"] == "swiss"]
            if groups:
                totals = {st["id"]: st.get("rounds", 5) for st in man.get("stages", [])}
                cur = [max((rd["round"] for rd in st["rounds"]), default=1) for st in groups]
                left = sum(1 for st in groups for rd in st["rounds"] for m in rd["matches"] if not m.get("w"))
                total = max(totals.get(st["id"], 5) for st in groups)
                lo, hi = min(cur), max(cur)
                cards.append({"kind": "live", "label": "On now", "title": _clean(tr["name"]),
                              "text": f"Group stage: {left} match{'es' if left != 1 else ''} to play "
                                      + (f"(round {lo} of {total})" if lo == hi else f"(groups between round {lo} and {hi} of {total})")
                                      + (". Top 2 in each group reach the playoffs." if po else "."),
                              "link": f"#/tournament/{tr['slug']}"})
        return cards

    def cards(self):
        out = self.live_cards()
        recent_log = sorted(self.log, key=lambda e: -e["ts"])
        windows = {"record": 30, "champion": 14, "promotion": 14, "top": 14, "transfer": 7, "milestone": 7, "upset": 7}
        labels = {"record": "New record", "champion": "Champions", "promotion": "Promoted", "top": "New #1",
                  "transfer": "Transfer", "milestone": "Milestone", "upset": "Upset"}
        shown_upset = False
        for e in recent_log:
            if self.now - e["ts"] <= windows.get(e["type"], 7) * DAY:
                out.append({"kind": e["type"], "label": labels.get(e["type"], e["type"]), "title": e["title"], "text": e["text"],
                            "link": e["link"], "ts": e["ts"]})
                shown_upset = shown_upset or e["type"] == "upset"
        ups = self.upsets(self.now - 7 * DAY)
        if ups and not shown_upset:
            u = ups[0]
            out.append({"kind": "upset", "label": "Upset of the week", "title": f"{u['w']} beat {u['l']} {u['score']}",
                        "text": f"Line-ups averaging {u['wa']} vs {u['la']} rating points ({_clean(u['event'])})",
                        "link": f"#/match/{u['slug']}/{u['ref']}", "ts": u["ts"]})
        cl = [c for c in self.climbers if c["gain"] >= 3][:3]
        if cl:
            out.append({"kind": "climbers", "label": "Climbers this week", "title": "Biggest rank gains",
                        "items": [{"name": self.pby[c["slug"]]["name"], "link": f"#/player/{c['slug']}",
                                   "val": f"▲{c['gain']} to #{c['to']}"} for c in cl if c["slug"] in self.pby],
                        "link": f"#/player/{cl[0]['slug']}"})
        hot = sorted((t for t in self.d["teams"] if (t.get("streak") or "").startswith("W") and int(t["streak"][1:] or 0) >= 3),
                     key=lambda t: -int(t["streak"][1:]))[:3]
        if hot:
            out.append({"kind": "streak", "label": "On fire", "title": "Longest current win streaks",
                        "items": [{"name": t["name"], "link": f"#/team/{t['slug']}", "val": f"{t['streak'][1:]} wins"} for t in hot],
                        "link": f"#/team/{hot[0]['slug']}"})
        if not any(c["kind"] == "champion" for c in out):
            done = []
            for tr in self.d["tournaments"]:
                if tr.get("champion"):
                    ts = max((m.get("ts") or 0 for _, _, _, m in _iter_matches(tr)), default=0)
                    if ts and self.now - ts <= 14 * DAY:
                        done.append((ts, tr))
            if done:
                ts, tr = max(done, key=lambda x: x[0])
                out.append({"kind": "champion", "label": "Latest champions", "title": f"{tr['champion']} win {_clean(tr['name'])}",
                            "text": f"Beat {self.runner_up(tr)} in the final" if self.runner_up(tr) else "Event complete",
                            "link": f"#/tournament/{tr['slug']}", "ts": ts})
        return out[:8]

    def run(self):
        self.detect_records()
        self.detect_champions()
        self.detect_promotions()
        self.detect_transfers()
        self.detect_top()
        self.detect_milestones()
        self.detect_upsets()
        self.state["v"] = 1
        self.state["drafted"] = sorted(self.drafted)
        self.log = sorted(self.log, key=lambda e: e["ts"])[-200:]
        _save(os.path.join(self.dir, "storyline_state.json"), self.state)
        _save(os.path.join(self.dir, "storyline_log.json"), self.log)
        _save(os.path.join(self.dir, "article_drafts.json"), self.drafts)
        cards = self.cards()
        print(f"storylines: {len(cards)} card(s), {len(self.drafts)} draft(s) waiting" + (" [first run: state recorded]" if self.first else ""))
        return cards


def run(data, data_dir, climbers=None, now=None):
    return Storylines(data, data_dir, climbers, now or time.time()).run()
