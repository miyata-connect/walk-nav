// worker.js
// Cloudflare Worker: Proxy for Google Maps/Places APIs
// - CORS allowlist via env.ALLOWED_ORIGINS (comma-separated, or JSON array as string)
// - Google API key via secret `GMAPS_API_KEY`
// Endpoints:
//   GET    /health
//   GET    /geocode?lat=..&lng=..
//   GET    /directions?origin=lat,lng&destination=lat,lng&mode=walking&language=ja
//   POST   /places:searchText
//   POST   /places:searchNearby
// Caution: Do NOT log secrets.

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Goog-FieldMask",
  };
}

// Accept CSV or JSON-array string in env.ALLOWED_ORIGINS
function parseAllowedOrigins(raw) {
  try {
    if (!raw) return [];
    const s = String(raw).trim();
    if (!s) return [];
    // Try JSON array string
    if (s.startsWith("[")) {
      return JSON.parse(s).map(x => String(x).trim()).filter(Boolean);
    }
    // Fallback: CSV
    return s.split(",").map(x => x.trim()).filter(Boolean);
  } catch {
    // Last resort: split by comma anyway
    try { return String(raw).split(",").map(x => x.trim()).filter(Boolean); }
    catch { return []; }
  }
}

function isAllowedOrigin(origin, env) {
  if (!origin || !origin.startsWith("https://")) return false;
  const list = parseAllowedOrigins(env.ALLOWED_ORIGINS || "");
  return list.includes(origin);
}

async function handleOptions(request, env) {
  const origin = request.headers.get("Origin") || "";
  if (!isAllowedOrigin(origin, env)) {
    return new Response(JSON.stringify({ ok: false, error: "forbidden_origin" }), {
      status: 403,
      headers: { "Content-Type": "application/json", ...cors(origin) }
    });
  }
  return new Response("ok", { headers: cors(origin) });
}

// ---------------- Google fetch helpers ----------------

function buildJsonHeaders(apiKey, fieldMask) {
  const h = new Headers();
  h.set("Content-Type", "application/json");
  if (apiKey) h.set("X-Goog-Api-Key", apiKey);
  if (fieldMask) h.set("X-Goog-FieldMask", fieldMask);
  return h;
}

async function proxyJsonPOST(url, body, headers = {}) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function handlePlacesText(request, env, origin) {
  const apiKey = env.GMAPS_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ ok:false, error:"missing_api_key" }), {
      status: 500, headers: { "Content-Type":"application/json", ...cors(origin) }
    });
  }
  const fieldMask = request.headers.get("X-Goog-FieldMask") || "places.displayName,places.formattedAddress,places.location";
  const payload = await request.json();
  // Harden defaults (language fallback)
  if (!payload.languageCode) payload.languageCode = "ja";
  const res = await proxyJsonPOST(
    "https://places.googleapis.com/v1/places:searchText",
    payload,
    Object.fromEntries(buildJsonHeaders(apiKey, fieldMask).entries())
  );
  const text = await res.text();
  return new Response(text, { status: res.status, headers: { "Content-Type":"application/json", ...cors(origin) } });
}

async function handlePlacesNearby(request, env, origin) {
  const apiKey = env.GMAPS_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ ok:false, error:"missing_api_key" }), {
      status: 500, headers: { "Content-Type":"application/json", ...cors(origin) }
    });
  }
  const fieldMask = request.headers.get("X-Goog-FieldMask") || "places.displayName,places.formattedAddress,places.location";
  const payload = await request.json();
  if (!payload.languageCode) payload.languageCode = "ja";
  const res = await proxyJsonPOST(
    "https://places.googleapis.com/v1/places:searchNearby",
    payload,
    Object.fromEntries(buildJsonHeaders(apiKey, fieldMask).entries())
  );
  const text = await res.text();
  return new Response(text, { status: res.status, headers: { "Content-Type":"application/json", ...cors(origin) } });
}

