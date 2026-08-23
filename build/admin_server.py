#!/usr/bin/env python3
"""BPL admin server: serves the site AND exposes a small write API so you can
create tournaments and enter scores from the site's Admin page. Every change
regenerates data.json so the whole site updates.

Run:  python build/admin_server.py [port]   (default 8099)
Then open http://localhost:8099/#/admin
The public/static deploy never runs this, so the Admin page is read-only there.
"""
import json, os, subprocess, sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import manual

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

def regenerate():
    """Re-run the data pipeline so the site reflects the latest manual edits."""
    r = subprocess.run([sys.executable, os.path.join(ROOT, "build", "parse.py")],
                       capture_output=True, text=True)
    return r.returncode == 0, (r.stderr or r.stdout)[-500:]

def git_publish():
    """Stage all changes, commit, and push to GitHub (which auto-deploys the site).
    Returns (ok, human-readable message)."""
    def run(args):
        return subprocess.run(["git"] + args, cwd=ROOT, capture_output=True, text=True)
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
        if path == "/api/solo/list":
            return self._json(200, {"ok": True, "games": load_solo()})
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
                ok, msg = regenerate()
                return self._json(200, {"ok": ok, "slug": man["slug"], "msg": msg})
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
            elif path == "/api/delete":
                manual.delete(b["slug"]); ok, msg = regenerate()
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
