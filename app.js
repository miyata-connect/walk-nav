'use strict';

/**
 * WalkNav app.js
 * Fix pack:
 * - 検索結果が1件しか見えない/スクロールできない → results を確実に scroll 可能化＋高さ動的調整
 * - 10/20/30km と ポイント選択 を横並び（横スライド）に再配置
 * - 二重発火（alert/promptが二回出る）を lock + stopImmediatePropagation + click追撃抑止で封じる
 * - Google側でREQUEST_DENIEDが出ているため、Places/Geocoderのブラウザ直呼びは主経路から外してWorker優先
 */

const ISSUE_ID = 'idx20251204_fix_scroll_and_worker_first_v1';

// ユーザー指定
const API_KEY = 'AIzaSyBuX-4y1Cgl6jdKcHZWWlsoosDWK_RGqF0';
const WORKER_ORIGIN = 'https://ors-proxy.miyata-connect-jp.workers.dev';

// Places API v1 field mask (workerが利用する想定)
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

/* =========================
   二重読込・二重発火対策（window共有）
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

function injectStyleOnce(key, cssText) {
  if (WN.styles[key]) return;
  WN.styles[key] = true;
  const style = document.createElement('style');
  style.id = `wn-style-${key}`;
  style.textContent = cssText;
  document.head.appendChild(style);
}

if (WN.booted) {
  console.warn('[WalkNav] duplicate app.js blocked:', ISSUE_ID);
} else {
  WN.booted = true;

  const appState = {
    map: null,
    userMarker: null,
    currentPos: null,

    pointSearchMode: false,
    searchPoint: null,
    searchPointMarker: null,

    mapInitialized: false,
    searchMarkers: [],
    currentDestination: null,
    currentPolyline: null,

    recognition: null,
    isPaused: false,
    isNavigating: false,

    locationWatchId: null,
    compassWatchId: null,
    currentHeading: 0,

    isSimulation: false,
    currentRouteData: null,

    unifiedHeight: null,

    savedLocations: [],
    editingLocationIndex: null,
    isEditDialogOpen: false,

    mapMode: 'roadmap',

    // 検索重複防止
    searchInFlight: false,

    // 10/20/30km
    searchRadiusMeters: 10000
  };

  /* =========================
     DOM helpers
     ========================= */
  function getEl(id) { return document.getElementById(id); }

  function setDisplay(id, displayVal) {
    const el = getEl(id);
    if (el) el.style.display = displayVal;
  }

  function setText(id, text) {
    const el = getEl(id);
    if (el) el.textContent = text;
  }

  function safeRemove(el) {
    try { if (el && el.parentNode) el.parentNode.removeChild(el); } catch (_) {}
  }

  /* =========================
     UI Fix: パネル高さ/スクロール/並び替え
     ========================= */
  function applyUiFixes() {
    // 1) パネルは画面の半分（max-height）& スクロールは内部に寄せる
    injectStyleOnce('panel_half_scroll', `
      /* 操作パネルは液晶の半分で抑える（要求） */
      #searchPanel{
        max-height: 50vh !important;
        height: 50vh !important;
        overflow: hidden !important;
      }

      /* タブ中身は内部スクロール前提 */
      #tabPaneSearch, #tabPaneNav, #tabPaneSettings{
        height: 100% !important;
        overflow: hidden !important;
      }

      /* 検索入力の下に余白追加（要求） */
      #q, input#q{
        margin-bottom: 12px !important;
      }

      /* 検索結果/案内リストは縦スクロール */
      #results, #navPanelInstructions{
        overflow-y: auto !important;
        -webkit-overflow-scrolling: touch !important;
      }

      /* チップ列（10/20/30/ポイント）を横並びスライド */
      .wn-chip-row{
        display: flex !important;
        gap: 10px !important;
        align-items: center !important;
        overflow-x: auto !important;
        -webkit-overflow-scrolling: touch !important;
        padding: 4px 2px 10px !important;
        margin: 0 0 6px !important;
      }
      .wn-chip-row > *{
        flex: 0 0 auto !important;
        white-space: nowrap !important;
      }
    `);

    // 2) 10/20/30km と ポイント選択を、同一行（横スクロール）に構築
    buildSearchChipRow();

    // 3) results 高さを「見えてる領域」に自動フィット
    updateScrollableHeights();
    window.addEventListener('resize', () => updateScrollableHeights(), { passive: true });
  }

  function buildSearchChipRow() {
    const r10 = getEl('r10');
    const r20 = getEl('r20');
    const r30 = getEl('r30');
    const btnPoint = getEl('btnPointSearch');

    // すでに作成済みなら何もしない
    if (getEl('wnChipRow')) return;

    // 4要素が揃っている場合のみ再配置（不要な改変禁止のため、揃わないなら触らない）
    if (!r10 || !r20 || !r30 || !btnPoint) return;

    // 置き場所：r10がいるブロックの直前に挿入
    const anchorParent = r10.parentElement;
    if (!anchorParent || !anchorParent.parentElement) return;

    const row = document.createElement('div');
    row.id = 'wnChipRow';
    row.className = 'wn-chip-row';

    // 先に row をDOMへ（位置確定）
    anchorParent.parentElement.insertBefore(row, anchorParent);

    // 既存のボタンを row に移動（見た目だけの再配置）
    row.appendChild(r10);
    row.appendChild(r20);
    row.appendChild(r30);
    row.appendChild(btnPoint);
  }

  function updateScrollableHeights() {
    // results を確実にスクロールさせる：offsetTop基準で残り高さを maxHeight に入れる
    const panel = getEl('searchPanel');
    const paneSearch = getEl('tabPaneSearch');
    const results = getEl('results');

    if (!panel || !paneSearch || !results) return;

    // 見えてるパネル内の残り高を計算
    const panelRect = panel.getBoundingClientRect();
    const resRect = results.getBoundingClientRect();

    // results の上端から panel 下端まで
    const available = Math.floor(panelRect.bottom - resRect.top - 10);
    if (available > 80) {
      results.style.maxHeight = `${available}px`;
      results.style.overflowY = 'auto';
      results.style.webkitOverflowScrolling = 'touch';
    }
  }

  /* =========================
     LocalStorage
     ========================= */
  function loadSavedLocations() {
    try {
      const saved = localStorage.getItem(SAVED_LOCATIONS_KEY);
      appState.savedLocations = saved ? JSON.parse(saved) : [];
      if (!Array.isArray(appState.savedLocations)) appState.savedLocations = [];
    } catch (e) {
      console.error('登録地の読み込みエラー:', e);
      appState.savedLocations = [];
    }
  }

  function saveSavedLocations() {
    try {
      localStorage.setItem(SAVED_LOCATIONS_KEY, JSON.stringify(appState.savedLocations));
      console.log('[SavedLocations] 保存完了:', appState.savedLocations.length, '件');
    } catch (e) {
      console.error('登録地の保存エラー:', e);
    }
  }

  function loadMapMode() {
    try {
      const saved = localStorage.getItem(MAP_MODE_KEY);
      appState.mapMode = saved || 'roadmap';
    } catch (_) {
      appState.mapMode = 'roadmap';
    }
  }

  function saveMapMode(mode) {
    try {
      localStorage.setItem(MAP_MODE_KEY, mode);
      appState.mapMode = mode;
      console.log('[MapMode] 保存:', mode);
    } catch (e) {
      console.error('地図モード保存エラー:', e);
    }
  }

  function updateMapModeButtons(activeMode) {
    ['btnMapPhoto', 'btnMapRoadmap', 'btnMap3D'].forEach(btnId => {
      const btn = getEl(btnId);
      if (!btn) return;
      const mode = btn.dataset.mode;
      btn.classList.toggle('active', mode === activeMode);
    });
  }

  function changeMapMode(mode) {
    if (!appState.map) return;

    saveMapMode(mode);

    if (mode === 'photo') {
      appState.map.setMapTypeId(google.maps.MapTypeId.SATELLITE);
      try { appState.map.setTilt(0); } catch (_) {}
    } else if (mode === '3d') {
      appState.map.setMapTypeId(google.maps.MapTypeId.HYBRID);
      try { appState.map.setTilt(45); } catch (_) {}
    } else {
      appState.map.setMapTypeId(google.maps.MapTypeId.ROADMAP);
      try { appState.map.setTilt(0); } catch (_) {}
    }

    updateMapModeButtons(mode);
  }

  function switchPanelTab(mode) {
    const isNav = mode === 'nav';
    const isSettings = mode === 'settings';

    const paneSearch = getEl('tabPaneSearch');
    const paneNav = getEl('tabPaneNav');
    const paneSettings = getEl('tabPaneSettings');

    if (paneSearch && paneNav && paneSettings) {
      paneSearch.classList.toggle('active', !isNav && !isSettings);
      paneNav.classList.toggle('active', isNav);
      paneSettings.classList.toggle('active', isSettings);
    }

    const target = isSettings ? 'settings' : (isNav ? 'nav' : 'search');
    document.querySelectorAll('[data-panel-tab]').forEach(btn => {
      const active = btn.dataset.panelTab === target;
      btn.classList.toggle('active', active);
    });

    // タブ切替で高さ再計算
    setTimeout(updateScrollableHeights, 50);
  }

  /* =========================
     fetch retry
     ========================= */
  async function fetchWithRetry(url, options = {}, retries = MAX_RETRY) {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await fetch(url, options);
        if (!response.ok && i < retries - 1) {
          await new Promise(r => setTimeout(r, RETRY_DELAY * (i + 1)));
          continue;
        }
        return response;
      } catch (error) {
        if (i === retries - 1) throw error;
        await new Promise(r => setTimeout(r, RETRY_DELAY * (i + 1)));
      }
    }
  }

  /* =========================
     Places search: Worker first
     ========================= */
  async function placesTextSearchViaWorker(query, centerLat, centerLng, radiusMeters) {
    const payload = {
      textQuery: query,
      locationBias: {
        circle: {
          center: { latitude: centerLat, longitude: centerLng },
          radius: radiusMeters
        }
      },
      languageCode: 'ja'
    };

    const resp = await fetchWithRetry(`${WORKER_ORIGIN}/places:searchText`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-FieldMask': DEFAULT_MASK
      },
      body: JSON.stringify(payload)
    });

    if (!resp.ok) {
      let body = '';
      try { body = await resp.text(); } catch (_) {}
      throw new Error(`WORKER_TextSearch ${resp.status} ${body.slice(0, 220)}`);
    }
    return await resp.json();
  }

  // 最終手段：ブラウザ直 REST（このキーがPlaces許可されてないと失敗する可能性が高い）
  async function placesTextSearchDirect(query, centerLat, centerLng, radiusMeters) {
    const payload = {
      textQuery: query,
      locationBias: {
        circle: {
          center: { latitude: centerLat, longitude: centerLng },
          radius: radiusMeters
        }
      },
      languageCode: 'ja'
    };

    const resp = await fetchWithRetry(`https://places.googleapis.com/v1/places:searchText`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': API_KEY,
        'X-Goog-FieldMask': DEFAULT_MASK
      },
      body: JSON.stringify(payload)
    });

    if (!resp.ok) {
      let body = '';
      try { body = await resp.text(); } catch (_) {}
      throw new Error(`DIRECT_TextSearch ${resp.status} ${body.slice(0, 220)}`);
    }
    return await resp.json();
  }

  async function placesTextSearch(query, centerLat, centerLng) {
    // Worker優先（キー制限の影響を避ける）
    try {
      return await placesTextSearchViaWorker(query, centerLat, centerLng, appState.searchRadiusMeters);
    } catch (e1) {
      console.warn('[WalkNav] Worker search failed, fallback direct:', e1?.message || e1);
      return await placesTextSearchDirect(query, centerLat, centerLng, appState.searchRadiusMeters);
    }
  }

  /* =========================
     Geocode: Worker first
     ========================= */
  async function geocodeViaWorker(lat, lng) {
    const res = await fetchWithRetry(`${WORKER_ORIGIN}/geocode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latlng: { lat, lng }, language: 'ja' })
    });
    if (!res.ok) {
      let body = '';
      try { body = await res.text(); } catch (_) {}
      throw new Error(`WORKER_Geocode ${res.status} ${body.slice(0, 220)}`);
    }
    return await res.json();
  }

  // 最終手段：ブラウザ直（このキーがGeocoding許可されてないと失敗する可能性あり）
  async function geocodeDirect(lat, lng) {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${encodeURIComponent(lat + ',' + lng)}&language=ja&key=${encodeURIComponent(API_KEY)}`;
    const res = await fetchWithRetry(url, { method: 'GET' });
    if (!res.ok) {
      let body = '';
      try { body = await res.text(); } catch (_) {}
      throw new Error(`DIRECT_Geocode ${res.status} ${body.slice(0, 220)}`);
    }
    return await res.json();
  }

  /* =========================
     Map init / markers
     ========================= */
  function initMap(center) {
    if (appState.map) {
      appState.map.setCenter(center);
      console.log('[WalkNav] Map center updated');
      return;
    }
    const mapEl = getEl('map');
    if (!mapEl) return;

    try {
      appState.map = new google.maps.Map(mapEl, {
        center,
        zoom: 17,
        mapId: 'DEMO_MAP',
        gestureHandling: 'greedy',
        clickableIcons: true,
        disableDefaultUI: true
      });

      appState.map.addListener('click', (e) => {
        if (!appState.pointSearchMode) return;
        if (e.latLng) setSearchPoint(e.latLng.lat(), e.latLng.lng());
      });

      changeMapMode(appState.mapMode);
      appState.mapInitialized = true;
      console.log('[WalkNav] Map initialized');

    } catch (e) {
      console.error('[WalkNav] Map initialization failed:', e);
      alertOnce('map_fail', '地図の読み込みに失敗しました。APIキーの設定を確認してください。');
    }
  }

  function setUserMarker(lat, lng) {
    appState.currentPos = { lat, lng };
    if (!appState.map) return;

    if (!appState.userMarker) {
      const pin = document.createElement('div');
      pin.style.width = '32px';
      pin.style.height = '32px';
      pin.innerHTML =
        `<svg id="user-marker-icon" viewBox="0 0 24 24" style="width:100%;height:100%;transform:rotate(${appState.currentHeading}deg);transition:transform 0.2s ease-out;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.4));">
          <path d="M12 2L4.5 20.5L12 16.5L19.5 20.5L12 2Z" fill="#3aa0ff" stroke="#ffffff" stroke-width="2" stroke-linejoin="round" />
        </svg>`;

      try {
        appState.userMarker = new google.maps.marker.AdvancedMarkerElement({
          map: appState.map,
          position: { lat, lng },
          content: pin,
          zIndex: 1000
        });
      } catch (_) {
        appState.userMarker = new google.maps.Marker({
          map: appState.map,
          position: { lat, lng }
        });
      }
    } else {
      appState.userMarker.position = { lat, lng };
    }
  }

  function setSearchPoint(lat, lng) {
    appState.searchPoint = { lat, lng };
    if (appState.searchPointMarker) appState.searchPointMarker.map = null;

    const pin = document.createElement('div');
    pin.style.width = '30px';
    pin.style.height = '30px';
    pin.style.borderRadius = '50% 50% 50% 0';
    pin.style.background = '#ff6565';
    pin.style.border = '3px solid #fff';
    pin.style.transform = 'rotate(-45deg)';
    pin.style.boxShadow = '0 4px 4px rgba(0,0,0,.3)';

    try {
      appState.searchPointMarker = new google.maps.marker.AdvancedMarkerElement({
        map: appState.map,
        position: { lat, lng },
        content: pin,
        zIndex: 999
      });
    } catch (_) {
      appState.searchPointMarker = new google.maps.Marker({
        map: appState.map,
        position: { lat, lng },
        label: 'Target'
      });
    }

    fetchPointAddress(lat, lng).catch(() => {});
  }

  function drawRoutePolyline(route) {
    if (appState.currentPolyline) {
      appState.currentPolyline.setMap(null);
      appState.currentPolyline = null;
    }
    const encoded =
      route?.overview_polyline?.points ||
      route?.polyline?.encodedPolyline ||
      route?.overviewPolyline?.encodedPolyline;

    if (!encoded) return;

    try {
      const path = google.maps.geometry.encoding.decodePath(encoded);
      appState.currentPolyline = new google.maps.Polyline({
        path,
        geodesic: true,
        strokeColor: '#62b5ff',
        strokeOpacity: 0.8,
        strokeWeight: 6,
        map: appState.map
      });
    } catch (e) {
      console.error('Polyline decode error:', e);
    }
  }

  /* =========================
     Compass / location
     ========================= */
  function startCompassListener() {
    if (!window.DeviceOrientationEvent) return;

    const handler = (event) => {
      if (appState.isNavigating) return;
      const heading = event.webkitCompassHeading || (event.absolute ? event.alpha : null);
      if (heading === null || heading === undefined) return;

      appState.currentHeading = heading;
      const icon = getEl('user-marker-icon');
      if (icon) icon.style.transform = `rotate(${heading}deg)`;
    };

    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission()
        .then(state => {
          if (state === 'granted') {
            window.addEventListener('deviceorientation', handler, true);
            appState.compassWatchId = 1;
          }
        })
        .catch(() => {});
    } else {
      window.addEventListener('deviceorientationabsolute', handler, true);
      window.addEventListener('deviceorientation', handler, true);
      appState.compassWatchId = 1;
    }
  }

  function startLocationWatcher() {
    if (appState.locationWatchId) navigator.geolocation.clearWatch(appState.locationWatchId);
    appState.locationWatchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setUserMarker(latitude, longitude);
        if (appState.isNavigating && !appState.isPaused && appState.map) {
          appState.map.panTo({ lat: latitude, lng: longitude });
        }
      },
      (e) => console.error(e),
      LOCATION_OPTIONS
    );
  }

  function stopLocationWatcher() {
    if (appState.locationWatchId) {
      navigator.geolocation.clearWatch(appState.locationWatchId);
      appState.locationWatchId = null;
    }
  }

  function acquireLocation() {
    const onSuccess = (pos) => {
      const { latitude, longitude } = pos.coords;
      const loadingEl = getEl('loading');
      if (loadingEl) loadingEl.remove();

      if (!appState.mapInitialized) {
        initMap({ lat: latitude, lng: longitude });
      } else if (appState.map) {
        appState.map.setCenter({ lat: latitude, lng: longitude });
      }

      setUserMarker(latitude, longitude);
      fetchLocationNameGoogle(latitude, longitude).catch(() => {});
    };

    const onError = (error) => {
      console.warn('[WalkNav] Geolocation error:', error);
      const loadingEl = getEl('loading');
      if (loadingEl) loadingEl.remove();

      const defaultPos = { lat: 34.0344, lng: 134.0577 };
      if (!appState.mapInitialized) initMap(defaultPos);

      setText('locAddress', '現在地取得失敗');
      setText('locCoords', 'GPSエラー');
    };

    if (!navigator.geolocation) {
      onError('Geolocation not supported');
      return;
    }

    try {
      navigator.geolocation.getCurrentPosition(onSuccess, onError, LOCATION_OPTIONS);
    } catch (e) {
      onError(e);
    }
  }

  async function fetchLocationNameGoogle(lat, lng) {
    setText('locCoords', `Lat: ${lat.toFixed(5)} / Lng: ${lng.toFixed(5)}`);
    try {
      let data;
      try {
        data = await geocodeViaWorker(lat, lng);
      } catch (e1) {
        console.warn('[WalkNav] Worker geocode failed, fallback direct:', e1?.message || e1);
        data = await geocodeDirect(lat, lng);
      }

      if (data.results?.[0]) {
        setText('locAddress', String(data.results[0].formatted_address || '').replace(/^日本、\s*/, ''));
      } else {
        setText('locAddress', '');
      }
    } catch (e) {
      console.error(e);
      setText('locAddress', '');
    }
  }

  async function fetchPointAddress(lat, lng) {
    setText('pointAddress', '取得中…');
    setDisplay('pointAddressBlock', 'flex');
    setText('pointCoords', `Lat: ${lat.toFixed(5)}`);

    try {
      let data;
      try {
        data = await geocodeViaWorker(lat, lng);
      } catch (e1) {
        console.warn('[WalkNav] Worker point geocode failed, fallback direct:', e1?.message || e1);
        data = await geocodeDirect(lat, lng);
      }

      if (data.results?.[0]) {
        setText('pointAddress', String(data.results[0].formatted_address || '').replace(/^日本、\s*/, ''));
      } else {
        setText('pointAddress', '取得できません');
      }
    } catch (_) {
      setText('pointAddress', '取得エラー');
    }
  }

  /* =========================
     Search
     ========================= */
  async function performSearch(query) {
    if (!query) return;

    // クリック追撃対策
    if (!lock('search_click', 900)) return;
    if (appState.searchInFlight) return;
    appState.searchInFlight = true;

    const center = appState.pointSearchMode && appState.searchPoint
      ? appState.searchPoint
      : (appState.currentPos || appState.map?.getCenter()?.toJSON());

    if (!center) {
      appState.searchInFlight = false;
      alertOnce('no_center', '現在地が取得できていません');
      return;
    }

    try {
      const data = await placesTextSearch(query, center.lat, center.lng);
      const results = data.places || [];
      displayResults(results);
      updateScrollableHeights();

      if (results.length === 0) alertOnce('no_results', '検索結果がありません');
    } catch (e) {
      console.error(e);
      const msg = String(e?.message || '');
      if (msg.includes('403')) alertOnce('search_403', '検索に失敗しました（403）');
      else if (msg.includes('400')) alertOnce('search_400', '検索に失敗しました（400）');
      else alertOnce('search_fail', '検索に失敗しました');
    } finally {
      appState.searchInFlight = false;
    }
  }

  function displayResults(places) {
    const resDiv = getEl('results');
    if (!resDiv) return;

    resDiv.innerHTML = '';
    setDisplay('results', 'block');
    setDisplay('instructionsSection', 'none');

    appState.searchMarkers.forEach(m => { try { m.map = null; } catch (_) {} });
    appState.searchMarkers = [];

    // 5件（UI表示仕様）
    const slice = Array.isArray(places) ? places.slice(0, 5) : [];
    slice.forEach((p, i) => {
      const lat = p.location?.latitude;
      const lng = p.location?.longitude;
      const name = p.displayName?.text || '(名称不明)';
      const addr = p.formattedAddress || '';

      const item = document.createElement('div');
      item.className = 'result-item';
      item.innerHTML = `<div>${i + 1}. ${name}</div><div style="font-size:0.8em;opacity:0.7">${addr}</div>`;

      item.addEventListener('click', (ev) => {
        try { ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation(); } catch (_) {}
        if (!lock('result_click', 600)) return;
        if (typeof lat !== 'number' || typeof lng !== 'number') return;
        startNavigation({ name, lat, lng }).catch(() => {});
      }, { passive: false });

      resDiv.appendChild(item);

      if (typeof lat !== 'number' || typeof lng !== 'number') return;

      const pin = document.createElement('div');
      pin.style.cssText = 'width:24px;height:24px;background:#25d07a;border-radius:50%;color:#fff;text-align:center;line-height:24px;font-size:12px;font-weight:bold;border:2px solid #fff;';
      pin.textContent = String(i + 1);

      try {
        const m = new google.maps.marker.AdvancedMarkerElement({
          map: appState.map,
          position: { lat, lng },
          content: pin,
          title: name
        });
        appState.searchMarkers.push(m);
      } catch (_) {
        const m = new google.maps.Marker({
          map: appState.map,
          position: { lat, lng },
          label: String(i + 1)
        });
        appState.searchMarkers.push(m);
      }
    });

    // コンテナを確実にスクロール可能にする
    resDiv.style.overflowY = 'auto';
    resDiv.style.webkitOverflowScrolling = 'touch';
  }

  /* =========================
     Navigation
     ========================= */
  async function startNavigation(destination) {
    let originLat, originLng;

    if (appState.pointSearchMode && appState.searchPoint) {
      originLat = appState.searchPoint.lat;
      originLng = appState.searchPoint.lng;
      appState.isSimulation = true;
    } else if (appState.currentPos) {
      originLat = appState.currentPos.lat;
      originLng = appState.currentPos.lng;
      appState.isSimulation = false;
    } else {
      alertOnce('no_origin', '起点が取得できません');
      return;
    }

    appState.currentDestination = destination;
    appState.isNavigating = true;
    appState.isPaused = false;

    setDisplay('searchPanel', 'block');
    setDisplay('fabStack', 'flex');
    switchPanelTab('nav');
    setDisplay('routeControlSection', 'block');

    try {
      const response = await fetchWithRetry(`${WORKER_ORIGIN}/directions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin: `${originLat},${originLng}`,
          destination: `${destination.lat},${destination.lng}`,
          mode: 'walking',
          language: 'ja'
        })
      });
      if (!response.ok) throw new Error('Route API Error');

      const result = await response.json();
      if (!result.routes || result.routes.length === 0) {
        alertOnce('no_route', 'ルートが見つかりませんでした');
        stopNavigation();
        return;
      }

      const r0 = result.routes[0];
      const l0 = r0.legs ? r0.legs[0] : null;

      setText('destinationName', destination.name);
      if (l0?.distance?.text) setText('routeDistance', l0.distance.text);
      if (l0?.duration?.text) setText('routeTime', `徒歩 ${l0.duration.text}`);

      setDisplay('routeInfoSection', 'block');
      setDisplay('results', 'none');
      setDisplay('btnDestination', 'flex');

      const list = getEl('navPanelInstructions');
      if (list && l0?.steps) {
        list.innerHTML = '';
        l0.steps.forEach(step => {
          const d = document.createElement('div');
          d.className = 'nav-instruction-item';
          const inst = String(step.html_instructions || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          const dist = step.distance?.text || '';
          d.textContent = `${inst}${dist ? ` (${dist})` : ''}`;
          list.appendChild(d);
        });

        // 縦スクロール確保
        list.style.overflowY = 'auto';
        list.style.webkitOverflowScrolling = 'touch';
      }
      setDisplay('instructionsSection', 'block');

      appState.currentRouteData = { destinationName: destination.name, summary: r0.summary };

      if (!appState.isSimulation) startLocationWatcher();
      drawRoutePolyline(r0);

      const bounds = new google.maps.LatLngBounds();
      bounds.extend({ lat: originLat, lng: originLng });
      bounds.extend({ lat: destination.lat, lng: destination.lng });
      appState.map.fitBounds(bounds, { padding: 50 });

      setTimeout(updateScrollableHeights, 50);

    } catch (e) {
      console.error(e);
      alertOnce('route_fail', 'ルート検索エラー');
      stopNavigation();
    }
  }

  function stopNavigation() {
    stopLocationWatcher();
    appState.isNavigating = false;

    try { appState.currentPolyline?.setMap(null); } catch (_) {}
    appState.currentPolyline = null;

    setDisplay('routeInfoSection', 'none');
    setDisplay('instructionsSection', 'none');
    setDisplay('routeControlSection', 'none');
    setDisplay('btnDestination', 'none');

    setDisplay('fabStack', 'none');
    setDisplay('btnSearch', 'flex');

    const q = getEl('q');
    const results = getEl('results');
    if (q) q.value = '';
    if (results) results.innerHTML = '';
    setDisplay('results', 'none');

    switchPanelTab('search');

    if (appState.currentPos && appState.map) {
      appState.map.panTo(appState.currentPos);
      appState.map.setZoom(17);
    }

    setTimeout(updateScrollableHeights, 50);
  }

  /* =========================
     登録地：追加／編集（prompt/alert二重抑止）
     ========================= */
  function showSaveLocationDialog() {
    if (!lock('save_location', 1200)) return;

    if (!appState.currentPos) {
      alertOnce('no_pos', '現在地が取得できていません');
      return;
    }

    const address = getEl('locAddress')?.textContent || '現在地';
    const lat = appState.currentPos.lat;
    const lng = appState.currentPos.lng;

    const name = prompt('登録地名を入力してください:', address);

    // キャンセルで終了（再表示させない）
    if (name === null) return;

    const trimmed = String(name).trim();
    if (!trimmed) return;

    loadSavedLocations();

    appState.savedLocations.push({
      name: trimmed,
      address,
      lat,
      lng,
      timestamp: Date.now()
    });

    saveSavedLocations();

    // 登録後に再promptしない（alertOnce）
    alertOnce('saved_ok', `「${trimmed}」を登録しました`, 900);
  }

  function closeAnyEditOverlay() {
    const existing = document.querySelector('.edit-dialog-overlay');
    if (existing) safeRemove(existing);
    appState.isEditDialogOpen = false;
  }

  function showEditLocationDialog() {
    if (!lock('edit_location', 900)) return;

    try {
      loadSavedLocations();

      if (appState.savedLocations.length === 0) {
        alertOnce('no_saved_locations', '登録地がありません');
        return;
      }

      if (appState.isEditDialogOpen) return;
      appState.isEditDialogOpen = true;

      closeAnyEditOverlay();

      const overlay = document.createElement('div');
      overlay.className = 'edit-dialog-overlay';

      const dialog = document.createElement('div');
      dialog.className = 'edit-dialog';

      const title = document.createElement('h3');
      title.textContent = '編集する登録地を選択してください';
      dialog.appendChild(title);

      const list = document.createElement('div');
      list.className = 'edit-dialog-list';

      appState.savedLocations.forEach((loc, index) => {
        const item = document.createElement('div');
        item.className = 'edit-dialog-item';

        const itemTitle = document.createElement('div');
        itemTitle.className = 'edit-dialog-item-title';
        itemTitle.textContent = loc.name || '(名称未設定)';

        const itemSubtitle = document.createElement('div');
        itemSubtitle.className = 'edit-dialog-item-subtitle';
        itemSubtitle.textContent = loc.address || '';

        item.appendChild(itemTitle);
        item.appendChild(itemSubtitle);

        item.addEventListener('click', (ev) => {
          try { ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation(); } catch (_) {}
          if (!lock('edit_select', 600)) return;
          safeRemove(overlay);
          appState.isEditDialogOpen = false;
          showLocationEditMenu(index);
        }, { passive: false });

        list.appendChild(item);
      });

      dialog.appendChild(list);

      const btnClose = document.createElement('button');
      btnClose.className = 'edit-dialog-btn edit-dialog-btn-secondary';
      btnClose.type = 'button';
      btnClose.textContent = 'キャンセル';
      btnClose.addEventListener('click', (ev) => {
        try { ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation(); } catch (_) {}
        safeRemove(overlay);
        appState.isEditDialogOpen = false;
      }, { passive: false });

      dialog.appendChild(btnClose);

      overlay.appendChild(dialog);
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          safeRemove(overlay);
          appState.isEditDialogOpen = false;
        }
      });

      document.body.appendChild(overlay);
    } catch (e) {
      appState.isEditDialogOpen = false;
      console.error(e);
      alertOnce('edit_dialog_fail', '登録地編集ダイアログの表示に失敗しました');
    }
  }

  function showLocationEditMenu(index) {
    loadSavedLocations();
    const location = appState.savedLocations[index];
    if (!location) {
      alertOnce('no_target', '対象の登録地が見つかりません');
      return;
    }

    closeAnyEditOverlay();

    const overlay = document.createElement('div');
    overlay.className = 'edit-dialog-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'edit-dialog';

    const title = document.createElement('h3');
    title.textContent = `「${location.name || '(名称未設定)'}」を編集`;
    dialog.appendChild(title);

    const btnEdit = document.createElement('button');
    btnEdit.className = 'edit-dialog-btn edit-dialog-btn-primary';
    btnEdit.type = 'button';
    btnEdit.textContent = '修正';
    btnEdit.addEventListener('click', (ev) => {
      try { ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation(); } catch (_) {}
      safeRemove(overlay);
      showLocationEditForm(index);
    }, { passive: false });

    const btnDelete = document.createElement('button');
    btnDelete.className = 'edit-dialog-btn edit-dialog-btn-danger';
    btnDelete.type = 'button';
    btnDelete.textContent = '削除';
    btnDelete.addEventListener('click', (ev) => {
      try { ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation(); } catch (_) {}
      safeRemove(overlay);
      showLocationDeleteConfirm(index);
    }, { passive: false });

    const btnCancel = document.createElement('button');
    btnCancel.className = 'edit-dialog-btn edit-dialog-btn-secondary';
    btnCancel.type = 'button';
    btnCancel.textContent = 'キャンセル';
    btnCancel.addEventListener('click', (ev) => {
      try { ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation(); } catch (_) {}
      safeRemove(overlay);
      appState.isEditDialogOpen = false;
    }, { passive: false });

    dialog.appendChild(btnEdit);
    dialog.appendChild(btnDelete);
    dialog.appendChild(btnCancel);

    overlay.appendChild(dialog);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        safeRemove(overlay);
        appState.isEditDialogOpen = false;
      }
    });

    document.body.appendChild(overlay);
    appState.isEditDialogOpen = true;
  }

  function showLocationDeleteConfirm(index) {
    loadSavedLocations();
    const location = appState.savedLocations[index];
    if (!location) {
      alertOnce('no_target_del', '対象の登録地が見つかりません');
      return;
    }

    closeAnyEditOverlay();

    const overlay = document.createElement('div');
    overlay.className = 'edit-dialog-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'edit-dialog';

    const title = document.createElement('h3');
    title.textContent = 'この登録ポイントを削除しますか?';
    dialog.appendChild(title);

    const message = document.createElement('div');
    message.className = 'edit-dialog-message';
    message.textContent = `「${location.name || '(名称未設定)'}」`;
    dialog.appendChild(message);

    const btnGroup = document.createElement('div');
    btnGroup.className = 'edit-dialog-btn-group';

    const btnNo = document.createElement('button');
    btnNo.className = 'edit-dialog-btn edit-dialog-btn-secondary';
    btnNo.type = 'button';
    btnNo.textContent = 'いいえ';
    btnNo.addEventListener('click', (ev) => {
      try { ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation(); } catch (_) {}
      safeRemove(overlay);
      appState.isEditDialogOpen = false;
    }, { passive: false });

    const btnYes = document.createElement('button');
    btnYes.className = 'edit-dialog-btn edit-dialog-btn-danger';
    btnYes.type = 'button';
    btnYes.textContent = 'はい';
    btnYes.addEventListener('click', (ev) => {
      try { ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation(); } catch (_) {}
      appState.savedLocations.splice(index, 1);
      saveSavedLocations();
      safeRemove(overlay);
      appState.isEditDialogOpen = false;
      alertOnce('deleted_ok', '削除しました', 900);
    }, { passive: false });

    btnGroup.appendChild(btnNo);
    btnGroup.appendChild(btnYes);
    dialog.appendChild(btnGroup);

    overlay.appendChild(dialog);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        safeRemove(overlay);
        appState.isEditDialogOpen = false;
      }
    });

    document.body.appendChild(overlay);
    appState.isEditDialogOpen = true;
  }

  function showLocationEditForm(index) {
    loadSavedLocations();
    const location = appState.savedLocations[index];
    if (!location) {
      alertOnce('no_target_edit', '対象の登録地が見つかりません');
      return;
    }

    closeAnyEditOverlay();

    const overlay = document.createElement('div');
    overlay.className = 'edit-dialog-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'edit-dialog';

    const title = document.createElement('h3');
    title.textContent = '登録地名を修正';
    dialog.appendChild(title);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'edit-dialog-input';
    input.value = location.name || '';
    input.placeholder = '登録地名を入力';
    dialog.appendChild(input);

    const btnComplete = document.createElement('button');
    btnComplete.className = 'edit-dialog-btn edit-dialog-btn-primary';
    btnComplete.type = 'button';
    btnComplete.textContent = '完了';
    btnComplete.addEventListener('click', (ev) => {
      try { ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation(); } catch (_) {}
      const newName = input.value.trim();
      if (!newName) {
        alertOnce('name_required', '登録地名を入力してください');
        return;
      }
      location.name = newName;
      saveSavedLocations();
      safeRemove(overlay);
      appState.isEditDialogOpen = false;
      alertOnce('updated_ok', '更新しました', 900);
    }, { passive: false });

    const btnCancel = document.createElement('button');
    btnCancel.className = 'edit-dialog-btn edit-dialog-btn-secondary';
    btnCancel.type = 'button';
    btnCancel.textContent = 'キャンセル';
    btnCancel.addEventListener('click', (ev) => {
      try { ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation(); } catch (_) {}
      safeRemove(overlay);
      appState.isEditDialogOpen = false;
    }, { passive: false });

    dialog.appendChild(btnComplete);
    dialog.appendChild(btnCancel);

    overlay.appendChild(dialog);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        safeRemove(overlay);
        appState.isEditDialogOpen = false;
      }
    });

    document.body.appendChild(overlay);
    appState.isEditDialogOpen = true;

    setTimeout(() => input.focus(), 100);
  }

  /* =========================
     イベント：二重発火の根本対策
     ========================= */
  function bindReliableActivate(el, fn, lockKey) {
    if (!el) return;
    if (el.__wnBound) return;
    el.__wnBound = true;

    let last = 0;

    const run = (e) => {
      const now = Date.now();

      // pointer/touchの後に click が追撃してくる → click を黙らせる
      if (e && e.type === 'click' && (now - last) < 750) return;

      last = now;

      try {
        if (e && e.cancelable) e.preventDefault();
      } catch (_) {}

      try {
        if (e) {
          e.stopPropagation();
          e.stopImmediatePropagation();
        }
      } catch (_) {}

      // ボタン個別 lock（指定があれば）
      if (lockKey) {
        if (!lock(lockKey, 700)) return;
      }

      try {
        fn(e);
      } catch (err) {
        console.error(err);
        alertOnce('op_error', '操作の実行中にエラーが発生しました');
      }
    };

    el.addEventListener('touchend', run, { passive: false });
    el.addEventListener('pointerup', run, { passive: false });
    el.addEventListener('click', run, { passive: false });
  }

  function bindUI() {
    const inputQ = getEl('q');

    bindReliableActivate(getEl('btnSearchIcon'), () => performSearch(inputQ ? inputQ.value : ''), 'btn_search');
    if (inputQ) {
      inputQ.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') performSearch(inputQ.value);
      });
    }

    bindReliableActivate(getEl('btnReset'), () => {
      if (inputQ) inputQ.value = '';
      setDisplay('results', 'none');
      appState.pointSearchMode = false;
      const btnP = getEl('btnPointSearch');
      if (btnP) {
        btnP.textContent = '📍 ポイント選択';
        btnP.style.background = '';
        btnP.style.color = '';
      }
      setTimeout(updateScrollableHeights, 50);
    }, 'btn_reset');

    bindReliableActivate(getEl('btnLocatePanel'), () => acquireLocation(), 'btn_locate_panel');
    bindReliableActivate(getEl('btnLocate'), () => acquireLocation(), 'btn_locate');

    bindReliableActivate(getEl('btnClosePanel'), () => {
      setDisplay('searchPanel', 'none');
      setDisplay('fabStack', appState.isNavigating ? 'flex' : 'none');
    }, 'btn_close_panel');

    bindReliableActivate(getEl('btnSearch'), () => {
      setDisplay('searchPanel', 'block');
      setDisplay('fabStack', 'none');
      setTimeout(updateScrollableHeights, 50);
    }, 'btn_open_panel');

    bindReliableActivate(getEl('btnStopRoute'), () => stopNavigation(), 'btn_stop_route');

    bindReliableActivate(getEl('btnSaveLocation'), () => showSaveLocationDialog(), 'btn_save_loc');
    bindReliableActivate(getEl('btnEditLocation'), () => showEditLocationDialog(), 'btn_edit_loc');

    const btnPoint = getEl('btnPointSearch');
    if (btnPoint) {
      bindReliableActivate(btnPoint, () => {
        appState.pointSearchMode = !appState.pointSearchMode;
        btnPoint.textContent = appState.pointSearchMode ? '📍 選択中...' : '📍 ポイント選択';
        btnPoint.style.background = appState.pointSearchMode ? '#25d07a' : '';
        btnPoint.style.color = appState.pointSearchMode ? '#fff' : '';
      }, 'btn_point');
    }

    const btnMapPhoto = getEl('btnMapPhoto');
    const btnMapRoadmap = getEl('btnMapRoadmap');
    const btnMap3D = getEl('btnMap3D');
    if (btnMapPhoto) bindReliableActivate(btnMapPhoto, () => changeMapMode('photo'), 'btn_map_photo');
    if (btnMapRoadmap) bindReliableActivate(btnMapRoadmap, () => changeMapMode('roadmap'), 'btn_map_road');
    if (btnMap3D) bindReliableActivate(btnMap3D, () => changeMapMode('3d'), 'btn_map_3d');

    const r10 = getEl('r10');
    const r20 = getEl('r20');
    const r30 = getEl('r30');

    if (r10) bindReliableActivate(r10, () => {
      r10.classList.add('active');
      r20 && r20.classList.remove('active');
      r30 && r30.classList.remove('active');
      appState.searchRadiusMeters = 10000;
      setText('radiusLabel', '10km');
    }, 'radius_10');

    if (r20) bindReliableActivate(r20, () => {
      r20.classList.add('active');
      r10 && r10.classList.remove('active');
      r30 && r30.classList.remove('active');
      appState.searchRadiusMeters = 20000;
      setText('radiusLabel', '20km');
    }, 'radius_20');

    if (r30) bindReliableActivate(r30, () => {
      r30.classList.add('active');
      r10 && r10.classList.remove('active');
      r20 && r20.classList.remove('active');
      appState.searchRadiusMeters = 30000;
      setText('radiusLabel', '30km');
    }, 'radius_30');
  }

  function startApp() {
    console.log('[WalkNav] Starting app…', ISSUE_ID);

    applyUiFixes();

    setDisplay('searchPanel', 'block');
    setDisplay('fabStack', 'none');
    setDisplay('btnSearch', 'flex');

    loadSavedLocations();
    loadMapMode();
    bindUI();
    updateMapModeButtons(appState.mapMode);
    switchPanelTab('search');
    acquireLocation();
    startCompassListener();

    // 初回高さ調整
    setTimeout(updateScrollableHeights, 150);
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