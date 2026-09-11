# Pogoda Lublin (weather-pwa-v1)

Personal Lublin weather PWA — multi-source consensus, e-ink UI.

## Run

```bash
python3 local-proxy.py
# open http://127.0.0.1:8765/
```

Service worker + UMCS proxy require localhost HTTP (not `file://`).

## Layout

- `index.html` — app shell
- `css/app.css`, `js/app.js` — UI + data
- `manifest.webmanifest`, `sw.js`, `icons/` — PWA
- `local-proxy.py` — static allowlist + UMCS CORS proxy
