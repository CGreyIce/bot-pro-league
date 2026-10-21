#!/usr/bin/env python3
"""Write up a news draft with an LLM (admin "✨ Write with AI" button).

The admin page sends a draft (title + body, usually a stats-report draft from storylines.py); this
gathers background on everyone the draft links ([[...]]): player and team details, recent results,
transfers, and earlier articles about them, then asks the model for a long news article in the
house style. Nothing is saved here: the text goes back into the editor for the admin to check.

The API key lives in local/ai.json (git-ignored, never published):
    {"key": "cpk_...", "model": "moonshotai/Kimi-K2.6-TEE", "base": "https://llm.chutes.ai/v1"}
Chutes exposes an OpenAI-compatible chat endpoint.
"""
import json
import os
import re
import urllib.error
import urllib.request

import wikilinks

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCAL = os.path.join(ROOT, "local")
CONF = os.path.join(LOCAL, "ai.json")
DEFAULT_MODEL = "moonshotai/Kimi-K2.6-TEE"
DEFAULT_BASE = "https://llm.chutes.ai/v1"
WORDS = 550                     # the admin chose "always long"


def load_conf():
    try:
        return json.load(open(CONF, encoding="utf-8"))
    except Exception:
        return {}


def status():
    c = load_conf()
    return {"configured": bool(c.get("key")), "model": c.get("model") or DEFAULT_MODEL}


def save_key(key):
    os.makedirs(LOCAL, exist_ok=True)
    c = load_conf()
    if key:
        c["key"] = key.strip()
    else:
        c.pop("key", None)
    json.dump(c, open(CONF, "w", encoding="utf-8"), indent=1)


# ---------------------------------------------------------------- background for the model

def _pron(g):
    return {"M": "he/him", "F": "she/her"}.get(g or "", "they/them")


def _player_facts(p, rank_of):
    titles = [f"{t['event']} ({t['year']}, with {t['team']})" for t in p.get("titles") or []]
    t20 = [f"#{a['rank']} in the Top 20 Players of {a['year']}" for a in p.get("awards") or [] if a.get("rank")]
    other_aw = [f"{a['award']} {a['year']}" for a in p.get("awards") or [] if not a.get("rank")]
    hist = [f"{h['team']} ({', '.join(h.get('years') or [])})" for h in (p.get("teamHistory") or [])[-8:]]
    lines = [
        f"PLAYER {p['name']} ({_pron(p.get('gender'))}): {p.get('nat') or '?'} {p.get('role') or ''}, "
        f"team: {p.get('team') or 'free agent'}.",
        f"  Rating Points {p.get('ratingPoints')}, rank #{rank_of.get(p['slug'], '?')}, rating {p.get('rating')}, "
        f"K/D {p.get('kdr')}, {p.get('maps')} maps, {p.get('kills')} kills, {p.get('mvp')} MVP rounds, win rate {p.get('winrate')}.",
        f"  Joined BPL {p.get('joined')} (generation {p.get('generation')}; 0 = Founder). Market value ${p.get('marketValue') or 0:,}, career prize money ${p.get('earnings') or 0:,}.",
    ]
    if titles:
        lines.append("  Titles: " + "; ".join(titles))
    if t20 or other_aw:
        lines.append("  Awards: " + "; ".join(t20 + other_aw))
    if hist:
        lines.append("  Team history (recent last): " + "; ".join(hist))
    if p.get("bio"):
        lines.append("  Bio: " + p["bio"])
    return "\n".join(lines)


def _team_facts(t, by_slug):
    ev = [f"{e['name']} ({e.get('date', '')[:4]}): {e.get('placementLabel') or ('Champion' if e.get('isChampion') else '#' + str(e.get('placement')))}"
          for e in (t.get("events") or [])[:8]]
    roster = []
    for r in t.get("roster") or []:
        p = by_slug.get(r.get("slug"))
        roster.append(f"{r['name']} ({p.get('role')}, {p.get('ratingPoints')} RP)" if p else r["name"])
    lines = [
        f"TEAM {t['name']}: region {t.get('region') or '?'}, BPL rank #{t.get('rank') or 'unranked'} ({t.get('rank_points')} pts), "
        f"Majors {t.get('major_wins') or 0}, S-Tier titles {t.get('s_tier_wins') or 0}, A-Tier titles {t.get('a_tier_wins') or 0}.",
        f"  Roster: {', '.join(roster) or 'none'}. Budget ${t.get('budget') or 0:,}, prize money ${t.get('earnings') or 0:,}.",
        f"  Recent events (newest first): {'; '.join(ev) or 'none'}.",
    ]
    if t.get("bio"):
        lines.append("  Bio: " + t["bio"])
    return "\n".join(lines)


