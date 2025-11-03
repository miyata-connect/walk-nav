// worker.js  — Cloudflare Worker for WalkNav proxy
// Endpoints: /health, /places:searchText, /places:searchNearby, /geocode, /directions
// CORS allowlist comes from env.ALLOWED_ORIGINS (JSON array or comma-separated string)
// Google API key via secret GMAPS_API_KEY

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Goog-FieldMask"
  };
}

// Parse ALLOWED_ORIGINS from env (JSON array string or comma-separated string)
function parseAllowedOrigins(env) {
  try {
    const raw = env.ALLOWED_ORIGINS || "";
    if (!raw) return [];
    try {
      // Try JSON array string: ["https://...", "https://..."]
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        return arr.map(s => String(s).trim()).filter(Boolean);
      }
    } catch {
      // Fallback: comma-separated
      return String(raw).split(",").map(s => s.trim()).filter(Boolean);
    }
  } catch {
    return [];
  }
}

function isAllowedOrigin(origin, env) {
  if (!origin || !origin.startsWith("https://")) return false;
  const list = parseAllowedOrigins(env);
  return list.includes(origin);
}

async function handleOptions(request, env) {
  const origin = request.headers.get("Origin") || "";
  if (!isAllowedOrigin(origin, env)) {
    return new Response(
      JSON.stringify({ ok: false, error: "forbidden_origin" }),
      { status: 403, headers: { "Content-Type": "application/json", ...cors(origin) } }
    );
  }
  return new Response("ok", { headers: cors(origin) });
}

// ----- Google API helpers -----
function withKey(url, env) {
  const u = new URL(url);
  u.searchParams.set("key", env.GMAPS_API_KEY);
  return u.toString();
}

async function proxyJsonPOST(url, body, headers = {}) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

// ----- Handlers -----
async function handleHealth(origin) {
  return new Response(JSON.stringify({ ok: true, service: "ors-proxy" }), {
    status: 200,
    headers: { "Content-Type": "application/json", ...cors(origin) }
  });
}

async function handlePlacesText(request, env, origin) {
  const mask = request.headers.get("X-Goog-FieldMask") || "";
  const url = withKey("https://places.googleapis.com/v1/places:searchText", env);
  const body = await request.json().catch(() => ({}));
  const resp = await proxyJsonPOST(url, body, mask ? { "X-Goog-FieldMask": mask } : {});
  const text = await resp.text();
  return new Response(text, {
    status: resp.status,
    headers: { "Content-Type": "application/json", ...cors(origin) }
  });
}

async function handlePlacesNearby(request, env, origin) {
  const mask = request.headers.get("X-Goog-FieldMask") || "";
  const url = withKey("https://places.googleapis.com/v1/places:searchNearby", env);
  const body = await request.json().catch(() => ({}));
  const resp = await proxyJsonPOST(url, body, mask ? { "X-Goog-FieldMask": mask } : {});
  const text = await resp.text();
  return new Response(text, {
    status: resp.status,
    headers: { "Content-Type": "application/json", ...cors(origin) }
  });
}

async function handleReverseGeocode(request, env, origin) {
  const u = new URL(request.url);
  const lat = u.searchParams.get("lat");
  const lng = u.searchParams.get("lng");

  const okNum = (v) => typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v));

  if (!okNum(lat) || !okNum(lng)) {
    return new Response(JSON.stringify({ ok: false, error: "missing_latlng" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...cors(origin) }
    });
  }

  // Geocoding API (reverse geocode)
  const gUrl = withKey(
    `https://maps.googleapis.com/maps/api/geocode/json?latlng=${encodeURIComponent(lat)},${encodeURIComponent(lng)}&language=ja`,
    env
  );

  const gResp = await fetch(gUrl, { method: "GET" });
  const data = await gResp.json().catch(() => ({}));

  if (!gResp.ok) {
    return new Response(JSON.stringify({ ok: false, error: "geocode_failed", status: gResp.status }), {
      status: 502,
      headers: { "Content-Type": "application/json", ...cors(origin) }
    });
  }

  const formattedAddress =
    (Array.isArray(data.results) && data.results[0]?.formatted_address) ||
    data.plus_code?.compound_code ||
    "";

  return new Response(JSON.stringify({ ok: true, formattedAddress, raw: data }), {
    status: 200,
    headers: { "Content-Type": "application/json", ...cors(origin) }
  });
}

async function handleDirections(request, env, origin) {
  const u = new URL(request.url);
  const originParam = u.searchParams.get("origin");
  const destParam = u.searchParams.get("destination");
  const mode = u.searchParams.get("mode") || "walking";
  const language = u.searchParams.get("language") || "ja";

  if (!originParam || !destParam) {
    return new Response(JSON.stringify({ ok: false, error: "missing_origin_or_destination" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...cors(origin) }
    });
  }

  // Legacy Directions API (overview_polyline.points expected by client)
  const dUrl = withKey(
    `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(originParam)}&destination=${encodeURIComponent(destParam)}&mode=${encodeURIComponent(mode)}&language=${encodeURIComponent(language)}`,
    env
  );

  const dResp = await fetch(dUrl, { method: "GET" });
  const text = await dResp.text();

  return new Response(text, {
    status: dResp.status,
    headers: { "Content-Type": "application/json", ...cors(origin) }
  });
}

// ----- Main fetch -----
export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const { pathname } = new URL(request.url);

    // Preflight
    if (request.method === "OPTIONS") {
      return handleOptions(request, env);
    }

    // Origin allow-check (only for browser calls; allow curl without Origin)
    if (origin && !isAllowedOrigin(origin, env)) {
      return new Response(
        JSON.stringify({ ok: false, error: "forbidden_origin", message: "Only approved HTTPS origins may call this Worker." }),
        { status: 403, headers: { "Content-Type": "application/json", ...cors(origin) } }
      );
    }

    try {
      if (request.method === "GET" && pathname === "/health") {
        return handleHealth(origin);
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

      return new Response(JSON.stringify({ ok: false, error: "not_found" }), {
        status: 404,
        headers: { "Content-Type": "application/json", ...cors(origin) }
      });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: "proxy_error", message: String(e) }), {
        status: 502,
        headers: { "Content-Type": "application/json", ...cors(origin) }
      });
    }
  }
};
