'use strict';

// WalkNav app.js - v23: Fix Map Init Timing + Strict Proxy + Anti-Flash

const ISSUE_ID = 'idx20251211_v23_fix_map_timing';

// Google Maps APIキー (地図表示用: クライアント側に必須)
const API_KEY = 'AIzaSyBuX-4y1Cgl6jdKcHZWWlsoosDWK_RGqF0';

// Cloudflare Workerのエンドポイント (天気・検索・ルートは全てここを経由)
const WORKER_ORIGIN = 'https://ors-proxy.miyata-connect-jp.workers.dev';
const MAP_ID = '9110fb2763169e9d8f2b317e'; 

/* ==========================================================================
   【最優先実行】CSS強制注入 (巨大アイコン防止 & デザイン定義)
   ========================================================================== */
(function applyImmediateCSS() {
  const styleId = 'wn-forced-layout-css';
  if (document.getElementById(styleId)) return;

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    html, body {
      height: 100%; margin: 0; padding: 0; overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #f5f5f5;
    }

    /* === ★SVG巨大化防止: 初期ロード時は強制サイズ固定★ === */
    /* Google Maps以外のSVGすべてに適用 */
    svg:not(.gm-style svg) {
      width: 24px !important;
      height: 24px !important;
      max-width: 24px !important;
      max-height: 24px !important;
      min-width: 24px !important;
      display: inline-block;
    }
    
    .weather-icon-img {
      width: 32px; height: 32px; vertical-align: middle;
    }

    /* アプリ基本レイアウト */
    .app { position: relative; width: 100%; height: 100%; overflow: hidden; background: #f5f5f5; }
    #map { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 0; }

    /* パネルデザイン */
    .panel {
      position: absolute; left: 0; right: 0; bottom: 0;
      max-height: 55vh; height: 55vh;
      background: #ffffff; border-radius: 20px 20px 0 0;
      box-shadow: 0 -2px 15px rgba(0,0,0,0.15);
      display: flex; flex-direction: column; z-index: 1000;
      box-sizing: border-box; overflow: hidden;
      transition: height 0.3s ease; 
    }
    .panel.collapsed { height: 56px; }
    .panel-handle-area { padding: 6px 0 2px; display: flex; justify-content: center; cursor: pointer; }
    .panel-handle { width: 40px; height: 4px; border-radius: 999px; background: #e0e0e0; }

    /* タブヘッダー */
    .panel-tabs-header { display: flex; border-bottom: 1px solid #e5e5e5; background: #fafafa; }
    .panel-tabs-header .tab-btn { flex: 1; text-align: center; padding: 10px 4px; font-size: 14px; cursor: pointer; }
    .panel-tabs-header .tab-btn.active { font-weight: 600; border-bottom: 3px solid #25d07a; background: #ffffff; }
    .panel-tabs-body { flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 12px 16px 16px; box-sizing: border-box; }
    .tab-pane { display: none; }
    .tab-pane.active { display: block; }

    /* 天気ウィジェット */
    .weather-widget {
      margin: 8px 0; padding: 8px 10px; border-radius: 8px;
      background: #e0f2fe; color: #0369a1; font-size: 13px;
    }
    .weather-current-row { display: flex; align-items: center; gap: 6px; font-weight: 600; margin-bottom: 8px; font-size: 14px; }
    .weather-forecast-list { display: flex; flex-direction: column; gap: 4px; }
    .weather-forecast-item { display: flex; align-items: center; justify-content: space-between; background: #ffffff; padding: 4px 8px; border-radius: 6px; font-size: 12px; color: #333; }

    /* 検索フィルターチップ */
    .filter-chips-row { display: flex; flex-wrap: nowrap; gap: 8px; overflow-x: auto; padding-bottom: 8px; margin-bottom: 8px; }
    .filter-chips-row::-webkit-scrollbar { display: none; }
    .chip { flex: 0 0 auto; border-radius: 16px; border: 1px solid #ccc; padding: 6px 12px; font-size: 12px; background: #fff; cursor: pointer; }
    .chip.active { background: #25d07a; color: #fff; border-color: #25d07a; }

    /* 入力フォーム */
    .search-box-container { margin-top: 4px; margin-bottom: 8px; }
    .input-wrapper { display: flex; align-items: center; border-radius: 999px; border: 1px solid #ccc; padding: 2px 8px; background: #fff; }
    .input-wrapper .input { border: none; flex: 1; font-size: 14px; padding: 8px 6px; outline: none; background: transparent; }
    .icon { display: inline-flex; align-items: center; justify-content: center; }
    
    /* 検索結果リスト */
    .results-list { margin-top: 4px; border-radius: 8px; border: 1px solid #eee; overflow: hidden; background: #fff; }
    .result-item { padding: 8px 10px; border-bottom: 1px solid #eee; font-size: 13px; cursor: pointer; }
    .result-item:last-child { border-bottom: none; }
    .result-item:active { background: #f0f0f0; }

    /* 住所カード */
    .address-card { margin-top: 4px; margin-bottom: 8px; padding: 8px 10px; border-radius: 8px; background: #f1f5f9; font-size: 12px; }
    .address-title { font-weight: 600; margin-bottom: 2px; }
    .address-coords { color: #6b7280; }

    /* ボタン類 */
    .action-buttons-row, .bottom-actions-row { display: flex; gap: 8px; margin-top: 8px; }
    .btn { flex: 1; border-radius: 999px; border: 1px solid #ccc; padding: 8px 10px; font-size: 13px; background: #fff; cursor: pointer; text-align: center;}
    .btn-primary { border-color: #25d07a; background: #25d07a; color: #fff; }
    .btn-secondary { background: #e5e7eb; border-color: #d1d5db; }
    .btn-danger { border-color: #f97373; background: #fee2e2; color: #b91c1c; }
    .btn-danger-block { width: 100%; border-color: #f97373; background: #fee2e2; color: #b91c1c; }

    /* FAB */
    .fab-container { position: absolute; right: 12px; bottom: 58vh; display: flex; flex-direction: column; gap: 8px; z-index: 900; pointer-events: none; }
    .fab-container .fab-btn { pointer-events: auto; min-width: 48px; height: 40px; border-radius: 999px; border: none; padding: 0 12px; font-size: 12px; background: #ffffff; box-shadow: 0 4px 8px rgba(0,0,0,0.2); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
    .fab-container .fab-btn.destination { background: #25d07a; color: #fff; }
    .fab-container .fab-btn.voice-btn { background: #333; color: #fff; font-size: 16px; }

    /* その他 */
    .loading-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.9); z-index: 1100; }
    .nav-section { margin-bottom: 12px; }
    .nav-section-title { font-size: 14px; font-weight: 600; margin-bottom: 4px; }
    .incident-alert { border-radius: 8px; border: 1px solid #facc15; background: #fef9c3; color: #713f12; padding: 8px 10px; font-size: 12px; }

    /* マーカー */
    .wn-user-marker { width: 24px; height: 24px; border-radius: 999px; background: #3aa0ff; border: 2px solid #ffffff; box-shadow: 0 0 4px rgba(0,0,0,0.4); position: relative; transform-origin: 50% 50%; }
    .wn-user-marker::after { content: ''; position: absolute; left: 50%; top: 50%; width: 2px; height: 8px; background: #ffffff; border-radius: 999px; transform: translate(-50%, -90%); }
    .wn-search-marker { width: 24px; height: 24px; border-radius: 999px; background: #ffffff; border: 2px solid #25d07a; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600; color: #111; box-shadow: 0 1px 4px rgba(0,0,0,0.3); }
    .wn-point-marker { width: 18px; height: 18px; border-radius: 999px; background: #ff6565; border: 2px solid #ffffff; box-shadow: 0 1px 3px rgba(0,0,0,0.3); }
  `;
  document.head.appendChild(style);
})();

const DEFAULT_MASK = 'places.displayName,places.formattedAddress,places.location,places.id,places.types';
const MAX_RETRY = 3;
const RETRY_DELAY = 1000;
const LOCATION_OPTIONS = { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 };
const SAVED_LOCATIONS_KEY = 'walknav_saved_locations';
const MAP_MODE_KEY = 'walknav_map_mode';
const PROFILE_KEY = 'walknav_user_profile';

const WN = (window.__WN_GLOBAL__ = window.__WN_GLOBAL__ || {
  booted: false, locks: Object.create(null), alerts: Object.create(null)
});

function lock(key, ms) {
  const now = Date.now(); if (now < (WN.locks[key] || 0)) return false;
  WN.locks[key] = now + ms; return true;
}
function alertOnce(key, msg, ms = 1200) {
  const now = Date.now(); if (now - (WN.alerts[key] || 0) < ms) return;
  WN.alerts[key] = now; alert(msg);
}

if (WN.booted) {
  console.warn('[WalkNav] duplicate app.js blocked:', ISSUE_ID);
} else {
  WN.booted = true;

  const appState = {
    map: null, userMarker: null, userMarkerElement: null, currentPos: null,
    pointSearchMode: false, searchPoint: null, searchPointMarker: null,
    mapInitialized: false, searchMarkers: [], currentDestination: null,
    currentPolyline: null, isNavigating: false, locationWatchId: null,
    compassWatchId: null, currentHeading: 0, isSimulation: false,
    currentRouteData: null, userProfile: { luggage: 'None', condition: 'Normal', companion: 'None' },
    savedLocations: [], editingLocationIndex: null, isEditDialogOpen: false,
    mapMode: 'roadmap', searchInFlight: false, searchRadiusMeters: 10000,
    aiMode: 'normal', incidentData: null, cachedWeatherData: null
  };

  function getEl(id) { return document.getElementById(id); }
  function setDisplay(id, displayVal) { const el = getEl(id); if (el) el.style.display = displayVal; }
  function setText(id, text) { const el = getEl(id); if (el) el.textContent = text; }

  function loadUserProfile() {
    try { const raw = localStorage.getItem(PROFILE_KEY); if (raw) appState.userProfile = JSON.parse(raw); } catch (_) {}
  }
  function persistUserProfile() {
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(appState.userProfile)); } catch (_) {}
  }

  async function fetchWithRetry(url, options = {}, retries = MAX_RETRY) {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await fetch(url, options);
        if (!response.ok && i < retries - 1) { await new Promise(r => setTimeout(r, RETRY_DELAY * (i + 1))); continue; }
        return response;
      } catch (error) {
        if (i === retries - 1) throw error;
        await new Promise(r => setTimeout(r, RETRY_DELAY * (i + 1)));
      }
    }
  }

  /* === 天気取得 (Cloudflare Proxyのみ) === */
  async function fetchWeatherProxy(endpoint, lat, lng) {
    try {
      const resp = await fetchWithRetry(`${WORKER_ORIGIN}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat, lng, language: 'ja', units: 'metric' })
      });
      if (!resp.ok) throw new Error(`Proxy Error: ${resp.status}`);
      return await resp.json();
    } catch (e) {
      console.error(`[WalkNav] Weather Proxy failed for ${endpoint}:`, e);
      return null;
    }
  }
  async function fetchCurrentWeather(lat, lng) { return fetchWeatherProxy('weather', lat, lng); }
  async function fetchForecast(lat, lng) { return fetchWeatherProxy('forecast', lat, lng); }

  async function fetchAddressNominatim(lat, lng) {
    try {
      const resp = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`);
      if (!resp.ok) return '住所不明';
      const data = await resp.json(); return data.display_name || '現在地';
    } catch (e) { return '現在地'; }
  }

  function buildWeatherHtml(current, forecast) {
    if (!current) return '<div style="font-size:12px; color:#666;">☁️ 天気情報なし (Proxy設定を確認)</div>';
    let pop = 0; if (forecast && forecast.list?.[0]) pop = Math.round(forecast.list[0].pop * 100);
    const curIcon = `https://openweathermap.org/img/wn/${current.weather[0].icon}.png`;
    const html = `
      <div class="weather-current-row">
        <img src="${curIcon}" class="weather-icon-img" alt="${current.weather[0].description}">
        <span>${current.weather[0].description}</span>
        <span style="margin-left:auto;">${Math.round(current.main.temp)}℃</span>
        <span style="color:#3b82f6; margin-left:8px;">☂️ ${pop}%</span>
      </div>`;
    let forecastHtml = '';
    if (forecast && forecast.list) {
      forecastHtml += `<div class="weather-forecast-list">`;
      for (let i = 1; i <= 3; i++) {
        const item = forecast.list[i];
        if (item) {
          forecastHtml += `
            <div class="weather-forecast-item">
              <span style="width:40px; font-weight:bold;">${i * 3}H後</span>
              <img src="https://openweathermap.org/img/wn/${item.weather[0].icon}.png" style="width:24px; height:24px;">
              <span>${Math.round(item.main.temp)}℃</span>
              <span style="color:#3b82f6;">☂️ ${Math.round(item.pop * 100)}%</span>
            </div>`;
        }
      }
      forecastHtml += `</div>`;
    }
    return html + forecastHtml;
  }

  async function updateAllWeatherUI(lat, lng) {
    const [current, forecast] = await Promise.all([fetchCurrentWeather(lat, lng), fetchForecast(lat, lng)]);
    appState.cachedWeatherData = { current, forecast };
    const html = buildWeatherHtml(current, forecast);

    // Search Panel 更新
    let searchEl = getEl('weatherDisplaySearch');
    if (!searchEl) {
      const card = document.querySelector('.address-card');
      if (card?.parentNode) {
        searchEl = document.createElement('div'); searchEl.id = 'weatherDisplaySearch'; searchEl.className = 'weather-widget';
        card.parentNode.insertBefore(searchEl, card.nextSibling);
      }
    }
    if (searchEl) { searchEl.innerHTML = html; searchEl.style.display = 'block'; }

    // Nav Panel 更新
    const routeInfo = getEl('routeInfoSection');
    if (routeInfo) {
      let navEl = getEl('weatherDisplayNav');
      if (!navEl) {
        navEl = document.createElement('div'); navEl.id = 'weatherDisplayNav'; navEl.className = 'weather-widget';
        routeInfo.insertBefore(navEl, routeInfo.firstChild);
      }
      navEl.innerHTML = html; navEl.style.display = 'block';
    }
    return current ? { desc: current.weather[0].description, temp: Math.round(current.main.temp) } : { desc: null };
  }

  async function handleVoiceAnnounce() {
    if (!appState.currentPos) return alertOnce('no_pos', '現在地なし');
    if (navigator.vibrate) navigator.vibrate(50);
    const [addr, w] = await Promise.all([fetchAddressNominatim(appState.currentPos.lat, appState.currentPos.lng), updateAllWeatherUI(appState.currentPos.lat, appState.currentPos.lng)]);
    const simple = addr.split(' ').pop().replace(/^日本、\s*/,'').replace(/、.*$/,'');
    let msg = `現在地は${simple}です。`;
    if (w.temp !== null) msg += `天気は${w.desc}、気温は${w.temp}度です。`;
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(msg); u.lang = 'ja-JP'; window.speechSynthesis.speak(u);
    }
  }

  /* === Google Maps Proxy Calls === */
  async function placesTextSearch(query, lat, lng) {
    const payload = { textQuery: query, locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: appState.searchRadiusMeters } }, languageCode: 'ja' };
    try {
      const resp = await fetchWithRetry(`${WORKER_ORIGIN}/places:searchText`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-FieldMask': DEFAULT_MASK },
        body: JSON.stringify(payload)
      });
      if (!resp.ok) throw new Error('Worker Error'); return await resp.json();
    } catch (e) {
      console.warn('Worker search failed, fallback direct', e);
      const resp = await fetchWithRetry(`https://places.googleapis.com/v1/places:searchText`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': API_KEY, 'X-Goog-FieldMask': DEFAULT_MASK },
        body: JSON.stringify(payload)
      });
      return await resp.json();
    }
  }

  async function geocode(lat, lng) {
    try {
      const resp = await fetchWithRetry(`${WORKER_ORIGIN}/geocode`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latlng: { lat, lng }, language: 'ja' })
      });
      if (!resp.ok) throw new Error('Worker Error'); return await resp.json();
    } catch (e) {
      const resp = await fetchWithRetry(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&language=ja&key=${API_KEY}`);
      return await resp.json();
    }
  }

  async function fetchIncidentsAround(lat, lng) {
    try {
      const resp = await fetchWithRetry(`${WORKER_ORIGIN}/incidents`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat, lng, radiusKm: 10 })
      });
      const json = await resp.json();
      const sec = getEl('incidentSection'); const box = getEl('incidentText');
      if (sec && box) {
        if (!json) { sec.style.display = 'none'; return; }
        const parts = [];
        if (json.traffic?.length) parts.push('交通:' + json.traffic.map(x=>x.title).join(','));
        if (json.events?.length) parts.push('事故:' + json.events.map(x=>x.title).join(','));
        if (json.weather?.length) parts.push('気象:' + json.weather.map(x=>x.title).join(','));
        sec.style.display = 'block';
        box.textContent = parts.length ? parts.join(' / ') : '周辺の特筆すべきインシデントはありません';
      }
    } catch (_) {}
  }

  /* === Map Logic (Timing Fix) === */
  function initMap(center) {
    if (appState.map) { appState.map.setCenter(center); return; }
    const mapEl = getEl('map'); if (!mapEl) return;
    
    const options = { center, zoom: 17, gestureHandling: 'greedy', clickableIcons: true, disableDefaultUI: true };

    try {
      // 1. Map ID ありで初期化を試みる
      appState.map = new google.maps.Map(mapEl, { ...options, mapId: MAP_ID });
      console.log('[WalkNav] Map initialized with ID');
    } catch (e) {
      // 2. 失敗時は ID なしで再試行 (Safe Mode)
      console.warn('Map ID init failed, fallback legacy', e);
      try {
        appState.map = new google.maps.Map(mapEl, options);
        console.log('[WalkNav] Map initialized (Legacy)');
      } catch (e2) {
        alertOnce('map_fail', '地図の表示に失敗しました');
        return;
      }
    }

    appState.map.addListener('click', (e) => { if (appState.pointSearchMode && e.latLng) setSearchPoint(e.latLng.lat(), e.latLng.lng()); });
    changeMapMode(appState.mapMode);
    appState.mapInitialized = true;
  }

  function setUserMarker(lat, lng) {
    appState.currentPos = { lat, lng };
    if (!appState.map) return;

    // AdvancedMarker 利用可否判定
    const useAdvanced = (google.maps.marker && google.maps.marker.AdvancedMarkerElement && appState.map.getMapCapabilities().isAdvancedMarkersAvailable !== false);

    if (useAdvanced) {
      if (!appState.userMarker) {
        const el = document.createElement('div'); el.className = 'wn-user-marker'; appState.userMarkerElement = el;
        appState.userMarker = new google.maps.marker.AdvancedMarkerElement({ map: appState.map, position: { lat, lng }, content: el, zIndex: 1000 });
      } else { appState.userMarker.position = { lat, lng }; }
      if (appState.userMarkerElement) appState.userMarkerElement.style.transform = `rotate(${appState.currentHeading}deg)`;
    } else {
      // Fallback: Legacy Marker
      if (!appState.userMarker) {
        appState.userMarker = new google.maps.Marker({
          map: appState.map, position: { lat, lng }, zIndex: 1000,
          icon: { path: google.maps.SymbolPath.CIRCLE, scale: 10, fillColor: "#3aa0ff", fillOpacity: 1, strokeWeight: 2, strokeColor: "white" }
        });
      } else { appState.userMarker.setPosition({ lat, lng }); }
    }
  }

  function setSearchPoint(lat, lng) {
    appState.searchPoint = { lat, lng };
    if (!appState.map) return;
    if (appState.searchPointMarker) {
      if(appState.searchPointMarker.map) appState.searchPointMarker.map = null;
      if(appState.searchPointMarker.setMap) appState.searchPointMarker.setMap(null);
      appState.searchPointMarker = null;
    }

    const useAdvanced = (google.maps.marker && google.maps.marker.AdvancedMarkerElement && appState.map.getMapCapabilities().isAdvancedMarkersAvailable !== false);

    if (useAdvanced) {
      const el = document.createElement('div'); el.className = 'wn-point-marker';
      appState.searchPointMarker = new google.maps.marker.AdvancedMarkerElement({ map: appState.map, position: { lat, lng }, content: el, zIndex: 999 });
    } else {
      appState.searchPointMarker = new google.maps.Marker({
        map: appState.map, position: { lat, lng }, zIndex: 999,
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 8, fillColor: "#ff6565", fillOpacity: 1, strokeWeight: 2, strokeColor: "white" }
      });
    }

    setText('pointAddress', '取得中…'); setDisplay('pointAddressBlock', 'flex'); setText('pointCoords', `Lat: ${lat.toFixed(5)}`);
    geocode(lat, lng).then(d => setText('pointAddress', d.results?.[0]?.formatted_address.replace(/^日本、\s*/,'') || '不明'));
    fetchIncidentsAround(lat, lng);
  }

  function acquireLocation() {
    navigator.geolocation.getCurrentPosition(pos => {
      const { latitude, longitude } = pos.coords;
      getEl('loading')?.remove();
      if (!appState.mapInitialized) initMap({ lat: latitude, lng: longitude }); else appState.map.setCenter({ lat: latitude, lng: longitude });
      setUserMarker(latitude, longitude);
      setText('locCoords', `Lat: ${latitude.toFixed(5)}`);
      geocode(latitude, longitude).then(d => setText('locAddress', d.results?.[0]?.formatted_address.replace(/^日本、\s*/,'') || ''));
      updateAllWeatherUI(latitude, longitude); 
      fetchIncidentsAround(latitude, longitude);
    }, () => {
      getEl('loading')?.remove();
      const def = { lat: 35.0, lng: 135.0 };
      if (!appState.mapInitialized) initMap(def);
      setUserMarker(def.lat, def.lng);
      setText('locAddress', '現在地取得失敗');
      updateAllWeatherUI(def.lat, def.lng);
    }, LOCATION_OPTIONS);
  }

  function startCompassListener() {
    window.addEventListener('deviceorientation', (e) => {
      if (appState.isNavigating) return;
      const h = e.webkitCompassHeading || (e.absolute ? e.alpha : null);
      if (h != null && appState.userMarkerElement) {
        appState.currentHeading = h; appState.userMarkerElement.style.transform = `rotate(${h}deg)`;
      }
    }, true);
  }

  function startLocationWatcher() {
    if (appState.locationWatchId) navigator.geolocation.clearWatch(appState.locationWatchId);
    appState.locationWatchId = navigator.geolocation.watchPosition(pos => {
      const { latitude, longitude } = pos.coords;
      setUserMarker(latitude, longitude);
      if (appState.isNavigating && appState.map) appState.map.panTo({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    }, null, LOCATION_OPTIONS);
  }

  /* === Route === */
  function renderRoute(route, destName) {
    if (!route?.legs?.[0]) return;
    const leg = route.legs[0];
    setText('destinationName', destName || '目的地');
    setText('routeDistance', leg.distance?.text);
    setText('routeTime', `徒歩 ${leg.duration?.text}`);
    const list = getEl('navPanelInstructions');
    if (list) {
      list.innerHTML = '';
      leg.steps.forEach(s => {
        const d = document.createElement('div'); d.className = 'nav-instruction-item'; d.style.padding='8px 0'; d.style.borderBottom='1px solid #eee';
        d.textContent = s.html_instructions.replace(/<[^>]+>/g,'') + (s.distance?.text ? ` (${s.distance.text})` : '');
        list.appendChild(d);
      });
    }
    setDisplay('instructionsSection', 'block');
    if (appState.currentPolyline) appState.currentPolyline.setMap(null);
    if (google.maps.geometry) {
      appState.currentPolyline = new google.maps.Polyline({
        path: google.maps.geometry.encoding.decodePath(route.overview_polyline.points),
        map: appState.map, strokeColor: '#62b5ff', strokeWeight: 6
      });
    }
    const b = new google.maps.LatLngBounds(); b.extend(appState.currentPos); b.extend(leg.end_location);
    appState.map.fitBounds(b, { padding: 50 });
    setDisplay('routeInfoSection', 'block');
    
    if (appState.cachedWeatherData && appState.cachedWeatherData.current) {
      updateAllWeatherUI(appState.currentPos.lat, appState.currentPos.lng);
    }
  }

  async function startNavigation(dest) {
    if (!appState.currentPos) return;
    appState.currentDestination = dest; appState.isNavigating = true;
    getEl('searchPanel').classList.add('collapsed');
    setDisplay('fabStack', 'flex'); setDisplay('searchPanel', 'block'); switchPanelTab('nav'); setDisplay('routeControlSection', 'block'); setDisplay('results', 'none');
    try {
      const resp = await fetchWithRetry(`${WORKER_ORIGIN}/directions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin: `${appState.currentPos.lat},${appState.currentPos.lng}`, destination: `${dest.lat},${dest.lng}`, mode: 'walking', language: 'ja' })
      });
      const json = await resp.json();
      let chosen = { route: json.routes[0], index: 0 };
      if (window.RouteEvaluator?.pickBestRoute) chosen = window.RouteEvaluator.pickBestRoute(json.routes, appState.userProfile, appState.aiMode);
      appState.currentRouteData = { routes: json.routes, selectedIndex: chosen.index };
      renderRoute(chosen.route, dest.name);
      startLocationWatcher(); fetchIncidentsAround(dest.lat, dest.lng);
    } catch (e) { alertOnce('route_err', 'ルート取得失敗'); stopNavigation(); }
  }

  function stopNavigation() {
    if (appState.locationWatchId) navigator.geolocation.clearWatch(appState.locationWatchId);
    appState.isNavigating = false;
    if (appState.currentPolyline) appState.currentPolyline.setMap(null);
    setDisplay('routeControlSection', 'none'); setDisplay('instructionsSection', 'none'); setDisplay('routeInfoSection', 'none');
    setDisplay('btnDestination', 'none'); setDisplay('fabStack', 'none'); setDisplay('btnSearch', 'flex');
    switchPanelTab('search');
    if (appState.currentPos && appState.map) { appState.map.panTo(appState.currentPos); appState.map.setZoom(17); }
  }

  function switchPanelTab(mode) {
    const s = getEl('tabPaneSearch'), n = getEl('tabPaneNav'), st = getEl('tabPaneSettings');
    if (s) s.classList.toggle('active', mode !== 'nav' && mode !== 'settings');
    if (n) n.classList.toggle('active', mode === 'nav');
    if (st) st.classList.toggle('active', mode === 'settings');
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.panelTab === (mode==='settings'?'settings':mode==='nav'?'nav':'search')));
  }

  function changeMapMode(mode) {
    localStorage.setItem(MAP_MODE_KEY, mode); appState.mapMode = mode;
    if (appState.map) {
      appState.map.setMapTypeId(mode === 'photo' ? google.maps.MapTypeId.SATELLITE : mode === '3d' ? google.maps.MapTypeId.HYBRID : google.maps.MapTypeId.ROADMAP);
      appState.map.setTilt(mode === '3d' ? 45 : 0);
    }
    ['btnMapPhoto', 'btnMapRoadmap', 'btnMap3D'].forEach(id => getEl(id)?.classList.toggle('active', getEl(id).dataset.mode === mode));
  }

  /* === UI Binding === */
  function bindUI() {
    const q = getEl('q');
    if (getEl('btnSearchIcon')) getEl('btnSearchIcon').onclick = () => placesTextSearch(q.value, appState.currentPos.lat, appState.currentPos.lng).then(d => displayResults(d.places || []));
    if (q) q.onkeypress = (e) => { if (e.key === 'Enter') getEl('btnSearchIcon').click(); };
    if (getEl('btnReset')) getEl('btnReset').onclick = () => { q.value = ''; setDisplay('results', 'none'); appState.pointSearchMode = false; getEl('btnPointSearch').textContent = '📍 ポイント選択'; getEl('btnPointSearch').style.background = ''; };
    if (getEl('btnLocate')) getEl('btnLocate').onclick = acquireLocation;
    if (getEl('btnLocatePanel')) getEl('btnLocatePanel').onclick = acquireLocation;
    if (getEl('btnClosePanel')) getEl('btnClosePanel').onclick = () => getEl('searchPanel').classList.add('collapsed');
    if (getEl('btnSearch')) getEl('btnSearch').onclick = () => getEl('searchPanel').classList.remove('collapsed');
    if (getEl('btnStopRoute')) getEl('btnStopRoute').onclick = stopNavigation;
    [10, 20, 30].forEach(d => {
      const el = getEl(`r${d}`);
      if (el) el.onclick = () => { appState.searchRadiusMeters = d * 1000; setText('radiusLabel', `${d}km`); document.querySelectorAll('.chip').forEach(c => c.classList.remove('active')); el.classList.add('active'); };
    });
    if (getEl('btnPointSearch')) getEl('btnPointSearch').onclick = () => {
      appState.pointSearchMode = !appState.pointSearchMode;
      const b = getEl('btnPointSearch');
      b.textContent = appState.pointSearchMode ? '📍 選択中...' : '📍 ポイント選択';
      b.style.background = appState.pointSearchMode ? '#25d07a' : '';
    };
    ['btnMapPhoto', 'btnMapRoadmap', 'btnMap3D'].forEach(id => getEl(id).onclick = () => changeMapMode(getEl(id).dataset.mode));
    
    const fab = document.querySelector('.fab-container');
    if (fab && !getEl('btnVoiceAnnounce')) {
      const btn = document.createElement('button'); btn.id = 'btnVoiceAnnounce'; btn.className = 'fab-btn voice-btn'; btn.innerHTML = '🎤';
      btn.onclick = handleVoiceAnnounce; fab.appendChild(btn);
    }
    const ph = document.querySelector('.panel-handle-area');
    if(ph) ph.onclick = () => getEl('searchPanel').classList.toggle('collapsed');
  }

  function displayResults(places) {
    const div = getEl('results'); if (!div) return;
    div.innerHTML = ''; setDisplay('results', 'block'); setDisplay('instructionsSection', 'none');
    appState.searchMarkers.forEach(m => { if(m.map) m.map=null; if(m.setMap) m.setMap(null); });
    appState.searchMarkers = [];
    
    const useAdvanced = (appState.map && google.maps.marker && google.maps.marker.AdvancedMarkerElement && appState.map.getMapCapabilities().isAdvancedMarkersAvailable !== false);

    places.slice(0, 5).forEach((p, i) => {
      const item = document.createElement('div'); item.className = 'result-item';
      item.innerHTML = `<div>${i + 1}. ${p.displayName?.text || '名称不明'}</div><div style="font-size:0.8em;opacity:0.7">${p.formattedAddress || ''}</div>`;
      item.onclick = () => startNavigation({ name: p.displayName?.text, lat: p.location.latitude, lng: p.location.longitude });
      div.appendChild(item);
      
      if (useAdvanced) {
        const el = document.createElement('div'); el.className = 'wn-search-marker'; el.textContent = String(i + 1);
        appState.searchMarkers.push(new google.maps.marker.AdvancedMarkerElement({ map: appState.map, position: { lat: p.location.latitude, lng: p.location.longitude }, content: el, title: p.displayName?.text }));
      } else {
        appState.searchMarkers.push(new google.maps.Marker({
          map: appState.map, position: { lat: p.location.latitude, lng: p.location.longitude }, label: String(i+1), title: p.displayName?.text
        }));
      }
    });
  }

  function startApp() {
    console.log('[WalkNav] Starting v23 (Wait Loop)...');
    loadUserProfile(); bindUI();
    appState.mapMode = localStorage.getItem(MAP_MODE_KEY) || 'roadmap';
    switchPanelTab('search'); acquireLocation(); startCompassListener();
  }

  /* === ★重要★ Google Maps APIの読み込み完了を待機するループ === */
  function initializeWhenReady() {
    if (typeof google !== 'undefined' && google.maps && google.maps.Map) {
      startApp();
    } else {
      console.log('[WalkNav] Waiting for Google Maps API...');
      setTimeout(initializeWhenReady, 200); // 0.2秒後に再チェック
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeWhenReady);
  } else {
    initializeWhenReady();
  }
}
