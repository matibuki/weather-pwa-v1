#!/usr/bin/env python3
"""Tiny local static + CORS proxy for the Lublin weather dashboard.

Why: pogoda.umcs.pl/api/stations/{id} has no Access-Control-Allow-Origin, so a
file:// (or even http://localhost) page cannot fetch it directly. This process:
  1) serves an allowlisted set of dashboard files from this directory
  2) proxies UMCS station JSON under /umcs/stations/<id> with CORS *

Usage:
  python3 local-proxy.py
  open http://127.0.0.1:8765/

Env:
  PORT=8765  (optional)
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
PORT = int(os.environ.get("PORT", "8765"))
UMCS_UPSTREAM = "https://pogoda.umcs.pl/api/stations/{id}"
UA = "lublin-dashboard-local-proxy/1.0 (+personal; contact: local)"

# Only these files are served as static content (no .git, no arbitrary paths).
STATIC_ALLOWLIST = {
    "index.html",
    "game.html",
    "ARCHITECTURE.md",
    "AGENTS.md",
}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Accept")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path.startswith("/umcs/stations/"):
            return self._proxy_umcs(path)

        if path in ("/", "/index.html"):
            self.path = "/index.html"
            return super().do_GET()

        rel = path.lstrip("/")
        if rel in STATIC_ALLOWLIST and (ROOT / rel).is_file():
            return super().do_GET()

        self.send_error(404, "Not found")

    def _proxy_umcs(self, path: str):
        sid = path.rstrip("/").split("/")[-1]
        if not sid.isdigit():
            self.send_error(400, "station id must be numeric")
            return
        url = UMCS_UPSTREAM.format(id=sid)
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                body = resp.read()
                ctype = resp.headers.get("Content-Type", "application/json")
        except urllib.error.HTTPError as e:
            body = e.read() or str(e).encode()
            self.send_response(e.code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(body if body.startswith(b"{") else json.dumps({"error": str(e)}).encode())
            return
        except Exception as e:
            self.send_response(502)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(json.dumps({"error": f"UMCS proxy failed: {e}"}).encode())
            return

        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))


def main():
    httpd = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Lublin dashboard proxy on http://127.0.0.1:{PORT}/")
    print(f"  dashboard: http://127.0.0.1:{PORT}/")
    print(f"  UMCS proxy: http://127.0.0.1:{PORT}/umcs/stations/16")
    print("Ctrl+C to stop.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")


if __name__ == "__main__":
    main()
