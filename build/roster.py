#!/usr/bin/env python3
"""Roster tools behind the admin page: transfer, add/edit/rename players, rename/promote/disband
teams. Every action edits the same source files the build reads, preserving each file's quoting
and line endings so a change only touches the cells it means to.

Where things live (what the build reads):
  player team / role   bot_tourney_stats.csv (pro sheet)  +  bot_amateur_tourney_stats.csv (amateur)
                       (merged per player: the pro team wins; amateur team only when no pro team)
  solo-only players    bot_competitive_me.csv
  country              allplayer.txt  (name TAB country)
  gender               player_gender.json  (normkey -> "M"/"F")
  renames              name_changes.json (players), team_changes.json (teams)
  pro teams            pro_team.csv  +  rosters.txt block (tag, origin, in-game bot_add lines)
  provisional          provisional_teams.json
  transfers feed       roster_moves.json
  disbanded ad-hoc     disbanded_teams.json

Each action is run(action, params, dry_run): it returns {"changes": [human-readable lines]} and,
unless dry_run, writes the files. Validation errors raise RosterError with a readable message.
"""
import base64, csv, io, json, os, re, sys, unicodedata
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
SITE = os.path.join(ROOT, "site")
LOGO_DIR = os.path.join(ROOT, "assets", "teams")

FREE_AGENT = "Free agent"
PRONOUNS = {"M": "he/him", "F": "she/her", "NB": "they/them"}
# amateur-sheet rows on these teams are dropped from the pool by parse.py (they're pro teams)
AMATEUR_EXCLUDED = {"floodflashers", "xplosiv", "5percent"}


class RosterError(Exception):
    pass


def poss(name):
    """The Nomads -> The Nomads'  |  Opal -> Opal's"""
    return name + ("'" if name.endswith("s") else "'s")


def norm(s):
    s = unicodedata.normalize("NFKD", s or "")
    return re.sub(r"[^a-z0-9]", "", s.lower())


def slug(s):
    # must match parse.slug
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import parse
    return parse.slug(s)


def country_iso():
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import parse
    return parse.COUNTRY_ISO


# ---------------------------------------------------------------- file helpers (format-preserving)
class Sheet:
    """A CSV file read and written back with its own quoting style and line endings."""
    def __init__(self, name):
        self.name, self.path = name, os.path.join(DATA, name)
        raw = open(self.path, encoding="utf-8", newline="").read()
        self.eol = "\r\n" if "\r\n" in raw else "\n"
        self.trailing = raw.endswith(("\n", "\r"))
        first = raw.split("\n", 1)[0]
        self.quoting = csv.QUOTE_ALL if first.startswith('"') else csv.QUOTE_MINIMAL
        self.rows = list(csv.reader(io.StringIO(raw, newline="")))
        self.width = len(self.rows[0]) if self.rows else 0
        self.dirty = False

    def find(self, name):
        k = norm(name)
        return [r for r in self.rows[1:] if r and norm(r[0]) == k]

    def text(self):
        out = io.StringIO()
        csv.writer(out, quoting=self.quoting, lineterminator=self.eol).writerows(self.rows)
        s = out.getvalue()
        return s if self.trailing else s[:-len(self.eol)]

    def save(self):
        if self.dirty:
            open(self.path, "w", encoding="utf-8", newline="").write(self.text())


class TextFile:
    """A line-based text file (allplayer.txt, rosters.txt) keeping its line endings."""
    def __init__(self, name):
        self.path = os.path.join(DATA, name)
        raw = open(self.path, encoding="utf-8", errors="replace", newline="").read()
        self.eol = "\r\n" if "\r\n" in raw else "\n"
        self.trailing = raw.endswith(("\n", "\r"))
        self.lines = raw.split(self.eol)
        if self.trailing and self.lines and self.lines[-1] == "":
            self.lines.pop()
        self.dirty = False

    def save(self):
        if self.dirty:
            s = self.eol.join(self.lines) + (self.eol if self.trailing else "")
            open(self.path, "w", encoding="utf-8", newline="").write(s)


def load_json(name, default):
    p = os.path.join(DATA, name)
    return json.load(open(p, encoding="utf-8")) if os.path.exists(p) else default


def save_json(name, obj, indent=1):
    json.dump(obj, open(os.path.join(DATA, name), "w", encoding="utf-8"), ensure_ascii=False, indent=indent)


# ---------------------------------------------------------------- rosters.txt blocks
BOT_RE = re.compile(r'(bot_add(?:_ct)?)\s+(?:"([^"]*)"|([^;\s]+))')


