'use strict';

// WalkNav app.js - v15: Forecast (3H/6H/9H) + Rain Prob + Anti-Flash Global Fix

const ISSUE_ID = 'idx20251211_forecast_v15';
const API_KEY = 'AIzaSyBuX-4y1Cgl6jdKcHZWWlsoosDWK_RGqF0';

// ▼▼▼【重要】ここに OpenWeatherMap の APIキーを貼り付けてください ▼▼▼
const OPEN_WEATHER_KEY = 'YOUR_OPENWEATHER_API_KEY'; 
// ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲

const MAP_ID = '9110fb2763169e9d8f2b317e'; 

/* ==========================================================================
   【最優先実行】CSS強制注入 (巨大アイコン防止 & 予報リストのデザイン)
   ========================================================================== */
(function applyImmediateCSS() {
  const styleId = 'wn-forced-layout-css';
  if (document.getElementById(styleId)) return;

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    html, body {
      height: 100%;
      margin: 0;
      padding: 0;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #f5f5f5;
    }
    /* === ★最強の安全装置: すべてのSVGを強制的に24px以下にする★ === */
    svg {
      width: 24px !important;
      height: 24px !important;
      max-width: 24px !important;
      max-height: 24px !important;
      min-width: 24px !important;
    }
    /* 地図上のマーカーだけは制限解除 */
    .wn-user-marker svg, 
    .wn-search-marker svg,
    button.gm-control-active svg,
    .gm-style svg {
      width: auto !important;
      height: auto !important;
      max-width: none !important;
      max-height: none !important;
      min-width: auto !important;
    }
    /* ============================================================= */
    .app {
      position: relative;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: #f5f5f5;
    }
    #map {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      z-index: 0;
    }
    .panel {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      max-height: 55vh;
      height: 55vh;
      background: #ffffff;
      border-radius: 20px 20px 0 0;
      box-shadow: 0 -2px 15px rgba(0,0,0,0.15);
      display: flex;
      flex-direction: column;
      z-index: 1000;
      box-sizing: border-box;
      overflow: hidden;
    }
    .panel.collapsed {
      height: 56px;
    }
    .panel-handle-area {
      padding-top: 6px;
      padding-bottom: 2px;
      display: flex;
      justify-content: center;
    }
    .panel-handle {
      width: 40px;
      height: 4px;
      border-radius: 999px;
      background: #e0e0e0;
    }
    .panel-tabs-header {
      display: flex;
      border-bottom: 1px solid #e5e5e5;
      background: #fafafa;
    }
    .panel-tabs-header .tab-btn {
      flex: 1;
      text-align: center;
      padding: 10px 4px;
      font-size: 14px;
      cursor: pointer;
    }
    .panel-tabs-header .tab-btn.active {
      font-weight: 600;
      border-bottom: 3px solid #25d07a;
      background: #ffffff;
    }
    .panel-tabs-body {
      flex: 1;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      padding: 12px 16px 16px;
      box-sizing: border-box;
    }
    .tab-pane {
      display: none;
    }
    .tab-pane.active {
      display: block;
    }
    .section-title {
      font-size: 16px;
      font-weight: 600;
      margin: 0 0 8px;
    }
    .filter-chips-row {
      display: flex;
      flex-wrap: nowrap;
      gap: 8px;
      overflow-x: auto;
      padding-bottom: 8px;
      margin-bottom: 8px;
    }
    .filter-chips-row::-webkit-scrollbar {
      display: none;
    }
    .chip {
      flex: 0 0 auto;
      border-radius: 16px;
      border: 1px solid #ccc;
      padding: 6px 12px;
      font-size: 12px;
      background: #fff;
      cursor: pointer;
    }
    .chip.small {
      font-size: 11px;
      padding: 4px 10px;
    }
    .chip.active {
      background: #25d07a;
      color: #fff;
      border-color: #25d07a;
    }
    .search-box-container {
      margin-top: 4px;
      margin-bottom: 8px;
    }
    .input-wrapper {
      display: flex;
      align-items: center;
      border-radius: 999px;
      border: 1px solid #ccc;
      padding: 2px 8px;
      background: #fff;
    }
    .input-wrapper .input {
      border: none;
      flex: 1;
      font-size: 14px;
      padding: 8px 6px;
      outline: none;
      background: transparent;
    }
    .icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .icon-g {
      display: none !important;
      width: 0 !important;
      margin-right: 0 !important;
    }
    .results-list {
      margin-top: 4px;
      border-radius: 8px;
      border: 1px solid #eee;
      overflow: hidden;
      background: #fff;
    }
    .result-item {
      padding: 8px 10px;
      border-bottom: 1px solid #eee;
      font-size: 13px;
      cursor: pointer;
    }
    .result-item:last-child {
      border-bottom: none;
    }
    .result-item:active {
      background: #f0f0f0;
    }
    .address-card {
      margin-top: 4px;
      margin-bottom: 8px;
      padding: 8px 10px;
      border-radius: 8px;
      background: #f1f5f9;
      font-size: 12px;
    }
    /* === 天気表示用 === */
    .weather-card {
      margin-top: 4px;
      margin-bottom: 8px;
      padding: 8px 10px;
      border-radius: 8px;
      background: #e0f2fe;
      color: #0369a1;
      font-size: 13px;
    }
    .weather-current-row {
      display: flex;
      align-items: center;
      gap: 6px;
      font-weight: 600;
      margin-bottom: 8px;
      font-size: 14px;
    }
    .weather-forecast-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .weather-forecast-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: #ffffff;
      padding: 4px 8px;
      border-radius: 6px;
      font-size: 12px;
      color: #333;
    }
    /* アイコン画像はSVGではないので制限解除 */
    .weather-icon-img {
      width: 32px;
      height: 32px;
      vertical-align: middle;
    }
    /* ========================== */
    .address-title {
      font-weight: 600;
      margin-bottom: 2px;
    }
    .address-coords {
      color: #6b7280;
    }
    .action-buttons-row,
    .bottom-actions-row {
      display: flex;
      gap: 8px;
      margin-top: 8px;
    }
    .btn {
      flex: 1;
      border-radius: 999px;
      border: 1px solid #ccc;
      padding: 8px 10px;
      font-size: 13px;
      background: #fff;
      cursor: pointer;
    }
    .btn-primary {
      border-color: #25d07a;
      background: #25d07a;
      color: #fff;
    }
    .btn-secondary {
      background: #e5e7eb;
      border-color: #d1d5db;
    }
    .btn-danger {
      border-color: #f97373;
      background: #fee2e2;
      color: #b91c1c;
    }
    .btn-danger-block {
      width: 100%;
      border-color: #f97373;
      background: #fee2e2;
      color: #b91c1c;
    }
    .fab-container {
      position: absolute;
      right: 12px;
      bottom: 58vh;
      display: flex;
      flex-direction: column;
      gap: 8px;
      z-index: 900;
      pointer-events: none;
    }
    .fab-container .fab-btn {
      pointer-events: auto;
      min-width: 48px;
      height: 40px;
      border-radius: 999px;
      border: none;
      padding: 0 12px;
      font-size: 12px;
      background: #ffffff;
      box-shadow: 0 4px 8px rgba(0,0,0,0.2);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .fab-container .fab-btn.destination {
      background: #25d07a;
      color: #fff;
    }
    .fab-container .fab-btn.voice-btn {
      background: #333;
      color: #fff;
      font-size: 16px;
    }
    .loading-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(255,255,255,0.9);
      z-index: 1100;
    }
    .loading-content {
      text-align: center;
      font-size: 14px;
    }
    .nav-section {
      margin-bottom: 12px;
    }
    .nav-section-title {
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 4px;
    }
    .incident-alert {
      border-radius: 8px;
      border: 1px solid #facc15;
      background: #fef9c3;
      color: #713f12;
      padding: 8px 10px;
      font-size: 12px;
    }
    .wn-user-marker {
      width: 24px;
      height: 24px;
      border-radius: 999px;
      background: #3aa0ff;
      border: 2px solid #ffffff;
      box-shadow: 0 0 4px rgba(0,0,0,0.4);
      position: relative;
      transform-origin: 50% 50%;
    }
    .wn-user-marker::after {
      content: '';
      position: absolute;
      left: 50%;
      top: 50%;
      width: 2px;
      height: 8px;
      background: #ffffff;
      border-radius: 999px;
      transform: translate(-50%, -90%);
    }
    .wn-search-marker {
      width: 24px;
      height: 24px;
      border-radius: 999px;
      background: #ffffff;
      border: 2px solid #25d07a;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 600;
      color: #111;
      box-shadow: 0 1px 4px rgba(0,0,0,0.3);
    }
    .wn-point-marker {
      width: 18px;
      height: 18px;
      border-radius: 999px;
      background: #ff6565;
      border: 2px solid #ffffff;
      box-shadow: 0 1px 3px rgba(0,0,0,0.3);
    }
  `;
  if (document.head.firstChild) {
    document.head.insertBefore(style, document.head.firstChild);
  } else {
    document.head.appendChild(style);
  }
})();

const WORKER_ORIGIN = 'https://ors-proxy.miyata-connect-jp.workers.dev';
const DEFAULT_MASK = 'places.displayName,places.formattedAddress,places.location,places.id,places.types';
const MAX_RETRY = 3;
const RETRY_DELAY = 1000;

const LOCATION_OPTIONS = {
  enableHighAccuracy: true,
  timeout: 15000,
  maximumAge: 0
};

const SAVED_LOCATIONS_KEY = 'walknav_saved_locations';
const MAP_MODE_KEY = 'walknav_map_mode';
const PROFILE_KEY = 'walknav_user_profile';

/* =========================
   Global State & Helpers
   ========================= */
const WN = (window.__WN_GLOBAL__ = window.__WN_GLOBAL__ || {
  booted: false,
  locks: Object.create(null),
  alerts: Object.create(null),
  styles: Object.create(null)
});

function lock(key, ms) {
  const now = Date.now();
  const until = WN.locks[key] || 0;
  if (now < until) return false;
  WN.locks[key] = now + ms;
  return true;
}

function alertOnce(key, msg, ms = 1200) {
  const now = Date.now();
  const last = WN.alerts[key] || 0;
  if (now - last < ms) return;
  WN.alerts[key] = now;
  alert(msg);
}

/* =========================
   メインロジック
   ========================= */

if (WN.booted) {
  console.warn('[WalkNav] duplicate app.js blocked:', ISSUE_ID);
} else {
  WN.booted = true;

  const appState = {
    map: null,
    userMarker: null,
    userMarkerElement: null,
    currentPos: null,
    pointSearchMode: false,
    searchPoint: null,
    searchPointMarker: null,
    mapInitialized: false,
    searchMarkers: [],
    currentDestination: null,
    currentPolyline: null,
    isNavigating: false,
    locationWatchId: null,
    compassWatchId: null,
    currentHeading: 0,
    isSimulation: false,
    currentRouteData: null,
    userProfile: { luggage: 'None', condition: 'Normal', companion: 'None' },
    savedLocations: [],
    editingLocationIndex: null,
    isEditDialogOpen: false,
    mapMode: 'roadmap',
    searchInFlight: false,
    searchRadiusMeters: 10000,
    aiMode: 'normal',
    incidentData: null
  };

  function getEl(id) {
    return document.getElementById(id);
  }
  function setDisplay(id, displayVal) {
    const el = getEl(id);
    if (el) el.style.display = displayVal;
  }
  function setText(id, text) {
    const el = getEl(id);
    if (el) el.textContent = text;
  }

  function loadUserProfile() {
    try {
      const raw = localStorage.getItem(PROFILE_KEY);
      if (!raw) return;
      const p = JSON.parse(raw);
      if (!p) return;
      appState.userProfile = {
        luggage: p.luggage || 'None',
        condition: p.condition || 'Normal',
        companion: p.companion || 'None'
      };
    } catch (_) {}
  }

  function persistUserProfile() {
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(appState.userProfile));
    } catch (_) {}
  }

  /* =========================
     API & Search 共通
     ========================= */
  async function fetchWithRetry(url, options = {}, retries = MAX_RETRY) {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await fetch(url, options);
        if (!response.ok && i < retries - 1) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY * (i + 1)));
          continue;
        }
        return response;
      } catch (error) {
        if (i === retries - 1) throw error;
        await new Promise((r) => setTimeout(r, RETRY_DELAY * (i + 1)));
      }
    }
  }

  /* === 音声案内 & 天気 (降水確率・予報 3H単位) === */

  async function fetchAddressNominatim(lat, lng) {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`;
    try {
      const resp = await fetch(url);
      if (!resp.ok) return '住所不明';
      const data = await resp.json();
      return data.display_name || '現在地';
    } catch (e) {
      console.warn('Nominatim error', e);
      return '現在地';
    }
  }

  // 現在の天気取得
  async function fetchCurrentWeather(lat, lng) {
    if (!OPEN_WEATHER_KEY || OPEN_WEATHER_KEY.includes('YOUR_')) return null;
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&appid=${OPEN_WEATHER_KEY}&lang=ja&units=metric`;
    try {
      const resp = await fetch(url);
      if (!resp.ok) return null;
      return await resp.json();
    } catch (e) { return null; }
  }

  // 3時間ごとの予報取得
  async function fetchForecast(lat, lng) {
    if (!OPEN_WEATHER_KEY || OPEN_WEATHER_KEY.includes('YOUR_')) return null;
    const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lng}&appid=${OPEN_WEATHER_KEY}&lang=ja&units=metric`;
    try {
      const resp = await fetch(url);
      if (!resp.ok) return null;
      return await resp.json();
    } catch (e) { return null; }
  }

  // 画面更新 & 音声用データ生成
  async function updateWeatherUI(lat, lng) {
    const [current, forecast] = await Promise.all([
      fetchCurrentWeather(lat, lng),
      fetchForecast(lat, lng)
    ]);

    let weatherEl = getEl('weatherDisplay');
    if (!weatherEl) {
      const addressCard = document.querySelector('.address-card');
      if (addressCard && addressCard.parentNode) {
        weatherEl = document.createElement('div');
        weatherEl.id = 'weatherDisplay';
        weatherEl.className = 'weather-card';
        addressCard.parentNode.insertBefore(weatherEl, addressCard.nextSibling);
      } else {
        return { desc: '情報なし', temp: null };
      }
    }

    if (!current) {
      weatherEl.textContent = '☁️ 天気情報なし (APIキーを確認)';
      return { desc: '取得不可', temp: null };
    }

    // 現在の降水確率は forecast.list[0] (直近) から取得して近似
    let pop = 0;
    if (forecast && forecast.list && forecast.list.length > 0) {
      pop = Math.round(forecast.list[0].pop * 100);
    }

    const curIconUrl = `https://openweathermap.org/img/wn/${current.weather[0].icon}.png`;
    const curDesc = current.weather[0].description;
    const curTemp = Math.round(current.main.temp);

    // HTML構築: 現在 + 3H/6H/9H
    let html = `
      <div class="weather-current-row">
        <img src="${curIconUrl}" class="weather-icon-img" alt="${curDesc}">
        <span>${curDesc}</span>
        <span style="margin-left:auto;">${curTemp}℃</span>
        <span style="color:#3b82f6; margin-left:8px;">☂️ ${pop}%</span>
      </div>
    `;

    // 予報リスト
    if (forecast && forecast.list) {
      html += `<div class="weather-forecast-list">`;
      // 直近3つを表示 (approx 3h, 6h, 9h later)
      for (let i = 1; i <= 3; i++) {
        const item = forecast.list[i]; 
        if (item) {
          const timeLabel = `${i * 3}H後`; // 簡易表記
          const fIcon = `https://openweathermap.org/img/wn/${item.weather[0].icon}.png`;
          const fTemp = Math.round(item.main.temp);
          const fPop = Math.round(item.pop * 100);
          html += `
            <div class="weather-forecast-item">
              <span style="width:40px; font-weight:bold;">${timeLabel}</span>
              <img src="${fIcon}" style="width:24px; height:24px;">
              <span>${fTemp}℃</span>
              <span style="color:#3b82f6;">☂️ ${fPop}%</span>
            </div>
          `;
        }
      }
      html += `</div>`;
    }

    weatherEl.innerHTML = html;
    weatherEl.style.display = 'block';

    return { desc: curDesc, temp: curTemp, pop: pop };
  }

  function speakText(text) {
    if (!window.speechSynthesis) {
      alert('お使いのブラウザは音声読み上げに対応していません。');
      return;
    }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ja-JP';
    u.rate = 1.0; 
    u.pitch = 1.0; 
    u.volume = 1.0;
    window.speechSynthesis.speak(u);
  }

  async function handleVoiceAnnounce() {
    if (!appState.currentPos) {
      alertOnce('voice_no_pos', '現在地が取得できていません');
      return;
    }
    const { lat, lng } = appState.currentPos;
    if (navigator.vibrate) navigator.vibrate(50);
    
    const [addressName, wData] = await Promise.all([
      fetchAddressNominatim(lat, lng),
      updateWeatherUI(lat, lng)
    ]);

    // 住所の短縮
    let simpleAddr = addressName.split(' ').pop() || addressName;
    simpleAddr = simpleAddr.replace(/^日本、\s*/, '').replace(/、.*$/, '');

    let msg = `現在地は、${simpleAddr}です。`;
    if (wData.temp !== null) {
      msg += `天気は${wData.desc}、気温は${wData.temp}度、降水確率は${wData.pop}パーセントです。`;
      
      if (wData.pop >= 50) msg += '傘を持ったほうが良いでしょう。';
      else if (wData.temp > 30) msg += '熱中症にご注意ください。';
      else if (wData.temp < 10) msg += '暖かくしてお過ごしください。';
      else msg += '快適な気候です。';
    }

    console.log('[WalkNav] Speaking:', msg);
    speakText(msg);
  }

  /* =========================================== */

  async function placesTextSearch(query, centerLat, centerLng) {
    const payload = {
      textQuery: query,
      locationBias: {
        circle: { center: { latitude: centerLat, longitude: centerLng }, radius: appState.searchRadiusMeters }
      },
      languageCode: 'ja'
    };
    try {
      const resp = await fetchWithRetry(`${WORKER_ORIGIN}/places:searchText`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-FieldMask': DEFAULT_MASK },
        body: JSON.stringify(payload)
      });
      if (!resp.ok) throw new Error(`WORKER ${resp.status}`);
      return await resp.json();
    } catch (e) {
      console.warn('Fallback to Direct:', e);
      const resp = await fetchWithRetry(`https://places.googleapis.com/v1/places:searchText`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': API_KEY,
          'X-Goog-FieldMask': DEFAULT_MASK
        },
        body: JSON.stringify(payload)
      });
      if (!resp.ok) throw new Error(`DIRECT ${resp.status}`);
      return await resp.json();
    }
  }

  async function geocode(lat, lng) {
    try {
      const resp = await fetchWithRetry(`${WORKER_ORIGIN}/geocode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latlng: { lat, lng }, language: 'ja' })
      });
      if (!resp.ok) throw new Error(`WORKER ${resp.status}`);
      return await resp.json();
    } catch (e) {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&language=ja&key=${API_KEY}`;
      const resp = await fetchWithRetry(url);
      if (!resp.ok) throw new Error(`DIRECT ${resp.status}`);
      return await resp.json();
    }
  }

  /* =========================
     インシデント表示
     ========================= */
  function renderIncidentSection(data, isError) {
    const section = getEl('incidentSection');
    const box = getEl('incidentText');
    if (!section || !box) return;

    if (isError) {
      section.style.display = 'block';
      box.textContent = 'インシデント情報の取得に失敗しました。';
      return;
    }

    if (!data) {
      section.style.display = 'none';
      return;
    }

    const traffic = data.traffic || [];
    const events = data.events || data.incidents || [];
    const weather = data.weather || [];

    const parts = [];

    if (traffic.length) {
      const t = traffic
        .map((x) => x.title || x.summary || x.description || '交通遅延')
        .join(' / ');
      parts.push(`【交通】${t}`);
    }
    if (events.length) {
      const e = events
        .map((x) => x.title || x.summary || x.description || '事件・事故')
        .join(' / ');
      parts.push(`【事件・事故】${e}`);
    }
    if (weather.length) {
      const w = weather
        .map((x) => x.title || x.summary || x.description || '気象注意報')
        .join(' / ');
      parts.push(`【気象】${w}`);
    }

    if (parts.length === 0) {
      section.style.display = 'block';
      box.textContent = '半径10km以内に特筆すべきインシデントはありません。';
    } else {
      section.style.display = 'block';
      box.textContent = parts.join(' ｜ ');
    }
  }

  async function fetchIncidentsAround(lat, lng) {
    const payload = { lat, lng, radiusKm: 10 };
    try {
      const resp = await fetchWithRetry(`${WORKER_ORIGIN}/incidents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!resp.ok) throw new Error(`INCIDENTS ${resp.status}`);
      const json = await resp.json();
      appState.incidentData = json;
      renderIncidentSection(json, false);
    } catch (e) {
      console.warn('[WalkNav] incidents fetch error:', e);
      renderIncidentSection(null, true);
    }
  }

  /* =========================
     Map & Location Logic
     ========================= */

  function initMap(center) {
    if (appState.map) {
      appState.map.setCenter(center);
      return;
    }
    const mapEl = getEl('map');
    if (!mapEl) return;

    try {
      appState.map = new google.maps.Map(mapEl, {
        center,
        zoom: 17,
        mapId: MAP_ID, 
        gestureHandling: 'greedy',
        clickableIcons: true,
        disableDefaultUI: true
      });

      appState.map.addListener('click', (e) => {
        if (appState.pointSearchMode && e.latLng) {
          setSearchPoint(e.latLng.lat(), e.latLng.lng());
        }
      });

      changeMapMode(appState.mapMode);
      appState.mapInitialized = true;
      console.log('[WalkNav] Map initialized with AdvancedMarker (Map ID)');
    } catch (e) {
      console.error('[WalkNav] Map failed:', e);
      alertOnce('map_fail', '地図の初期化に失敗しました');
    }
  }

  function setUserMarker(lat, lng) {
    appState.currentPos = { lat, lng };
    if (!appState.map) return;
    if (!google.maps.marker || !google.maps.marker.AdvancedMarkerElement) {
      console.error('AdvancedMarkerElement not available');
      return;
    }

    if (!appState.userMarkerElement) {
      const el = document.createElement('div');
      el.className = 'wn-user-marker';
      appState.userMarkerElement = el;
    }

    if (!appState.userMarker) {
      appState.userMarker = new google.maps.marker.AdvancedMarkerElement({
        map: appState.map,
        position: { lat, lng },
        content: appState.userMarkerElement,
        zIndex: 1000
      });
    } else {
      appState.userMarker.position = { lat, lng };
    }

    appState.userMarkerElement.style.transform = `rotate(${appState.currentHeading}deg)`;
  }

  function setSearchPoint(lat, lng) {
    appState.searchPoint = { lat, lng };
    if (!appState.map) return;
    if (!google.maps.marker || !google.maps.marker.AdvancedMarkerElement) {
      console.error('AdvancedMarkerElement not available');
      return;
    }

    if (appState.searchPointMarker) {
      try {
        appState.searchPointMarker.map = null;
      } catch (_) {}
      appState.searchPointMarker = null;
    }

    const el = document.createElement('div');
    el.className = 'wn-point-marker';

    appState.searchPointMarker = new google.maps.marker.AdvancedMarkerElement({
      map: appState.map,
      position: { lat, lng },
      content: el,
      zIndex: 999
    });

    setText('pointAddress', '取得中…');
    setDisplay('pointAddressBlock', 'flex');
    setText('pointCoords', `Lat: ${lat.toFixed(5)}`);
    geocode(lat, lng)
      .then((data) => {
        if (data.results?.[0])
          setText('pointAddress', data.results[0].formatted_address.replace(/^日本、\s*/, ''));
        else setText('pointAddress', '不明な場所');
      })
      .catch(() => setText('pointAddress', '取得エラー'));

    fetchIncidentsAround(lat, lng);
  }

  function acquireLocation() {
    const onSuccess = (pos) => {
      const { latitude, longitude } = pos.coords;
      const loading = getEl('loading');
      if (loading) loading.remove();
      if (!appState.mapInitialized) initMap({ lat: latitude, lng: longitude });
      else appState.map.setCenter({ lat: latitude, lng: longitude });

      setUserMarker(latitude, longitude);

      setText('locCoords', `Lat: ${latitude.toFixed(5)}`);
      geocode(latitude, longitude).then((data) => {
        if (data.results?.[0])
          setText('locAddress', data.results[0].formatted_address.replace(/^日本、\s*/, ''));
      });
      
      // ★天気UI更新
      updateWeatherUI(latitude, longitude);

      fetchIncidentsAround(latitude, longitude);
    };

    const onError = (error) => {
      console.warn('[WalkNav] Geolocation error:', error);
      const loading = getEl('loading');
      if (loading) loading.remove();

      const defaultPos = { lat: 35.0, lng: 135.0 };
      if (!appState.mapInitialized) initMap(defaultPos);
      else appState.map.setCenter(defaultPos);

      setUserMarker(defaultPos.lat, defaultPos.lng);

      setText('locAddress', '現在地取得に失敗しました (デフォルト位置)');
      setText('locCoords', 'GPSエラー');
      
      updateWeatherUI(defaultPos.lat, defaultPos.lng);

      fetchIncidentsAround(defaultPos.lat, defaultPos.lng);
    };

    if (!navigator.geolocation) {
      onError('Not supported');
      return;
    }
    navigator.geolocation.getCurrentPosition(onSuccess, onError, LOCATION_OPTIONS);
  }

  function startCompassListener() {
    if (!window.DeviceOrientationEvent) return;
    const handler = (e) => {
      if (appState.isNavigating) return;
      const h = e.webkitCompassHeading || (e.absolute ? e.alpha : null);
      if (h != null) {
        appState.currentHeading = h;
        if (appState.userMarkerElement) {
          appState.userMarkerElement.style.transform = `rotate(${h}deg)`;
        }
      }
    };
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission().then((s) => {
        if (s === 'granted') window.addEventListener('deviceorientation', handler, true);
      });
    } else {
      window.addEventListener('deviceorientationabsolute', handler, true);
      window.addEventListener('deviceorientation', handler, true);
    }
  }

  function startLocationWatcher() {
    if (appState.locationWatchId) navigator.geolocation.clearWatch(appState.locationWatchId);
    appState.locationWatchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setUserMarker(latitude, longitude);
        if (appState.isNavigating && appState.map) {
          appState.map.panTo({ lat: latitude, lng: longitude });
        }
      },
      () => {},
      LOCATION_OPTIONS
    );
  }

  function stopLocationWatcher() {
    if (appState.locationWatchId) {
      navigator.geolocation.clearWatch(appState.locationWatchId);
      appState.locationWatchId = null;
    }
  }

  /* =========================
     Route rendering helpers
     ========================= */
  function renderRoute(route, destinationName) {
    if (!route) return;
    const leg = route.legs && route.legs[0];
    if (!leg) return;

    setText('destinationName', destinationName || '目的地');
    setText('routeDistance', leg.distance?.text || '');
    setText('routeTime', `徒歩 ${leg.duration?.text || ''}`);

    const list = getEl('navPanelInstructions');
    if (list) {
      list.innerHTML = '';
      (leg.steps || []).forEach((s) => {
        const d = document.createElement('div');
        d.className = 'nav-instruction-item';
        d.style.padding = '8px 0';
        d.style.borderBottom = '1px solid #eee';
        d.textContent =
          s.html_instructions.replace(/<[^>]+>/g, '') +
          (s.distance?.text ? ` (${s.distance.text})` : '');
        list.appendChild(d);
      });
    }
    setDisplay('instructionsSection', 'block');

    if (appState.currentPolyline) appState.currentPolyline.setMap(null);
    if (
      google.maps.geometry &&
      google.maps.geometry.encoding &&
      route.overview_polyline &&
      route.overview_polyline.points
    ) {
      const path = google.maps.geometry.encoding.decodePath(route.overview_polyline.points);
      appState.currentPolyline = new google.maps.Polyline({
        path,
        map: appState.map,
        strokeColor: '#62b5ff',
        strokeWeight: 6
      });
    }

    if (appState.currentPos && appState.map && leg.end_location) {
      const b = new google.maps.LatLngBounds();
      b.extend(appState.currentPos);
      b.extend(leg.end_location);
      appState.map.fitBounds(b, { padding: 50 });
    }

    // ルート情報セクションを必ず表示
    setDisplay('routeInfoSection', 'block');
  }

  function applyCurrentRouteSelection() {
    const data = appState.currentRouteData;
    if (!data || !data.routes || data.routes.length === 0) return;

    let chosen = { route: data.routes[0], index: 0, reason: '' };

    if (window.RouteEvaluator && typeof window.RouteEvaluator.pickBestRoute === 'function') {
      chosen = window.RouteEvaluator.pickBestRoute(
        data.routes,
        appState.userProfile,
        appState.aiMode
      );
    }

    appState.currentRouteData.selectedIndex = chosen.index;
    appState.currentRouteData.reason = chosen.reason;

    console.log(
      '[WalkNav] Route selection mode=',
      appState.aiMode,
      'index=',
      chosen.index,
      'reason=',
      chosen.reason
    );

    renderRoute(
      chosen.route,
      appState.currentDestination ? appState.currentDestination.name : '目的地'
    );
  }

  /* =========================
     Search & Nav Flow
     ========================= */
  async function performSearch(query) {
    if (!query || !lock('search', 1000)) return;

    const center =
      appState.pointSearchMode && appState.searchPoint
        ? appState.searchPoint
        : appState.currentPos;

    if (!center) {
      alertOnce('no_pos', '検索中心（現在地）が特定できません');
      return;
    }

    try {
      const data = await placesTextSearch(query, center.lat, center.lng);
      const places = (data && data.places) || [];
      displayResults(places);
      if (places.length === 0) alertOnce('no_res', '見つかりませんでした');
    } catch (e) {
      console.error(e);
      alertOnce('search_err', '検索エラーが発生しました');
    }
  }

  function displayResults(places) {
    const div = getEl('results');
    if (!div) return;
    div.innerHTML = '';
    setDisplay('results', 'block');
    setDisplay('instructionsSection', 'none');

    appState.searchMarkers.forEach((m) => {
      try {
        m.map = null;
      } catch (_) {}
    });
    appState.searchMarkers = [];

    if (!google.maps.marker || !google.maps.marker.AdvancedMarkerElement) {
      console.error('AdvancedMarkerElement not available');
    }

    places.slice(0, 5).forEach((p, i) => {
      const lat = p.location.latitude;
      const lng = p.location.longitude;
      const name = p.displayName?.text || '名称不明';

      const item = document.createElement('div');
      item.className = 'result-item';
      item.innerHTML = `<div>${i + 1}. ${name}</div><div style="font-size:0.8em;opacity:0.7">${p.formattedAddress}</div>`;
      item.onclick = () => startNavigation({ name, lat, lng });
      div.appendChild(item);

      if (google.maps.marker && google.maps.marker.AdvancedMarkerElement && appState.map) {
        const markerEl = document.createElement('div');
        markerEl.className = 'wn-search-marker';
        markerEl.textContent = String(i + 1);

        const m = new google.maps.marker.AdvancedMarkerElement({
          map: appState.map,
          position: { lat, lng },
          content: markerEl,
          title: name
        });
        appState.searchMarkers.push(m);
      }
    });
  }

  async function startNavigation(dest) {
    if (!appState.currentPos) return;
    appState.currentDestination = dest;
    appState.isNavigating = true;

    // 検索結果タップ時: パネルを自動で閉じて、FAB を出す
    const panel = getEl('searchPanel');
    if (panel) panel.classList.add('collapsed');
    setDisplay('fabStack', 'flex');

    setDisplay('searchPanel', 'block');
    switchPanelTab('nav');
    setDisplay('routeControlSection', 'block');
    setDisplay('results', 'none');

    try {
      const origin = `${appState.currentPos.lat},${appState.currentPos.lng}`;
      const destination = `${dest.lat},${dest.lng}`;
      const resp = await fetchWithRetry(`${WORKER_ORIGIN}/directions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin, destination, mode: 'walking', language: 'ja' })
      });
      const json = await resp.json();
      const routes = json.routes || [];
      if (!routes[0]) throw new Error('No route');

      appState.currentRouteData = {
        routes,
        selectedIndex: 0,
        reason: ''
      };

      applyCurrentRouteSelection();
      startLocationWatcher();

      fetchIncidentsAround(dest.lat, dest.lng);
    } catch (e) {
      console.error(e);
      alertOnce('route_err', 'ルートが見つかりませんでした');
      stopNavigation();
    }
  }

  function stopNavigation() {
    stopLocationWatcher();
    appState.isNavigating = false;
    if (appState.currentPolyline) appState.currentPolyline.setMap(null);
    setDisplay('routeControlSection', 'none');
    setDisplay('instructionsSection', 'none');
    setDisplay('routeInfoSection', 'none');
    setDisplay('btnDestination', 'none');
    setDisplay('fabStack', 'none');
    setDisplay('btnSearch', 'flex');
    switchPanelTab('search');
    if (appState.currentPos && appState.map) {
      appState.map.panTo(appState.currentPos);
      appState.map.setZoom(17);
    }
  }

  /* =========================
     UI Binding & Init
     ========================= */
  function switchPanelTab(mode) {
    const isNav = mode === 'nav';
    const isSettings = mode === 'settings';
    const s = getEl('tabPaneSearch');
    const n = getEl('tabPaneNav');
    const st = getEl('tabPaneSettings');
    if (s) s.classList.toggle('active', !isNav && !isSettings);
    if (n) n.classList.toggle('active', isNav);
    if (st) st.classList.toggle('active', isSettings);

    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.classList.toggle(
        'active',
        btn.dataset.panelTab === (isSettings ? 'settings' : isNav ? 'nav' : 'search')
      );
    });
  }

  function changeMapMode(mode) {
    if (!appState.map) return;
    localStorage.setItem(MAP_MODE_KEY, mode);
    appState.mapMode = mode;
    const type =
      mode === 'photo'
        ? google.maps.MapTypeId.SATELLITE
        : mode === '3d'
        ? google.maps.MapTypeId.HYBRID
        : google.maps.MapTypeId.ROADMAP;
    appState.map.setMapTypeId(type);
    appState.map.setTilt(mode === '3d' ? 45 : 0);
    ['btnMapPhoto', 'btnMapRoadmap', 'btnMap3D'].forEach((id) => {
      const el = getEl(id);
      if (el) el.classList.toggle('active', el.dataset.mode === mode);
    });
  }

  function bindUI() {
    const q = getEl('q');
    const btnSearchIcon = getEl('btnSearchIcon');
    if (btnSearchIcon) btnSearchIcon.onclick = () => performSearch(q ? q.value : '');
    if (q)
      q.onkeypress = (e) => {
        if (e.key === 'Enter') performSearch(q.value);
      };

    const btnReset = getEl('btnReset');
    if (btnReset) {
      btnReset.onclick = () => {
        if (q) q.value = '';
        setDisplay('results', 'none');
        appState.pointSearchMode = false;
        const btnPInner = getEl('btnPointSearch');
        if (btnPInner) {
          btnPInner.textContent = '📍 ポイント選択';
          btnPInner.style.background = '';
          btnPInner.style.color = '';
        }
      };
    }

    const btnLocate = getEl('btnLocate');
    if (btnLocate) btnLocate.onclick = () => acquireLocation();
    const btnLocatePanel = getEl('btnLocatePanel');
    if (btnLocatePanel) btnLocatePanel.onclick = () => acquireLocation();

    const btnClosePanel = getEl('btnClosePanel');
    if (btnClosePanel) {
      btnClosePanel.onclick = () => {
        const panel = getEl('searchPanel');
        if (panel) panel.classList.add('collapsed');
      };
    }

    const btnSearch = getEl('btnSearch');
    if (btnSearch) {
      btnSearch.onclick = () => {
        const panel = getEl('searchPanel');
        if (panel) panel.classList.remove('collapsed');
      };
    }

    const btnStopRoute = getEl('btnStopRoute');
    if (btnStopRoute) btnStopRoute.onclick = () => stopNavigation();

    const chips = [getEl('r10'), getEl('r20'), getEl('r30')];
    chips.forEach((el, idx) => {
      if (!el) return;
      el.onclick = () => {
        chips.forEach((c) => c && c.classList.remove('active'));
        el.classList.add('active');
        appState.searchRadiusMeters = (idx + 1) * 10000;
        setText('radiusLabel', `${(idx + 1) * 10}km`);
      };
    });

    const btnP = getEl('btnPointSearch');
    if (btnP) {
      btnP.onclick = () => {
        appState.pointSearchMode = !appState.pointSearchMode;
        btnP.textContent = appState.pointSearchMode ? '📍 選択中...' : '📍 ポイント選択';
        btnP.style.background = appState.pointSearchMode ? '#25d07a' : '';
        btnP.style.color = appState.pointSearchMode ? '#fff' : '';
      };
    }

    const btnMapPhoto = getEl('btnMapPhoto');
    if (btnMapPhoto) btnMapPhoto.onclick = () => changeMapMode('photo');
    const btnMapRoadmap = getEl('btnMapRoadmap');
    if (btnMapRoadmap) btnMapRoadmap.onclick = () => changeMapMode('roadmap');
    const btnMap3D = getEl('btnMap3D');
    if (btnMap3D) btnMap3D.onclick = () => changeMapMode('3d');

    const selLuggage = getEl('userLuggage');
    const selCondition = getEl('userCondition');
    const selCompanion = getEl('userCompanion');

    if (selLuggage) {
      selLuggage.value = appState.userProfile.luggage;
      selLuggage.onchange = () => {
        appState.userProfile.luggage = selLuggage.value;
        persistUserProfile();
        if (appState.currentRouteData) applyCurrentRouteSelection();
      };
    }
    if (selCondition) {
      selCondition.value = appState.userProfile.condition;
      selCondition.onchange = () => {
        appState.userProfile.condition = selCondition.value;
        persistUserProfile();
        if (appState.currentRouteData) applyCurrentRouteSelection();
      };
    }
    if (selCompanion) {
      selCompanion.value = appState.userProfile.companion;
      selCompanion.onchange = () => {
        appState.userProfile.companion = selCompanion.value;
        persistUserProfile();
        if (appState.currentRouteData) applyCurrentRouteSelection();
      };
    }

    const btnRouteNormal = getEl('btnRouteNormal');
    const btnRouteAiShortest = getEl('btnRouteAiShortest');
    if (btnRouteNormal && btnRouteAiShortest) {
      btnRouteNormal.onclick = () => {
        appState.aiMode = 'normal';
        btnRouteNormal.classList.add('active');
        btnRouteAiShortest.classList.remove('active');
        if (appState.currentRouteData) applyCurrentRouteSelection();
      };
      btnRouteAiShortest.onclick = () => {
        appState.aiMode = 'ai';
        btnRouteAiShortest.classList.add('active');
        btnRouteNormal.classList.remove('active');
        if (appState.currentRouteData) applyCurrentRouteSelection();
      };
    }
    
    // === 音声案内ボタン ===
    const fabContainer = document.querySelector('.fab-container');
    if (fabContainer && !getEl('btnVoiceAnnounce')) {
      const btnVoice = document.createElement('button');
      btnVoice.id = 'btnVoiceAnnounce';
      btnVoice.className = 'fab-btn voice-btn';
      btnVoice.innerHTML = '🎤';
      btnVoice.onclick = handleVoiceAnnounce;
      fabContainer.appendChild(btnVoice);
    }
  }

  function startApp() {
    console.log(
      '[WalkNav] Starting Logic + ForcedCSS (Forecast v15) + AI + Incidents + AdvancedMarker + Voice...'
    );
    loadUserProfile();
    bindUI();
    appState.mapMode = localStorage.getItem(MAP_MODE_KEY) || 'roadmap';
    switchPanelTab('search');
    acquireLocation();
    startCompassListener();
  }

  function initializeWhenReady() {
    if (typeof google !== 'undefined' && google.maps && google.maps.Map) {
      startApp();
    } else {
      setTimeout(initializeWhenReady, 100);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeWhenReady);
  } else {
    initializeWhenReady();
  }
}