def _event_facts(tr):
    st = tr.get("finalStandings") or tr.get("standings") or []
    top = [f"{x.get('rank')}. {x.get('name') or x.get('team')}" for x in st[:8]]
    return (f"EVENT {tr['name']}: {tr.get('date')}, {tr.get('tierLabel') or tr.get('tier')}, prize pool ${tr.get('prizePool') or 0:,}, "
            f"champion {tr.get('champion') or 'not decided yet'}, runner-up {tr.get('runnerUp') or '?'}. Standings: {', '.join(top) or 'none yet'}.")


def build_context(title, body):
    d = json.load(open(os.path.join(ROOT, "site", "data.json"), encoding="utf-8"))
    players = d["players"]["pro"] + d["players"].get("amateur", []) + d["players"].get("solo", [])
    by_slug = {p["slug"]: p for p in players}
    idx = wikilinks.Index(players, d["teams"], d["tournaments"], os.path.join(ROOT, "data"))
    ranked = sorted((p for p in d["players"]["pro"] if p.get("ratingPoints") is not None), key=lambda p: -p["ratingPoints"])
    rank_of = {p["slug"]: i + 1 for i, p in enumerate(ranked)}
    team_by = {t["slug"]: t for t in d["teams"]}
    tr_by = {t["slug"]: t for t in d["tournaments"]}

    names, facts, seen = [], [], set()
    for raw in re.findall(r"\[\[([^\[\]|]+?)(?:\|[^\[\]]+?)?\]\]", f"{title}\n{body}"):
        hit = idx.lookup(raw)
        if not hit:
            continue
        kind, slug = hit[0], hit[1]
        if (kind, slug) in seen:
            continue
        seen.add((kind, slug))
        if kind == "player" and slug in by_slug:
            facts.append(_player_facts(by_slug[slug], rank_of)); names.append(by_slug[slug]["name"])
        elif kind == "team" and slug in team_by:
            facts.append(_team_facts(team_by[slug], by_slug)); names.append(team_by[slug]["name"])
        elif kind == "tournament" and slug in tr_by:
            facts.append(_event_facts(tr_by[slug])); names.append(tr_by[slug]["name"])

    # transfers involving these names, and earlier articles about them (lore to stay consistent with)
    low = {n.lower() for n in names}
    moves = [m for m in d.get("transfers", []) if (m.get("player") or "").lower() in low
             or (m.get("toTeam") or "").lower() in low or (m.get("fromTeam") or "").lower() in low][:8]
    mv = [f"{m['date']}: {m['player']} {m.get('fromTeam') or 'free agent'} -> {m.get('toTeam') or 'free agent'}"
          + (f" (fee ${m['fee']:,})" if m.get("fee") else "") for m in moves]
    arts = json.load(open(os.path.join(ROOT, "data", "articles.json"), encoding="utf-8"))
    related = [a for a in sorted(arts, key=lambda a: a.get("date", ""), reverse=True)
               if a.get("title") != title and any(n.lower() in (a.get("body", "") + a.get("title", "")).lower() for n in names)][:3]
    lore = []
    for a in related:
        snippet = re.sub(r"\s+", " ", a.get("body", ""))[:700]
        lore.append(f"- \"{a['title']}\" ({a.get('date')}): {snippet}")

    ctx = "\n\n".join(facts) or "(no linked players, teams or events)"
    if mv:
        ctx += "\n\nTRANSFERS:\n" + "\n".join(mv)
    if lore:
        ctx += "\n\nEARLIER ARTICLES (stay consistent with these):\n" + "\n".join(lore)
    return ctx, names, idx


