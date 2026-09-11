# Architecture guidelines

Guidelines for the Lublin weather dashboard (`index.html`). Update this file as decisions are made.

## PWA

- Installable via `manifest.webmanifest` (standalone, e-ink theme colors).
- `sw.js` precaches the app shell; weather API responses are **network-only**
  (fresh forecasts). UMCS proxy path is network-first with a 503 JSON fallback.
- Run: `python3 local-proxy.py` → open `http://127.0.0.1:8765/` → Install app
  in the browser if offered.

## Visual theme

- Full UI uses a Kindle-like **e-ink** look: warm paper background, grayscale
  ink, serif type, flat matte cards/tabs (no bright accent colors).

## Product

A single-page, personal (non-commercial) dashboard that aggregates weather data
from multiple sources for one location, computes a consensus (average, min, max,
spread) per metric, and lists the details for the current time.

## Structure

- **PWA** (no build step, no bundler deps):
  - `index.html` — app shell + SW registration
  - `css/app.css` — e-ink theme
  - `js/app.js` — sources, consensus, tabs
  - `manifest.webmanifest`, `sw.js`, `icons/` — installability + offline shell
  - `local-proxy.py` — **required** for PWA features and UMCS: serves the app at
    `http://127.0.0.1:8765/` and CORS-proxies UMCS JSON. Service workers do not
    register on `file://`; open via the proxy (or any http localhost server).
- **Tabbed layout:**
  - `Dashboard` (landing) — compact phone-widget summary: consensus icon, average
    temperature, rain chance now/today, wind, pressure, and daypart temps
    (≈7 / 10–12 / ≈15 / ≈18 / ≈21 Europe/Warsaw). Default tab on load.
  - `Główna` (main) — full aggregates: average/min/max/spread of temperature,
    rain banner, per-source comparison tables.
  - One tab per source (`ICM UM`, then others).
  - `About` — short product description plus source attribution (no global footer).
  - Placeholder tabs for not-yet-added sources are disabled and marked `(wkrótce)`.

## Sources

| id | name | kind | endpoint | notes |
|----|------|------|----------|-------|
| `icm` | ICM UM | `forecast` | `devmgramapi.meteo.pl` (unofficial, CORS `*`) | 60 h hourly series + meteorogram image |
| `imgw` | IMGW-PIB | `observation` | `danepubliczne.imgw.pl/api/data/synop/id/12495` (Lublin) | single current measurement, no hourly series |
| `openmeteo` | Open-Meteo | `forecast` | `api.open-meteo.com/v1/forecast` (free, keyless, CORS `*`) | Default best-match blend; 72 h hourly series; metric units requested directly; CC-BY 4.0. No per-hour min/max (nulls). Occasionally returns `relative_humidity_2m = 0` — rendered as-is, upstream quirk |
| `meteoblue` | meteoblue | `forecast` | `api.meteoblue.com/packages/basic-1h` (free tier, **requires API key**, CORS `*`) | meteoblue's own forecast engine → adds genuine model diversity to the average. Free trial allows 1 h resolution only for `basic-1h` (clouds/wind at 1 h are paid), so `clouds` and `gustMs` stay `null`; no dew point / per-hour min-max either. Requested `temperature=C`, `windspeed=m/s`, `tz=UTC` (times come back as `YYYY-MM-DD HH:mm` in UTC). Weather icon comes from meteoblue's hourly `pictocode` (1–35), not cloud cover. Key lives in `localStorage.meteoblueApiKey` — see exception below |
| `metno` | MET Norway | `forecast` | `api.met.no/weatherapi/locationforecast/2.0/compact` (free, keyless, CORS `*`) | For Poland (“rest of world”) upstream is **ECMWF HRES** + MET post-processing (overlaps `om-ecmwf`). Compact: precip from `next_1_hours`; often no precipProb / feels / dew; CC BY 4.0 |
| `wttr` | wttr.in | `forecast` | `wttr.in/Lublin?format=j1` (free, keyless, CORS `*`) | Aggregator; `j1` JSON is WorldWeatherOnline-shaped. Multi-day 3-hourly; wind km/h → m/s; local Europe/Warsaw civil times |
| `om-gfs` | Open-Meteo GFS | `forecast` | `api.open-meteo.com/v1/forecast?models=gfs_seamless` | NOAA / NCEP **GFS** via Open-Meteo |
| `om-icon` | Open-Meteo ICON | `forecast` | `api.open-meteo.com/v1/forecast?models=icon_seamless` | DWD **ICON** via Open-Meteo |
| `om-ecmwf` | Open-Meteo ECMWF | `forecast` | `api.open-meteo.com/v1/forecast?models=ecmwf_ifs025` | **ECMWF IFS** 0.25° via Open-Meteo |
| `om-gem` | Open-Meteo GEM | `forecast` | `api.open-meteo.com/v1/forecast?models=gem_seamless` | Environment Canada **GEM** via Open-Meteo |
| `om-meteofrance` | Open-Meteo Météo-France | `forecast` | `api.open-meteo.com/v1/forecast?models=meteofrance_seamless` | **Météo-France** ARPEGE/AROME seamless via Open-Meteo |
| `om-ukmo` | Open-Meteo UKMO | `forecast` | `api.open-meteo.com/v1/forecast?models=ukmo_seamless` | UK Met Office **UKMO** via Open-Meteo (≠ ICM UM, which is a local Unified Model run) |
| `om-jma` | Open-Meteo JMA | `forecast` | `api.open-meteo.com/v1/forecast?models=jma_seamless` | Japan Meteorological Agency **JMA** via Open-Meteo |
| `om-cma` | Open-Meteo CMA | `forecast` | `api.open-meteo.com/v1/forecast?models=cma_grapes_global` | China Meteorological Administration **GRAPES** via Open-Meteo |
| `imgw-ostrowek` | IMGW Ostrówek | `observation` | `danepubliczne.imgw.pl/api/data/meteo` (kod `251220230`) | IMGW climate/meteo network neighbor (Ostrówek-Kolonia); **not** the Radawiec synop site. `precip` = 10‑min tip |
| `imgw-wysokie` | IMGW Wysokie | `observation` | `danepubliczne.imgw.pl/api/data/meteo` (kod `250220030`) | IMGW climate/meteo neighbor south of Lublin |
| `imgw-hydro-lublin` | IMGW Bystrzyca | `observation` | `danepubliczne.imgw.pl/api/data/hydro` (id `151220070`) | Hydrology gauge Lublin/Bystrzyca (level, flow). Excluded from forecast average; details in `extraHtml` |
| `umcs-litewski` | UMCS Plac Litewski | `observation` | `pogoda.umcs.pl/api/stations/16` via `local-proxy.py` | True Lublin city station (UMCS). Needs local CORS proxy — API itself sends no ACAO |
| `umcs-zemborzycka` | UMCS Zemborzycka | `observation` | `pogoda.umcs.pl/api/stations/17` via `local-proxy.py` | UMCS / MPWiK Zemborzycka station; same proxy requirement |

