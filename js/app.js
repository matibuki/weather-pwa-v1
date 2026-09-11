const CITY = {
      name: "Lublin",
      lat: 51.203611,
      lon: 22.495556,
      umRow: 432,
      umCol: 277,
    };

    const TZ = "Europe/Warsaw";
    const ICM_API = "https://devmgramapi.meteo.pl";
    const MODEL = "um4_60";
    const UMCS_PROXY_BASE = "http://127.0.0.1:8765/umcs";

    const METEOBLUE_API_KEY_PLACEHOLDER = "WSTAW_TUTAJ_SWOJ_KLUCZ";
    function getMeteoblueApiKey() {
      try {
        const stored = (localStorage.getItem("meteoblueApiKey") || "").trim();
        if (stored && stored !== METEOBLUE_API_KEY_PLACEHOLDER) return stored;
      } catch (_) { /* private mode */ }
      const entered = (window.prompt(
        "Wklej klucz API meteoblue (zapisze się w localStorage tej przeglądarki):",
        ""
      ) || "").trim();
      if (!entered) throw new Error("Brak klucza meteoblue — ustaw localStorage.meteoblueApiKey");
      try { localStorage.setItem("meteoblueApiKey", entered); } catch (_) {}
      return entered;
    }

    const fmt = {
      temp: (n) => (n == null || Number.isNaN(n) ? "–" : `${n.toFixed(1)}°`),
      pct: (n) => (n == null || Number.isNaN(n) ? "–" : `${Math.round(n)}%`),
      mm: (n) => (n == null || Number.isNaN(n) ? "–" : `${n.toFixed(1)} mm`),
      wind: (ms) => (ms == null || Number.isNaN(ms) ? "–" : `${(ms * 3.6).toFixed(0)} km/h`),
      hpa: (pa) => (pa == null || Number.isNaN(pa) ? "–" : `${(pa / 100).toFixed(0)} hPa`),
      dir: (deg) => {
        if (deg == null || Number.isNaN(deg)) return "–";
        const names = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
        return `${Math.round(deg)}° ${names[Math.round(deg / 45) % 8]}`;
      },
      time: (d) => new Intl.DateTimeFormat("pl-PL", {
        timeZone: TZ, weekday: "short", hour: "2-digit", minute: "2-digit",
      }).format(d),
      stamp: (d) => new Intl.DateTimeFormat("pl-PL", {
        timeZone: TZ, dateStyle: "medium", timeStyle: "short",
      }).format(d),
      hourOnly: (d) => new Intl.DateTimeFormat("pl-PL", {
        timeZone: TZ, hour: "2-digit", minute: "2-digit",
      }).format(d),
    };

    function series(block) {
      if (!block || !Array.isArray(block.data)) return [];
      const start = Number(block.first_timestamp) * 1000;
      const step = (block.interval || 3600) * 1000;
      return block.data.map((value, i) => ({
        time: new Date(start + i * step),
        value: Number(value),
      }));
    }

    function nearestIndex(times, now) {
      let best = 0;
      let dist = Infinity;
      times.forEach((t, i) => {
        const d = Math.abs(t.getTime() - now.getTime());
        if (d < dist) { dist = d; best = i; }
      });
      return best;
    }

    function fdateFromIso(iso) {
      const d = new Date(iso);
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, "0");
      const day = String(d.getUTCDate()).padStart(2, "0");
      const h = String(d.getUTCHours()).padStart(2, "0");
      return `${y}${m}${day}${h}`;
    }

    function meanFinite(arr) {
      const vals = arr.filter(Number.isFinite);
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    }

    function isSameWarsawDay(a, b) {
      const fmtD = (d) => new Intl.DateTimeFormat("en-CA", {
        timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
      }).format(d);
      return fmtD(a) === fmtD(b);
    }

    async function fetchIcm() {
      const availableRes = await fetch(`${ICM_API}/meteorograms/available`);
      if (!availableRes.ok) throw new Error(`ICM available — HTTP ${availableRes.status}`);
      const available = await availableRes.json();
      const dates = available[MODEL];
      if (!dates || !dates.length) throw new Error("Brak dostępnych prognoz ICM UM");
      const date = dates[dates.length - 1];

      const forecastRes = await fetch(`${ICM_API}/meteorograms/${MODEL}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ date, point: { lat: CITY.lat, lon: CITY.lon } }),
      });
      if (!forecastRes.ok) throw new Error(`Prognoza ICM — błąd HTTP ${forecastRes.status}`);
      const json = await forecastRes.json();
      const data = json.data;

      const temp = series(data.airtmp_point);
      const tMin = series(data.airtmp_min);
      const tMax = series(data.airtmp_max);
      const feels = series(data.wchill_point);
      const dew = series(data.dwptmp_point);
      const hum = series(data.realhum_aver);
      const rain = series(data.pcpttl_aver);
      const rainProb = series(data.pcpttlprob_point);
      const wind = series(data.wind10_sd_true_prev_point);
      const windDir = series(data.wind10_dr_deg_true_prev_point);
      const gust = series(data.wind_gust_max);
      const pres = series(data.slpres_point);
      const clouds = series(data.cldtot_aver);
      const storm = series(data.storm_max);
      const flash = series(data.flash_max);

      const hourly = temp.map((row, i) => ({
        time: row.time,
        temp: row.value,
        tempMin: tMin[i]?.value,
        tempMax: tMax[i]?.value,
        feels: feels[i]?.value,
        dew: dew[i]?.value,
        humidity: hum[i]?.value,
        precip: rain[i]?.value,
        precipProb: rainProb[i]?.value,
        windMs: wind[i]?.value,
        windDirDeg: windDir[i]?.value,
        gustMs: gust[i]?.value,
        pressurePa: pressVal(pres[i]?.value),
        clouds: clouds[i]?.value,
        storm: (storm[i]?.value > 0) || (flash[i]?.value > 0),
        snow: null,
      }));

      function pressVal(v) {
        if (!Number.isFinite(v)) return null;
        // ICM slpres is typically Pa already when large; if hPa-ish, scale
        return v > 2000 ? v : v * 100;
      }

      const nowIdx = nearestIndex(hourly.map((h) => h.time), new Date());
      const current = hourly[nowIdx];
      const fdate = fdateFromIso(json.fstart || data.airtmp_point.fstart);
      const meteorogramUrl =
        `https://www.meteo.pl/um/metco/mgram_pict.php?ntype=0u&fdate=${fdate}&row=${CITY.umRow}&col=${CITY.umCol}&lang=pl`;

      return {
        kind: "forecast",
        current,
        hourly,
        nowIdx,
        meta: `Start prognozy ${String(json.fstart || "").replace("T", " ").replace("Z", " UTC")} · bieżąca godzina ${fmt.time(current.time)}`,
        extraHtml: `
          <div class="graph">
            <img class="legend" src="https://www.meteo.pl/um/metco/leg_um_pl_cbase_256.png" alt="Legenda meteorogramu ICM UM" />
            <img class="meteo" src="${meteorogramUrl}" alt="Meteorogram ICM UM dla Lublina" />
          </div>`,
      };
    }

    const IMGW_STATION_ID = "12495";
    async function fetchImgw() {
      const res = await fetch(`https://danepubliczne.imgw.pl/api/data/synop/id/${IMGW_STATION_ID}`);
      if (!res.ok) throw new Error(`IMGW — błąd HTTP ${res.status}`);
      const d = await res.json();
      const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
      const hh = String(d.godzina_pomiaru ?? "0").padStart(2, "0");
      const time = new Date(`${d.data_pomiaru}T${hh}:00:00Z`);
      const hpa = num(d.cisnienie);
      const current = {
        time,
        temp: num(d.temperatura),
        tempMin: null, tempMax: null, feels: null, dew: null,
        humidity: num(d.wilgotnosc_wzgledna),
        precip: num(d.suma_opadu),
        precipProb: null,
        precipBasis: "period",
        windMs: num(d.predkosc_wiatru),
        windDirDeg: num(d.kierunek_wiatru),
        gustMs: null,
        pressurePa: hpa == null ? null : hpa * 100,
        clouds: null,
      };
      return {
        kind: "observation",
        current,
        hourly: [],
        nowIdx: 0,
        meta: `Stacja ${d.stacja} · pomiar ${fmt.stamp(time)}`,
      };
    }

    async function fetchOpenMeteoModel(model, label) {
      const params = new URLSearchParams({
        latitude: String(CITY.lat),
        longitude: String(CITY.lon),
        hourly: [
          "temperature_2m", "relative_humidity_2m", "dew_point_2m",
          "apparent_temperature", "precipitation", "precipitation_probability",
          "snowfall", "weather_code", "pressure_msl", "cloud_cover",
          "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m",
        ].join(","),
        wind_speed_unit: "ms",
        timezone: "UTC",
        forecast_days: "3",
      });
      if (model) params.set("models", model);
      const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
      if (!res.ok) throw new Error(`${label} — błąd HTTP ${res.status}`);
      const json = await res.json();
      const h = json.hourly;
      if (!h || !Array.isArray(h.time) || !h.time.length) {
        throw new Error(`${label} — brak danych godzinowych`);
      }
      const val = (arr, i) => {
        const n = arr ? Number(arr[i]) : NaN;
        return Number.isFinite(n) ? n : null;
      };
      const hourly = h.time.map((t, i) => {
        const code = val(h.weather_code, i);
        return {
          time: new Date(`${t}Z`),
          temp: val(h.temperature_2m, i),
          tempMin: null, tempMax: null,
          feels: val(h.apparent_temperature, i),
          dew: val(h.dew_point_2m, i),
          humidity: val(h.relative_humidity_2m, i),
          precip: val(h.precipitation, i),
          precipProb: val(h.precipitation_probability, i),
          windMs: val(h.wind_speed_10m, i),
          windDirDeg: val(h.wind_direction_10m, i),
          gustMs: val(h.wind_gusts_10m, i),
          pressurePa: (() => { const p = val(h.pressure_msl, i); return p == null ? null : p * 100; })(),
          clouds: val(h.cloud_cover, i),
          storm: [95, 96, 99].includes(code),
          snow: (val(h.snowfall, i) || 0) > 0 || [71, 73, 75, 77, 85, 86].includes(code),
        };
      });
      if (!hourly.some((r) => Number.isFinite(r.temp))) {
        throw new Error(`${label} — brak temperatur dla lokalizacji`);
      }
      const nowIdx = nearestIndex(hourly.map((r) => r.time), new Date());
      return {
        kind: "forecast",
        current: hourly[nowIdx],
        hourly,
        nowIdx,
        meta: `${label}${model ? ` · model ${model}` : ""} · ${fmt.time(hourly[nowIdx].time)}`,
      };
    }

    function fetchOpenMeteo() { return fetchOpenMeteoModel(null, "Open-Meteo"); }

    function meteoblueIcon(pictocode, snowFrac) {
      const code = Number(pictocode);
      if (!Number.isFinite(code)) return null;
      if (code >= 27) return { e: "⛈️", label: "Burza" };
      if (code >= 17 && code <= 22) {
        return (snowFrac || 0) > 0.5 ? { e: "🌨️", label: "Śnieg" } : { e: "🌧️", label: "Deszcz" };
      }
      if (code <= 2) return { e: "☀️", label: "Słonecznie" };
      if (code <= 5) return { e: "🌤️", label: "Przeważnie słonecznie" };
      if (code <= 9) return { e: "⛅", label: "Częściowe zachmurzenie" };
      return { e: "☁️", label: "Zachmurzenie" };
    }

    async function fetchMeteoblue() {
      const key = getMeteoblueApiKey();
      const params = new URLSearchParams({
        lat: String(CITY.lat),
        lon: String(CITY.lon),
        apikey: key,
        temperature: "C",
        windspeed: "ms",
        format: "json",
        tz: "UTC",
      });
      const res = await fetch(`https://api.meteoblue.com/packages/basic-1h?${params}`);
      if (!res.ok) throw new Error(`meteoblue — błąd HTTP ${res.status}`);
      const json = await res.json();
      const d = json.data_1h || json.data_hourly;
      if (!d || !d.time) throw new Error("meteoblue — brak data_1h");
      const val = (arr, i) => {
        const n = arr ? Number(arr[i]) : NaN;
        return Number.isFinite(n) ? n : null;
      };
      const hourly = d.time.map((t, i) => {
        const snowFrac = val(d.snowfraction, i);
        const pic = val(d.pictocode, i);
        const wx = meteoblueIcon(pic, snowFrac);
        return {
          time: new Date(String(t).includes("T") ? `${String(t).replace(" ", "T")}Z` : `${String(t).replace(" ", "T")}:00Z`),
          temp: val(d.temperature, i),
          tempMin: null, tempMax: null,
          feels: null, dew: null,
          humidity: val(d.relativehumidity, i),
          precip: val(d.precipitation, i),
          precipProb: val(d.precipitation_probability, i),
          windMs: val(d.windspeed, i),
          windDirDeg: val(d.winddirection, i),
          gustMs: null,
          pressurePa: (() => { const p = val(d.sealevelpressure, i); return p == null ? null : p * 100; })(),
          clouds: null,
          storm: Number.isFinite(pic) && pic >= 27,
          snow: (snowFrac || 0) > 0.5,
          wxIcon: wx || undefined,
        };
      });
      const nowIdx = nearestIndex(hourly.map((r) => r.time), new Date());
      return {
        kind: "forecast",
        current: hourly[nowIdx],
        hourly,
        nowIdx,
        meta: `basic-1h · ${fmt.time(hourly[nowIdx].time)}`,
      };
    }

    async function fetchMetNo() {
      const res = await fetch(
        `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${CITY.lat}&lon=${CITY.lon}`,
        { headers: { Accept: "application/json", "User-Agent": "lublin-weather-dashboard/1.0 personal" } }
      );
      if (!res.ok) throw new Error(`MET Norway — błąd HTTP ${res.status}`);
      const json = await res.json();
      const seriesTs = json.properties?.timeseries || [];
      if (!seriesTs.length) throw new Error("MET Norway — brak timeseries");
      const hourly = seriesTs.map((e) => {
        const d = e.data || {};
        const inst = d.instant?.details || {};
        const next1 = d.next_1_hours?.details || {};
        const next1sum = d.next_1_hours?.summary || {};
        const symbol = String(next1sum.symbol_code || "");
        return {
          time: new Date(e.time),
          temp: Number.isFinite(inst.air_temperature) ? inst.air_temperature : null,
          tempMin: null, tempMax: null,
          feels: null,
          dew: Number.isFinite(inst.dew_point_temperature) ? inst.dew_point_temperature : null,
          humidity: Number.isFinite(inst.relative_humidity) ? inst.relative_humidity : null,
          precip: Number.isFinite(next1.precipitation_amount) ? next1.precipitation_amount : null,
          precipProb: Number.isFinite(next1.probability_of_precipitation) ? next1.probability_of_precipitation : null,
          windMs: Number.isFinite(inst.wind_speed) ? inst.wind_speed : null,
          windDirDeg: Number.isFinite(inst.wind_from_direction) ? inst.wind_from_direction : null,
          gustMs: Number.isFinite(inst.wind_speed_of_gust) ? inst.wind_speed_of_gust : null,
          pressurePa: Number.isFinite(inst.air_pressure_at_sea_level) ? inst.air_pressure_at_sea_level * 100 : null,
          clouds: Number.isFinite(inst.cloud_area_fraction) ? inst.cloud_area_fraction : null,
          storm: /thunder/.test(symbol),
          snow: /snow|sleet/.test(symbol),
        };
      });
      const nowIdx = nearestIndex(hourly.map((r) => r.time), new Date());
      return {
        kind: "forecast",
        current: hourly[nowIdx],
        hourly,
        nowIdx,
        meta: `locationforecast compact · ${fmt.time(hourly[nowIdx].time)}`,
      };
    }

    async function fetchWttr() {
      const res = await fetch(`https://wttr.in/Lublin?format=j1`);
      if (!res.ok) throw new Error(`wttr.in — błąd HTTP ${res.status}`);
      const json = await res.json();
      const days = json.weather || [];
      const hourly = [];
      for (const day of days) {
        const date = day.date;
        for (const h of day.hourly || []) {
          const t100 = String(h.time || "0").padStart(4, "0");
          const hh = t100 === "0" || t100 === "0000" ? "00" : t100.slice(0, -2).padStart(2, "0");
          // civil local Europe/Warsaw — approximate as local wall time tagged +02/+01 via Date parsing as local is wrong in UTC browsers
          // Use explicit offset from nearest: treat as Europe/Warsaw by appending and letting Intl... simplest: `${date}T${hh}:00:00` as UTC then wrong.
          // wttr times are local civil; build with timeZone via manual: store as Date from ISO with Z then subtract — better approach:
          const localIso = `${date}T${hh}:00:00`;
          // Interpret as Warsaw local by appending offset from a formatter hack:
          const probe = new Date(`${localIso}Z`);
          const warsaw = new Intl.DateTimeFormat("en-US", {
            timeZone: TZ, timeZoneName: "shortOffset",
            year: "numeric", month: "2-digit", day: "2-digit",
            hour: "2-digit", minute: "2-digit", hourCycle: "h23",
          }).formatToParts(probe);
          // Simpler: use the fact that for display we only need correct Warsaw clock — create from parts
          const time = warsawLocalDate(date, Number(hh));
          const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
          const windKmh = num(h.windspeedKmph);
          const desc = String((h.weatherDesc && h.weatherDesc[0] && h.weatherDesc[0].value) || "").toLowerCase();
          hourly.push({
            time,
            temp: num(h.tempC),
            tempMin: null, tempMax: null,
            feels: num(h.FeelsLikeC),
            dew: num(h.DewPointC),
            humidity: num(h.humidity),
            precip: num(h.precipMM),
            precipProb: num(h.chanceofrain),
            windMs: windKmh == null ? null : windKmh / 3.6,
            windDirDeg: num(h.winddirDegree),
            gustMs: (() => { const g = num(h.WindGustKmph); return g == null ? null : g / 3.6; })(),
            pressurePa: (() => { const p = num(h.pressure); return p == null ? null : p * 100; })(),
            clouds: num(h.cloudcover),
            storm: /thunder|burz/.test(desc),
            snow: /snow|śnieg|snieg/.test(desc),
          });
        }
      }
      if (!hourly.length) throw new Error("wttr.in — brak godzin");
      const nowIdx = nearestIndex(hourly.map((r) => r.time), new Date());
      return {
        kind: "forecast",
        current: hourly[nowIdx],
        hourly,
        nowIdx,
        meta: `format=j1 · ${fmt.time(hourly[nowIdx].time)}`,
      };
    }

    function warsawLocalDate(ymd, hour) {
      // Find UTC instant whose Warsaw local date/hour matches.
      let guess = new Date(`${ymd}T${String(hour).padStart(2, "0")}:00:00Z`);
      for (let i = 0; i < 8; i++) {
        const parts = Object.fromEntries(
          new Intl.DateTimeFormat("en-GB", {
            timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
            hour: "2-digit", hourCycle: "h23",
          }).formatToParts(guess).filter((p) => p.type !== "literal").map((p) => [p.type, p.value])
        );
        const got = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}`;
        const want = `${ymd}T${String(hour).padStart(2, "0")}`;
        if (got === want) return guess;
        const gotH = Number(parts.hour);
        const deltaH = hour - gotH;
        // also day skew
        const gotDay = Date.UTC(+parts.year, +parts.month - 1, +parts.day, gotH);
        const wantDay = Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10), hour);
        guess = new Date(guess.getTime() + (wantDay - gotDay));
      }
      return guess;
    }

    let imgwMeteoIndexPromise = null;
    function getImgwMeteoIndex() {
      if (!imgwMeteoIndexPromise) {
        imgwMeteoIndexPromise = fetch("https://danepubliczne.imgw.pl/api/data/meteo")
          .then(async (res) => {
            if (!res.ok) throw new Error(`IMGW meteo — HTTP ${res.status}`);
            return res.json();
          })
          .catch((err) => {
            imgwMeteoIndexPromise = null;
            throw err;
          });
      }
      return imgwMeteoIndexPromise;
    }

    async function fetchImgwMeteoStation(kod, label) {
      const list = await getImgwMeteoIndex();
      const d = (list || []).find((x) => String(x.kod_stacji) === String(kod) || String(x.id_stacji) === String(kod));
      if (!d) throw new Error(`IMGW meteo ${label} — brak stacji ${kod}`);
      const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
      const time = d.data_pomiaru ? new Date(String(d.data_pomiaru).replace(" ", "T") + "Z") : new Date();
      const current = {
        time,
        temp: num(d.temperatura || d.t),
        tempMin: null, tempMax: null, feels: null, dew: null,
        humidity: num(d.wilgotnosc_wzgledna || d.wilgotnosc),
        precip: num(d.opad_10min || d.opad || d.suma_opadu),
        precipProb: null,
        precipBasis: "10min",
        windMs: num(d.wiatr_predkosc || d.predkosc_wiatru),
        windDirDeg: num(d.wiatr_kierunek || d.kierunek_wiatru),
        gustMs: num(d.wiatr_poryw),
        pressurePa: (() => { const p = num(d.cisnienie); return p == null ? null : p * 100; })(),
        clouds: null,
      };
      return {
        kind: "observation",
        current,
        hourly: [],
        nowIdx: 0,
        meta: `${label} · kod ${kod} · ${fmt.stamp(time)}`,
      };
    }

    async function fetchImgwHydroBystrzyca() {
      const res = await fetch("https://danepubliczne.imgw.pl/api/data/hydro");
      if (!res.ok) throw new Error(`IMGW hydro — HTTP ${res.status}`);
      const list = await res.json();
      const id = "151220070";
      const d = (list || []).find((x) => String(x.id_stacji) === id || String(x.kod_stacji) === id);
      if (!d) throw new Error("IMGW hydro Bystrzyca — brak stacji");
      const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
      const time = d.stacja_data ? new Date(String(d.stacja_data).replace(" ", "T") + "Z")
        : (d.data ? new Date(String(d.data).replace(" ", "T") + "Z") : new Date());
      const level = num(d.stan || d.stan_wody);
      const flow = num(d.przeplyw);
      const waterTemp = num(d.temperatura || d.temperatura_wody);
      const current = {
        time,
        temp: null, // do not map water temp to air temp
        tempMin: null, tempMax: null, feels: null, dew: null,
        humidity: null, precip: null, precipProb: null,
        windMs: null, windDirDeg: null, gustMs: null,
        pressurePa: null, clouds: null,
      };
      return {
        kind: "observation",
        current,
        hourly: [],
        nowIdx: 0,
        meta: `Lublin-Bystrzyca · ${fmt.stamp(time)}`,
        extraHtml: `<div class="metrics">
          <div class="metric"><span class="label">Stan wody</span><b>${level == null ? "–" : `${level} cm`}</b></div>
          <div class="metric"><span class="label">Przepływ</span><b>${flow == null ? "–" : `${flow} m³/s`}</b></div>
          <div class="metric"><span class="label">Temp. wody</span><b>${waterTemp == null ? "–" : `${waterTemp.toFixed(1)}°`}</b></div>
        </div>`,
      };
    }

    async function fetchUmcsStation(stationId, label) {
      const res = await fetch(`${UMCS_PROXY_BASE}/stations/${stationId}`);
      if (!res.ok) throw new Error(`UMCS ${label} — HTTP ${res.status} (uruchom local-proxy.py?)`);
      const d = await res.json();
      const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
      const time = d.time || d.timestamp ? new Date(d.time || d.timestamp) : new Date();
      let windDir = num(d.windDirInt);
      if (windDir == null || windDir < 0 || windDir > 360) windDir = num(d.windDir);
      const current = {
        time,
        temp: num(d.temp ?? d.temperature),
        tempMin: null, tempMax: null,
        feels: num(d.tempApp ?? d.feels),
        dew: num(d.dewPoint),
        humidity: num(d.humidity),
        precip: num(d.rain ?? d.precip),
        precipProb: null,
        precipBasis: "since_midnight",
        windMs: num(d.windSpeed ?? d.wind),
        windDirDeg: windDir,
        gustMs: num(d.windGust ?? d.gust),
        pressurePa: (() => { const p = num(d.pressure); return p == null ? null : (p > 2000 ? p : p * 100); })(),
        clouds: null,
      };
      return {
        kind: "observation",
        current,
        hourly: [],
        nowIdx: 0,
        meta: `${label} · via proxy · ${fmt.stamp(time)}`,
      };
    }

    const SOURCES = [
      { id: "icm", name: "ICM UM", kind: "forecast", load: fetchIcm },
      { id: "imgw", name: "IMGW-PIB", kind: "observation", load: fetchImgw },
      { id: "openmeteo", name: "Open-Meteo", kind: "forecast", load: fetchOpenMeteo },
      { id: "meteoblue", name: "meteoblue", kind: "forecast", load: fetchMeteoblue },
      { id: "metno", name: "MET Norway", kind: "forecast", load: fetchMetNo },
      { id: "wttr", name: "wttr.in", kind: "forecast", load: fetchWttr },
      { id: "om-gfs", name: "Open-Meteo GFS", kind: "forecast", load: () => fetchOpenMeteoModel("gfs_seamless", "Open-Meteo GFS") },
      { id: "om-icon", name: "Open-Meteo ICON", kind: "forecast", load: () => fetchOpenMeteoModel("icon_seamless", "Open-Meteo ICON") },
      { id: "om-ecmwf", name: "Open-Meteo ECMWF", kind: "forecast", load: () => fetchOpenMeteoModel("ecmwf_ifs025", "Open-Meteo ECMWF") },
      { id: "om-gem", name: "Open-Meteo GEM", kind: "forecast", load: () => fetchOpenMeteoModel("gem_seamless", "Open-Meteo GEM") },
      { id: "om-meteofrance", name: "Open-Meteo Météo-France", kind: "forecast", load: () => fetchOpenMeteoModel("meteofrance_seamless", "Open-Meteo Météo-France") },
      { id: "om-ukmo", name: "Open-Meteo UKMO", kind: "forecast", load: () => fetchOpenMeteoModel("ukmo_seamless", "Open-Meteo UKMO") },
      { id: "om-jma", name: "Open-Meteo JMA", kind: "forecast", load: () => fetchOpenMeteoModel("jma_seamless", "Open-Meteo JMA") },
      { id: "om-cma", name: "Open-Meteo CMA", kind: "forecast", load: () => fetchOpenMeteoModel("cma_grapes_global", "Open-Meteo CMA") },
      { id: "imgw-ostrowek", name: "IMGW Ostrówek", kind: "observation", load: () => fetchImgwMeteoStation("251220230", "Ostrówek") },
      { id: "imgw-wysokie", name: "IMGW Wysokie", kind: "observation", load: () => fetchImgwMeteoStation("250220030", "Wysokie") },
      { id: "imgw-hydro-lublin", name: "IMGW Bystrzyca", kind: "observation", load: fetchImgwHydroBystrzyca },
      { id: "umcs-litewski", name: "UMCS Plac Litewski", kind: "observation", load: () => fetchUmcsStation(16, "Plac Litewski") },
      { id: "umcs-zemborzycka", name: "UMCS Zemborzycka", kind: "observation", load: () => fetchUmcsStation(17, "Zemborzycka") },
    ];

    const METRICS = [
      { key: "temp", label: "Temperatura", fmt: fmt.temp, avg: true },
      { key: "feels", label: "Odczuwalna", fmt: fmt.temp, avg: true },
      { key: "humidity", label: "Wilgotność", fmt: fmt.pct, avg: true },
      { key: "pressurePa", label: "Ciśnienie", fmt: fmt.hpa, avg: true },
      { key: "windMs", label: "Wiatr", fmt: fmt.wind, avg: true },
      { key: "windDirDeg", label: "Kierunek", fmt: fmt.dir, avg: false },
      { key: "gustMs", label: "Porywy", fmt: fmt.wind, avg: true },
      { key: "precip", label: "Opad", fmt: fmt.mm, avg: true },
      { key: "precipProb", label: "Prawd. opadu", fmt: fmt.pct, avg: true },
      { key: "clouds", label: "Zachmurzenie", fmt: fmt.pct, avg: true },
    ];

    const loaded = {};
    let loadGen = 0;
    let lastLoadIssues = [];

    function iconFor(c) {
      if (!c) return { e: "", label: "" };
      if (c.wxIcon && c.wxIcon.e) return c.wxIcon;
      const heavyProb = Number.isFinite(c.precipProb) && c.precipProb >= 60;
      const hasPrecip = (Number.isFinite(c.precip) && c.precip > 0) || heavyProb;
      if (c.storm) return { e: "⛈️", label: "Burza" };
      if (hasPrecip) {
        const snowy = c.snow === true || (c.snow == null && Number.isFinite(c.temp) && c.temp <= 0.5);
        return snowy ? { e: "🌨️", label: "Śnieg" } : { e: "🌧️", label: "Deszcz" };
      }
      const cl = Number.isFinite(c.clouds) ? c.clouds : null;
      if (cl == null) return { e: "", label: "" };
      if (cl < 15) return { e: "☀️", label: "Słonecznie" };
      if (cl < 50) return { e: "🌤️", label: "Przeważnie słonecznie" };
      if (cl < 85) return { e: "⛅", label: "Częściowe zachmurzenie" };
      return { e: "☁️", label: "Zachmurzenie" };
    }

    function iconHtml(c, size) {
      const { e, label } = iconFor(c);
      if (!e) return "";
      return `<span class="wx" title="${label}" aria-label="${label}"${size ? ` style="font-size:${size}"` : ""}>${e}</span>`;
    }

    function metricsGridHtml(current) {
      return METRICS
        .map((m) => `<div class="metric"><span class="label">${m.label}</span><b>${m.fmt(current[m.key])}</b></div>`)
        .join("");
    }

    function hourlyTableHtml(src) {
      const rows = src.hourly.map((row, i) => `
        <tr class="${i === src.nowIdx ? "now" : ""}">
          <td>${fmt.time(row.time)}</td>
          <td>${iconHtml(row)}</td>
          <td>${fmt.temp(row.temp)}</td>
          <td>${fmt.temp(row.tempMin)} / ${fmt.temp(row.tempMax)}</td>
          <td>${fmt.temp(row.feels)}</td>
          <td>${fmt.temp(row.dew)}</td>
          <td>${fmt.pct(row.humidity)}</td>
          <td>${fmt.mm(row.precip)}</td>
          <td>${fmt.pct(row.precipProb)}</td>
          <td>${fmt.wind(row.windMs)}</td>
          <td>${fmt.wind(row.gustMs)}</td>
          <td>${fmt.hpa(row.pressurePa)}</td>
          <td>${fmt.pct(row.clouds)}</td>
        </tr>`).join("");
      return `
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Godzina</th><th>Pogoda</th><th>Temp.</th><th>Min / Maks</th><th>Odczuw.</th>
                <th>Pkt rosy</th><th>Wilgotność</th><th>Opad</th><th>Prawd.</th><th>Wiatr</th>
                <th>Poryw</th><th>Ciśnienie</th><th>Zachmurz.</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    }

    const DAYPARTS = [
      { id: "h07", label: "≈7:00", targetHour: 7, hours: [7] },
      { id: "h1012", label: "10–12", targetHour: 11, hours: [10, 11, 12] },
      { id: "h15", label: "≈15:00", targetHour: 15, hours: [15] },
      { id: "h18", label: "≈18:00", targetHour: 18, hours: [18] },
      { id: "h21", label: "≈21:00", targetHour: 21, hours: [21] },
    ];

    function warsawParts(d) {
      const parts = Object.fromEntries(
        new Intl.DateTimeFormat("en-GB", {
          timeZone: TZ,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          hourCycle: "h23",
        }).formatToParts(d).filter((p) => p.type !== "literal").map((p) => [p.type, p.value])
      );
      return { key: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
    }

    function daypartsDayKey(now = new Date()) {
      const p = warsawParts(now);
      if (p.hour < 21) return p.key;
      return warsawParts(new Date(now.getTime() + 24 * 3600 * 1000)).key;
    }

    function pickDaypartTemp(hourly, part, dayKey) {
      if (!Array.isArray(hourly) || !hourly.length) return null;
      const candidates = hourly.filter((h) => {
        if (!Number.isFinite(h.temp)) return false;
        const p = warsawParts(h.time);
        return p.key === dayKey && part.hours.includes(p.hour);
      });
      if (!candidates.length) return null;
      const exact = candidates.filter((h) => warsawParts(h.time).hour === part.targetHour);
      const use = exact.length ? exact : candidates;
      return use.reduce((a, h) => a + h.temp, 0) / use.length;
    }

    function daypartsForSource(src, dayKey = daypartsDayKey()) {
      return DAYPARTS.map((part) => ({ ...part, temp: pickDaypartTemp(src.hourly || [], part, dayKey) }));
    }

    function consensusDayparts(forecasts, dayKey = daypartsDayKey()) {
      return DAYPARTS.map((part) => {
        const vals = forecasts.map((s) => pickDaypartTemp(s.hourly || [], part, dayKey)).filter(Number.isFinite);
        return { ...part, temp: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null, n: vals.length };
      });
    }

    function daypartsLabel(dayKey) {
      return dayKey === warsawParts(new Date()).key ? "Temperatury w ciągu dnia" : "Temperatury (jutro)";
    }

    function daypartsHtml(slots, { compact = false, title = null } = {}) {
      const head = title ? `<div class="dayparts-title">${title}</div>` : "";
      const cells = slots.map((s) => `
        <div class="daypart">
          <div class="when">${s.label}</div>
          <div class="t">${fmt.temp(s.temp)}</div>
        </div>`).join("");
      const cls = compact ? "eink compact" : "eink";
      return `<div class="${cls}">${head}<div class="dayparts${compact ? " compact" : ""}">${cells}</div></div>`;
    }

    function renderSourcePanel(src) {
      const panel = document.getElementById(`panel-${src.id}`);
      if (!panel) return;
      const hasHourly = Array.isArray(src.hourly) && src.hourly.length > 1;
      const hourlySection = hasHourly
        ? `<section class="card">
            <div class="source-head">
              <h2>Lista godzinowa</h2>
              <div class="sub">Wiersz najbliższy bieżącej godzinie jest podświetlony</div>
            </div>
            ${hourlyTableHtml(src)}
          </section>`
        : `<section class="card">
            <div class="placeholder">${src.name} udostępnia dane pomiarowe (obserwacje) — bez prognozy godzinowej.</div>
          </section>`;

      const dayKey = daypartsDayKey();
      const daypartBlock = hasHourly
        ? `<section class="card">${daypartsHtml(daypartsForSource(src, dayKey), { title: daypartsLabel(dayKey) })}</section>`
        : "";

      panel.innerHTML = `
        <section class="card source">
          <div class="source-head">
            <h2>${iconHtml(src.current, "1.4em")}${src.name} · ${CITY.name}</h2>
            <div class="sub">${src.meta || ""}</div>
          </div>
          <div class="metrics">${metricsGridHtml(src.current)}</div>
          ${src.extraHtml || ""}
        </section>
        ${daypartBlock}
        ${hourlySection}`;

      const now = panel.querySelector("tr.now");
      const wrap = panel.querySelector(".table-wrap");
      if (now && wrap) wrap.scrollTop = Math.max(0, now.offsetTop - 48);
    }

    function comparisonTableHtml(list, { withAverage }) {
      const headCols = METRICS.map((m) => `<th>${m.label}</th>`).join("");
      const bodyRows = list.map((s) => `
        <tr>
          <td class="src-name">${iconHtml(s.current)} ${s.name}</td>
          ${METRICS.map((m) => `<td>${m.fmt(s.current[m.key])}</td>`).join("")}
        </tr>`).join("");
      const avgRow = withAverage ? `
        <tr class="avg-row">
          <td class="src-name">Średnia</td>
          ${METRICS.map((m) => {
            if (!m.avg) return "<td>–</td>";
            const vals = list.map((s) => s.current[m.key]).filter(Number.isFinite);
            const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : NaN;
            return `<td>${m.fmt(mean)}</td>`;
          }).join("")}
        </tr>` : "";
      return `
        <div class="table-wrap">
          <table>
            <thead><tr><th class="src-name">Źródło</th>${headCols}</tr></thead>
            <tbody>${bodyRows}${avgRow}</tbody>
          </table>
        </div>`;
    }

    function renderMain() {
      const all = Object.values(loaded);
      const panel = document.getElementById("panel-main");
      if (!panel) return;
      if (!all.length) {
        panel.innerHTML = `<div class="placeholder">Brak wczytanych źródeł.</div>`;
        return;
      }

      const forecasts = all.filter((s) => s.kind !== "observation");
      const observations = all.filter((s) => s.kind === "observation");

      const precipBasisLabel = {
        hour: "mm/h",
        period: "suma okresu (synop)",
        "10min": "suma 10 min",
        since_midnight: "od 00 UTC",
      };
      const fPrecip = forecasts.map((s) => s.current.precip).filter(Number.isFinite);
      const fProb = forecasts.map((s) => s.current.precipProb).filter(Number.isFinite);
      const maxPrecip = fPrecip.length ? Math.max(...fPrecip) : null;
      const avgPrecip = fPrecip.length ? fPrecip.reduce((a, b) => a + b, 0) / fPrecip.length : null;
      const maxProb = fProb.length ? Math.max(...fProb) : null;
      const rainingNow = maxPrecip != null && maxPrecip > 0;
      const obsPrecipNotes = observations
        .filter((s) => Number.isFinite(s.current.precip))
        .map((s) => {
          const basis = s.current.precipBasis || "period";
          return `${s.name}: ${fmt.mm(s.current.precip)} (${precipBasisLabel[basis] || basis})`;
        });

      let nextRain = null;
      forecasts.forEach((s) => {
        for (let j = s.nowIdx + 1; j < s.hourly.length; j++) {
          const p = s.hourly[j].precip;
          if (Number.isFinite(p) && p > 0) {
            if (!nextRain || s.hourly[j].time < nextRain.time) {
              nextRain = { time: s.hourly[j].time, name: s.name, mm: p };
            }
            break;
          }
        }
      });

      let rainBanner = "";
      if (forecasts.length || observations.length) {
        const parts = [];
        if (avgPrecip != null) parts.push(`prognoza teraz: śr. ${fmt.mm(avgPrecip)}/h, maks. ${fmt.mm(maxPrecip)}/h`);
        if (maxProb != null) parts.push(`maks. prawdopodobieństwo ${fmt.pct(maxProb)}`);
        if (obsPrecipNotes.length) parts.push(`pomiary: ${obsPrecipNotes.join("; ")}`);
        if (nextRain) parts.push(`najbliższy opad w prognozie: ${fmt.time(nextRain.time)} (${nextRain.name}, ${fmt.mm(nextRain.mm)}/h)`);
        else if (forecasts.length) parts.push("brak opadu w prognozie na najbliższe godziny");
        const status = rainingNow
          ? `Pada (wg prognoz) — do ${fmt.mm(maxPrecip)}/h`
          : "Nie pada (wg prognoz godzinowych)";
        rainBanner = `
          <section class="card">
            <h3 class="section-title">Opad</h3>
            <div class="rain-status${rainingNow ? " wet" : ""}">${status}</div>
            <div class="rain-sub">${parts.join(" · ")}</div>
          </section>`;
      }

      let cards;
      if (forecasts.length) {
        const withTemp = forecasts.filter((s) => Number.isFinite(s.current.temp));
        const temps = withTemp.map((s) => s.current.temp);
        if (!temps.length) {
          cards = `<section class="card"><div class="placeholder">Brak temperatur w źródłach prognozy.</div></section>`;
        } else {
          const avgT = temps.reduce((a, b) => a + b, 0) / temps.length;
          const minS = withTemp.reduce((a, b) => (b.current.temp < a.current.temp ? b : a));
          const maxS = withTemp.reduce((a, b) => (b.current.temp > a.current.temp ? b : a));
          const n = forecasts.length;
          const word = n === 1 ? "prognoza" : (n < 5 ? "prognozy" : "prognoz");
          const cloudsVals = forecasts.map((s) => s.current.clouds).filter(Number.isFinite);
          const consensus = {
            temp: avgT,
            precip: avgPrecip,
            precipProb: maxProb,
            clouds: cloudsVals.length ? cloudsVals.reduce((a, b) => a + b, 0) / cloudsVals.length : null,
            storm: forecasts.some((s) => s.current.storm),
            snow: forecasts.some((s) => s.current.snow) ? true : null,
          };
          cards = `
            <section class="cards">
              <article class="card">
                <div class="label">Teraz (średnia prognoz)</div>
                <div class="value">${iconHtml(consensus, "0.9em")}${fmt.temp(avgT)}</div>
                <div class="hint">${n} ${word} · ${fmt.stamp(new Date())}</div>
              </article>
              <article class="card">
                <div class="label">Najniższa prognoza</div>
                <div class="value">${fmt.temp(minS.current.temp)}</div>
                <div class="hint">${minS.name}</div>
              </article>
              <article class="card">
                <div class="label">Najwyższa prognoza</div>
                <div class="value">${fmt.temp(maxS.current.temp)}</div>
                <div class="hint">${maxS.name}</div>
              </article>
              <article class="card">
                <div class="label">Rozrzut</div>
                <div class="value">${fmt.temp(maxS.current.temp - minS.current.temp)}</div>
                <div class="hint">maks − min między prognozami</div>
              </article>
            </section>`;
        }
      } else {
        cards = `<section class="card"><div class="placeholder">Brak źródeł prognozy do uśrednienia.</div></section>`;
      }

      const dayKey = daypartsDayKey();
      const daypartSection = forecasts.length ? `
        <section class="card">
          ${daypartsHtml(consensusDayparts(forecasts, dayKey), {
            title: `${daypartsLabel(dayKey)} — średnia prognoz`,
          })}
        </section>` : "";

      const forecastSection = forecasts.length ? `
        <section class="card">
          <h3 class="section-title">Porównanie prognoz (teraz)</h3>
          ${comparisonTableHtml(forecasts, { withAverage: true })}
        </section>` : "";

      const obsSection = observations.length ? `
        <section class="card">
          <h3 class="section-title">Pomiar (teraz) — dane obserwacyjne, poza średnią</h3>
          ${comparisonTableHtml(observations, { withAverage: false })}
        </section>` : "";

      panel.innerHTML = rainBanner + cards + daypartSection + forecastSection + obsSection;
    }

    function renderDashboard() {
      const panel = document.getElementById("panel-dashboard");
      if (!panel) return;
      const forecasts = Object.values(loaded).filter((s) => s.kind !== "observation");
      if (!forecasts.length) {
        panel.innerHTML = `<div class="placeholder">Wczytywanie widgetu…</div>`;
        return;
      }
      const now = new Date();
      const avgTemp = meanFinite(forecasts.map((s) => s.current.temp));
      const avgWind = meanFinite(forecasts.map((s) => s.current.windMs));
      const avgPress = meanFinite(forecasts.map((s) => s.current.pressurePa));
      const avgPrecip = meanFinite(forecasts.map((s) => s.current.precip));
      const maxProbNow = (() => {
        const vals = forecasts.map((s) => s.current.precipProb).filter(Number.isFinite);
        return vals.length ? Math.max(...vals) : null;
      })();
      const cloudsVals = forecasts.map((s) => s.current.clouds).filter(Number.isFinite);
      const consensus = {
        temp: avgTemp,
        precip: avgPrecip,
        precipProb: maxProbNow,
        clouds: cloudsVals.length ? cloudsVals.reduce((a, b) => a + b, 0) / cloudsVals.length : null,
        storm: forecasts.some((s) => s.current.storm),
        snow: forecasts.some((s) => s.current.snow) ? true : null,
      };

      // rain hours table — upcoming wet hours only
      const hourMap = new Map();
      forecasts.forEach((s) => {
        (s.hourly || []).forEach((h) => {
          if (h.time < now) return;
          const key = h.time.toISOString().slice(0, 13);
          if (!hourMap.has(key)) hourMap.set(key, { time: h.time, precips: [], probs: [] });
          const bucket = hourMap.get(key);
          if (Number.isFinite(h.precip)) bucket.precips.push(h.precip);
          if (Number.isFinite(h.precipProb)) bucket.probs.push(h.precipProb);
        });
      });
      const rainyHours = [...hourMap.values()]
        .map((b) => ({
          time: b.time,
          mm: meanFinite(b.precips),
          prob: b.probs.length ? Math.max(...b.probs) : null,
        }))
        .filter((b) => (Number.isFinite(b.mm) && b.mm > 0.05) || (Number.isFinite(b.prob) && b.prob >= 50))
        .sort((a, b) => a.time - b.time)
        .slice(0, 4);

      const rainTableHtml = rainyHours.length
        ? `<div class="dash-rain-table">
            <div class="title">Nadchodzący opad</div>
            <table>
              <thead><tr><th>Godzina</th><th>mm</th><th>Prawd.</th></tr></thead>
              <tbody>
                ${rainyHours.map((r) => `<tr>
                  <td>${fmt.hourOnly(r.time)}</td>
                  <td>${fmt.mm(r.mm)}</td>
                  <td>${fmt.pct(r.prob)}</td>
                </tr>`).join("")}
              </tbody>
            </table>
          </div>`
        : `<div class="dash-rain-table"><div class="dash-rain-empty">Brak opadu</div></div>`;

      panel.innerHTML = `
        <div class="dash-wrap">
          <div class="dash-widget">
            <div class="dash-place">${CITY.name}</div>
            <div class="dash-icon">${iconHtml(consensus, "1em") || "·"}</div>
            <div class="dash-label">Średnia prognoz</div>
            <div class="dash-temp">${fmt.temp(avgTemp)}</div>
            <div class="dash-grid">
              <div class="dash-cell">
                <div class="k">Wiatr</div>
                <div class="v">${fmt.wind(avgWind)}</div>
              </div>
              <div class="dash-cell">
                <div class="k">Ciśnienie</div>
                <div class="v">${fmt.hpa(avgPress)}</div>
              </div>
            </div>
            ${daypartsHtml(consensusDayparts(forecasts, daypartsDayKey()), {
              compact: true,
              title: daypartsLabel(daypartsDayKey()),
            })}
            ${rainTableHtml}
            <div class="dash-foot">${forecasts.length} prognoz · ${fmt.hourOnly(now)}</div>
          </div>
        </div>`;
    }

    function renderAbout() {
      const panel = document.getElementById("panel-about");
      if (!panel) return;
      const issuesHtml = lastLoadIssues.length
        ? `<h3>Status źródeł</h3>
            <ul class="about-issues">
              ${lastLoadIssues.map((m) => `<li>${m}</li>`).join("")}
            </ul>`
        : `<h3>Status źródeł</h3><p>Wszystkie źródła wczytane poprawnie (lub jeszcze nie odświeżono).</p>`;
      panel.innerHTML = `
        <div class="about">
          <section class="card">
            <h2>O stronie</h2>
            <p>Osobisty panel pogody dla Lublina. Zbiera kilka niezależnych prognoz i lokalnych
            pomiarów, liczy konsensus (średnia / min / max) i pokazuje różnice między źródłami.</p>
            <ul>
              <li><strong>Dashboard</strong> — krótki „widget” na telefon: konsensus teraz i temperatury w ciągu dnia (≈7, 10–12, 15, 18, 21).</li>
              <li><strong>Główna</strong> — porównanie prognoz, rozrzut, opad, temperatury w ciągu dnia, pomiary osobno.</li>
              <li><strong>Karty źródeł</strong> — surowe dane z każdej usługi / modelu / stacji.</li>
            </ul>
            ${issuesHtml}
            <p>Działa jako <strong>PWA</strong> (GitHub Pages lub <code>local-proxy.py</code>). Shell działa offline; świeże prognozy wymagają sieci. Bez konta, bez trackingu.</p>
            <h3>Źródła i atrybucja</h3>
            <ul>
              <li>ICM UW — meteorogram UM (meteo.pl / devmgramapi)</li>
              <li>IMGW-PIB — synop Lublin, meteo Ostrówek/Wysokie, hydro Bystrzyca (danepubliczne.imgw.pl)</li>
              <li>Open-Meteo — best-match oraz modele GFS, ICON, ECMWF, GEM, Météo-France, UKMO, JMA, CMA (CC BY 4.0)</li>
              <li>meteoblue — basic-1h (klucz w localStorage)</li>
              <li>MET Norway — Locationforecast 2.0 compact (CC BY 4.0)</li>
              <li>wttr.in — format=j1</li>
              <li>UMCS — stacje Plac Litewski i Zemborzycka (pogoda.umcs.pl via lokalny proxy)</li>
            </ul>
          </section>
        </div>`;
    }

    let activeTab = "dashboard";

    function tabList() {
      return [
        { id: "dashboard", name: "Dashboard", group: "home" },
        { id: "main", name: "Główna", group: "home" },
        ...SOURCES.map((s) => ({ ...s, group: "sources" })),
        { id: "about", name: "About", group: "meta" },
      ];
    }

    function isNavOpen() {
      return document.getElementById("nav-drawer").classList.contains("is-open");
    }

    function openNav() {
      const drawer = document.getElementById("nav-drawer");
      const backdrop = document.getElementById("nav-backdrop");
      const toggle = document.getElementById("nav-toggle");
      drawer.hidden = false;
      backdrop.hidden = false;
      drawer.classList.add("is-open");
      backdrop.classList.add("is-open");
      toggle.setAttribute("aria-expanded", "true");
      document.body.style.overflow = "hidden";
    }

    function closeNav() {
      const drawer = document.getElementById("nav-drawer");
      const backdrop = document.getElementById("nav-backdrop");
      const toggle = document.getElementById("nav-toggle");
      drawer.classList.remove("is-open");
      backdrop.classList.remove("is-open");
      drawer.hidden = true;
      backdrop.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
      document.body.style.overflow = "";
    }

    function buildTabs() {
      const tabs = tabList();
      // Keep legacy #tabs empty/hidden for compatibility
      document.getElementById("tabs").innerHTML = "";

      document.getElementById("panels").innerHTML = tabs
        .map((t) => {
          if (t.tbd) return `<div class="panel" id="panel-${t.id}"><div class="placeholder">Miejsce na kolejne źródło. Zostanie dodane wkrótce.</div></div>`;
          if (t.id === "about") return `<div class="panel" id="panel-about"><div class="placeholder">…</div></div>`;
          if (t.id === "dashboard") return `<div class="panel" id="panel-dashboard"><div class="placeholder">Wczytywanie…</div></div>`;
          if (t.id === "main") return `<div class="panel" id="panel-main"><div class="placeholder">Wczytywanie…</div></div>`;
          return `<div class="panel" id="panel-${t.id}"><div class="placeholder">Wczytywanie…</div></div>`;
        })
        .join("");

      const list = document.getElementById("nav-drawer-list");
      const parts = [];
      let lastGroup = null;
      const groupLabel = { home: "Widoki", sources: "Źródła", meta: "Info" };
      for (const t of tabs) {
        if (t.group !== lastGroup) {
          parts.push(`<div class="nav-sep">${groupLabel[t.group] || ""}</div>`);
          lastGroup = t.group;
        }
        const label = `${t.name}${t.tbd ? " (wkrótce)" : ""}`;
        parts.push(
          `<button type="button" class="nav-item" data-tab="${t.id}"${t.tbd ? " disabled" : ""}>${label}</button>`
        );
      }
      list.innerHTML = parts.join("");
      list.querySelectorAll(".nav-item").forEach((btn) => {
        btn.addEventListener("click", () => {
          setActiveTab(btn.dataset.tab);
          closeNav();
        });
      });

      setActiveTab(activeTab);
    }

    function setActiveTab(id) {
      activeTab = id;
      document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.tab === id));
      document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === `panel-${id}`));
      document.body.classList.toggle("view-dashboard", id === "dashboard");
    }

    async function load() {
      const status = document.getElementById("status");
      const gen = ++loadGen;
      for (const k of Object.keys(loaded)) delete loaded[k];
      status.textContent = "Wczytywanie prognozy…";
      buildTabs();
      renderAbout();

      const sources = SOURCES.filter((s) => !s.tbd);
      const results = await Promise.allSettled(
        sources.map(async (s) => {
          const data = await s.load();
          if (gen !== loadGen) return s.id;
          loaded[s.id] = { ...data, id: s.id, name: s.name, kind: s.kind || data.kind };
          renderSourcePanel(loaded[s.id]);
          return s.id;
        })
      );
      if (gen !== loadGen) return;

      lastLoadIssues = results
        .map((r, i) => (r.status === "rejected"
          ? `${sources[i].name}: ${r.reason?.message || "błąd"}`
          : null))
        .filter(Boolean);

      renderDashboard();
      renderMain();
      renderAbout();

      if (Object.keys(loaded).length) {
        status.textContent = CITY.name;
      } else {
        status.textContent = "Brak danych — szczegóły w About";
      }
    }

    document.getElementById("refresh").addEventListener("click", load);
    document.getElementById("nav-toggle").addEventListener("click", () => {
      if (isNavOpen()) closeNav();
      else openNav();
    });
    document.getElementById("nav-close").addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeNav();
    });
    document.getElementById("nav-backdrop").addEventListener("click", (e) => {
      e.preventDefault();
      closeNav();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeNav();
    });
    load();
