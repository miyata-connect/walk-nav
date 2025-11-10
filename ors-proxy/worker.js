/**
 * WalkNav Cloudflare Worker (ors-proxy) — production
 * 既存エンドポイントは維持（/geocode, /directions, /places:searchText, /places:searchNearby）
 * 追加：/weather-google（Google Weather v1/forecast:hourly を POST でプロキシ）
 * 追加：/weather-openweather（OpenWeatherMap API をプロキシ）
 * 追加：/incidents（ダミーインシデント情報を返す）
 *
 * 必要な環境変数：
 * - GMAPS_API_KEY            : Google Maps系(Geocode/Directions/Places)用
 * - GOOGLE_WEATHER_API_KEY   : Google Weather API 用（ウェブサイト制限OK）
 * - OPENWEATHER_API_KEY       : OpenWeatherMap API 用
 * - ALLOWED_ORIGINS          : カンマ区切り（例: "https://miyata-connect.github.io,https://miyata-connect.pages.dev"）
 * - FORCED_REFERRER          : Weather 用に強制付与する Referer（例: "https://miyata-connect.github.io"）
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = pickCorsOrigin(request, env);

    // Preflight
    if (request.method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }), origin);
    }

    try {
      if (url.pathname === '/health') {
        return withCors(json({ status: 'OK' }), origin);
      }
      if (url.pathname === '/geocode')              return withCors(await handleGeocode(url, env), origin);
      if (url.pathname === '/directions')           return withCors(await handleDirections(url, env), origin);
      if (url.pathname === '/places:searchText')    return withCors(await handlePlacesText(request, env), origin);
      if (url.pathname === '/places:searchNearby')  return withCors(await handlePlacesNearby(request, env), origin);
      if (url.pathname === '/weather-google')       return withCors(await handleWeatherGoogle(request, env), origin);
      if (url.pathname === '/weather-openweather') return withCors(await handleWeatherOpenWeather(url, env), origin);
      if (url.pathname === '/incidents')            return withCors(await handleIncidents(url, env), origin);

      return withCors(json({ status: 'NOT_FOUND', error_message: 'Invalid path' }, 404), origin);
    } catch (e) {
      const msg = (e && e.message) ? e.message : String(e);
      return withCors(json({ status: 'SERVER_ERROR', error_message: msg }, 500), origin);
    }
  }
};

// -------------------------- 共通/CORS --------------------------
function pickCorsOrigin(request, env) {
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const reqOrigin = request.headers.get('Origin');
  if (reqOrigin && allowed.includes(reqOrigin)) return reqOrigin;
  return allowed[0] || '*';
}
function withCors(res, origin) {
  res.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type, X-Goog-FieldMask');
  res.headers.set('Access-Control-Max-Age', '86400');
  res.headers.set('Vary', 'Origin');
  res.headers.set('Access-Control-Allow-Origin', origin || '*');
  return res;
}
function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });
}
function requireEnv(key, env) {
  const v = env[key];
  if (!v) throw new Error(`${key} is not configured on Worker environment`);
  return v;
}
function cloneInboundHeaders(h) {
  const headers = new Headers(h);
  headers.delete('host'); headers.delete('origin'); headers.delete('referer');
  return headers;
}
function passthroughJSON(h) {
  const o = new Headers(h);
  o.set('Content-Type', 'application/json; charset=utf-8');
  return o;
}

/* ----------------------------- Places: Text Search ----------------------------- */

async function handlePlacesText(request, env, origin) {
  const apiKey = env.GMAPS_API_KEY;
  if (!apiKey) return json({ ok: false, error: "missing_api_key" }, origin, 500);

  const body = await request.text();
  const payload = parseJSONSafely(body, {});
  // Default languageCode if not provided
  if (!payload.languageCode) payload.languageCode = "ja";

  const fieldMask = request.headers.get("X-Goog-FieldMask") ||
    "places.displayName,places.formattedAddress,places.location,places.id,places.types";

  const upstream = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": fieldMask
    },
    body: JSON.stringify(payload)
  });

  const text = await upstream.text();
  const status = upstream.status;
  if (!upstream.ok) {
    return json({ ok: false, error: "places_text_error", status, body: tryParse(text) }, origin, 502);
  }
  return new Response(text, { status: 200, headers: corsHeaders(origin, true) });
}