### Source eligibility (hard constraints)

A source must be **free, CORS-open, and callable from the browser** (same rules
as when the app ran from `file://`). Prefer **keyless** sources. Vet new sources
against this before adding. The installed PWA still calls APIs from the client;
`local-proxy.py` is only required for UMCS + serving the shell.

**Exceptions:**
- **UMCS** — origin API has no CORS; allowed only via `local-proxy.py`.
- **meteoblue** — keyed; key must live in `localStorage.meteoblueApiKey` (never
  committed in `index.html`).

- **meteoblue** — *keyed exception, accepted for personal use.* Unlike
  weather.com it has a genuine free tier (free account → 10 M credits valid one
  year, no purchase obligation) and officially supports browser/CORS use. It
  still requires an API key on every call. The key is read from
  `localStorage.meteoblueApiKey` (one-time prompt); do **not** commit a real key
  into `index.html`.
- **Open-Meteo model tabs** (`om-gfs`, `om-icon`, `om-ecmwf`, `om-gem`, `om-meteofrance`, `om-ukmo`, `om-jma`, `om-cma`) — same eligibility as the default Open-Meteo source; they only pin `models=` so Główna can average **distinct national NWP producers**. Prefer one tab per producer; skip redundant cuts of the same family (e.g. ICON-EU vs ICON seamless) and wrappers that re-serve the same upstream (Eris→OpenWeatherMap, Bright Sky→DWD/IMGW station 12495 for Lublin).
- **Polish / Lublin-local sources:** Prefer IMGW `meteo` neighbors and UMCS city stations for local observations. UMCS (`pogoda.umcs.pl`) has **no CORS** headers, so the dashboard calls it only through `local-proxy.py` (`http://127.0.0.1:8765/umcs/stations/{id}`), which also serves the static files. Botanic Garden station id `10` has been observed stuck on stale timestamps — do not register it until the feed is fresh again.
- **Provenance notes (Lublin):** `metno` locationforecast for Poland is documented as **ECMWF HRES** + MET Norway post-processing (overlaps `om-ecmwf` upstream). `wttr` `format=j1` remains WorldWeatherOnline-shaped (aggregator). `icm` is ICM UW’s local **Unified Model** run — related to Met Office UM lineage but **not** the same feed as `om-ukmo`.
- **weather.com / The Weather Company** — *evaluated and rejected.* Rich data and
  CORS is open, but every request needs an API key (401 without one), there is no
  free public tier (30-day trial then enterprise/contact-sales), and their docs
  forbid embedding keys in client-side code. Incompatible with the keyless,
  single-static-file design. Revisit only if we add a backend/proxy or a
  user-supplied key stored in `localStorage`.

