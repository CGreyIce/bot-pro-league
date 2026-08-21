#!/usr/bin/env python3
"""Threaded static server for the BPL site (handles parallel asset requests
without the connection resets you get from the default single-threaded server).

Run:  python build/serve.py [port]
"""
import os, sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(ROOT, "site")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8099

class Handler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"          # keep-alive + Content-Length so large files close cleanly
    def __init__(self, *a, **k):
        super().__init__(*a, directory=SITE, **k)
    def end_headers(self):
        # no caching so edits show up on reload during development
        self.send_header("Cache-Control", "no-store")
        super().end_headers()
    def log_message(self, *a):
        pass

if __name__ == "__main__":
    httpd = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"BPL site serving at http://localhost:{PORT}/  (Ctrl+C to stop)")
    httpd.serve_forever()
