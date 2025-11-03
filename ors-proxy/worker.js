// ISSUE_ID: wrk202511040355
// ors-proxy Cloudflare Worker (full version)
// Handles: /health, /geocode (reverse), /places:searchText, /directions, CORS-safe routing.

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const method = request.method.toUpperCase();

    // --- CORS preflight ---
    if (method === "OPTIONS") {
      return handleOptions(origin);
    }

    // --- Security: Origin check ---
    if (!isAllowedOrigin(origin, env.ALLOWED_ORIGINS)) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "forbidden_origin",
          message: "Only approved HTTPS origins may call this Worker.",
        }),
        {
          status: 403,
          headers: { "Content-Type": "application/json", ...cors(origin) },
        }
      );
    }

    // --- Routing ---
    const path = url.pathname;

    try {
      if (path === "/health") {
        return new Response(JSON.stringify({ ok: true, service: "ors-proxy" }), {
          headers: { "Content-Type": "application/json", ...cors(origin) },
        });
      }

      if (path === "/geocode") {
        return await handleReverseGeocode(request, env, origin);
      }

      if (path === "/places:searchText") {
        return await handlePlacesSearch(request, env, origin);
      }

      if (path === "/directions") {
        return await handleDirections(request, env, origin);
      }

      return new Response(
        JSON.stringify({ ok: false, error: "unknown_path" }),
        { status: 404, headers: { "Content-Type": "application/json", ...cors(origin) } }
      );
    } catch (e) {
      return new Response(
        JSON.stringify({ ok: false, error: "server_error", message: String(e) }),
        { status: 500, headers: { "Content-Type": "application/json", ...cors(origin) } }
      );
    }
  },
};

// ---- Reverse Geocode (accepts lat/lng OR latitude/longitude) ----
async function handleReverseGeocode(request, env, origin) {
  const u = new URL(request.url);

  const rawLat = u.searchParams.get("lat") || u.searchParams.get("latitude");
  const rawLng = u.searchParams.get("lng") || u.searchParams.get("longitude");

  const lat = rawLat ? parseFloat(rawLat.trim()) : NaN;
  const lng = rawLng ? parseFloat(rawLng.trim()) : NaN;

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return new Response(
      JSON.stringify({ ok: false, error: "missing_latlng" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json", ...cors(origin) },
      }
    );
  }

  const api = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&language=ja&key=${env.GMAPS_API_KEY}`;
  const res = await fetch(api);
  const data = await res.json().catch(() => ({}));

  if (!res.ok || !data.results) {
    return new Response(
      JSON.stringify({ ok: false, error: "geocode_failed" }),
      {
        status: 502,
        headers: { "Content-Type": "application/json", ...cors(origin) },
      }
    );
  }

  const formattedAddress =
    data.results[0]?.formatted_address || data.plus_code?.compound_code || "";

  return new Response(
    JSON.stringify({
      ok: true,
      formattedAddress,
      lat,
      lng,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json", ...cors(origin) },
    }
  );
}

// ---- Google Places: searchText ----
async function handlePlacesSearch(request, env, origin) {
  const body = await request.text();
  if (!body) {
    return new Response(
      JSON.stringify({ ok: false, error: "missing_body" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json", ...cors(origin) },
      }
    );
  }

  const data = JSON.parse(body);
  const payload = {
    textQuery: data.textQuery,
    maxResultCount: data.maxResultCount || 5,
  };

  const gUrl = "https://places.googleapis.com/v1/places:searchText";
  const res = await fetch(gUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": env.GMAPS_API_KEY,
      "X-Goog-FieldMask":
        "places.displayName,places.formattedAddress,places.location",
    },
    body: JSON.stringify(payload),
  });

  const json = await res.json().catch(() => ({}));

  return new Response(JSON.stringify(json), {
    status: res.status,
    headers: { "Content-Type": "application/json", ...cors(origin) },
  });
}

// ---- Directions proxy (ORS / Google) ----
async function handleDirections(request, env, origin) {
  const u = new URL(request.url);
  const query = u.searchParams.toString();
  const api = `https://maps.googleapis.com/maps/api/directions/json?${query}&key=${env.GMAPS_API_KEY}`;
  const res = await fetch(api);
  const data = await res.json();
  return new Response(JSON.stringify(data), {
    status: res.status,
    headers: { "Content-Type": "application/json", ...cors(origin) },
  });
}

// ---- Utility: Origin allow ----
function isAllowedOrigin(origin, allowed) {
  if (!allowed || !origin) return false;
  const list = allowed.split(",").map((x) => x.trim());
  return list.includes(origin);
}

// ---- Utility: CORS ----
function cors(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Goog-FieldMask",
    "Access-Control-Allow-Credentials": "true",
  };
}

// ---- OPTIONS handler ----
function handleOptions(origin) {
  return new Response(null, {
    status: 204,
    headers: { ...cors(origin) },
  });
}
