#!/usr/bin/env python3
"""Live player bios, regenerated on EVERY build from the finished data (called near the end of
parse.py), so a bio always matches the player's current team, role, rank, stats and results.

Facts used: current team + tenure (or free agent / the ad-hoc team they're playing for in a live
event), league rank + recent movement, stats framed against the league (role-aware), titles,
event MVP awards, Hall of Fame, previous pro teams, and the most recent event result.

Hand-written lore lives in data/player_bio_notes.json:
    { "<normkey>": {"note": "...", "team": "<team when written>", "role": "<role>", "titles": N} }
A note is appended only while the player's team, role and title count still match what it was
written against; the moment any of them changes the note retires itself (reported in the build
log), so hand-written prose can never contradict the live stats.
Style rules: no em dashes, "team" never "side".
"""
import hashlib, json, math, os, re, unicodedata

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
    "vietnam": "Vietnamese", "china": "Chinese", "india": "Indian", "brazil": "Brazilian",
    "spain": "Spanish", "mexico": "Mexican", "denmark": "Danish", "norway": "Norwegian",
}
ROLE = {"igl": "in-game leader", "awper": "AWPer", "awp": "AWPer", "rifler": "rifler",
        "fill": "support player", "support": "support player", "flex": "flex player"}
ORD_WORD = {1: "first", 2: "second", 3: "third", 4: "fourth", 5: "fifth", 6: "sixth",
            7: "seventh", 8: "eighth", 9: "ninth", 10: "tenth"}
NUM_WORD = {1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven", 8: "eight",
            9: "nine", 10: "ten"}
TIER_ORDER = {"major": 0, "s": 1, "a": 2, "b": 3, "c": 4}

def norm(s):
    s = unicodedata.normalize("NFKD", s or "")
    return re.sub(r"[^a-z0-9]", "", s.lower())

def pick(seed, options):
    """Deterministic phrasing choice, so a bio only changes when its facts change."""
    return options[int(hashlib.md5(seed.encode()).hexdigest(), 16) % len(options)]

def cap(s):
    return s[:1].upper() + s[1:] if s else s

def join_list(xs):
    xs = [x for x in xs if x]
    return xs[0] if len(xs) == 1 else ", ".join(xs[:-1]) + " and " + xs[-1] if xs else ""

def pron(gender):
    if gender == "M":
        return {"he": "he", "his": "his", "him": "him", "has": "has", "is": "is", "was": "was"}
    if gender == "F":
        return {"he": "she", "his": "her", "him": "her", "has": "has", "is": "is", "was": "was"}
    return {"he": "they", "his": "their", "him": "them", "has": "have", "is": "are", "was": "were"}

def wr_frac(v):
    try:
        v = float(str(v).rstrip("%"))
    except (TypeError, ValueError):
        return None
    return v / 100 if v > 1 else v

def top_pct(pct):
    """0.97 percentile -> 'top 3%'."""
    return f"top {max(1, math.ceil((1 - pct) * 100))}%"

def result_phrase(res, rank):
    r = (res or "").lower()
    if r == "champion": return "winning the title"
    if r == "runner-up": return "finishing as runner-up"
    if r == "3rd place": return "finishing third"
    if r == "4th place": return "finishing fourth"
    if "semifinal" in r: return "reaching the semifinals"
    if "quarterfinal" in r: return "reaching the quarterfinals"
    if r.startswith("round of"): return f"going out in the {res}"
    if "group" in r: return "going out in the group stage"
    if rank == 1: return "winning the title"
    if rank == 2: return "finishing as runner-up"
    if rank and rank <= 4: return "finishing in the top four"
    if rank and rank <= 8: return "finishing in the top eight"
    return f"finishing #{rank}" if rank else ""


