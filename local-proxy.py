#!/usr/bin/env python3
"""Local static server + CORS proxy for the Lublin weather PWA.

Why: pogoda.umcs.pl/api/stations/{id} has no Access-Control-Allow-Origin, so the
app cannot fetch it directly. Service workers also need http(s):// (not file://).
This process:
  1) serves the PWA shell (HTML/CSS/JS/manifest/icons/sw) from this directory
  2) proxies UMCS station JSON under /umcs/stations/<id> with CORS *

Usage:
  python3 local-proxy.py
  open http://127.0.0.1:8765/

Env:
  PORT=8765  (optional)
"""
from __future__ import annotations

import json
import mimetypes
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

# Explicit allowlist — no .git, no arbitrary path traversal.
STATIC_ALLOWLIST = {
    "index.html",
    "game.html",
    "ARCHITECTURE.md",
    "AGENTS.md",
    "manifest.webmanifest",
    "sw.js",
    "css/app.css",
    "js/app.js",
    "icons/icon.svg",
    "icons/icon-192.png",
    "icons/icon-512.png",
}

mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("image/svg+xml", ".svg")


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Accept")
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
            return self._send_static("index.html", cache="no-cache")

        rel = path.lstrip("/")
        if rel in STATIC_ALLOWLIST and (ROOT / rel).is_file():
            # SW must be network-fresh; shell assets can be revalidated.
            if rel == "sw.js":
                return self._send_static(rel, cache="no-cache")
            if rel.endswith((".html", ".webmanifest")):
                return self._send_static(rel, cache="no-cache")
            return self._send_static(rel, cache="public, max-age=3600")

        self.send_error(404, "Not found")

    def _send_static(self, rel: str, cache: str):
        file_path = ROOT / rel
        data = file_path.read_bytes()
        ctype = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
        if rel.endswith(".webmanifest"):
            ctype = "application/manifest+json"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", cache)
        self.end_headers()
        self.wfile.write(data)

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
                status = resp.status
                ctype = resp.headers.get("Content-Type", "application/json")
        except urllib.error.HTTPError as e:
            body = e.read() if e.fp else b"{}"
            status = e.code
            ctype = "application/json"
        except Exception as e:
            payload = json.dumps({"error": str(e)}).encode()
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(payload)
            return

        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def main():
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"PWA + UMCS proxy at http://127.0.0.1:{PORT}/", flush=True)
    print("Allowlisted static files:", ", ".join(sorted(STATIC_ALLOWLIST)), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nbye", flush=True)


if __name__ == "__main__":
    main()
