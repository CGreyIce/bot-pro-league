#!/usr/bin/env python3
"""Small per-build extras (from 2026-10-10).

team_colors  each team's colour for its page header: data/team_colors.json overrides (set from the admin page),
             otherwise the dominant saturated colour of its logo. t["color"] is the raw colour, t["colorText"]
             a lighter version that reads well on the dark site.
generations  when each player joined the BPL: the year of their first tournament. 2020 (the first BPL year) makes
             them a Founder, 2021 the 1st Generation, 2022 the 2nd, and so on. A player who hasn't played a
             tournament yet counts as joining this year.
dle          BPL-dle, the daily guess-the-player game. data/dle_schedule.json holds one answer per day
             (Singapore time). It only ever grows, so a day's answer never changes after it is scheduled,
             even when players are added later. The site gets yesterday through the next year, lightly encoded
             so the answers aren't readable at a glance in data.json.
"""
import base64, colorsys, json, os, random, re
from datetime import datetime, timedelta, timezone

SGT = timezone(timedelta(hours=8))
DLE_AHEAD = 400          # days scheduled ahead of today
DLE_NO_REPEAT = 200      # a player can't come back within this many days
DLE_START = "2026-10-11" # puzzle #1 (the first full day after it was built)


def _hex(rgb):
    return "#%02x%02x%02x" % tuple(max(0, min(255, int(round(c)))) for c in rgb)


def _rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def text_safe(hexcol):
    """A lighter version of the colour for numbers and accents on the dark background."""
    r, g, b = (c / 255 for c in _rgb(hexcol))
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    l = max(l, 0.64)
    s = min(s, 0.9)
    return _hex(tuple(c * 255 for c in colorsys.hls_to_rgb(h, l, s)))


def logo_color(path):
    """Dominant saturated colour of a logo, or None for a black/white/grey logo."""
    try:
        from PIL import Image
        im = Image.open(path).convert("RGBA")
    except Exception:
        return None
    im.thumbnail((96, 96))
    bins = {}
    for r, g, b, a in im.getdata():
        if a < 200:
            continue
        h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        if s < 0.28 or v < 0.2:
            continue
        k = int(h * 24) % 24
        w = s * v
        x = bins.setdefault(k, [0.0, 0.0, 0.0, 0.0, 0])
        x[0] += w; x[1] += r * w; x[2] += g * w; x[3] += b * w; x[4] += 1
    total = sum(x[4] for x in bins.values())
    if not bins or total < 40:
        return None
    # merge each hue bin with its neighbours so a gradient isn't split across bins
    best = max(bins, key=lambda k: sum(bins.get((k + d) % 24, [0])[0] for d in (-1, 0, 1)))
    w = r = g = b = 0.0
    for d in (-1, 0, 1):
        x = bins.get((best + d) % 24)
        if x:
            w += x[0]; r += x[1]; g += x[2]; b += x[3]
    return _hex((r / w, g / w, b / w))


def team_colors(teams, logo_dir, site_dir, data_dir):
    path = os.path.join(data_dir, "team_colors.json")
    try:
        over = json.load(open(path, encoding="utf-8"))
    except Exception:
        over = {}
    n = 0
    for t in teams:
        col = over.get(t["slug"])
        src = "admin" if col else ""
        if not col and t.get("logo"):
            src_logo = os.path.join(logo_dir, os.path.basename(t["logo"]))
            col = logo_color(src_logo if os.path.exists(src_logo) else os.path.join(site_dir, t["logo"]))
            src = "logo" if col else ""
        if col and re.fullmatch(r"#[0-9a-fA-F]{6}", col):
            t["color"], t["colorText"], t["colorSource"] = col.lower(), text_safe(col), src
            n += 1
    print(f"team colours: {n} of {len(teams)} teams ({sum(1 for t in teams if t.get('colorSource') == 'admin')} set in admin)")


def save_team_color(data_dir, slug, color):
    """Admin: set (or with color=None reset to the logo colour) one team's colour."""
    path = os.path.join(data_dir, "team_colors.json")
    try:
        over = json.load(open(path, encoding="utf-8"))
    except Exception:
        over = {}
    if color:
        if not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
            raise ValueError("colour must look like #ff6a3d")
        over[slug] = color.lower()
    else:
        over.pop(slug, None)
    json.dump(over, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1, sort_keys=True)


# ---------------- generations ----------------
FOUNDING_YEAR = 2020


def generations(players, tournaments):
    first = {}
    for t in sorted((t for t in tournaments if t.get("date")), key=lambda t: t["date"]):
        for r in t.get("attending", []):
            for pl in r.get("players", []):
                if pl.get("slug") and pl["slug"] not in first:
                    first[pl["slug"]] = t
    this_year = _sgt_today().year
    for p in players:
        t = first.get(p.get("slug"))
        # line-ups of a few old events weren't recorded; the team history still has their years
        hist = [int(y) for th in p.get("teamHistory") or [] for y in th.get("years") or [] if str(y).isdigit()]
        years = ([int(t["date"][:4])] if t else []) + hist
        year = min(years) if years else this_year
        if t and year < int(t["date"][:4]):
            t = None          # their real first event has no recorded line-up, so there's nothing to link
        p["joined"] = year
        p["generation"] = max(0, year - FOUNDING_YEAR)
        if t:
            p["debutEvent"] = {"name": t["name"], "slug": t["slug"], "date": t["date"]}
        elif year == this_year:
            p["joinedNoEvent"] = True     # no tournament yet: counted as joining this year
    gens = sorted({p["generation"] for p in players})
    print("generations: " + ", ".join(f"{'Founders' if g == 0 else f'gen {g}'} {sum(1 for p in players if p['generation'] == g)}" for g in gens))


# ---------------- BPL-dle ----------------
def _sgt_today():
    return datetime.now(SGT).date()


def dle(pro, data_dir):
    path = os.path.join(data_dir, "dle_schedule.json")
    try:
        sch = json.load(open(path, encoding="utf-8"))
    except Exception:
        sch = {}
    today = _sgt_today()
    start = datetime.strptime(sch.get("start") or DLE_START, "%Y-%m-%d").date()
    answers = list(sch.get("answers") or [])
    pool = sorted(p["slug"] for p in pro if p.get("slug"))
    live = set(pool)
    # a scheduled player who no longer exists (renamed or removed): follow the rename, else re-pick
    alias = {}
    for p in pro:
        for nm in [p["name"]] + list(p.get("aka") or []):
            alias.setdefault(re.sub(r"[^a-z0-9]", "", nm.lower()), p["slug"])
    def pick(i):
        rng = random.Random(f"bpl-dle-{start + timedelta(days=i)}")
        recent = set(answers[max(0, i - DLE_NO_REPEAT):i])
        cands = [s for s in pool if s not in recent] or pool
        return rng.choice(cands)
    for i, s in enumerate(answers):
        if s not in live:
            answers[i] = alias.get(re.sub(r"[^a-z0-9]", "", s.lower())) or pick(i)
    need = max(0, (today - start).days) + DLE_AHEAD
    while len(answers) < need:
        answers.append(pick(len(answers)))
    sch = {"start": str(start), "answers": answers}
    json.dump(sch, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    # the site gets yesterday onward (yesterday's answer is shown after you play)
    first = max(0, (today - start).days - 1)
    days = answers[first:]
    enc = base64.b64encode(json.dumps(days[::-1], separators=(",", ":")).encode()).decode()[::-1]
    print(f"bpl-dle: puzzle #{max(1, (today - start).days + 1)} today, {len(answers)} days scheduled")
    return {"start": str(start), "from": first, "days": enc}
