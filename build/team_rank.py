#!/usr/bin/env python3
"""BPL team ranking (from 2026-10-05): opponent-weighted placement points + a results Elo, with the
HLTV-style core rule and a 2-year half-life.

  team points = sum over completed events of
                  placement points x tier x 2-year decay x FIELD x CORE
              + BETA x CORE_now x (results Elo - 1500)      (a penalty is capped at half the placement points)

  FIELD  how strong the teams you beat in that event were, blended 50/50 with the whole field
         (0.6x .. 1.4x). A title won against top teams is worth more than one won against weak ones.
  Elo    every match of every COMPLETED event since 2020, opponent-aware (in-progress events don't
         move team rankings until they finish). Ad-hoc / national squads have no page or Elo of their
         own: their strength comes from their five players' Rating Points. Ratings fade back toward
         1500 with the same 2-year half-life while a team is inactive.
  CORE   a result keeps full value while 3+ of the 5 players who earned it are still on the team;
         2 remaining -> 60%, 1 -> 35%, none -> 20% (credit to the organization).

SCALE / ALPHA were calibrated on the 2,266 recorded team results (2026-10-05): team results are close
to a coin flip on paper, so the Elo part stays a supporting term and titles remain the main currency.
"""
import re, unicodedata
from collections import defaultdict
from datetime import date

SCALE, ALPHA, K, BETA = 600, 0.2, 32, 1.0
FIELD_DIV, FMIN, FMAX = 500, 0.6, 1.4
FORM_FLOOR = 0.5            # the results-Elo penalty is capped at this share of a team's placement points
HALF = 730
CORE = {3: 1.0, 2: 0.6, 1: 0.35, 0: 0.2}


def norm(s):
    s = unicodedata.normalize("NFKD", s or "")
    return re.sub(r"[^a-z0-9]", "", s.lower())


def _pdate(s):
    y, m, d = (int(x) for x in s.split("-")); return date(y, m, d)


def _core(event_roster, current):
    if not event_roster or not current:
        return 1.0
    return CORE[min(3, len(event_roster & current))]


