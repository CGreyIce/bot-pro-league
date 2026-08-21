#!/usr/bin/env python3
"""One-off local collector: receives POSTed tournament JSON from the browser and
writes it to data/tournaments/<slug>.json. Lets the in-app browser (on the
challonge.com origin) dump extracted bracket data straight to disk without
round-tripping it through the chat tool channel.

Run:  python build/collector.py   (Ctrl+C when scraping is done)
"""
import json, os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "tournaments")
os.makedirs(OUT, exist_ok=True)
PORT = 8100

class H(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.end_headers()
    def do_GET(self):
        files = sorted(os.listdir(OUT))
        body = json.dumps({"saved": files, "count": len(files)}).encode()
        self.send_response(200); self._cors()
        self.send_header("Content-Type", "application/json"); self.end_headers()
        self.wfile.write(body)
    def do_POST(self):
        q = parse_qs(urlparse(self.path).query)
        slug = (q.get("slug", ["unknown"])[0]).replace("/", "_").replace("\\", "_")
        n = int(self.headers.get("Content-Length", 0))
        data = self.rfile.read(n)
        try:
            json.loads(data)  # validate
            with open(os.path.join(OUT, slug + ".json"), "wb") as f:
                f.write(data)
            ok = True
        except Exception as e:
            ok = False
            print("bad payload for", slug, e)
        self.send_response(200 if ok else 400); self._cors()
        self.send_header("Content-Type", "application/json"); self.end_headers()
        self.wfile.write(json.dumps({"ok": ok, "slug": slug, "bytes": n}).encode())
    def log_message(self, *a):
        pass

if __name__ == "__main__":
    print(f"Collector on http://localhost:{PORT}/  -> {OUT}")
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
