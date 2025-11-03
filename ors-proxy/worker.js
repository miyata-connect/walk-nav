// worker.js  (Cloudflare Workers - module syntax)
// Purpose: HTTPS proxy for Google Places API (NEW v1) + Directions + Reverse Geocode
// - Strict origin allowlist via env.ALLOWED_ORIGINS (comma-separated string)
// - CORS for GET/POST/OPTIONS
// - Endpoints:
//    GET  /health
//    POST /places:searchText
//    POST /places:searchNearby
//    GET  /geocode?lat=..&lng=..           (Maps Geocoding API)
//    GET  /directions?origin=..&destination=..&mode=walking|driving|bicycling&language=ja
//
// Secrets / Vars:
//   - Secret: GMAPS_API_KEY
//   - Var   : ALLOWED_ORIGINS = "https://miyata-connect.github.io,https://localhost:8787,http://localhost:8787"

export default {
  async fetch(request, env) {
    try {
      const origin = request.headers.get("Origin") || "";
      const allowed = isAllowedOrigin(origin, env);

      // CORS preflight
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders(origin, allowed) });
      }

      if (!allowed) {
        return json(
          { ok: false, error: "forbidden_origin", message: "Only approved HTTPS origins may call this Worker." },
          origin,
          403
        );
      }

      const url = new URL(request.url);
      const { pathname } = url;

      if (request.method === "GET" && pathname === "/health") {
        return json({ ok: true, service: "ors-proxy" }, origin);
      }

      if (request.method === "POST" && pathname === "/places:searchText") {
        return handlePlacesText(request, env, origin);
      }

      if (request.method === "POST" && pathname === "/places:searchNearby") {
        return handlePlacesNearby(request, env, origin);
      }

      if (request.method === "GET" && pathname === "/geocode") {
        return handleReverseGeocode(request, env, origin);
      }

      if (request.method === "GET" && pathname === "/directions") {
        return handleDirections(request, env, origin);
      }

      return json({ ok: false, error: "not_found" }, origin, 404);
    } catch (e) {
      return json({ ok: false, error: "proxy_error", message: String(e) }, "", 502);
    }
  }
};

/* ----------------------------- Helpers ----------------------------- */

function corsHeaders(origin, allowed) {
  const h = new Headers();
  h.set("Access-Control-Allow-Credentials", "true");
  h.set("Access-Control-Allow-Headers", "Content-Type, X-Goog-FieldMask");
  h.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (allowed && origin) h.set("Access-Control-Allow-Origin", origin);
  return h;
}

function json(obj, origin, status = 200, extra = {}) {
  const h = {
    "Content-Type": "application/json",
    ...corsHeaders(origin, !!origin)
  };
  return new Response(JSON.stringify(obj), { status, headers: { ...h, ...extra } });
}

function isAllowedOrigin(origin, env) {
  if (!origin) return false;
  // Accept only https/http origins explicitly listed
  const raw = (env.ALLOWED_ORIGINS || "").trim();
  if (!raw) return false;
  const list = raw
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  return list.includes(origin);
}

function parseJSONSafely(text, fallback = {}) {
  try { return JSON.parse(text); } catch { return fallback; }
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