### Forecast vs observation

- Each source declares `kind: "forecast" | "observation"`.
- The `Główna` tab averages **only `forecast` sources** (cards + averaged row of
  the "Porównanie prognoz" table).
- `observation` sources are shown separately in a "Pomiar (teraz)" reference
  table and are **excluded from the average** (comparing a measurement with a
  forecast average would be misleading).
- Observation sources have no hourly series, so their tab shows only the
  current-conditions grid plus a note (no hourly table).
- The `Główna` tab has an "Opad" banner: whether it's raining now, current
  mm/h (forecast avg + max), max precipitation probability across forecasts,
  observation precip totals (labeled by `precipBasis`), and the earliest
  upcoming forecast hour with rain. “Is it raining now?” uses **forecast
  hourly precip only** — period/10‑min/since‑midnight obs totals are shown
  as notes, not as mm/h. `precipProb` is forecast-only.

### Daypart temperatures

- Shared helpers expose local-clock slots ≈7:00, 10–12, ≈15:00, ≈18:00, ≈21:00
  (`Europe/Warsaw`). After 21:00 the strip rolls to the next calendar day.
- Dashboard and Główna show the **forecast consensus** average; each forecast
  source tab shows that source’s own hourly pick. Observations skip the strip.

### Weather icons

- `iconFor(current)` derives an emoji (☀️ 🌤️ ⛅ ☁️ 🌧️ 🌨️ ⛈️) from the normalized
  shape — source-agnostic. Priority: a source-supplied `wxIcon` → `storm` →
  precip (snow vs rain) → cloud cover buckets. Returns an empty icon when there's
  no basis (e.g. an observation without cloud cover), so we never guess.
- Optional normalized flags improve accuracy: `storm` (bool) and `snow` (bool,
  or `null` to fall back to a `temp <= 0.5 °C` heuristic). ICM sets `storm` from
  `storm_max`/`flash_max`; Open-Meteo sets both from `weather_code`/`snowfall`.
- A source with no cloud-cover metric can instead precompute the icon and expose
  it as `wxIcon` (a `{ e, label }` object); `iconFor` returns it verbatim. This
  keeps fabricated numbers out of the averaged metrics. meteoblue uses this: it
  has no free-tier cloud cover, so `meteoblueIcon()` maps the hourly `pictocode`
  (1–35, clear→overcast, thunderstorm codes 27–35) plus snow fraction into
  `wxIcon`, while its `clouds` metric stays `null`.
- Icons appear in each source tab header, the `Główna` average card, the
  comparison rows, and every hourly-table row.

## Adding a new source

The code is source-agnostic. To add a source:

1. Write an `async` loader that returns the **normalized shape**:
   - `kind`: `"forecast"` or `"observation"`.
   - `current` and each `hourly[]` entry expose the same metric keys:
     `temp`, `tempMin`, `tempMax`, `feels`, `dew`, `humidity`, `precip` (mm),
     `precipProb` (%, forecast only), optional `precipBasis`
     (`hour` | `period` | `10min` | `since_midnight`) for observations whose
     precip is not an hourly rate, `windMs` (m/s), `windDirDeg` (°),
     `gustMs` (m/s), `pressurePa` (Pa), `clouds` (%), plus `time`.
     Missing values are `null` (rendered as `–`).
   - `nowIdx` (index of the hour nearest to now), optional `meta` string, and
     optional `extraHtml` for source-specific content (e.g. the ICM meteorogram).
   - Observations return `hourly: []`.
2. Register it in the `SOURCES` array with its `id`, `name`, `kind`, and `load`.
   Tabs, the detail panel, and the `Główna` aggregation update automatically.

- Units are normalized internally to SI-ish (m/s, Pa) and converted only at
  display time via the `fmt` helpers, so all sources stay comparable.
- The `Główna` averages are driven by the `METRICS` table (`avg: true`); metrics
  that can't be linearly averaged (e.g. wind direction) use `avg: false`.
- Attribution for every source belongs on the `About` tab (no site-wide footer).

## Guidelines

### Language

- The dashboard UI must be in **Polish**. All user-facing labels, headings,
  card titles, table headers, status/error messages, and units-in-words must be
  written in Polish.
- Keep source/model names as-is (e.g. `ICM UM`, `Open-Meteo`).
- Code identifiers, comments, and this documentation stay in English.
- Prefer Polish locale formatting (`pl-PL`, `Europe/Warsaw` timezone) for dates,
  times, and numbers.