class BioEngine:
    def __init__(self, players, tournaments, teams, hall_of_fame, genders, notes, rank_climb=None):
        self.rank_climb = rank_climb or {}
        self.players = players
        self.genders = genders
        self.notes = notes
        self.hof = {x.get("slug") for x in (hall_of_fame or {}).get("players", [])}
        self.team_by_name = {norm(t["name"]): t for t in teams}
        # league rank = EXACTLY the Players page order: the pro list, stable-sorted by Rating Points
        # (null last). Sorting by the 3-decimal rating instead mis-orders ties (1.103 vs 1.103).
        ladder = [p for p in players if p.get("pool") != "solo"]
        ladder = sorted(ladder, key=lambda p: -(p["ratingPoints"] if p.get("ratingPoints") is not None else -1))
        self.rank = {p["slug"]: i + 1 for i, p in enumerate(ladder)}
        self.n_ranked = len(ladder)
        ranked = [p for p in ladder if (p.get("maps") or 0) > 0 and p.get("rating") is not None]
        sample = [p for p in ranked if (p.get("maps") or 0) >= 5]
        self.kd_sorted = sorted(p.get("kdr") or 0 for p in sample)
        self.wr_sorted = sorted(wr_frac(p.get("winrate")) or 0 for p in sample)
        self.mvp_sorted = sorted((p.get("mvp") or 0) / max(1, p.get("maps") or 1) for p in sample)
        self.events = self._participation(tournaments)
        self.retired_notes = []

    @staticmethod
    def _pct(sorted_vals, v):
        if not sorted_vals:
            return 0.5
        lo = sum(1 for x in sorted_vals if x < v)
        return lo / len(sorted_vals)

    def _participation(self, tournaments):
        """slug -> chronological [{event, date, tier, team, result, rank, live}]."""
        out = {}
        for tr in tournaments:
            if not tr.get("date"):
                continue
            fs = tr.get("finalStandings") or []
            st = tr.get("standings") or []
            by_slug, by_name = {}, {}
            for row in (fs or st):
                if row.get("teamSlug"):
                    by_slug[row["teamSlug"]] = row
                by_name[norm(row.get("name"))] = row
            live = not tr.get("champion")
            champ = {norm(tr.get("champion")), norm(tr.get("championTeam"))} - {""}
            ru = {norm(tr.get("runnerUp")), norm(tr.get("runnerUpTeam"))} - {""}
            for row in tr.get("attending", []):
                srow = by_slug.get(row.get("teamSlug")) or by_name.get(norm(row.get("team")))
                if not fs:
                    # raw Challonge ranks aren't placements (group-only events, swiss); trust only the
                    # event's recorded champion / runner-up
                    keys = {norm(row.get("team")), norm(row.get("teamSlug"))} - {""}
                    srow = ({"rank": 1, "result": "Champion"} if keys & champ else
                            {"rank": 2, "result": "Runner-up"} if keys & ru else None)
                for pl in row.get("players", []):
                    if not pl.get("slug"):
                        continue
                    out.setdefault(pl["slug"], []).append({
                        "event": tr["name"], "date": tr["date"], "tier": tr.get("tier"),
                        "team": row.get("team"), "live": live,
                        "result": (srow or {}).get("result"), "slug": tr["slug"],
                        "rank": (srow or {}).get("rank"),
                    })
        for v in out.values():
            v.sort(key=lambda e: e["date"])
        return out

    # ------------------------------------------------------------------ sentences
    def s_identity(self, p, P, seed):
        name = p["name"]
        aka = [a for a in (p.get("aka") or []) if a and norm(a) != norm(name)]
        who = f"{name} (formerly known as {join_list(aka[-2:])})" if aka else name
        nat = NAT_ADJ.get((p.get("nat") or "").lower(), "")
        role = ROLE.get((p.get("role") or "").strip().lower(), "")
        descr = " ".join(x for x in (nat, role or "player") if x)
        art = "an" if descr[:1].lower() in "aeiou" else "a"
        team = (p.get("team") or "").strip()
        if team and p.get("teamTourney"):
            where = pick(seed + "lt", [f"currently competing for {team} at {p['teamTourney']}",
                                       f"suiting up for {team} at {p['teamTourney']}"])
        elif team:
            where = f"playing for {team}"
            hist = next((h for h in (p.get("teamHistory") or []) if norm(h.get("team")) == norm(team)), None)
            yrs = sorted({int(y) for y in (hist or {}).get("years", []) if str(y).isdigit()})
            if len(yrs) >= 2:
                run = 1
                for a, b in zip(yrs[::-1], yrs[-2::-1]):
                    if a - b == 1:
                        run += 1
                    else:
                        break
                if run >= 2:
                    where = f"in {P['his']} {ORD_WORD.get(run, str(run) + 'th')} straight year with {team}"
                else:
                    where = f"playing for {team}, a team {P['he']} first joined in {yrs[0]}"
        else:
            where = pick(seed + "fa", [", currently a free agent", ", currently without a team"])
        return f"{who} is {art} {descr}{'' if where.startswith(',') else ' '}{where}."

    def s_standing(self, p, P, seed):
        maps = p.get("maps") or 0
        ss = p.get("soloStats") or {}
        if p.get("pool") == "solo" or not maps:
            if p.get("pool") == "solo" and p.get("soloRank"):
                return (f"{cap(P['he'])} {P['has']} yet to play a BPL tournament map, but {P['is']} "
                        f"ranked #{p['soloRank']} in Solo Queue at {p.get('ratingPoints')} points "
                        f"(Level {p.get('level')}).")
            if ss.get("soloRank"):
                return (f"{cap(P['he'])} {P['has']} yet to play a tournament map, but {P['is']} ranked "
                        f"#{ss['soloRank']} of {ss.get('soloTotal')} in Solo Queue.")
            return f"{cap(P['he'])} {P['has']} yet to play a recorded map, so the story is still unwritten."
        r, n = self.rank.get(p["slug"]), self.n_ranked
        pts, lvl = p.get("ratingPoints"), p.get("level")
        if not r:
            return ""
        if r == 1:
            s = f"{cap(P['he'])} {P['is']} the highest-rated player in the league, sitting at {pts} points (Level {lvl})."
        elif r <= 10:
            s = pick(seed + "t10", [
                f"Ranked #{r} in the league at {pts} points, {P['he']} {P['is']} one of the ten best players in BPL right now.",
                f"{cap(P['he'])} {P['is']} a top-ten player in the league, #{r} at {pts} points (Level {lvl})."])
        elif r <= n * 0.25:
            s = f"Ranked #{r} of {n} at {pts} points (Level {lvl}), {P['he']} {P['is']} in the league's top quarter."
        elif r <= n * 0.6:
            s = f"{cap(P['he'])} {P['is']} ranked #{r} of {n} in the league, at Level {lvl} with {pts} points."
        else:
            s = f"At #{r} of {n} (Level {lvl}, {pts} points), {P['he']} {P['is']} still working up the ladder."
        if p.get("provisional"):
            s = s[:-1] + f", on a provisional rating after {maps} map{'s' if maps != 1 else ''}."
        d = p.get("rankDelta") or 0
        if d >= 5:
            s += f" {cap(P['his'])} latest results lifted {P['him']} {d} places."
        elif d <= -5:
            s += f" {cap(P['he'])} slipped {-d} places after {P['his']} latest results."
        return s

    def s_stats(self, p, P, seed):
        maps = p.get("maps") or 0
        if p.get("pool") == "solo" or not maps:
            return ""
        kdr = p.get("kdr") or 0
        wr = wr_frac(p.get("winrate"))
        wr_s = f"{round((wr or 0) * 100)}%"
        if maps < 5:
            return f"Through {maps} map{'s' if maps != 1 else ''} so far, {P['he']} {P['has']} a {kdr:.2f} K/D."
        k = self._pct(self.kd_sorted, kdr)
        w = self._pct(self.wr_sorted, wr or 0)
        mv = self._pct(self.mvp_sorted, (p.get("mvp") or 0) / maps)
        role = (p.get("role") or "").lower()
        weapon = " behind the AWP" if role in ("awper", "awp") else ""
        if k >= 0.85 and w >= 0.6:
            s = pick(seed + "s1", [
                f"The numbers back it up: a {kdr:.2f} K/D{weapon} ({top_pct(k)} in the league) and a {wr_s} map win rate across {maps} maps.",
                f"{cap(P['he'])} {P['is']} a genuine difference maker{weapon}, with a {kdr:.2f} K/D ({top_pct(k)}) and {wr_s} of {maps} maps won."])
        elif k >= 0.85:
            s = (f"A natural fragger{weapon}, {P['he']} {P['has']} a {kdr:.2f} K/D ({top_pct(k)} in the league), "
                 f"though {P['his']} teams have won only {wr_s} of {P['his']} {maps} maps.")
        elif w >= 0.8 and k < 0.45:
            lead = (f"{cap(P['his'])} value is in the calling" if role == "igl"
                    else "The raw numbers are modest")
            s = f"{lead}: a {kdr:.2f} K/D, but {P['his']} teams win, taking {wr_s} of {P['his']} {maps} maps."
        elif k < 0.2 and w < 0.3:
            s = f"It has been a tough run on paper, with a {kdr:.2f} K/D and a {wr_s} win rate across {maps} maps."
        elif k < 0.2:
            s = f"{cap(P['his'])} {kdr:.2f} K/D sits near the bottom of the league, but {P['his']} teams have taken {wr_s} of {maps} maps."
        else:
            s = f"{cap(P['he'])} {P['has']} a {kdr:.2f} K/D and a {wr_s} win rate across {maps} maps."
        if mv >= 0.85:
            s += f" {P['his'].capitalize()} {p.get('mvp')} MVP rounds rank in the league's {top_pct(mv)}."
        return s

    def s_honours(self, p, P, seed):
        titles = p.get("titles") or []
        parts = []
        if titles:
            best = sorted(titles, key=lambda t: (TIER_ORDER.get(t.get("tier"), 9), -int(t.get("year") or 0)))[0]
            majors = sum(1 for t in titles if t.get("tier") == "major")
            n = len(titles)
            if n >= 2:
                extra = f", including {NUM_WORD.get(majors, majors)} Major{'s' if majors != 1 else ''}" if majors else ""
                parts.append(pick(seed + "h", [
                    f"A {NUM_WORD.get(n, n)}-time BPL champion{extra}, {P['his']} biggest trophy is the {best['event']}.",
                    f"{cap(P['he'])} {P['has']} won {NUM_WORD.get(n, n)} BPL titles{extra}, headlined by the {best['event']}."]))
            else:
                parts.append(f"{cap(P['he'])} won the {best['event']}" + (f" with {best['team']}." if best.get("team") else "."))
        else:
            ev = self.events.get(p["slug"], [])
            done = [e for e in ev if not e["live"] and e.get("rank")]
            finals = [e for e in done if e["rank"] == 2]
            if len(finals) >= 2:
                parts.append(f"{cap(P['he'])} {P['has']} reached {NUM_WORD.get(len(finals), len(finals))} finals but {P['is']} still chasing a first title.")
            elif finals:
                parts.append(f"{cap(P['his'])} best finish is a runner-up run at the {finals[-1]['event']}.")
            else:
                deep = [e for e in done if e["rank"] <= 4]
                if deep:
                    parts.append(f"{cap(P['his'])} best finish is a top-four run at the {deep[-1]['event']}.")
        aw = p.get("mvpAwards") or []
        if len(aw) >= 2:
            parts.append(f"{cap(P['he'])} {P['has']} been named event MVP {'twice' if len(aw) == 2 else NUM_WORD.get(len(aw), len(aw)) + ' times'}, most recently at the {aw[-1]['event']}.")
        elif aw:
            parts.append(f"{cap(P['he'])} {P['was']} named MVP of the {aw[0]['event']}.")
        if self.rank_climb.get("slug") == p["slug"]:
            parts.append(f"{cap(P['he'])} {P['has']} the league record for the biggest single rank climb, +{self.rank_climb.get('delta')} places.")
        if p["slug"] in self.hof:
            parts.append(f"{cap(P['he'])} {P['is']} a BPL Hall of Fame inductee.")
        return " ".join(parts)

    def s_career(self, p, P, seed):
        team = norm(p.get("team"))
        prev = [h["team"] for h in (p.get("teamHistory") or [])
                if h.get("isPro") and norm(h.get("team")) != team]
        prev = list(dict.fromkeys(prev))[-3:]
        ev = [e for e in self.events.get(p["slug"], [])]
        out = []
        if prev:
            if p.get("team") and not p.get("teamTourney"):
                out.append(f"Before {p['team']}, {P['he']} played for {join_list(prev)}.")
            else:
                out.append(f"{cap(P['he'])} previously played for {join_list(prev)}.")
        if len(ev) >= 3:
            first, lastyr = ev[0]["date"][:4], ev[-1]["date"][:4]
            span = f"all in {first}" if first == lastyr else f"since {first}"
            out.append(f"{cap(P['he'])} {P['has']} played {len(ev)} BPL events, {span}.".replace(", since", " since"))
        return " ".join(out)

    def s_recent(self, p, P, seed):
        ev = self.events.get(p["slug"], [])
        club = [e for e in ev if "qualifier" not in e["slug"]]
        if not club:
            return ""
        last = club[-1]
        if last["live"]:
            if p.get("teamTourney") == last["event"]:
                return ""                               # already said in the identity line
            return f"{cap(P['he'])} {P['is']} currently competing at the {last['event']} with {last['team']}."
        res = result_phrase(last.get("result"), last.get("rank"))
        if not res:
            return f"{cap(P['his'])} most recent event was the {last['event']} with {last['team']}."
        if res == "winning the title" and (p.get("titles") or []):
            return f"Most recently, {P['he']} lifted the {last['event']} with {last['team']}."
        if "nations-cup" in last["slug"]:
            return f"{cap(P['he'])} most recently represented {last['team']} at the {last['event']}, {res}."
        return f"{cap(P['his'])} most recent outing was the {last['event']} with {last['team']}, {res}."

    def note_for(self, k, p):
        n = self.notes.get(k)
        if not n or not n.get("note"):
            return ""
        live = {"team": norm(p.get("team")), "role": norm(p.get("role")), "titles": len(p.get("titles") or [])}
        rec = {"team": norm(n.get("team")), "role": norm(n.get("role")), "titles": int(n.get("titles") or 0)}
        if live != rec:
            self.retired_notes.append(p["name"])
            return ""
        return n["note"].strip()

    def bio(self, p):
        k = norm(p["name"])
        g = self.genders.get(k)
        if g in ("M", "F"):
            p["gender"] = g
        P = pron(p.get("gender") if p.get("gender") in ("M", "F") else g)
        seed = k
        parts = [self.s_identity(p, P, seed), self.s_standing(p, P, seed), self.s_stats(p, P, seed),
                 self.s_honours(p, P, seed), self.s_career(p, P, seed), self.s_recent(p, P, seed),
                 self.note_for(k, p)]
        text = " ".join(x for x in parts if x)
        text = text.replace("—", ", ").replace("–", "-")           # house style: no em dashes
        return re.sub(r"\s+", " ", text).replace(" ,", ",").replace("the the ", "the ").strip()


def build_bios(pro, amateur, solo, tournaments, teams, hall_of_fame, data_dir, rank_climb=None):
    """Regenerate every player's bio in place and write data/player_bios.json (for reference)."""
    gp = os.path.join(data_dir, "player_gender.json")
    genders = json.load(open(gp, encoding="utf-8")) if os.path.exists(gp) else {}
    np_ = os.path.join(data_dir, "player_bio_notes.json")
    notes = json.load(open(np_, encoding="utf-8")) if os.path.exists(np_) else {}
    players = pro + amateur + solo
    eng = BioEngine(players, tournaments, teams, hall_of_fame, genders, notes, rank_climb)
    out = {}
    for p in players:
        p["bio"] = eng.bio(p)
        out[norm(p["name"])] = {"gender": p.get("gender") if p.get("gender") in ("M", "F") else "NB",
                                "bio": p["bio"]}
    json.dump(out, open(os.path.join(data_dir, "player_bios.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    msg = f"bios: regenerated {len(out)} from live data"
    if eng.retired_notes:
        msg += f"; {len(eng.retired_notes)} lore note(s) retired as stale: {', '.join(eng.retired_notes[:10])}"
    print(msg)
