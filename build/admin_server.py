#!/usr/bin/env python3
"""BPL admin server: serves the site AND exposes a small write API so you can
create tournaments and enter scores from the site's Admin page. Every change
regenerates data.json so the whole site updates.

Run:  python build/admin_server.py [port]   (default 8099)
Then open http://localhost:8099/#/admin
The public/static deploy never runs this, so the Admin page is read-only there.
"""
import json, os, shutil, subprocess, sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import manual
import roster
import wrapup

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(ROOT, "site")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8099
SOLO_SB = os.path.join(ROOT, "data", "solo_scoreboards.json")

def load_solo():
    try:
        return json.load(open(SOLO_SB, encoding="utf-8"))
    except Exception:
        return []

def save_solo(lst):
    json.dump(lst, open(SOLO_SB, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

ARTICLES = os.path.join(ROOT, "data", "articles.json")

def load_articles():
    try:
        return json.load(open(ARTICLES, encoding="utf-8"))
    except Exception:
        return []

def save_articles(lst):
    json.dump(lst, open(ARTICLES, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

DRAFTS = os.path.join(ROOT, "data", "article_drafts.json")

def load_drafts():
    try:
        return json.load(open(DRAFTS, encoding="utf-8"))
    except Exception:
        return []

def save_drafts(lst):
    json.dump(lst, open(DRAFTS, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

def regenerate():
    """Re-run the data pipeline so the site reflects the latest manual edits."""
    r = subprocess.run([sys.executable, os.path.join(ROOT, "build", "parse.py")],
                       capture_output=True, text=True)
    return r.returncode == 0, (r.stderr or r.stdout)[-500:]

def deploy_guard():
    """The same check GitHub runs before deploying (build/deploy_check.py + a JS syntax check).
    Returns None if the build is fine to publish, else a message listing what's wrong."""
    sys.path.insert(0, os.path.join(ROOT, "build"))
    import importlib, deploy_check
    probs = importlib.reload(deploy_check).problems()
    node = shutil.which("node")
    if node:
        for f in sorted(os.listdir(os.path.join(ROOT, "site", "js"))):
            if f.endswith(".js"):
                r = subprocess.run([node, "--check", os.path.join(ROOT, "site", "js", f)], capture_output=True, text=True)
                if r.returncode != 0:
                    lines = r.stderr.strip().splitlines()
                    where = next((l.rsplit(":", 1)[-1] for l in lines[:1] if ":" in l), "?")
                    err = next((l for l in lines if "Error" in l), lines[-1] if lines else "?")
                    probs.append(f"JavaScript syntax error in site/js/{f} line {where}: {err[:140]}")
    if not probs:
        return None
    more = f" (+{len(probs) - 3} more, see Site Health)" if len(probs) > 3 else ""
    return (f"Not published: the deploy guard found {len(probs)} problem{'s' if len(probs) != 1 else ''}. "
            "The live site is unchanged. Fix these first: " + " | ".join(probs[:3]) + more)

def save_prize_pools(updates):
    """Merge {event slug: prize pool in USD} into data/prize_pools.json. 0 / None / "" removes an entry.
    Returns the number of events changed."""
    path = os.path.join(ROOT, "data", "prize_pools.json")
    pools = json.load(open(path, encoding="utf-8")) if os.path.exists(path) else {}
    changed = 0
    for slug, v in (updates or {}).items():
        try:
            amount = int(float(str(v).replace(",", "").replace("$", "").strip())) if v not in (None, "") else 0
        except ValueError:
            continue
        if amount > 0 and pools.get(slug) != amount:
            pools[slug] = amount; changed += 1
        elif amount <= 0 and slug in pools:
            pools.pop(slug); changed += 1
    json.dump(dict(sorted(pools.items())), open(path, "w", encoding="utf-8"), indent=1)
    return changed

def git_publish():
    """Stage all changes, commit, and push to GitHub (which auto-deploys the site).
    Returns (ok, human-readable message)."""
    def run(args):
        return subprocess.run(["git"] + args, cwd=ROOT, capture_output=True, text=True)
    blocked = deploy_guard()
    if blocked:
        return False, blocked
    try:
        add = run(["add", "-A"])
        if add.returncode != 0:
            return False, "Couldn't stage changes: " + (add.stderr or add.stdout)[-300:]
        status = run(["status", "--porcelain"])
        if not status.stdout.strip():
            return True, "Nothing new to publish — the live site is already up to date."
        commit = run(["commit", "-m", "Update stats (via admin)"])
        if commit.returncode != 0:
            return False, "Commit failed: " + (commit.stderr or commit.stdout)[-300:]
        push = run(["push"])
        if push.returncode != 0:
            return False, "Saved locally, but upload to GitHub failed: " + (push.stderr or push.stdout)[-300:]
        return True, "Published! The live site will update in about a minute."
    except FileNotFoundError:
        return False, "git is not installed or not on PATH — can't publish from here."
    except Exception as e:
        return False, "Publish error: " + str(e)

def team_names():
    try:
        d = json.load(open(os.path.join(SITE, "data.json"), encoding="utf-8"))
        return [t["name"] for t in d.get("teams", [])]
    except Exception:
        return []

class Handler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"          # keep-alive + clean Content-Length framing (no RST on close)
    def __init__(self, *a, **k):
        super().__init__(*a, directory=SITE, **k)
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()
    def log_message(self, *a):
        pass

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(n) or b"{}")

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/state":
            return self._json(200, {"ok": True, "admin": True,
                                    "tournaments": manual.list_manual(), "teams": team_names()})
        if path == "/api/drafts":
            return self._json(200, {"ok": True, "drafts": load_drafts()})
        if path == "/api/roster/meta":
            return self._json(200, {"ok": True, **roster.meta()})
        if path == "/api/solo/list":
            return self._json(200, {"ok": True, "games": load_solo()})
        if path.startswith("/api/wrapup/"):
            try:
                return self._json(200, {"ok": True, **wrapup.suggest(path[len("/api/wrapup/"):])})
            except roster.RosterError as e:
                return self._json(400, {"ok": False, "error": str(e)})
        if path == "/api/seeds":
            from urllib.parse import parse_qs
            name = (parse_qs(urlparse(self.path).query).get("name") or [""])[0]
            return self._json(200, {"ok": True, "seeds": wrapup.seeds_for(name)})
        if path.startswith("/api/manual/"):
            slug = path[len("/api/manual/"):]
            man = manual.load(slug)
            if not man:
                return self._json(404, {"ok": False, "error": "not found"})
            resolved = {}
            for st in man.get("stages", []):
                res, _ = manual.stage_resolved(st)
                resolved[str(st["id"])] = {str(k): v for k, v in res.items()}
            std = manual.to_standard(man)
            return self._json(200, {"ok": True, "manual": man, "resolved": resolved,
                                    "champion": std.get("champion")})
        return super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            b = self._body()
            man = None
            if path == "/api/create":
                if not b.get("name"):
                    return self._json(400, {"ok": False, "error": "name required"})
                man = manual.create(b["name"], b.get("tier", "a"), b.get("date", ""))
                if b.get("prizePool"):
                    save_prize_pools({man["slug"]: b["prizePool"]})
                ok, msg = regenerate()
                return self._json(200, {"ok": ok, "slug": man["slug"], "msg": msg})
            elif path == "/api/prizepools":
                n = save_prize_pools(b.get("pools") or {})
                ok, msg = regenerate()
                return self._json(200, {"ok": ok, "changed": n, "msg": msg})
            elif path == "/api/stage/add":
                man = manual.add_stage(b["slug"], b.get("name", ""), b.get("format", "single_elim"),
                                       b.get("teams", []), b.get("bestOf", 1))
            elif path == "/api/stage/rename":
                man = manual.rename_stage(b["slug"], b["sid"], b.get("name", ""))
            elif path == "/api/stage/reseed":
                man = manual.reseed(b["slug"], b["sid"], b.get("teams", []))
            elif path == "/api/stage/bestof":
                man = manual.set_bestof(b["slug"], b["sid"], b.get("bestOf", 1))
            elif path == "/api/stage/delete":
                man = manual.del_stage(b["slug"], b["sid"])
            elif path == "/api/score":
                man = manual.set_score(b["slug"], b["sid"], b["matchId"], b.get("sa"), b.get("sb"))
            elif path == "/api/match/add":
                man = manual.add_match(b["slug"], b["sid"], b.get("round", 1), b.get("a"), b.get("b"))
            elif path == "/api/match/delete":
                man = manual.del_match(b["slug"], b["sid"], b["matchId"])
            elif path == "/api/round/rename":
                man = manual.rename_round(b["slug"], b["sid"], b["round"], b.get("title", ""))
            elif path == "/api/matchstats":
                manual.save_match_stats(b["slug"], b["ref"], b.get("maps", []))
                ok, msg = regenerate()
                return self._json(200, {"ok": ok, "msg": msg})
            elif path == "/api/solo/add":
                games = load_solo()
                nid = max([g.get("id", 0) for g in games], default=0) + 1
                players = [{"name": (p.get("name") or "").strip(),
                            "k": int(p.get("k", 0) or 0), "d": int(p.get("d", 0) or 0),
                            "a": int(p.get("a", 0) or 0), "mvp": int(p.get("mvp", 0) or 0),
                            "won": bool(p.get("won"))}
                           for p in b.get("players", []) if (p.get("name") or "").strip()]
                games.append({"id": nid, "map": b.get("map", ""), "date": b.get("date", ""), "players": players})
                save_solo(games); ok, msg = regenerate()
                return self._json(200, {"ok": ok, "msg": msg, "id": nid})
            elif path == "/api/solo/delete":
                save_solo([g for g in load_solo() if g.get("id") != b.get("id")])
                ok, msg = regenerate()
                return self._json(200, {"ok": ok, "msg": msg})
            elif path == "/api/predlock":
                man = manual.set_predictions_locked(b["slug"], b.get("locked", True))
            elif path == "/api/complete":
                man = manual.set_completed(b["slug"], b.get("completed", True))
            elif path == "/api/article/save":
                if not (b.get("title") or "").strip():
                    return self._json(400, {"ok": False, "error": "title required"})
                arts = load_articles()
                slug = (b.get("slug") or "").strip() or manual.slugify(b["title"])
                art = {"slug": slug, "title": b["title"].strip(),
                       "date": (b.get("date") or "").strip(), "author": (b.get("author") or "").strip(),
                       "body": b.get("body") or ""}
                arts = [a for a in arts if a.get("slug") != slug]      # replace when editing
                arts.append(art)
                save_articles(arts)
                if b.get("draftId"):                                 # publishing a draft removes it
                    save_drafts([d for d in load_drafts() if d.get("id") != b["draftId"]])
                ok, msg = regenerate()
                return self._json(200, {"ok": ok, "msg": msg, "slug": slug})
            elif path == "/api/draft/delete":
                save_drafts([d for d in load_drafts() if d.get("id") != b.get("id")])
                return self._json(200, {"ok": True})
            elif path == "/api/article/delete":
                save_articles([a for a in load_articles() if a.get("slug") != b.get("slug")])
                ok, msg = regenerate()
                return self._json(200, {"ok": ok, "msg": msg})
            elif path == "/api/delete":
                manual.delete(b["slug"]); ok, msg = regenerate()
                return self._json(200, {"ok": ok, "msg": msg})
            elif path == "/api/roster":
                # roster tools: dryRun -> preview of every change; otherwise apply + rebuild
                try:
                    res = roster.run(b.get("action"), b, dry_run=bool(b.get("dryRun", True)))
                except roster.RosterError as e:
                    return self._json(400, {"ok": False, "error": str(e)})
                if b.get("dryRun", True):
                    return self._json(200, {"ok": True, "changes": res["changes"]})
                ok, msg = regenerate()
                return self._json(200, {"ok": ok, "changes": res["changes"], "msg": msg})
            elif path == "/api/wrapup":
                # event wrap-up: dryRun -> preview of every change; otherwise apply + rebuild
                try:
                    res = wrapup.run(b.get("slug"), b.get("rules") or {}, dry_run=bool(b.get("dryRun", True)))
                except roster.RosterError as e:
                    return self._json(400, {"ok": False, "error": str(e)})
                if b.get("dryRun", True):
                    return self._json(200, {"ok": True, "changes": res["changes"]})
                ok, msg = regenerate()
                return self._json(200, {"ok": ok, "changes": res["changes"], "msg": msg})
            elif path == "/api/teamcolor":
                # team page header colour; color=None goes back to the colour taken from the logo
                import extras
                try:
                    extras.save_team_color(os.path.join(ROOT, "data"), b["team"], b.get("color"))
                except ValueError as e:
                    return self._json(400, {"ok": False, "error": str(e)})
                ok, msg = regenerate()
                return self._json(200, {"ok": ok, "msg": msg})
            elif path == "/api/publish":
                ok, msg = git_publish()
                return self._json(200, {"ok": ok, "msg": msg})
            else:
                return self._json(404, {"ok": False, "error": "unknown endpoint"})
            if man is None:
                return self._json(404, {"ok": False, "error": "not found"})
            ok, msg = regenerate()
            return self._json(200, {"ok": ok, "msg": msg})
        except Exception as e:
            return self._json(500, {"ok": False, "error": str(e)})

if __name__ == "__main__":
    print(f"BPL ADMIN server on http://localhost:{PORT}/   (editing enabled)")
    print(f"Open http://localhost:{PORT}/#/admin")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
