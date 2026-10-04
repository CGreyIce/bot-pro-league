#!/usr/bin/env python3
"""Wikipedia-style links for articles: [[Name]] -> a link to that player, team or event page.

  [[rebebx]]                      -> [rebebx](#/player/rebebx)
  [[Aimpunch|the champions]]      -> [the champions](#/team/aimpunch)     (custom link text)
  [[team:Opal]] [[player:X]] [[event:Bot Pro Cup 2026]]                   (force the kind if a name is ambiguous)

Old player names (name_changes.json) and renamed teams (team_changes.json) still resolve to the
current page. Unknown names are left as plain text and reported, so Site Health can flag them.
"""
import json, os, re, unicodedata

WIKI_RE = re.compile(r"\[\[([^\[\]|]+?)(?:\|([^\[\]]+?))?\]\]")
KINDS = {"player": "player", "team": "team", "event": "tournament", "tournament": "tournament"}
ORDER = ("team", "player", "tournament")        # priority when a bare name matches several kinds


def norm(s):
    s = unicodedata.normalize("NFKD", s or "")
    return re.sub(r"[^a-z0-9]", "", s.lower())


class Index:
    def __init__(self, players, teams, tournaments, data_dir=None):
        self.by_kind = {"player": {}, "team": {}, "tournament": {}}
        for p in players:
            self.by_kind["player"].setdefault(norm(p["name"]), (p["slug"], p["name"]))
        for t in teams:
            self.by_kind["team"][norm(t["name"])] = (t["slug"], t["name"])
        for tr in tournaments:
            self.by_kind["tournament"].setdefault(norm(tr["name"]), (tr["slug"], tr["name"]))
        if data_dir:                                # aliases: old player / team names
            for fname, kind in (("name_changes.json", "player"), ("team_changes.json", "team")):
                p = os.path.join(data_dir, fname)
                if not os.path.exists(p):
                    continue
                for old, new in json.load(open(p, encoding="utf-8")).items():
                    tgt = self.by_kind[kind].get(norm(new))
                    if tgt and norm(old) not in self.by_kind[kind]:
                        self.by_kind[kind][norm(old)] = tgt

    def lookup(self, raw):
        """-> (kind, slug, canonical name, ambiguous) or None."""
        name, kind = raw.strip(), None
        m = re.match(r"^(player|team|event|tournament)\s*:\s*(.+)$", name, re.I)
        if m:
            kind, name = KINDS[m.group(1).lower()], m.group(2).strip()
        k = norm(name)
        if kind:
            hit = self.by_kind[kind].get(k)
            return (kind, hit[0], hit[1], False) if hit else None
        hits = [(kd, self.by_kind[kd][k]) for kd in ORDER if k in self.by_kind[kd]]
        if not hits:
            return None
        kd, (slug, canon) = hits[0]
        return kd, slug, canon, len(hits) > 1

    def resolvable(self, name):
        return self.lookup(name) is not None


def resolve(body, index):
    """-> (markdown body with [[...]] turned into links, unresolved names, ambiguous names)."""
    unresolved, ambiguous = [], []

    def sub(m):
        raw, label = m.group(1), m.group(2)
        hit = index.lookup(raw)
        shown = (label or re.sub(r"^(player|team|event|tournament)\s*:\s*", "", raw.strip(), flags=re.I)).strip()
        if not hit:
            unresolved.append(raw.strip())
            return shown
        kind, slug, _, amb = hit
        if amb:
            ambiguous.append(raw.strip())
        return f"[{shown}](#/{kind}/{slug})"

    return WIKI_RE.sub(sub, body or ""), unresolved, ambiguous


def link(name, index, label=None):
    """[[name]] when it resolves, else the plain name (for generated drafts)."""
    if name and index.resolvable(name):
        return f"[[{name}|{label}]]" if label else f"[[{name}]]"
    return label or name or ""
