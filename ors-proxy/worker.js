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

// -------------------------- 既存：Geocode/Directions/Places --------------------------
async function handleGeocode(u, env) {
  const apiKey = requireEnv('GMAPS_API_KEY', env);
  const lat = u.searchParams.get('lat');
  const lng = u.searchParams.get('lng');
  const language = u.searchParams.get('language') || 'ja';
  if (!lat || !lng) return json({ status: 'INVALID_REQUEST', error_message: 'lat & lng required' }, 400);
  const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&language=${encodeURIComponent(language)}&key=${apiKey}`;
  const r = await fetch(url);
  return new Response(r.body, { status: r.status, headers: passthroughJSON(r.headers) });
}
async function handleDirections(u, env) {
  const apiKey = requireEnv('GMAPS_API_KEY', env);
  const qs = new URLSearchParams(u.search); qs.delete('key'); qs.append('key', apiKey);
  const url = `https://maps.googleapis.com/maps/api/directions/json?${qs.toString()}`;
  const r = await fetch(url);
  return new Response(r.body, { status: r.status, headers: passthroughJSON(r.headers) });
}
async function handlePlacesText(request, env) {
  const apiKey = requireEnv('GMAPS_API_KEY', env);
  const url = `https://places.googleapis.com/v1/places:searchText?key=${apiKey}`;
  const headers = cloneInboundHeaders(request.headers);
  const r = await fetch(url, { method: 'POST', headers, body: request.body });
  return new Response(r.body, { status: r.status, headers: passthroughJSON(r.headers) });
}
async function handlePlacesNearby(request, env) {
  const apiKey = requireEnv('GMAPS_API_KEY', env);
  const url = `https://places.googleapis.com/v1/places:searchNearby?key=${apiKey}`;
  const headers = cloneInboundHeaders(request.headers);
  const r = await fetch(url, { method: 'POST', headers, body: request.body });
  return new Response(r.body, { status: r.status, headers: passthroughJSON(r.headers) });
}

// -------------------------- 追加：Google Weather --------------------------
/**
 * /weather-google?lat=..&lng=..&hours=9&language=ja&unit=METRIC
 * 返却：Google の生JSON（200/4xx/5xx をそのままパススルー）
 * 実体：v1/forecast:hourly を POST でコール
 */
async function handleWeatherGoogle(request, env) {
  const u = new URL(request.url);
  const key = requireEnv('GOOGLE_WEATHER_API_KEY', env);

  // app.js (GET) からのパラメータを取得
  const lat = u.searchParams.get('lat');
  const lng = u.searchParams.get('lng');
  if (!lat || !lng) return json({ status: 'INVALID_REQUEST', error_message: 'lat & lng required' }, 400);

  const hours    = Number(u.searchParams.get('hours') || 9);
  const language = u.searchParams.get('language') || 'ja';
  const unit     = u.searchParams.get('unit') || 'METRIC'; // (app.js側がMETRICを送る前提)

  // 正しいエンドポイントURL
  const weatherUrl = `https://weather.googleapis.com/v1/forecast:hourly`;

  // Google APIが要求するPOSTボディを作成
  const requestBody = {
    "location": {
      "latitude": Number(lat),
      "longitude": Number(lng)
    },
    "hours": hours,
    "languageCode": language,
    "units": unit
  };

  // Google APIに送るヘッダーを作成
  const forcedRef = (env.FORCED_REFERRER || '').trim();
  const headers = new Headers({
    'X-Goog-Api-Key': key,
    'Content-Type': 'application/json',
    ...(forcedRef ? { 'Referer': forcedRef } : {}),
    'X-Goog-FieldMask': [
      'forecast',
      'forecast.hours',
      'forecast.hours.temperature',
      'forecast.hours.precipitationChance',
      'forecast.hours.precipitationType',
      'forecast.hours.uvIndex',
      'forecast.hours.humidity',
      'forecast.hours.condition',
    ].join(',')
  });

  const r = await fetch(weatherUrl, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(requestBody)
  });

  return new Response(r.body, { status: r.status, headers: passthroughJSON(r.headers) });
}

