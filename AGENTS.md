# Agent notes — Pogoda Lublin (PWA)

- Branch work for the PWA lives on `pwa-swap` (tag `v1` is the pre-PWA static snapshot on `master`).
- Serve with `python3 local-proxy.py` and open `http://127.0.0.1:8765/` — needed for the
  service worker and for UMCS tabs (`/umcs/stations/{id}`).
- Do **not** commit a meteoblue API key; it belongs in `localStorage.meteoblueApiKey`.
- Static allowlist is in `local-proxy.py` (`STATIC_ALLOWLIST`); add new shell files there.
- No bundler: edit `index.html`, `css/app.css`, `js/app.js`, `sw.js`, `manifest.webmanifest` directly.
- After changing `sw.js` or shell assets, hard-refresh or bump the `CACHE` name in `sw.js`.