SYSTEM = """You write news for the Bot Pro League (BPL): a Counter-Strike league whose players and teams are covered like a real pro scene (think HLTV news). Treat everyone as real players.

Rules:
- Every stat, result, score, date, fee, ranking and placement must come from the DATA given. Never invent numbers, results or events. If you don't have a fact, leave it out.
- You may invent 1 to 3 short quotes from the people in the story (captains, players), as long as they fit the facts.
- Use each person's pronouns exactly as given in the DATA.
- Never use em dashes or en dashes. Use commas, colons or full stops instead.
- Say "team", never "side".
- Format: plain paragraphs separated by a blank line. You may use **bold** sub-headings on their own line. No # headings, no bullet lists, no tables.
- Link the first mention of each player, team and event as [[Exact Name]], using the exact names listed under NAMES. Don't link anything else.
- Spell every name exactly as it appears in the DATA (capitals, numbers and underscores included).
- Don't claim something has "never" or "always" happened, or is a first or a record, unless the DATA shows it.
- Make it a story, not a stats sheet: what it means, the history behind it, what comes next. Use the stats to support the story.
- About {words} words.

How the league works (use this, don't contradict it):
- Event tiers: the Major (the biggest title; the Conquerors Stage each year is the Major), S-Tier (big events; S-Tier 1 is bigger than S-Tier 2), A-Tier (smaller events such as the Bot Pro Minor Leagues).
- The 2026 season: the Challengers Stage (amateur and smaller teams; its top 15 go on) feeds the Legends Stage (48 teams; its top 16 go on), which feeds the Conquerors Stage 2026, the Major (the top 16 pro teams plus those 16).
- Teams with a page are pro teams with a BPL ranking. Amateur teams have no page and no ranking points.
- Rating Points rate a player (around 1000 is average, 1500+ is excellent). "Rank #N" is their place among all players.

Reply with the headline on the first line, starting with "TITLE: ", then a blank line, then the article body."""


def write(title, body, date=""):
    c = load_conf()
    if not c.get("key"):
        raise RuntimeError("No Chutes API key yet: add it in the Write with AI box first.")
    ctx, names, idx = build_context(title, body)
    user = (f"Today's date in the league: {date or 'unknown'}.\n\nDRAFT TITLE: {title}\n\nDRAFT (facts to build the story on):\n{body}\n\n"
            f"NAMES (link these as [[Exact Name]]): {', '.join(names) or 'none'}\n\nDATA:\n{ctx}")
    model = c.get("model") or DEFAULT_MODEL
    payload = {"model": model, "temperature": 0.6, "max_tokens": 4000,
               "messages": [{"role": "system", "content": SYSTEM.replace("{words}", str(WORDS))},
                            {"role": "user", "content": user}]}
    if "kimi" in model.lower():
        # Kimi K2.x "thinks" before answering, and the thinking counts against max_tokens: on a long
        # article it used the whole budget and the answer came back empty. Switched off, it writes straight away.
        payload["chat_template_kwargs"] = {"thinking": False}
    req = urllib.request.Request(
        (c.get("base") or DEFAULT_BASE).rstrip("/") + "/chat/completions",
        data=json.dumps(payload).encode(),
        headers={"Authorization": "Bearer " + c["key"], "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            out = json.load(r)
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:300]
        if e.code in (401, 403):
            raise RuntimeError("Chutes didn't accept the API key. Check it and save it again.")
        raise RuntimeError(f"Chutes error {e.code}: {detail}")
    except urllib.error.URLError as e:
        raise RuntimeError(f"Couldn't reach Chutes: {e.reason}")
    choice = (out.get("choices") or [{}])[0]
    text = choice.get("message", {}).get("content") or ""
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()   # reasoning models may include their thinking
    if not text:
        if choice.get("finish_reason") == "length":
            raise RuntimeError("The model ran out of room before writing the article (it spent it thinking). Try again, or pick another model in local/ai.json.")
        raise RuntimeError("The model sent back an empty answer. Try again.")
    new_title = title
    m = re.match(r"\s*TITLE:\s*(.+)", text)
    if m:
        new_title = m.group(1).strip().strip('"')
        text = text[m.end():].strip()
    return {"title": tidy(new_title, idx, links=False), "body": tidy(text, idx)}


def tidy(text, idx, links=True):
    """House style the model might miss: no long dashes, no [[links]] the site can't resolve."""
    text = re.sub(r"\s*[—]\s*", ", ", text)          # em dash -> comma
    text = re.sub(r"\s*[–]\s*", "-", text)           # en dash (ranges) -> hyphen
    if links:
        def keep(m):
            name = m.group(1)
            return m.group(0) if idx.lookup(name) else (m.group(2) or name)
        text = re.sub(r"\[\[([^\[\]|]+?)(?:\|([^\[\]]+?))?\]\]", keep, text)
    else:
        text = re.sub(r"\[\[([^\[\]|]+?)(?:\|([^\[\]]+?))?\]\]", lambda m: m.group(2) or m.group(1), text)
    return text.strip()