// -------------------------- 追加：OpenWeatherMap --------------------------
/**
 * /weather-openweather?lat=..&lng=..&units=metric&lang=ja
 * 返却：OpenWeatherMap の生JSON（200/4xx/5xx をそのままパススルー）
 */
async function handleWeatherOpenWeather(u, env) {
  const apiKey = requireEnv('OPENWEATHER_API_KEY', env);
  const lat = u.searchParams.get('lat');
  const lng = u.searchParams.get('lng');
  if (!lat || !lng) return json({ status: 'INVALID_REQUEST', error_message: 'lat & lng required' }, 400);

  const units = u.searchParams.get('units') || 'metric';
  const lang = u.searchParams.get('lang') || 'ja';

  const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lng}&units=${units}&lang=${lang}&appid=${apiKey}`;
  const r = await fetch(url);
  return new Response(r.body, { status: r.status, headers: passthroughJSON(r.headers) });
}

// -------------------------- 追加：インシデント情報 --------------------------
/**
 * /incidents?lat=..&lng=..&radius=10
 * ダミーのインシデント情報を返す（将来的に実際のAPIに置き換え可能）
 */
async function handleIncidents(u, env) {
  const lat = u.searchParams.get('lat');
  const lng = u.searchParams.get('lng');
  const radius = u.searchParams.get('radius') || '10';

  if (!lat || !lng) {
    return json({ status: 'INVALID_REQUEST', error_message: 'lat & lng required' }, 400);
  }

  // ダミーのインシデントデータを生成
  // 実際の運用では、ここで実際のインシデントAPIを呼び出すか、
  // データベースから情報を取得する
  const incidents = generateDummyIncidents(Number(lat), Number(lng), Number(radius));

  return json({
    status: 'OK',
    incidents: incidents,
    timestamp: new Date().toISOString()
  });
}

/**
 * ダミーのインシデントデータを生成
 * @param {number} centerLat - 中心緯度
 * @param {number} centerLng - 中心経度
 * @param {number} radius - 検索半径(km)
 * @returns {Array} インシデント配列
 */
function generateDummyIncidents(centerLat, centerLng, radius) {
  // 現在の時刻に基づいて動的にダミーデータを生成
  const now = new Date();
  const hour = now.getHours();
  
  // ラッシュアワー時は多めのインシデントを生成
  const isRushHour = (hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19);
  const incidentCount = isRushHour ? 3 : 1;
  
  const incidentTypes = [
    { type: 'traffic', title: '交通渋滞', severity: 'medium', icon: '🚗' },
    { type: 'construction', title: '道路工事', severity: 'low', icon: '🚧' },
    { type: 'accident', title: '交通事故', severity: 'high', icon: '⚠️' },
    { type: 'event', title: 'イベント開催', severity: 'info', icon: 'ℹ️' },
    { type: 'weather', title: '悪天候注意', severity: 'medium', icon: '🌧️' }
  ];

  const incidents = [];
  
  for (let i = 0; i < incidentCount; i++) {
    const incidentType = incidentTypes[Math.floor(Math.random() * incidentTypes.length)];
    
    // 中心点から半径内にランダムな位置を生成
    const angle = Math.random() * 2 * Math.PI;
    const distance = Math.random() * radius * 0.8; // 半径の80%以内
    const offsetLat = (distance / 111) * Math.cos(angle); // 1度≒111km
    const offsetLng = (distance / (111 * Math.cos(centerLat * Math.PI / 180))) * Math.sin(angle);
    
    incidents.push({
      id: `incident_${Date.now()}_${i}`,
      type: incidentType.type,
      title: incidentType.title,
      description: `${incidentType.title}が発生しています。通行にご注意ください。`,
      severity: incidentType.severity,
      icon: incidentType.icon,
      location: {
        lat: centerLat + offsetLat,
        lng: centerLng + offsetLng
      },
      distance: distance.toFixed(1) + 'km',
      timestamp: new Date(Date.now() - Math.random() * 3600000).toISOString(), // 過去1時間以内
      estimatedClearTime: isRushHour ? '30分以上' : '15分程度'
    });
  }

  // 距離でソート
  incidents.sort((a, b) => parseFloat(a.distance) - parseFloat(b.distance));
  
  return incidents;
}