def roster_blocks(tf):
    """header-line index -> (team name, tag, add-line index, ct-line index or None)."""
    out = {}
    for i, line in enumerate(tf.lines):
        s = line.strip()
        if not s or s.startswith(("bot_", "mp_", "☆")) or set(s) <= set("- "):
            continue
        j = i + 1
        while j < len(tf.lines) and not tf.lines[j].strip():
            j += 1
        if j < len(tf.lines) and tf.lines[j].strip().startswith("bot_add"):
            cut = len(s)
            for ch in ("(", "[", "☆"):
                p = s.find(ch)
                if p != -1:
                    cut = min(cut, p)
            name = s[:cut].strip()
            m = re.search(r'bot_add\s+"([^ ]+)\s', tf.lines[j])
            ct = j + 1 if j + 1 < len(tf.lines) and tf.lines[j + 1].strip().startswith("bot_add_ct") else None
            out[norm(name)] = {"name": name, "tag": m.group(1) if m else "", "add": j, "ct": ct, "header": i}
    return out


def _bot_entries(line):
    return [(m.group(1), m.group(2) if m.group(2) is not None else m.group(3)) for m in BOT_RE.finditer(line)]


def _bot_line(cmd, tag, names, trailing_semi):
    parts = [f'{cmd} "{(tag + " ") if tag else ""}{n}"' for n in names]
    return "; ".join(parts) + (";" if trailing_semi else "")


def _block_players(tf, blk):
    tag = blk["tag"]
    names = []
    for _, val in _bot_entries(tf.lines[blk["add"]]):
        names.append(val[len(tag) + 1:] if tag and val.startswith(tag + " ") else val)
    return names


def _write_block(tf, blk, names):
    for key, cmd in (("add", "bot_add"), ("ct", "bot_add_ct")):
        idx = blk[key]
        if idx is None:
            continue
        semi = tf.lines[idx].rstrip().endswith(";")
        tf.lines[idx] = _bot_line(cmd, blk["tag"], names, semi)
    tf.dirty = True