async function handleReverseGeocode(urlStr, env, origin) {
  const apiKey = env.GMAPS_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ ok:false, error:"missing_api_key" }), {
      status: 500, headers: { "Content-Type":"application/json", ...cors(origin) }
    });
  }
  const url = new URL(urlStr);
  const lat = url.searchParams.get("lat");
  const lng = url.searchParams.get("lng");
  if (!lat || !lng) {
    return new Response(JSON.stringify({ ok:false, error:"missing_latlng" }), {
      status: 400, headers: { "Content-Type":"application/json", ...cors(origin) }
    });
  }
  // IMPORTANT: Use latlng=LAT,LNG (not lat=&lng=)
  const geoUrl = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${encodeURIComponent(lat)},${encodeURIComponent(lng)}&language=ja&key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(geoUrl);
  const text = await res.text();
  // Optionally compress to a minimal shape; keep raw to avoid surprises
  return new Response(text, { status: res.status, headers: { "Content-Type":"application/json", ...cors(origin) } });
}

async function handleDirections(urlStr, env, origin) {
  const apiKey = env.GMAPS_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ ok:false, error:"missing_api_key" }), {
      status: 500, headers: { "Content-Type":"application/json", ...cors(origin) }
    });
  }
  const url = new URL(urlStr);
  const originParam = url.searchParams.get("origin");
  const destinationParam = url.searchParams.get("destination");
  const mode = url.searchParams.get("mode") || "walking";
  const language = url.searchParams.get("language") || "ja";

  if (!originParam || !destinationParam) {
    return new Response(JSON.stringify({ ok:false, error:"missing_origin_or_destination" }), {
      status: 400, headers: { "Content-Type":"application/json", ...cors(origin) }
    });
  }

  // Use classic Directions API for stable polyline + legs fields
  const q = new URLSearchParams({
    origin: originParam,
    destination: destinationParam,
    mode,
    language,
    key: apiKey
  });
  const dirUrl = `https://maps.googleapis.com/maps/api/directions/json?${q.toString()}`;
  const res = await fetch(dirUrl);
  const text = await res.text();
  return new Response(text, { status: res.status, headers: { "Content-Type":"application/json", ...cors(origin) } });
}

// ---------------- Worker entry ----------------

export default {
  async fetch(request, env) {
    try {
      const { pathname } = new URL(request.url);
      const origin = request.headers.get("Origin") || "";

      // CORS gate
      if (request.method === "OPTIONS") {
        return handleOptions(request, env);
      }
      if (!isAllowedOrigin(origin, env)) {
        return new Response(JSON.stringify({ ok:false, error:"forbidden_origin", message:"Only approved HTTPS origins may call this Worker." }), {
          status: 403,
          headers: { "Content-Type":"application/json", ...cors(origin) }
        });
      }

      // Routes
      if (request.method === "GET" && pathname === "/health") {
        return new Response(JSON.stringify({ ok: true, service: "ors-proxy" }), {
          headers: { "Content-Type":"application/json", ...cors(origin) }
        });
      }

      if (request.method === "POST" && pathname === "/places:searchText") {
        return handlePlacesText(request, env, origin);
      }

      if (request.method === "POST" && pathname === "/places:searchNearby") {
        return handlePlacesNearby(request, env, origin);
      }

      if (request.method === "GET" && pathname === "/geocode") {
        return handleReverseGeocode(request.url, env, origin);
      }

      if (request.method === "GET" && pathname === "/directions") {
        return handleDirections(request.url, env, origin);
      }

      return new Response(JSON.stringify({ ok:false, error:"not_found" }), {
        status: 404,
        headers: { "Content-Type":"application/json", ...cors(origin) }
      });
    } catch (e) {
      return new Response(JSON.stringify({ ok:false, error:"proxy_error", message: String(e) }), {
        status: 502,
        headers: { "Content-Type":"application/json", ...cors(request.headers.get("Origin") || "*") }
      });
    }
  }
};