def apply(teams, tournaments, players, tier_mult, placement_points, group_points):
    pts_of = {p["slug"]: p["ratingPoints"] for p in players if p.get("ratingPoints") is not None}
    by = {t["slug"]: t for t in teams}
    current = {t["slug"]: {r["slug"] for r in t.get("roster", []) if r.get("slug")} for t in teams}
    done = sorted((tr for tr in tournaments if tr.get("champion") and tr.get("date")), key=lambda t: t["date"])

    # ---------------------------------------------------------------- one chronological pass
    elo, last = defaultdict(lambda: 1500.0), {}
    beaten, faced, field, ev_roster = defaultdict(list), defaultdict(list), {}, {}
    snaps = {}                                             # date -> (elo copy, last copy) after that date

    def decayed(s, when):
        if s in last:
            elo[s] = 1500 + (elo[s] - 1500) * 0.5 ** (max(0, (when - last[s]).days) / HALF)
        last[s] = when
        return elo[s]

    for i, tr in enumerate(done):
        when = _pdate(tr["date"])
        att = {norm(r["team"]): r for r in tr.get("attending", [])}
        for r in tr.get("attending", []):
            if r.get("teamSlug"):
                ev_roster[(r["teamSlug"], tr["slug"])] = {pl["slug"] for pl in r.get("players", []) if pl.get("slug")}

        def adhoc(name):
            r = att.get(norm(name))
            ps = [pts_of[pl["slug"]] for pl in (r or {}).get("players", []) if pl.get("slug") in pts_of]
            return (1500 + ALPHA * (sum(ps) / len(ps) - 1150), 1.0) if len(ps) >= 3 else (1500.0, 0.5)
        ms = ([(st["id"] * 1000 + rd["round"], m) for st in tr["stages"] for rd in st["rounds"] for m in rd["matches"]]
              if tr.get("stages") else [(rd["round"], m) for rd in tr.get("bracket", []) for m in rd["matches"]])
        strengths = []
        for _, m in sorted(ms, key=lambda x: (x[0], x[1].get("ts") or 0)):
            if m.get("w") not in (1, 2) or "(bye)" in (m.get("a"), m.get("b")):
                continue
            sides = []
            for nm, slug in ((m.get("a"), m.get("aTeam")), (m.get("b"), m.get("bTeam"))):
                sides.append((slug, decayed(slug, when), 1.0) if slug else (None,) + adhoc(nm))
            (sa, ea, wa), (sb, eb, wb) = sides
            strengths += [ea, eb]
            E = 1 / (1 + 10 ** ((eb - ea) / SCALE))
            y = 1 if m["w"] == 1 else 0
            wgt = min(wa, wb)
            if sa:
                elo[sa] += K * wgt * (y - E); faced[(sa, tr["slug"])].append(eb)
                if y == 1:
                    beaten[(sa, tr["slug"])].append(eb)
            if sb:
                elo[sb] -= K * wgt * (y - E); faced[(sb, tr["slug"])].append(ea)
                if y == 0:
                    beaten[(sb, tr["slug"])].append(ea)
        field[tr["slug"]] = sum(strengths) / len(strengths) if strengths else 1500.0
        if i == len(done) - 1 or done[i + 1]["date"] != tr["date"]:
            snaps[tr["date"]] = (dict(elo), dict(last))

    def field_mult(ts, ev):
        opp = beaten.get((ts, ev)) or faced.get((ts, ev)) or [field[ev]]
        S = 0.5 * (sum(opp) / len(opp)) + 0.5 * field[ev]
        return max(FMIN, min(FMAX, 1 + (S - 1500) / FIELD_DIV))

    def table(asof, rosters, elo_s, last_s, with_breakdown=False):
        """Team points as of `asof`: completed events up to that date, decayed to it."""
        ref = _pdate(asof)
        tot, bd = defaultdict(float), defaultdict(list)
        latest_ev = {}
        for tr in done:
            if tr["date"] > asof:
                break
            w = 0.5 ** ((ref - _pdate(tr["date"])).days / HALF)
            mult = tr.get("pointsMult") or tier_mult.get(tr["tier"], 1.0)     # S-Tier sub-tiers (build/prizes.py)
            stl = tr.get("finalStandings") or tr.get("standings") or []
            grp = sorted(s["rank"] for s in stl if str(s.get("result") or "").startswith("Group") and s.get("rank") is not None)
            gpos = {r: j for j, r in enumerate(grp)}
            for s in stl:
                ts = s.get("teamSlug")
                if not ts:
                    continue
                latest_ev[ts] = tr["slug"]
                is_g = str(s.get("result") or "").startswith("Group")
                base = group_points(gpos.get(s["rank"], 0)) if is_g else placement_points(s["rank"])
                fm = field_mult(ts, tr["slug"])
                cf = _core(ev_roster.get((ts, tr["slug"])), rosters(ts))
                v = base * mult * w * fm * cf
                tot[ts] += v
                if with_breakdown:
                    bd[ts].append({"event": tr["name"], "slug": tr["slug"], "date": tr["date"], "tier": tr["tier"], "tierLabel": tr.get("tierLabel"),
                                   "placement": s["rank"], "points": round(v, 1), "base": round(base * mult * w, 1),
                                   "field": round(fm, 2), "core": cf})
        out = {}
        for ts in set(tot) | {s for s in elo_s}:
            e = elo_s.get(ts, 1500.0)
            if ts in last_s:
                e = 1500 + (e - 1500) * 0.5 ** (max(0, (ref - last_s[ts]).days) / HALF)
            ev = latest_ev.get(ts)
            cf = _core(ev_roster.get((ts, ev)) if ev else None, rosters(ts))
            place = tot.get(ts, 0.0)
            # bad form can cost a team at most half of what it earned in events, never wipe it out
            part = max(BETA * cf * (e - 1500), -FORM_FLOOR * place)
            out[ts] = {"place": place, "elo": e, "eloPart": part, "core": cf, "total": max(0.0, place + part)}
        return out, bd

    def rank_map(tbl):
        ranked = sorted((s for s in tbl if s in by and not by[s].get("provisional") and tbl[s]["total"] > 0),
                        key=lambda s: (-tbl[s]["total"], s))
        return {s: i + 1 for i, s in enumerate(ranked)}

    # ---------------------------------------------------------------- now (live table, newest event date)
    ref_now = max((t["date"] for t in tournaments if t.get("date")), default=done[-1]["date"] if done else "2000-01-01")
    now, bd = table(ref_now, lambda s: current.get(s, set()), dict(elo), dict(last), with_breakdown=True)
    for t in teams:
        r = now.get(t["slug"])
        t["rank_points"] = round(r["total"]) if r else 0
        t["points_breakdown"] = sorted(bd.get(t["slug"], []), key=lambda b: -b["points"])
        t["teamElo"] = round(r["elo"]) if r else 1500
        t["eloPart"] = round(r["eloPart"]) if r else 0
        t["coreNow"] = r["core"] if r else 1.0
    ranked = sorted((t for t in teams if not t.get("provisional")), key=lambda t: (-t["rank_points"], t["name"].lower()))
    for i, t in enumerate(ranked):
        t["rank"] = i + 1
    for t in teams:
        if t.get("provisional"):
            t["rank"] = None

    # ---------------------------------------------------------------- history + movement arrows
    def roster_asof(d):
        def f(s):
            evs = [tr for tr in done if tr["date"] <= d and (s, tr["slug"]) in ev_roster]
            return ev_roster[(s, evs[-1]["slug"])] if evs else set()
        return f
    hist = defaultdict(list)
    prev_rank = None
    dates = sorted(snaps)
    for j, d in enumerate(dates):
        e_s, l_s = snaps[d]
        tbl, _ = table(d, roster_asof(d), e_s, l_s)
        rk = rank_map(tbl)
        ev = [tr for tr in done if tr["date"] == d][-1]
        playing = {row.get("teamSlug") for tr in done if tr["date"] == d for row in (tr.get("finalStandings") or tr.get("standings") or [])}
        for s, v in tbl.items():
            if v["total"] > 0 and s in by:
                hist[s].append([ev["slug"], ev["name"], ev["date"], round(v["total"]), rk.get(s), 1 if s in playing else 0])
        if j == len(dates) - 2:
            prev_rank = rk                            # the table before the most recent completed event
    for t in teams:
        t["_rh"] = hist.get(t["slug"], [])
        if t.get("rank") and prev_rank:
            t["rankDelta"] = prev_rank.get(t["slug"], t["rank"]) - t["rank"]
        else:
            t["rankDelta"] = 0
    teams.sort(key=lambda t: (t["rank"] is None, t["rank"] or 0))
    print(f"team ranking: {len(ranked)} ranked teams from {len(done)} completed events")