# ---------------------------------------------------------------- the engine
class Roster:
    def __init__(self):
        self.pro = Sheet("bot_tourney_stats.csv")
        self.am = Sheet("bot_amateur_tourney_stats.csv")
        self.solo = Sheet("bot_competitive_me.csv")
        self.teams_csv = Sheet("pro_team.csv")
        self.allp = TextFile("allplayer.txt")
        self.rtxt = TextFile("rosters.txt")
        self.gender = load_json("player_gender.json", {})
        self.moves = load_json("roster_moves.json", [])
        self.prov = load_json("provisional_teams.json", {"slugs": []})
        self.disb = load_json("disbanded_teams.json", {"teams": []})
        self.namech = load_json("name_changes.json", {})
        self.teamch = load_json("team_changes.json", {})
        self.notes = load_json("player_bio_notes.json", {})
        self.dirty_json = set()
        self.changes = []
        self.extra_writes = []          # callables run on apply (logos, articles...)
        self.data = json.load(open(os.path.join(SITE, "data.json"), encoding="utf-8"))
        self.players = self.data["players"]["pro"] + self.data["players"]["amateur"] + self.data["players"]["solo"]
        self.by_key = {}
        for p in self.players:
            self.by_key.setdefault(norm(p["name"]), p)

    # ---- lookups
    def team_rows(self):
        return [r for r in self.teams_csv.rows[1:] if r and r[0].strip()]

    def page_team(self, name):
        """The pro/provisional team with a page called `name` (case/punct-insensitive), or None."""
        k = norm(name)
        for r in self.team_rows():
            if norm(r[0]) == k:
                return r[0].strip()
        return None

    def is_provisional(self, team):
        return slug(team) in set(self.prov.get("slugs", []))

    def player(self, name):
        p = self.by_key.get(norm(name))
        if not p:
            new = next((v for k, v in self.namech.items() if norm(k) == norm(name)), None)
            p = self.by_key.get(norm(new)) if new else None
        if not p:
            # not in the last build yet (e.g. added a moment ago): read them straight from the sheets
            pro_rows, am_rows = self.pro.find(name), self.am.find(name)
            row = (pro_rows or am_rows or self.solo.find(name) or [None])[0]
            if row:
                team = (pro_rows[0][1] if pro_rows and pro_rows[0][1] else am_rows[0][1] if am_rows else "")
                p = {"name": row[0], "team": team, "role": row[14] if len(row) > 14 else "",
                     "slug": slug(row[0]), "nat": ""}
        if not p:
            raise RosterError(f"No player called '{name}'.")
        return p

    def current_team(self, p):
        return (p.get("team") or "").strip() or FREE_AGENT

    def note(self, s):
        self.changes.append(s)

    # ---- core: set a player's team across the sheets
    def _set_team(self, name, team, role_hint="", quiet=False):
        """Make `team` (a page team, an amateur/ad-hoc team name, or '' for free agency) the player's
        team in the sheets. Pro (non-provisional) teams need a pro-sheet row; everything else lives
        in the amateur sheet. The other sheet's team is cleared so an old team can't resurface."""
        pro_rows, am_rows = self.pro.find(name), self.am.find(name)
        page = self.page_team(team) if team else None
        full_pro = page and not self.is_provisional(page)
        team = page or team
        if full_pro:
            if not pro_rows:
                row = [name, team, "0", "0", "0", "0", "0", "0", "0", "0.0%", "0", "", "", "", role_hint]
                self.pro.rows.append(row + [""] * (self.pro.width - len(row)))
                if not quiet:
                    self.note(f"Pro sheet: add a row for {name} (team {team}); their existing stats are kept.")
            for r in pro_rows:
                r[1] = team
            for r in am_rows:
                if r[1]:
                    r[1] = ""
            self.pro.dirty = True; self.am.dirty = bool(am_rows) or self.am.dirty
        else:
            for r in pro_rows:
                r[1] = ""
            if team and norm(team) in AMATEUR_EXCLUDED:
                raise RosterError(f"{team} can't be set as an amateur team.")
            if am_rows:
                for r in am_rows:
                    r[1] = team
            elif team or not pro_rows:
                row = [name, team, "0", "0", "0", "0", "0", "0", "0", "0.0%", "0", "", "", "", role_hint]
                self.am.rows.append(row + [""] * (self.am.width - len(row)))
                if not quiet:
                    self.note(f"Amateur sheet: add a row for {name}" + (f" (team {team})." if team else " (free agent)."))
            self.pro.dirty = self.pro.dirty or bool(pro_rows)
            self.am.dirty = True
        return team

    def _live_warning(self, p, new_team):
        """Warn when a player is on a LIVE event roster for a team other than `new_team`."""
        manual_dir = os.path.join(DATA, "manual")
        live = {f[:-5] for f in os.listdir(manual_dir) if f.endswith(".json")}
        for tr in self.data.get("tournaments", []):
            if tr["slug"] not in live or tr.get("champion") or "nations-cup" in tr["slug"]:
                continue
            for row in tr.get("attending", []):
                if any(pl.get("slug") == p.get("slug") for pl in row.get("players", [])) and norm(row["team"]) != norm(new_team):
                    self.note(f"⚠ {p['name']} is playing for {row['team']} at {tr['name']} (still running). The event "
                              f"roster keeps them, but {poss(row['team'])} live line-up and veto bot_add lines will miss "
                              f"them until it ends. Site Health will flag this.")

    def league_today(self):
        """The league's calendar runs ahead of real time (events/articles are dated in-world), so a
        move defaults to the later of today and the latest in-world date already on the site."""
        dates = [date.today().isoformat()]
        dates += [m.get("date", "") for m in self.moves]
        dates += [a.get("date", "") for a in self.data.get("articles", [])]
        return max(d for d in dates if d)

    def _log_move(self, player, frm, to, when, fee=0):
        prev = max((m.get("date", "") for m in self.moves if norm(m.get("player")) == norm(player)), default="")
        if prev and when < prev:
            self.note(f"⚠ Dated {when}, which is before {poss(player)} previous move ({prev}). The Transfers "
                      "page sorts by date, so pick a later date.")
        mv = {"date": when, "player": player, "from": frm, "to": to}
        if fee:
            mv["fee"] = int(fee)
        self.moves.append(mv)
        self.dirty_json.add("roster_moves.json")
        self.note(f"Transfers page: {player}, {frm} → {to} ({when})" + (f" for ${int(fee):,}." if fee else "."))

    def _rtxt_move(self, player, frm, to):
        blocks = roster_blocks(self.rtxt)
        b_from, b_to = blocks.get(norm(frm)), blocks.get(norm(to))
        if b_from:
            names = _block_players(self.rtxt, b_from)
            keep = [n for n in names if norm(n) != norm(player)]
            if len(keep) != len(names) and keep:
                _write_block(self.rtxt, b_from, keep)
                self.note(f"rosters.txt: remove {player} from {poss(b_from['name'])} bot_add lines.")
        if b_to:
            names = _block_players(self.rtxt, b_to)
            if not any(norm(n) == norm(player) for n in names):
                _write_block(self.rtxt, b_to, names + [player])
                self.note(f"rosters.txt: add {player} to {poss(b_to['name'])} bot_add lines.")

    # ================================================================ actions
    def team_data(self, name):
        return next((t for t in self.data.get("teams", []) if norm(t["name"]) == norm(name)), None)

    def transfer(self, player, to, when=None, log=True, fee=0):
        p = self.player(player)
        when = when or self.league_today()
        frm = self.current_team(p)
        to = (to or "").strip()
        if not to or norm(to) in (norm(FREE_AGENT), "freeagent", "none"):
            to = ""
        try:
            fee = int(float(str(fee or 0).replace(",", "").replace("$", "")))
        except ValueError:
            raise RosterError("The transfer fee must be a number of dollars.")
        if fee < 0:
            raise RosterError("The transfer fee can't be negative.")
        if fee:
            # fees: paid by the buying team to the selling team (build/economy.py turns them into budgets)
            if norm(frm) == norm(FREE_AGENT):
                raise RosterError(f"{p['name']} is a free agent, so there's no fee: set it to $0.")
            if not to:
                raise RosterError("Releasing a player to free agency has no fee: set it to $0.")
            buyer = self.page_team(to)
            if not buyer:
                raise RosterError(f"{to} has no team page, so it has no budget to pay a fee: set it to $0.")
            budget = (self.team_data(buyer) or {}).get("budget", 0) or 0
            if fee > budget:
                raise RosterError(f"{buyer} can't afford ${fee:,}: their budget is ${budget:,}. Lower the fee or pick another team.")
            self.note(f"Fee: {buyer} pays ${fee:,}" + (f" to {self.page_team(frm)}" if self.page_team(frm) else "")
                      + f". {buyer}'s budget goes from ${budget:,} to ${budget - fee:,}.")
        target = self._set_team(p["name"], to, p.get("role", ""))
        to_lbl = target or FREE_AGENT
        if norm(frm) == norm(to_lbl):
            raise RosterError(f"{p['name']} is already {('on ' + to_lbl) if target else 'a free agent'}.")
        self.note(f"{p['name']}: {frm} → {to_lbl}.")
        if not self.page_team(to_lbl) and target:
            self.note(f"Note: {target} has no team page, so {p['name']} shows it as an amateur team.")
        if log:
            self._log_move(p["name"], frm, to_lbl, when, fee)
        self._rtxt_move(p["name"], frm, to_lbl)
        self._live_warning(p, to_lbl)

    def add_player(self, name, country, gender, role, team="", when=None):
        name = (name or "").strip()
        if not name:
            raise RosterError("Name is required.")
        if norm(name) in self.by_key or self.pro.find(name) or self.am.find(name) or self.solo.find(name):
            raise RosterError(f"A player called '{name}' already exists.")
        iso = country_iso()
        if (country or "").lower() not in iso:
            raise RosterError(f"Unknown country '{country}'. Pick one from the list.")
        if gender not in ("M", "F", "NB", ""):
            raise RosterError("Gender must be M, F or NB.")
        self._set_team(name, (team or "").strip() if norm(team) != norm(FREE_AGENT) else "", role or "")
        for sh in (self.pro, self.am):
            for r in sh.find(name):
                r[14] = role or r[14]
        self.allp.lines.append(f"{name}\t{country}"); self.allp.dirty = True
        self.note(f"New player {name}: {country}, {role or 'no role'}, " +
                  (f"team {team}." if team and norm(team) != norm(FREE_AGENT) else "free agent."))
        if gender in ("M", "F", "NB"):
            self.gender[norm(name)] = gender; self.dirty_json.add("player_gender.json")
            self.note(f"Gender: {gender} ({PRONOUNS[gender]} in their bio).")
        if team and norm(team) != norm(FREE_AGENT):
            self._log_move(name, FREE_AGENT, self.page_team(team) or team, when or self.league_today())

    def edit_player(self, player, role=None, country=None, gender=None):
        p = self.player(player)
        name = p["name"]
        if role:
            rows = self.pro.find(name) + self.am.find(name) + self.solo.find(name)
            for r in rows:
                if len(r) > 14 and r[14] != role:
                    r[14] = role
            self.pro.dirty = self.am.dirty = self.solo.dirty = True
            self.note(f"{name}: role {p.get('role') or 'none'} → {role}.")
        if country:
            if country.lower() not in country_iso():
                raise RosterError(f"Unknown country '{country}'.")
            idx = next((i for i, l in enumerate(self.allp.lines) if norm(l.split("\t")[0]) == norm(name)), None)
            if idx is None:
                self.allp.lines.append(f"{name}\t{country}")
            else:
                self.allp.lines[idx] = f"{self.allp.lines[idx].split(chr(9))[0]}\t{country}"
            self.allp.dirty = True
            self.note(f"{name}: country {p.get('nat') or 'none'} → {country}.")
        if gender:
            if gender not in ("M", "F", "NB"):
                raise RosterError("Gender must be M, F or NB.")
            self.gender[norm(name)] = gender                # "NB" stored explicitly = chosen they/them
            self.dirty_json.add("player_gender.json")
            self.note(f"{name}: gender → {gender}.")
        if not (role or country or gender):
            raise RosterError("Nothing to change.")

    def set_genders(self, mapping):
        """Bulk gender update: {player name: "M" | "F" | "NB"} (NB = they/them, chosen on purpose)."""
        if not mapping:
            raise RosterError("Pick at least one gender.")
        counts = {"M": 0, "F": 0, "NB": 0}
        for name, g in mapping.items():
            if g not in counts:
                raise RosterError(f"'{g}' isn't a valid gender for {name} (use M, F or NB).")
            p = self.player(name)
            self.gender[norm(p["name"])] = g
            counts[g] += 1
        self.dirty_json.add("player_gender.json")
        parts = [f"{n} {PRONOUNS[g]}" for g, n in (("F", counts["F"]), ("M", counts["M"]), ("NB", counts["NB"])) if n]
        n = len(mapping)
        self.note(f"Set {n} gender{'' if n == 1 else 's'}: {', '.join(parts)}. Their bios update on the rebuild.")

    def rename_player(self, old, new):
        p = self.player(old)
        old, new = p["name"], (new or "").strip()
        if not new:
            raise RosterError("New name is required.")
        if norm(new) == norm(old):
            raise RosterError("That's the same name.")
        if norm(new) in self.by_key:
            raise RosterError(f"A player called '{new}' already exists.")
        for sh in (self.pro, self.am, self.solo):
            for r in sh.find(old):
                r[0] = new; sh.dirty = True
        for i, l in enumerate(self.allp.lines):
            if norm(l.split("\t")[0]) == norm(old):
                self.allp.lines[i] = new + l[len(l.split("\t")[0]):]; self.allp.dirty = True
        for store, fname in ((self.gender, "player_gender.json"), (self.notes, "player_bio_notes.json")):
            if norm(old) in store:
                store[norm(new)] = store.pop(norm(old)); self.dirty_json.add(fname)
        for k, v in list(self.namech.items()):
            if norm(v) == norm(old):
                self.namech[k] = new                    # keep older aliases pointing at the latest name
        self.namech[old] = new; self.dirty_json.add("name_changes.json")
        for mv in self.moves:
            if norm(mv.get("player")) == norm(old):
                mv["player"] = new; self.dirty_json.add("roster_moves.json")
        blocks = roster_blocks(self.rtxt)
        for b in blocks.values():
            names = _block_players(self.rtxt, b)
            if any(norm(n) == norm(old) for n in names):
                _write_block(self.rtxt, b, [new if norm(n) == norm(old) else n for n in names])
                self.note(f"rosters.txt: rename in {poss(b['name'])} bot_add lines.")
        self.note(f"{old} is now {new}. Their profile, stats and history follow the new name, and "
                  f"'formerly known as {old}' appears on their profile.")
        self._relink_slug("player", p["slug"], slug(new), stacks=True)

    def _relink_slug(self, kind, old_slug, new_slug, stacks=False):
        """Point article links, Hall of Fame and records at a renamed player/team."""
        if old_slug == new_slug:
            return
        arts = load_json("articles.json", [])
        n = 0
        for a in arts:
            body = a.get("body", "")
            nb = body.replace(f"(#/{kind}/{old_slug})", f"(#/{kind}/{new_slug})")
            if nb != body:
                a["body"] = nb; n += 1
        if n:
            self.extra_writes.append(lambda: save_json("articles.json", arts))
            self.note(f"Articles: update links in {n} article(s).")
        hof = load_json("hall_of_fame.json", {"players": [], "teams": []})
        sect = "players" if kind == "player" else "teams"
        if any(e.get("slug") == old_slug for e in hof.get(sect, [])):
            for e in hof[sect]:
                if e.get("slug") == old_slug:
                    e["slug"] = new_slug
            self.extra_writes.append(lambda: save_json("hall_of_fame.json", hof))
            self.note("Hall of Fame: update the entry.")
        if kind == "player":
            rc = load_json("rank_climb_record.json", {})
            if rc.get("slug") == old_slug:
                rc["slug"] = new_slug
                self.extra_writes.append(lambda: save_json("rank_climb_record.json", rc))
            if stacks:
                st = load_json("stacks.json", [])
                hit = False
                for s_ in st:
                    if old_slug in s_.get("players", []):
                        s_["players"] = [new_slug if x == old_slug else x for x in s_["players"]]; hit = True
                if hit:
                    self.extra_writes.append(lambda: save_json("stacks.json", st))
                    self.note("Solo-queue stacks: update.")

    def rename_team(self, old, new):
        old, new = (old or "").strip(), (new or "").strip()
        if not old or not new:
            raise RosterError("Both names are required.")
        if norm(old) == norm(new):
            raise RosterError("That's the same name.")
        if self.page_team(new):
            raise RosterError(f"A team called '{new}' already exists.")
        page = self.page_team(old)
        if page:
            old = page
            for r in self.team_rows():
                if r[0].strip() == old:
                    r[0] = new
            self.teams_csv.dirty = True
            for sh in (self.pro, self.am):
                for r in sh.rows[1:]:
                    if r and len(r) > 1 and norm(r[1]) == norm(old):
                        r[1] = new; sh.dirty = True
            b = roster_blocks(self.rtxt).get(norm(old))
            if b:
                hl = self.rtxt.lines[b["header"]]
                self.rtxt.lines[b["header"]] = hl.replace(b["name"], new, 1); self.rtxt.dirty = True
            for k, v in list(self.teamch.items()):
                if norm(v) == norm(old):
                    self.teamch[k] = new
            self.teamch[old] = new; self.dirty_json.add("team_changes.json")
            os_, ns_ = slug(old), slug(new)
            if os_ in self.prov.get("slugs", []):
                self.prov["slugs"] = [ns_ if s_ == os_ else s_ for s_ in self.prov["slugs"]]
                self.dirty_json.add("provisional_teams.json")
            tb = load_json("team_bios_override.json", {})
            for key in (os_, norm(old)):
                if key in tb:
                    tb[ns_] = tb.pop(key)
                    self.extra_writes.append(lambda: save_json("team_bios_override.json", tb))
            logo = next((f for f in os.listdir(LOGO_DIR) if norm(os.path.splitext(f)[0]) == norm(old)), None)
            if logo:
                ext = os.path.splitext(logo)[1]
                newfile = re.sub(r'[\\/:*?"<>|]', "", new) + ext
                def mv_logo(logo=logo, newfile=newfile):
                    os.replace(os.path.join(LOGO_DIR, logo), os.path.join(LOGO_DIR, newfile))
                    stale = os.path.join(SITE, "assets", "teams", logo)
                    if os.path.exists(stale):
                        os.remove(stale)
                self.extra_writes.append(mv_logo)
                self.note(f"Logo: {logo} → {newfile}.")
            self.note(f"{old} is now {new}: team page, rosters, sheets and rosters.txt. Past events show the new "
                      "name (team_changes.json alias).")
            self._relink_slug("team", os_, ns_)
            if ns_ in ("beehyve", "eiromancers") or os_ in ("beehyve", "eiromancers"):
                self.note("Heads-up: this team is tag-less in the veto simulator (VETO_NOTAG in app.js); ask Claude to update it.")
        else:
            self._rename_adhoc(old, new)
        for mv in self.moves:
            for f in ("from", "to"):
                if norm(mv.get(f)) == norm(old):
                    mv[f] = new; self.dirty_json.add("roster_moves.json")
        if any(norm(t) == norm(old) for t in self.disb.get("teams", [])):
            self.disb["teams"] = [new if norm(t) == norm(old) else t for t in self.disb["teams"]]
            self.dirty_json.add("disbanded_teams.json")

    def _rename_adhoc(self, old, new):
        """An event-only team (no page): rename it inside the events that use it."""
        hist = load_json("hist_rosters.json", {})
        ms = load_json("match_stats.json", {})
        events = []
        for ev, rows in hist.items():
            for row in rows:
                if norm(row.get("team")) == norm(old):
                    row["team"] = new; events.append(ev)
        hit_ms = False
        for ev, refs in ms.items():
            for ref, rec in refs.items():
                for mp in rec.get("maps", []):
                    for pl in mp.get("players", []):
                        if norm(pl.get("team")) == norm(old):
                            pl["team"] = new; hit_ms = True
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import manual
        mans = []
        for fn in os.listdir(os.path.join(DATA, "manual")):
            man = manual.load(fn[:-5])
            if not man:
                continue
            s = json.dumps(man, ensure_ascii=False)
            if json.dumps(old, ensure_ascii=False) not in s:
                continue
            def walk(o):
                if isinstance(o, dict):
                    return {(new if k == old else k): walk(v) for k, v in o.items()}
                if isinstance(o, list):
                    return [walk(x) for x in o]
                return new if o == old else o
            mans.append(walk(man))
        am_hit = False
        for r in self.am.rows[1:]:
            if r and len(r) > 1 and norm(r[1]) == norm(old):
                r[1] = new; am_hit = True
        if am_hit:
            self.am.dirty = True
        if not (events or hit_ms or mans or am_hit):
            raise RosterError(f"No team called '{old}' was found.")
        if events:
            self.extra_writes.append(lambda: save_json("hist_rosters.json", hist))
        if hit_ms:
            self.extra_writes.append(lambda: save_json("match_stats.json", ms))
        for m in mans:
            self.extra_writes.append(lambda m=m: manual.save(m))
        where = sorted(set(events) | {m["slug"] for m in mans})
        self.note(f"{old} is now {new} in: {', '.join(where) or 'the amateur sheet'}"
                  + (" (and its recorded scoreboards)." if hit_ms else "."))

    def promote_team(self, name, tag, players, logo_data=None, provisional=False, origin="", notes=""):
        name, tag = (name or "").strip(), (tag or "").strip()
        if not name:
            raise RosterError("Team name is required.")
        page = self.page_team(name)
        if page and not self.is_provisional(page):
            raise RosterError(f"{page} is already a pro team.")
        players = [x.strip() for x in (players or []) if x and x.strip()]
        if not page:
            if len(players) < 5:
                raise RosterError("Pick 5 players for the new pro team.")
            if not tag:
                raise RosterError("A tag is required (e.g. PD, Sol.).")
            if " " in tag:
                raise RosterError("The tag can't contain spaces.")
            row = [name, "0", "0", "0", "0", "0.0%", "0", "0", "0", "0", "0", "0", "0", "0"]
            self.teams_csv.rows.append(row + [""] * (self.teams_csv.width - len(row)))
            self.teams_csv.dirty = True
            self.note(f"New team page: {name} [{tag}]" + (" (provisional, not ranked yet)." if provisional else ", pro and ranked."))
            if provisional:
                self.prov["slugs"].append(slug(name)); self.dirty_json.add("provisional_teams.json")
        else:
            name = page
            if not provisional:
                self.prov["slugs"] = [s_ for s_ in self.prov["slugs"] if s_ != slug(page)]
                self.dirty_json.add("provisional_teams.json")
                self.note(f"{page}: provisional → full pro team (now ranked).")
        resolved = [self.player(x) for x in players]
        if not roster_blocks(self.rtxt).get(norm(name)):
            if not tag and not page:
                raise RosterError("A tag is required.")
            header = name + (f" ({origin})" if origin else "") + (f" [{notes}]" if notes else "")
            names = [p["name"] for p in resolved]
            add = _bot_line("bot_add", tag, names, True)
            ct = _bot_line("bot_add_ct", tag, names, True)
            if self.rtxt.lines and self.rtxt.lines[-1].strip():
                self.rtxt.lines.append("")
            self.rtxt.lines += [header, add, ct]
            self.rtxt.dirty = True
            self.note(f"rosters.txt: add {poss(name)} block with in-game tag '{tag}'.")
        if norm(name) in {norm(t) for t in self.disb.get("teams", [])}:
            self.disb["teams"] = [t for t in self.disb["teams"] if norm(t) != norm(name)]
            self.dirty_json.add("disbanded_teams.json")
            self.note(f"{name} removed from the disbanded list.")
        signed, kept = [], []
        for p in resolved:
            frm = self.current_team(p)
            self._set_team(p["name"], name, p.get("role", ""), quiet=True)
            if norm(frm) != norm(name):
                self._log_move(p["name"], frm, name, self.league_today()); signed.append(p["name"])
            else:
                kept.append(p["name"])
        if kept:
            self.note(f"Roster carried over: {', '.join(kept)} (their stats and history come with them).")
        if signed:
            self.note(f"Signed from elsewhere: {', '.join(signed)}.")
        if logo_data:
            self._save_logo(name, logo_data)

    def _save_logo(self, team, data_url):
        m = re.match(r"data:image/[a-zA-Z+.-]+;base64,(.*)$", data_url or "", re.S)
        if not m:
            raise RosterError("The logo must be an image file.")
        raw = base64.b64decode(m.group(1))
        from PIL import Image
        img = Image.open(io.BytesIO(raw))
        img.load()
        if img.mode not in ("RGBA", "LA"):
            img = img.convert("RGBA")
        img.thumbnail((512, 512))
        fname = re.sub(r'[\\/:*?"<>|]', "", team) + ".png"
        def write():
            for f in os.listdir(LOGO_DIR):                 # replace any older logo for this team
                if norm(os.path.splitext(f)[0]) == norm(team):
                    os.remove(os.path.join(LOGO_DIR, f))
            img.save(os.path.join(LOGO_DIR, fname))
        self.extra_writes.append(write)
        self.note(f"Logo: save assets/teams/{fname} ({img.width}×{img.height}).")

    def disband(self, team, when=None):
        team = (team or "").strip()
        page = self.page_team(team)
        members = [p for p in self.players if norm(p.get("team")) == norm(team)]
        if not members and not page:
            raise RosterError(f"No current players are on '{team}'.")
        when = when or self.league_today()
        for p in members:
            self._set_team(p["name"], "", p.get("role", ""), quiet=True)
            self._log_move(p["name"], page or team, FREE_AGENT, when)
            if not page:
                self._live_warning(p, FREE_AGENT)
        if not page and norm(team) not in {norm(t) for t in self.disb.get("teams", [])}:
            self.disb.setdefault("teams", []).append(team)
            self.dirty_json.add("disbanded_teams.json")
            self.note(f"{team} added to the disbanded list: it stays on past event rosters, but no longer "
                      "re-homes its players in a live event.")
        if page:
            self.note(f"{page}'s team page stays (history, trophies, former players); it just has no roster now.")
        self.note(f"{len(members)} player(s) released to free agency.")
        if roster_blocks(self.rtxt).get(norm(page or team)):
            self.note(f"rosters.txt: {poss(page or team)} in-game lines are left as they were (history).")

    # ---------------------------------------------------------------- apply
    def write(self):
        for sh in (self.pro, self.am, self.solo, self.teams_csv):
            sh.save()
        self.allp.save(); self.rtxt.save()
        files = {"player_gender.json": self.gender, "roster_moves.json": self.moves,
                 "provisional_teams.json": self.prov, "disbanded_teams.json": self.disb,
                 "name_changes.json": self.namech, "team_changes.json": self.teamch,
                 "player_bio_notes.json": self.notes}
        for f in self.dirty_json:
            save_json(f, files[f], indent=2 if f in ("name_changes.json", "team_changes.json", "provisional_teams.json") else 1)
        for fn in self.extra_writes:
            fn()