/* ----------------------------- Places: Nearby Search ----------------------------- */

async function handlePlacesNearby(request, env, origin) {
  const apiKey = env.GMAPS_API_KEY;
  if (!apiKey) return json({ ok: false, error: "missing_api_key" }, origin, 500);

  const body = await request.text();
  const payload = parseJSONSafely(body, {});
  if (!payload.languageCode) payload.languageCode = "ja";

  const fieldMask = request.headers.get("X-Goog-FieldMask") ||
    "places.displayName,places.formattedAddress,places.location,places.id,places.types";

  const upstream = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": fieldMask
    },
    body: JSON.stringify(payload)
  });

  const text = await upstream.text();
  const status = upstream.status;
  if (!upstream.ok) {
    return json({ ok: false, error: "places_nearby_error", status, body: tryParse(text) }, origin, 502);
  }
  return new Response(text, { status: 200, headers: corsHeaders(origin, true) });
}

/* ----------------------------- Reverse Geocode (GET /geocode) ----------------------------- */

async function handleReverseGeocode(request, env, origin) {
  const apiKey = env.GMAPS_API_KEY;
  if (!apiKey) return json({ ok: false, error: "missing_api_key" }, origin, 500);

  const url = new URL(request.url);

  // Accept multiple aliases for robustness
  const latParam =
    url.searchParams.get("lat") ||
    url.searchParams.get("latitude") ||
    url.searchParams.get("LAT") ||
    url.searchParams.get("Latitude");

  const lngParam =
    url.searchParams.get("lng") ||
    url.searchParams.get("lon") ||
    url.searchParams.get("longitude") ||
    url.searchParams.get("LON") ||
    url.searchParams.get("Longitude");

  const lat = latParam != null ? Number(latParam) : NaN;
  const lng = lngParam != null ? Number(lngParam) : NaN;

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return json(
      {
        ok: false,
        error: "missing_latlng",
        debug: {
          url: url.toString(),
          receivedParams: Object.fromEntries(url.searchParams.entries()),
          latParam, lngParam, latParsed: String(lat), lngParsed: String(lng)
        }
      },
      origin,
      400
    );
  }

  // Maps Geocoding API (must be enabled in your project)
  const api = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&language=ja&key=${apiKey}`;
  const resp = await fetch(api);
  const text = await resp.text();
  const data = tryParse(text);

  if (!resp.ok) {
    return json({ ok: false, error: "geocode_upstream_error", status: resp.status, body: data }, origin, 502);
  }

  const formatted =
    data?.results?.[0]?.formatted_address ??
    data?.plus_code?.compound_code ??
    "";

  return json({ ok: true, formattedAddress: formatted, lat, lng }, origin);
}

/* ----------------------------- Directions (GET /directions) ----------------------------- */

async function handleDirections(request, env, origin) {
  const apiKey = env.GMAPS_API_KEY;
  if (!apiKey) return json({ ok: false, error: "missing_api_key" }, origin, 500);

  const url = new URL(request.url);
  const originStr = url.searchParams.get("origin");
  const destStr = url.searchParams.get("destination");
  const mode = (url.searchParams.get("mode") || "walking").toLowerCase();
  const language = url.searchParams.get("language") || "ja";

  if (!originStr || !destStr) {
    return json({ ok: false, error: "missing_params", message: "origin and destination are required" }, origin, 400);
  }

  // Try Maps Directions API (v1) first
  // If you intend to use Routes API, adapt accordingly.
  const api =
    `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(originStr)}` +
    `&destination=${encodeURIComponent(destStr)}&mode=${encodeURIComponent(mode)}&language=${encodeURIComponent(language)}` +
    `&key=${apiKey}`;

  const resp = await fetch(api);
  const text = await resp.text();
  const data = tryParse(text);

  if (!resp.ok) {
    return json({ ok: false, error: "directions_upstream_error", status: resp.status, body: data }, origin, 502);
  }

  return json(data, origin);
}

/* ----------------------------- Utils ----------------------------- */

function tryParse(s) {
  try { return JSON.parse(s); } catch { return { raw: s }; }
}
