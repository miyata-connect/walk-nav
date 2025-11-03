// ISSUE_ID: wrk202511040404
// ors-proxy Cloudflare Worker - stable build
// Supports: /health, /geocode, /places:searchText, /directions

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    if (method === "OPTIONS") return handleOptions(origin);

    // Origin security
    if (!isAllowedOrigin(origin, env.ALLOWED_ORIGINS)) {
      return json(
        {
          ok: false,
          error: "forbidden_origin",
          message: "Only approved HTTPS origins may call this Worker.",
        },
        origin,
        403
      );
    }

    try {
      switch (url.pathname) {
        case "/health":
          return json({ ok: true, service: "ors-proxy" }, origin);

        case "/geocode":
          return await handleReverseGeocode(request, env, origin);

        case "/places:searchText":
          return await handlePlacesSearch(request, env, origin);

        case "/directions":
          return await handleDirections(request, env, origin);

        default:
          return json({ ok: false, error: "unknown_path" }, origin, 404);
      }
    } catch (err) {
      return json(
        { ok: false, error: "server_error", message: String(err) },
        origin,
        500
      );
    }
  },
};

// --- Reverse Geocode ---
async function handleReverseGeocode(request, env, origin) {
  const url = new URL(request.url);

  // Robust parameter parsing
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

  const lat = latParam ? parseFloat(latParam) : NaN;
  const lng = lngParam ? parseFloat(lngParam) : NaN;

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return json({ ok: false, error: "missing_latlng" }, origin, 400);
  }

  const api = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&language=ja&key=${env.GMAPS_API_KEY}`;
  const res = await fetch(api);
  const data = await res.json().catch(() => ({}));

  if (!res.ok || !data.results) {
    return json({ ok: false, error: "geocode_failed" }, origin, 502);
  }

  const formatted =
    data.results?.[0]?.formatted_address ||
    data.plus_code?.compound_code ||
    "住所不明";

  return json({ ok: true, formattedAddress: formatted, lat, lng }, origin);
}

// --- Places Search ---
async function handlePlacesSearch(request, env, origin) {
  const body = await request.text();
  if (!body) return json({ ok: false, error: "missing_body" }, origin, 400);
  const payload = JSON.parse(body);

  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": env.GMAPS_API_KEY,
      "X-Goog-FieldMask":
        "places.displayName,places.formattedAddress,places.location",
    },
    body: JSON.stringify({
      textQuery: payload.textQuery,
      maxResultCount: payload.maxResultCount || 5,
    }),
  });

  const jsonData = await res.json().catch(() => ({}));
  return new Response(JSON.stringify(jsonData), {
    status: res.status,
    headers: { "Content-Type": "application/json", ...cors(origin) },
  });
}

// --- Directions ---
async function handleDirections(request, env, origin) {
  const url = new URL(request.url);
  const params = url.searchParams.toString();
  const gUrl = `https://maps.googleapis.com/maps/api/directions/json?${params}&key=${env.GMAPS_API_KEY}`;
  const res = await fetch(gUrl);
  const data = await res.json().catch(() => ({}));
  return json(data, origin, res.status);
}

// --- Utility Functions ---
function json(obj, origin, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...cors(origin) },
  });
}

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Goog-FieldMask",
    "Access-Control-Allow-Credentials": "true",
  };
}

function handleOptions(origin) {
  return new Response(null, { status: 204, headers: cors(origin) });
}

function isAllowedOrigin(origin, allowed) {
  if (!allowed || !origin) return false;
  const list = allowed.split(",").map((x) => x.trim());
  return list.includes(origin);
}
