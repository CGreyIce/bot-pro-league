#!/usr/bin/env python3
"""BPL economy (from 2026-10-05): player market values, transfer fees and team budgets.

Market value (pro players with Rating Points), in US dollars:
    base   = $1,000,000 x 2^((Rating Points - 1800) / 235)      -> ~$1M stars, ~$150-300k mid-table, ~$30-80k fringe
    x (1 + 5% per title in the last 365 days, max +15%)
    x (1 + up to 15% for prize money won in the last 365 days, full at $150k)
    x 0.7 if the player hasn't played an event in the last 365 days
    rounded to $5k (or $1k under $100k), minimum $10k.
"Last 365 days" counts back from the newest completed event (the league runs on its own calendar).

Transfer fees live on the moves in data/roster_moves.json ("fee": dollars), set in the admin Roster Tools
(pre-filled with the market value; free agents always $0; older moves have no fee).
Team budget = the team's prize money (build/prizes.py) - fees paid + fees received. Roster Tools refuses a
signing the buying team can't afford.
"""
import json, os, re
from datetime import date

STAR_RP, DOUBLING, STAR_VALUE = 1800, 235, 1_000_000


def _norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def _d(s):
    y, m, dd = (int(x) for x in s.split("-")); return date(y, m, dd)


def _round(v):
    v = max(10_000, v)
    step = 5_000 if v >= 100_000 else 1_000
    return int(round(v / step) * step)


def market_values(pro, tournaments):
    done = [t for t in tournaments if t.get("champion") and t.get("date")]
    if not done:
        return
    ref = max(_d(t["date"]) for t in done)
    recent = {t["slug"] for t in done if (ref - _d(t["date"])).days <= 365}
    titles, active = {}, set()
    for tr in done:
        if tr["slug"] not in recent:
            continue
        for row in tr.get("attending", []):
            won = _norm(row["team"]) == _norm(tr.get("champion")) and not tr.get("noHonors")   # qualifiers award no titles
            for pl in row.get("players", []):
                if pl.get("slug"):
                    active.add(pl["slug"])
                    if won:
                        titles[pl["slug"]] = titles.get(pl["slug"], 0) + 1
    for p in pro:
        rp = p.get("ratingPoints")
        if rp is None:
            continue
        base = STAR_VALUE * 2 ** ((rp - STAR_RP) / DOUBLING)
        t = min(3, titles.get(p["slug"], 0))
        won_recently = sum(h["amount"] for h in p.get("prizeHistory", []) if h.get("slug") in recent)
        m_titles = 1 + 0.05 * t
        m_money = 1 + 0.15 * min(1.0, won_recently / 150_000)
        m_active = 1.0 if p["slug"] in active else 0.7
        p["marketValue"] = _round(base * m_titles * m_money * m_active)
        p["valueParts"] = {"base": _round(base), "titles": t, "recentPrize": won_recently, "active": p["slug"] in active}


def budgets(teams, data_dir):
    """Prize money - fees paid + fees received, from the fees recorded on roster moves."""
    alias = {}
    tcp = os.path.join(data_dir, "team_changes.json")
    if os.path.exists(tcp):
        alias = {_norm(k): _norm(v) for k, v in json.load(open(tcp, encoding="utf-8")).items()}
    by_key = {_norm(t["name"]): t for t in teams}
    team_of = lambda nm: by_key.get(alias.get(_norm(nm), _norm(nm)))
    for t in teams:
        t["feesIn"], t["feesOut"] = 0, 0
    rmp = os.path.join(data_dir, "roster_moves.json")
    moves = json.load(open(rmp, encoding="utf-8")) if os.path.exists(rmp) else []
    for mv in moves:
        fee = int(mv.get("fee") or 0)
        if fee <= 0:
            continue
        buyer, seller = team_of(mv.get("to")), team_of(mv.get("from"))
        if buyer:
            buyer["feesOut"] += fee
        if seller:
            seller["feesIn"] += fee
    for t in teams:
        t["budget"] = int((t.get("earnings") or 0) - t["feesOut"] + t["feesIn"])


def squad_values(teams, players):
    by = {p["slug"]: p for p in players}
    for t in teams:
        vals = [by[r["slug"]].get("marketValue") for r in t.get("roster", []) if r.get("slug") in by]
        vals = [v for v in vals if v]
        t["squadValue"] = sum(vals) if vals else None


def apply(pro, players, teams, tournaments, data_dir):
    market_values(pro, tournaments)
    budgets(teams, data_dir)
    squad_values(teams, players)
    vals = sorted((p["marketValue"] for p in pro if p.get("marketValue")), reverse=True)
    if vals:
        print(f"economy: {len(vals)} market values (top ${vals[0]:,}, median ${vals[len(vals) // 2]:,}); "
              f"{sum(1 for t in teams if t.get('feesOut') or t.get('feesIn'))} teams with transfer fees")
