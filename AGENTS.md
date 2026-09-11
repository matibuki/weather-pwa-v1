# Agent instructions

Before making changes in this repo, read `ARCHITECTURE.md` and follow its
guidelines. When you make an architectural decision or change a convention,
update `ARCHITECTURE.md` in the same change.

Key rules (see `ARCHITECTURE.md` for details):

- The dashboard (`index.html`) is a single dependency-free file that must work
  from `file://` for CORS-open sources. No build step, no frameworks.
- UMCS tabs require `python3 local-proxy.py` (serves `http://127.0.0.1:8765/` and
  CORS-proxies `pogoda.umcs.pl`). The proxy only allowlists dashboard files.
- All user-facing text is in **Polish**; code/comments/docs stay in English.
- To add a weather source, write a loader returning the normalized shape and
  register it in the `SOURCES` array — do not special-case the UI per source.
- Never commit a real meteoblue API key; use `localStorage.meteoblueApiKey`.
