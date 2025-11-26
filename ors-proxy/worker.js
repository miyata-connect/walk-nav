// Cloudflare Worker: Proxy for Google Places API (New) + Reverse Geocode + Directions
// CORS allowlist via env.ALLOWED_ORIGINS (comma-separated origins)
// API key via secret GMAPS_API_KEY

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Goog-FieldMask, X-Run-Id"
  };
}

function parseAllowedOrigins(env) {
  try {
    const raw = env.ALLOWED_ORIGINS;
    if (!raw) return [];
    try {
      // JSON 文字列（["https://...","..."]）ならそのまま
      return JSON.parse(raw);
    } catch {
      // カンマ区切りにも後方互換
      return String(raw).split(",").map(s => s.trim()).filter(Boolean);
    }
  } catch {
    return [];
  }
}
function isAllowedOrigin(origin, env) {
  if (!origin || !origin.startsWith("https://")) return false;
  const list = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  return list.includes(origin);
}

async function handleOptions(request, env) {
  const origin = request.headers.get("Origin") || "";
  if (!isAllowedOrigin(origin, env)) {
    return new Response(JSON.stringify({ ok:false, error:"forbidden_origin" }), {
      status: 403,
      headers: { "Content-Type":"application/json", ...cors(origin) }
    });
  }
  return new Response("ok", { headers: cors(origin) });
}

async function proxyJsonPOST(url, body, headers = {}) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type":"application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function handlePlacesSearchText(request, env, origin) {
  const payload = await request.json();
  const url = `https://places.googleapis.com/v1/places:searchText?key=${env.GMAPS_API_KEY}`;
  const fieldMask = request.headers.get("X-Goog-FieldMask") ||
    "places.displayName,places.formattedAddress,places.location,places.id,places.types";
  const upstream = await proxyJsonPOST(url, payload, { "X-Goog-FieldMask": fieldMask });
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { "Content-Type":"application/json", ...cors(origin) }
  });
}

async function handlePlacesNearby(request, env, origin) {
  const payload = await request.json();
  const url = `https://places.googleapis.com/v1/places:searchNearby?key=${env.GMAPS_API_KEY}`;
  const fieldMask = request.headers.get("X-Goog-FieldMask") ||
    "places.displayName,places.formattedAddress,places.location,places.id,places.types";
  const upstream = await proxyJsonPOST(url, payload, { "X-Goog-FieldMask": fieldMask });
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { "Content-Type":"application/json", ...cors(origin) }
  });
}

async function handleReverseGeocode(url, env, origin) {
  const latlng = new URL(url).searchParams.get("latlng");
  if (!latlng) {
    return new Response(JSON.stringify({ ok:false, error:"missing_latlng" }), {
      status: 400, headers: { "Content-Type":"application/json", ...cors(origin) }
    });
  }
  const api = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${encodeURIComponent(latlng)}&key=${env.GMAPS_API_KEY}&language=ja&region=JP`;
  const upstream = await fetch(api);
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { "Content-Type":"application/json", ...cors(origin) }
  });
}

async function handleDirections(url, env, origin) {
  const u = new URL(url);
  const api = `https://maps.googleapis.com/maps/api/directions/json?${u.search}&key=${env.GMAPS_API_KEY}`;
  const upstream = await fetch(api);
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { "Content-Type":"application/json", ...cors(origin) }
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const { pathname } = new URL(request.url);

    if (request.method === "OPTIONS") {
      return handleOptions(request, env);
    }

    if (!isAllowedOrigin(origin, env)) {
      return new Response(JSON.stringify({ ok:false, error:"forbidden_origin", message:"Only approved HTTPS origins may call this Worker." }), {
        status: 403,
        headers: { "Content-Type":"application/json", ...cors(origin) }
      });
    }

    try {
      if (request.method === "GET" && pathname === "/health") {
        return new Response(JSON.stringify({ ok:true, service:"ors-proxy" }), {
          headers: { "Content-Type":"application/json", ...cors(origin) }
        });
      }
      if (request.method === "POST" && pathname === "/places:searchText") {
        return handlePlacesSearchText(request, env, origin);
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
        headers: { "Content-Type":"application/json", ...cors(origin) }
      });
    }
  }
};