ACTIONS = {
    "transfer": lambda r, b: r.transfer(b.get("player"), b.get("to"), b.get("date"), fee=b.get("fee") or 0),
    "add": lambda r, b: r.add_player(b.get("name"), b.get("country"), b.get("gender", ""), b.get("role", ""), b.get("team", ""), b.get("date")),
    "edit": lambda r, b: r.edit_player(b.get("player"), b.get("role") or None, b.get("country") or None, b.get("gender") or None),
    "rename_player": lambda r, b: r.rename_player(b.get("old"), b.get("new")),
    "rename_team": lambda r, b: r.rename_team(b.get("old"), b.get("new")),
    "promote": lambda r, b: r.promote_team(b.get("name"), b.get("tag"), b.get("players", []), b.get("logo"),
                                           bool(b.get("provisional")), b.get("origin", ""), b.get("notes", "")),
    "disband": lambda r, b: r.disband(b.get("team"), b.get("date")),
    "genders": lambda r, b: r.set_genders(b.get("genders") or {}),
}


def run(action, params, dry_run=True):
    if action not in ACTIONS:
        raise RosterError(f"Unknown action '{action}'.")
    r = Roster()
    ACTIONS[action](r, params)
    if not dry_run:
        r.write()
    return {"changes": r.changes}


def meta():
    """Option lists for the admin forms."""
    allp = TextFile("allplayer.txt")
    iso = country_iso()
    countries = sorted({l.split("\t")[1].strip() for l in allp.lines[1:] if "\t" in l and l.split("\t")[1].strip().lower() in iso})
    r = Roster()
    roles = sorted({row[14].strip() for sh in (r.pro, r.am) for row in sh.rows[1:] if len(row) > 14 and row[14].strip()})
    return {"countries": countries, "roles": roles}
