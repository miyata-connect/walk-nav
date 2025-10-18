// filename: worker.js (modules)
//
// 目的:
//  - /places と /places:searchText を受け、Google Places API (New) v1 へ代理POST。
//  - 入力形式: JSON / x-www-form-urlencoded / multipart / text/plain / GET クエリ
//  - パラメータのゆらぎ: text | textQuery | q | query, + lat/lng/radius, lang/language/languageCode
//  - 規約: fieldMask は body から排し、X-Goog-FieldMask ヘッダで指定。
//  - 併設: /health, /echo（診断用）。CORS/OPTIONS 完備。
// 注意:
//  - 実運用では env.GMAPS_API_KEY に既存のサーバーキーをセット（新規発行は不要）。
//  - Places API (New) のみ許可のキー制限を維持。

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;

      // CORS Preflight
      if (request.method === 'OPTIONS') {
        return cors(new Response(null, { status: 204 }));
      }

      // Health check
      if (path === '/health') {
        return cors(json({ ok: true, service: 'places-proxy', time: new Date().toISOString() }));
      }

      // Echo (diagnostics): shows normalized input the proxy sees
      if (path === '/echo') {
        const { params, debug } = await parseUnifiedInput(request);
        return cors(json({ method: request.method, path, parsed: { params, debug } }));
      }

      // Main endpoints
      if (path === '/places' || path === '/places:searchText') {
        const { params } = await parseUnifiedInput(request, url);

        const hasText = typeof params.text === 'string' && params.text.trim().length > 0;
        const hasLatLng = isFiniteNum(params.lat) && isFiniteNum(params.lng);
        if (!hasText && !hasLatLng) {
          return cors(json({ error: 'missing text/lat/lng', hint: 'Provide text OR lat/lng' }, 400));
        }

        const endpoint = 'https://places.googleapis.com/v1/places:searchText';

        const body = {};
        if (hasText) body.textQuery = params.text;

        if (hasLatLng) {
          const radius = clampNumber(params.radius, 50, 50000) ?? 1500; // meters
          body.locationBias = {
            circle: {
              center: { latitude: Number(params.lat), longitude: Number(params.lng) },
              radius: Number(radius)
            }
          };
        }

        if (params.lang || params.language || params.languageCode) {
          body.languageCode = (params.lang || params.language || params.languageCode).toString();
        }
        if (params.limit || params.maxResultCount) {
          body.maxResultCount = Number(params.limit ?? params.maxResultCount);
        }

        const fieldMask =
          (params.fieldMask && String(params.fieldMask)) ||
          'places.id,places.displayName,places.formattedAddress,places.location,places.types';

        const headers = {
          'Content-Type': 'application/json; charset=utf-8',
          'Accept': 'application/json',
          'X-Goog-Api-Key': env.GMAPS_API_KEY,
          'X-Goog-FieldMask': fieldMask
        };

        const res = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(body)
        });

        const txt = await res.text();
        let data;
        try { data = JSON.parse(txt); } catch { data = { raw: txt }; }

        return cors(json(data, res.status));
      }

      // Not found
      return cors(json({ error: 'Not Found' }, 404));
    } catch (e) {
      return cors(json({ error: 'proxy_error', message: String(e?.message || e) }, 500));
    }
  }
};

// ===== Utilities =====
function cors(res) {
  const h = new Headers(res.headers);
  h.set('Access-Control-Allow-Origin', '*');
  h.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Requested-With,X-Goog-FieldMask');
  return new Response(res.body, { status: res.status, headers: h });
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}
function isFiniteNum(v) {
  const n = Number(v);
  return Number.isFinite(n);
}
function clampNumber(v, min, max) {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, n));
}

// Normalize all possible input forms into { params, debug }
async function parseUnifiedInput(request) {
  const url = new URL(request.url);
  const params = {};

  // GET params
  for (const [k, v] of url.searchParams.entries()) params[k] = v;

  // Body
  let parsedJson = null;
  let parsedForm = null;
  let rawBody = '';

  try {
    const ct = (request.headers.get('Content-Type') || '').toLowerCase();

    if (ct.includes('application/json')) {
      parsedJson = await request.json();
    } else if (ct.includes('application/x-www-form-urlencoded')) {
      const form = await request.formData();
      parsedForm = Object.fromEntries(form);
    } else if (ct.includes('multipart/form-data')) {
      const form = await request.formData();
      parsedForm = {};
      for (const [k, v] of form.entries()) {
        parsedForm[k] = typeof v === 'string' ? v : (v?.name || 'blob');
      }
    } else {
      rawBody = await request.text();
      if (rawBody && rawBody.includes('=')) {
        for (const kv of rawBody.split('&')) {
          const [k, v] = kv.split('=');
          if (!k) continue;
          params[decodeURIComponent(k)] = v ? decodeURIComponent(v) : '';
        }
      }
    }
  } catch (_) {}

  if (parsedForm && typeof parsedForm === 'object') Object.assign(params, parsedForm);
  if (parsedJson && typeof parsedJson === 'object') Object.assign(params, parsedJson);

  // Key normalization
  params.text = params.text ?? params.textQuery ?? params.q ?? params.query ?? null;
  if (params.lat != null) params.lat = Number(params.lat);
  if (params.lng != null) params.lng = Number(params.lng);
  if (params.radius != null) params.radius = Number(params.radius);
  if (params.limit != null) params.limit = Number(params.limit);
  if (params.maxResultCount != null) params.maxResultCount = Number(params.maxResultCount);
  params.lang = params.lang ?? params.language ?? params.languageCode ?? null;

  const debug = {
    method: request.method,
    contentType: request.headers.get('Content-Type') || ''
  };
  return { params, debug };
}
