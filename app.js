'use strict';

const ISSUE_ID = 'idx20251119_fix_loc_tsurugi_v5_all_fix_edit_button';
const API_KEY = 'AIzaSyBuX-4y1Cgl6jdKcHZWWlsoosDWK_RGqF0';
const WORKER_ORIGIN = 'https://ors-proxy.miyata-connect-jp.workers.dev';

const DEFAULT_MASK = 'places.displayName,places.formattedAddress,places.location,places.id,places.types';
const MAX_RETRY = 3;
const RETRY_DELAY = 1000;

const LOCATION_OPTIONS = {
  enableHighAccuracy: true,
  timeout: 15000,
  maximumAge: 0
};

const GEO_HARD_TIMEOUT_MS = 20000;

const SAVED_LOCATIONS_KEY = 'walknav_saved_locations';
const MAP_MODE_KEY = 'walknav_map_mode';

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

  // ★ 編集ダイアログ不動対策
  isEditDialogOpen: false,
  editOverlayEl: null,
  lastEditTapTs: 0,

  mapMode: 'roadmap',
  geoHardTimeoutId: null,

  // 検索半径（UIのチップに合わせる）
  searchRadiusM: 10000
};

function getEl(id) { return document.getElementById(id); }
function setDisplay(id, displayVal) { const el = getEl(id); if (el) el.style.display = displayVal; }
function setText(id, text) { const el = getEl(id); if (el) el.textContent = text; }

function removeLoadingIfAny() {
  const loadingEl = getEl('loading');
  if (loadingEl) loadingEl.remove();
}

function clearGeoHardTimeout() {
  if (appState.geoHardTimeoutId) {
    clearTimeout(appState.geoHardTimeoutId);
    appState.geoHardTimeoutId = null;
  }
}

function nowTs() { return Date.now(); }

function loadSavedLocations() {
  try {
    const saved = localStorage.getItem(SAVED_LOCATIONS_KEY);
    appState.savedLocations = saved ? JSON.parse(saved) : [];
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
  } catch (e) {
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

/* =========================
   fetch helpers
   ========================= */

async function fetchWithRetry(url, options = {}, retries = MAX_RETRY) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      if (!response.ok && i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (i + 1)));
        continue;
      }
      return response;
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (i + 1)));
    }
  }
}

async function readTextSafe(resp) {
  try { return await resp.text(); } catch (_) { return ''; }
}

function normalizeJapanAddressLabel(s) {
  if (!s) return '';
  return String(s).replace(/^日本、\s*/u, '').trim();
}

function pickFormattedAddressFromGeocodePayload(data) {
  const r0 = data?.results?.[0] || null;
  if (!r0) return '';
  return (r0.formatted_address || r0.formattedAddress || r0.address || '');
}

/**
 * CORSプリフライトで落ちやすいので、まず Content-Type のみで叩く→401/403のみキー付きで再試行
 */
async function postToWorker(path, payload, opt = {}) {
  const { fieldMask, tryApiKey = false, forceApiKey = false } = opt;

  const base = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(fieldMask ? { 'X-Goog-FieldMask': fieldMask } : {})
    },
    body: JSON.stringify(payload),
    cache: 'no-store'
  };

  if (!forceApiKey) {
    const r1 = await fetchWithRetry(`${WORKER_ORIGIN}${path}`, base);
    if (r1.ok) return await r1.json();

    const t1 = await readTextSafe(r1);
    console.warn('[Worker]', path, 'no-key failed:', r1.status, t1.slice(0, 240));

    if (!tryApiKey || (r1.status !== 401 && r1.status !== 403)) {
      throw new Error(`${path} ${r1.status}`);
    }
  }

  const withKey = {
    ...base,
    headers: {
      ...base.headers,
      'X-Goog-Api-Key': API_KEY
    }
  };

  const r2 = await fetchWithRetry(`${WORKER_ORIGIN}${path}`, withKey);
  if (!r2.ok) {
    const t2 = await readTextSafe(r2);
    console.warn('[Worker]', path, 'with-key failed:', r2.status, t2.slice(0, 240));
    throw new Error(`${path} ${r2.status}`);
  }
  return await r2.json();
}

async function placesTextSearch(payload, fieldMask) {
  payload.languageCode = 'ja';
  return await postToWorker('/places:searchText', payload, {
    fieldMask,
    tryApiKey: true,
    forceApiKey: false
  });
}

/* =========================
   Map
   ========================= */

function changeMapMode(mode) {
  if (!appState.map) return;

  saveMapMode(mode);

  if (mode === 'photo') {
    appState.map.setMapTypeId(google.maps.MapTypeId.SATELLITE);
  } else if (mode === '3d') {
    appState.map.setMapTypeId(google.maps.MapTypeId.HYBRID);
    appState.map.setTilt(45);
  } else {
    appState.map.setMapTypeId(google.maps.MapTypeId.ROADMAP);
    appState.map.setTilt(0);
  }

  updateMapModeButtons(mode);
}

function updateMapModeButtons(activeMode) {
  ['btnMapPhoto', 'btnMapRoadmap', 'btnMap3D'].forEach(btnId => {
    const btn = getEl(btnId);
    if (!btn) return;
    const mode = btn.dataset.mode;
    btn.classList.toggle('active', mode === activeMode);
  });
}

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
  } catch (e) {
    console.error('[WalkNav] Map initialization failed:', e);
    alert('地図の読み込みに失敗しました。APIキーの設定を確認してください。');
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
      ` <svg id="user-marker-icon" viewBox="0 0 24 24" style="width: 100%; height: 100%; transform: rotate(${appState.currentHeading}deg); transition: transform 0.2s ease-out; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4));">
          <path d="M12 2L4.5 20.5L12 16.5L19.5 20.5L12 2Z" fill="#3aa0ff" stroke="#ffffff" stroke-width="2" stroke-linejoin="round" />
        </svg>`;

    try {
      appState.userMarker = new google.maps.marker.AdvancedMarkerElement({
        map: appState.map,
        position: { lat, lng },
        content: pin,
        zIndex: 1000
      });
    } catch (e) {
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
  } catch (e) {
    appState.searchPointMarker = new google.maps.Marker({
      map: appState.map,
      position: { lat, lng },
      label: 'Target'
    });
  }
  fetchPointAddress(lat, lng);
}

/* =========================
   Reverse Geocode (current + point)
   ========================= */

function reverseGeocodeByMapsJS(lat, lng) {
  return new Promise((resolve, reject) => {
    try {
      if (!google?.maps?.Geocoder) return reject(new Error('No Geocoder'));
      const geocoder = new google.maps.Geocoder();
      geocoder.geocode({ location: { lat, lng } }, (results, status) => {
        if (status === 'OK' && results && results[0]) {
          resolve(results[0].formatted_address || '');
        } else {
          reject(new Error('Geocoder failed: ' + status));
        }
      });
    } catch (e) {
      reject(e);
    }
  });
}

async function fetchLocationNameGoogle(lat, lng) {
  setText('locCoords', `Lat: ${lat.toFixed(5)} / Lng: ${lng.toFixed(5)}`);

  const prev = getEl('locAddress')?.textContent || '';
  if (!prev.trim()) setText('locAddress', '住所取得中…');

  try {
    const data = await postToWorker('/geocode', {
      latlng: { lat, lng },
      language: 'ja'
    }, { tryApiKey: true, forceApiKey: false });

    const raw = pickFormattedAddressFromGeocodePayload(data);
    const addr = normalizeJapanAddressLabel(raw);
    if (addr) {
      setText('locAddress', addr);
      return;
    }
  } catch (e) {
    console.warn('[Geocode] worker failed:', e);
  }

  try {
    const raw2 = await reverseGeocodeByMapsJS(lat, lng);
    const addr2 = normalizeJapanAddressLabel(raw2);
    if (addr2) {
      setText('locAddress', addr2);
      return;
    }
  } catch (e2) {
    console.warn('[Geocode] mapsjs failed:', e2);
  }

  setText('locAddress', '住所取得失敗');
}

async function fetchPointAddress(lat, lng) {
  setText('pointAddress', '取得中…');
  setDisplay('pointAddressBlock', 'flex');
  setText('pointCoords', `Lat: ${lat.toFixed(5)}`);

  try {
    const data = await postToWorker('/geocode', {
      latlng: { lat, lng },
      language: 'ja'
    }, { tryApiKey: true, forceApiKey: false });

    const raw = pickFormattedAddressFromGeocodePayload(data);
    const addr = normalizeJapanAddressLabel(raw);
    if (addr) {
      setText('pointAddress', addr);
      return;
    }
    setText('pointAddress', '取得エラー');
  } catch (e) {
    setText('pointAddress', '取得エラー');
  }
}

/* =========================
   Search
   ========================= */

async function performSearch(query) {
  const q = (query || '').trim();
  if (!q) return;

  const center = (appState.pointSearchMode && appState.searchPoint)
    ? appState.searchPoint
    : (appState.currentPos || (appState.map ? appState.map.getCenter().toJSON() : null));

  if (!center) {
    alert('起点が取得できません');
    return;
  }

  try {
    const data = await placesTextSearch({
      textQuery: q,
      locationBias: {
        circle: {
          center: { latitude: center.lat, longitude: center.lng },
          radius: appState.searchRadiusM
        }
      },
      languageCode: 'ja'
    }, DEFAULT_MASK);

    const results = data.places || [];
    displayResults(results);
  } catch (e) {
    console.error('[Search] failed:', e);
    alert('検索に失敗しました');
  }
}

function displayResults(places) {
  const resDiv = getEl('results');
  if (!resDiv) return;

  resDiv.innerHTML = '';
  setDisplay('results', 'block');
  setDisplay('instructionsSection', 'none');

  appState.searchMarkers.forEach(m => m.map = null);
  appState.searchMarkers = [];

  places.forEach((p, i) => {
    if (i >= 5) return;

    const lat = p.location.latitude;
    const lng = p.location.longitude;

    const item = document.createElement('div');
    item.className = 'result-item';
    item.innerHTML =
      `<div>${i + 1}. ${p.displayName.text}</div>` +
      `<div style="font-size:0.8em;opacity:0.7">${p.formattedAddress}</div>`;
    item.onclick = () => startNavigation({ name: p.displayName.text, lat, lng });
    resDiv.appendChild(item);

    const pin = document.createElement('div');
    pin.style.cssText = 'width:24px;height:24px;background:#25d07a;border-radius:50%;color:#fff;text-align:center;line-height:24px;font-size:12px;font-weight:bold;border:2px solid #fff;';
    pin.textContent = i + 1;

    try {
      const m = new google.maps.marker.AdvancedMarkerElement({
        map: appState.map,
        position: { lat, lng },
        content: pin,
        title: p.displayName.text
      });
      appState.searchMarkers.push(m);
    } catch (e) {
      const m = new google.maps.Marker({
        map: appState.map,
        position: { lat, lng },
        label: (i + 1).toString()
      });
      appState.searchMarkers.push(m);
    }
  });
}

/* =========================
   Navigation / Route
   ========================= */

function readLegDistanceText(leg) {
  if (leg?.distance?.text) return leg.distance.text;
  return leg?.localizedValues?.distance?.text || '-';
}

function readLegDurationText(leg) {
  if (leg?.duration?.text) return leg.duration.text;
  if (typeof leg?.duration === 'string' && leg.duration.endsWith('s')) {
    const min = Math.max(1, Math.round(parseInt(leg.duration) / 60));
    return `${min} 分`;
  }
  return leg?.localizedValues?.duration?.text || '-';
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

  const path = google.maps.geometry.encoding.decodePath(encoded);
  appState.currentPolyline = new google.maps.Polyline({
    path,
    geodesic: true,
    strokeColor: '#62b5ff',
    strokeOpacity: 0.8,
    strokeWeight: 6,
    map: appState.map
  });
}

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
    alert('起点が取得できません');
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
    const result = await postToWorker('/directions', {
      origin: `${originLat},${originLng}`,
      destination: `${destination.lat},${destination.lng}`,
      mode: 'walking',
      language: 'ja'
    }, { tryApiKey: false, forceApiKey: false });

    if (result.routes && result.routes.length > 0) {
      const r0 = result.routes[0];
      const l0 = r0.legs ? r0.legs[0] : null;

      setText('destinationName', destination.name);
      setText('routeDistance', readLegDistanceText(l0));
      setText('routeTime', `徒歩 ${readLegDurationText(l0)}`);

      setDisplay('routeInfoSection', 'block');
      setDisplay('results', 'none');
      setDisplay('btnDestination', 'flex');

      const list = getEl('navPanelInstructions');
      if (list && l0.steps) {
        list.innerHTML = '';
        l0.steps.forEach(step => {
          const d = document.createElement('div');
          d.className = 'nav-instruction-item';
          d.textContent = `${step.html_instructions.replace(/<[^>]+>/g, ' ')} (${step.distance.text})`;
          list.appendChild(d);
        });
      }
      setDisplay('instructionsSection', 'block');

      if (!appState.isSimulation) startLocationWatcher();
      drawRoutePolyline(r0);

      const bounds = new google.maps.LatLngBounds();
      bounds.extend({ lat: originLat, lng: originLng });
      bounds.extend({ lat: destination.lat, lng: destination.lng });
      appState.map.fitBounds(bounds, { padding: 50 });
    } else {
      alert('ルートが見つかりませんでした');
      stopNavigation();
    }
  } catch (e) {
    console.error(e);
    alert('ルート検索エラー');
    stopNavigation();
  }
}

function stopNavigation() {
  stopLocationWatcher();
  appState.isNavigating = false;
  appState.currentPolyline?.setMap(null);

  setDisplay('routeInfoSection', 'none');
  setDisplay('instructionsSection', 'none');
  setDisplay('routeControlSection', 'none');
  setDisplay('btnDestination', 'none');
  setDisplay('fabStack', 'none');
  setDisplay('btnSearch', 'flex');

  const q = getEl('q');
  if (q) q.value = '';

  const results = getEl('results');
  if (results) results.innerHTML = '';
  setDisplay('results', 'none');

  switchPanelTab('search');
  if (appState.currentPos && appState.map) {
    appState.map.panTo(appState.currentPos);
    appState.map.setZoom(17);
  }
}

/* =========================
   Panel tabs
   ========================= */

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
}

/* =========================
   Location watcher
   ========================= */

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

/* =========================
   Acquire location
   ========================= */

function acquireLocation() {
  clearGeoHardTimeout();
  let completed = false;

  const onSuccess = (pos) => {
    if (completed) return;
    completed = true;
    clearGeoHardTimeout();

    const { latitude, longitude } = pos.coords;
    removeLoadingIfAny();

    if (!appState.mapInitialized) {
      initMap({ lat: latitude, lng: longitude });
    } else if (appState.map) {
      appState.map.setCenter({ lat: latitude, lng: longitude });
    }

    setUserMarker(latitude, longitude);
    fetchLocationNameGoogle(latitude, longitude);
  };

  const onError = (error) => {
    if (completed) return;
    completed = true;
    clearGeoHardTimeout();

    console.warn('[WalkNav] Geolocation error:', error);
    removeLoadingIfAny();

    const defaultPos = { lat: 34.0344, lng: 134.0577 };
    if (!appState.mapInitialized) initMap(defaultPos);

    setText('locAddress', '現在地取得失敗');
    setText('locCoords', (error && error.message) ? error.message : 'GPSエラー');
  };

  if (!navigator.geolocation) {
    onError({ message: 'Geolocation not supported' });
    return;
  }

  appState.geoHardTimeoutId = setTimeout(() => {
    onError({ message: '現在地取得がタイムアウトしました' });
  }, GEO_HARD_TIMEOUT_MS);

  try {
    navigator.geolocation.getCurrentPosition(onSuccess, onError, LOCATION_OPTIONS);
  } catch (e) {
    onError(e);
  }
}

/* =========================
   Compass
   ========================= */

function startCompassListener() {
  if (!window.DeviceOrientationEvent) return;

  const handler = (event) => {
    if (appState.isNavigating) return;
    const heading = event.webkitCompassHeading || (event.absolute ? event.alpha : null);
    if (heading !== null) {
      appState.currentHeading = heading;
      const icon = getEl('user-marker-icon');
      if (icon) icon.style.transform = `rotate(${heading}deg)`;
    }
  };

  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission().then(state => {
      if (state === 'granted') {
        window.addEventListener('deviceorientation', handler, true);
        appState.compassWatchId = 1;
      }
    }).catch(console.error);
  } else {
    window.addEventListener('deviceorientationabsolute', handler, true);
    window.addEventListener('deviceorientation', handler, true);
    appState.compassWatchId = 1;
  }
}

/* =========================
   Saved locations: Save / Edit / Delete
   ========================= */

function closeEditOverlayHard() {
  try {
    document.querySelectorAll('.edit-dialog-overlay').forEach(el => {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
  } catch (_) {}
  appState.editOverlayEl = null;
  appState.isEditDialogOpen = false;
}

function repairEditState() {
  // overlay DOMが無いのにフラグだけtrueが最大の「無反応」原因
  const overlay = document.querySelector('.edit-dialog-overlay');
  if (!overlay) {
    appState.isEditDialogOpen = false;
    appState.editOverlayEl = null;
  }
}

function shouldDedupeEditTap() {
  const ts = nowTs();
  if (ts - appState.lastEditTapTs < 700) return true; // touchend→click等の二重発火を抑止
  appState.lastEditTapTs = ts;
  return false;
}

function showSaveLocationDialog() {
  if (!appState.currentPos) {
    alert('現在地が取得できていません');
    return;
  }

  const address = getEl('locAddress')?.textContent || '現在地';
  const lat = appState.currentPos.lat;
  const lng = appState.currentPos.lng;

  const name = prompt('登録地名を入力してください:', address);
  if (!name) return;

  appState.savedLocations.push({
    name,
    address,
    lat,
    lng,
    timestamp: Date.now()
  });

  saveSavedLocations();
  alert(`「${name}」を登録しました`);
}

function showEditLocationDialog() {
  repairEditState();
  if (appState.isEditDialogOpen) closeEditOverlayHard();

  loadSavedLocations();
  if (appState.savedLocations.length === 0) {
    alert('登録地がありません');
    return;
  }

  appState.isEditDialogOpen = true;

  const overlay = document.createElement('div');
  overlay.className = 'edit-dialog-overlay';

  // 外側タップで閉じる
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeEditOverlayHard();
  }, { passive: true });

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
    itemTitle.textContent = loc.name;

    const itemSubtitle = document.createElement('div');
    itemSubtitle.className = 'edit-dialog-item-subtitle';
    itemSubtitle.textContent = loc.address;

    item.appendChild(itemTitle);
    item.appendChild(itemSubtitle);

    item.addEventListener('click', () => {
      closeEditOverlayHard();
      showLocationEditMenu(index);
    });

    list.appendChild(item);
  });

  dialog.appendChild(list);

  const btnClose = document.createElement('button');
  btnClose.className = 'edit-dialog-btn edit-dialog-btn-secondary';
  btnClose.textContent = 'キャンセル';
  btnClose.onclick = () => closeEditOverlayHard();

  dialog.appendChild(btnClose);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  appState.editOverlayEl = overlay;
}

function showLocationEditMenu(index) {
  loadSavedLocations();
  const location = appState.savedLocations[index];
  if (!location) return;

  closeEditOverlayHard();
  appState.isEditDialogOpen = true;

  const overlay = document.createElement('div');
  overlay.className = 'edit-dialog-overlay';
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeEditOverlayHard();
  }, { passive: true });

  const dialog = document.createElement('div');
  dialog.className = 'edit-dialog';

  const title = document.createElement('h3');
  title.textContent = `「${location.name}」を編集`;
  dialog.appendChild(title);

  const btnEdit = document.createElement('button');
  btnEdit.className = 'edit-dialog-btn edit-dialog-btn-primary';
  btnEdit.textContent = '修正';
  btnEdit.onclick = () => {
    closeEditOverlayHard();
    showLocationEditForm(index);
  };

  const btnDelete = document.createElement('button');
  btnDelete.className = 'edit-dialog-btn edit-dialog-btn-danger';
  btnDelete.textContent = '削除';
  btnDelete.onclick = () => {
    closeEditOverlayHard();
    showLocationDeleteConfirm(index);
  };

  const btnCancel = document.createElement('button');
  btnCancel.className = 'edit-dialog-btn edit-dialog-btn-secondary';
  btnCancel.textContent = 'キャンセル';
  btnCancel.onclick = () => closeEditOverlayHard();

  dialog.appendChild(btnEdit);
  dialog.appendChild(btnDelete);
  dialog.appendChild(btnCancel);

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  appState.editOverlayEl = overlay;
}

function showLocationDeleteConfirm(index) {
  loadSavedLocations();
  const location = appState.savedLocations[index];
  if (!location) return;

  closeEditOverlayHard();
  appState.isEditDialogOpen = true;

  const overlay = document.createElement('div');
  overlay.className = 'edit-dialog-overlay';
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeEditOverlayHard();
  }, { passive: true });

  const dialog = document.createElement('div');
  dialog.className = 'edit-dialog';

  const title = document.createElement('h3');
  title.textContent = 'この登録ポイントを削除しますか?';
  dialog.appendChild(title);

  const message = document.createElement('div');
  message.style.cssText = 'margin-bottom: 16px; opacity: 0.8;';
  message.textContent = `「${location.name}」`;
  dialog.appendChild(message);

  const btnGroup = document.createElement('div');
  btnGroup.className = 'edit-dialog-btn-group';

  const btnNo = document.createElement('button');
  btnNo.className = 'edit-dialog-btn edit-dialog-btn-secondary';
  btnNo.textContent = 'いいえ';
  btnNo.onclick = () => closeEditOverlayHard();

  const btnYes = document.createElement('button');
  btnYes.className = 'edit-dialog-btn edit-dialog-btn-danger';
  btnYes.textContent = 'はい';
  btnYes.onclick = () => {
    appState.savedLocations.splice(index, 1);
    saveSavedLocations();
    closeEditOverlayHard();
    alert('削除しました');
  };

  btnGroup.appendChild(btnNo);
  btnGroup.appendChild(btnYes);

  dialog.appendChild(btnGroup);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  appState.editOverlayEl = overlay;
}

function showLocationEditForm(index) {
  loadSavedLocations();
  const location = appState.savedLocations[index];
  if (!location) return;

  closeEditOverlayHard();
  appState.isEditDialogOpen = true;

  const overlay = document.createElement('div');
  overlay.className = 'edit-dialog-overlay';
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeEditOverlayHard();
  }, { passive: true });

  const dialog = document.createElement('div');
  dialog.className = 'edit-dialog';

  const title = document.createElement('h3');
  title.textContent = '登録地名を修正';
  dialog.appendChild(title);

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'edit-dialog-input';
  input.value = location.name;
  input.placeholder = '登録地名を入力';
  dialog.appendChild(input);

  const btnComplete = document.createElement('button');
  btnComplete.className = 'edit-dialog-btn edit-dialog-btn-primary';
  btnComplete.textContent = '完了';
  btnComplete.onclick = () => {
    const newName = input.value.trim();
    if (!newName) {
      alert('登録地名を入力してください');
      return;
    }
    location.name = newName;
    saveSavedLocations();
    closeEditOverlayHard();
    alert('更新しました');
  };

  const btnCancel = document.createElement('button');
  btnCancel.className = 'edit-dialog-btn edit-dialog-btn-secondary';
  btnCancel.textContent = 'キャンセル';
  btnCancel.onclick = () => closeEditOverlayHard();

  dialog.appendChild(btnComplete);
  dialog.appendChild(btnCancel);

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  appState.editOverlayEl = overlay;
  setTimeout(() => input.focus(), 100);
}

/* =========================
   ★Edit button router (最重要)
   - ID一致に加え、文字「登録地修正」一致でも拾う
   - iOSでclickが来ない/遅れる対策で touchend / pointerup / click すべて捕まえる
   - 透明オーバーレイ残骸があっても close→open で回復
   ========================= */

function isEditButtonTarget(t) {
  if (!t) return false;

  // 1) 典型ID
  const idHit =
    t.closest?.('#btnEditLocation') ||
    t.closest?.('#btnEditLocations') ||
    t.closest?.('#btnEditSavedLocation') ||
    t.closest?.('#btnEditSavedLocations') ||
    t.closest?.('[data-action="edit-location"]');

  if (idHit) return true;

  // 2) ボタン/要素の表示テキストで拾う（ID違いの保険）
  const btn = t.closest?.('button, a, div, span');
  if (!btn) return false;

  const txt = (btn.textContent || '').replace(/\s+/g, '');
  if (txt.includes('登録地修正')) return true;

  const aria = btn.getAttribute?.('aria-label') || '';
  if (aria.includes('登録地修正')) return true;

  return false;
}

function installEditButtonEventRouter() {
  const handler = (e) => {
    const t = e.target;
    if (!isEditButtonTarget(t)) return;

    if (e && typeof e.preventDefault === 'function') e.preventDefault();

    // 二重発火抑止
    if (shouldDedupeEditTap()) return;

    // ここで強制修復
    closeEditOverlayHard();
    showEditLocationDialog();
  };

  // captureで「上に被さった要素のせいで届かない」を回避（※完全には回避できないが最大限）
  document.addEventListener('touchend', handler, { passive: false, capture: true });
  document.addEventListener('pointerup', handler, { passive: false, capture: true });
  document.addEventListener('click', handler, { passive: false, capture: true });
}

/* =========================
   UI bind
   ========================= */

function bindUI() {
  const btnSearch = getEl('btnSearchIcon');
  const inputQ = getEl('q');

  const btnReset = getEl('btnReset');
  const btnLocate = getEl('btnLocatePanel');
  const btnClose = getEl('btnClosePanel');
  const btnFabSearch = getEl('btnSearch');
  const btnStop = getEl('btnStopRoute');

  if (btnSearch && inputQ) btnSearch.onclick = () => performSearch(inputQ.value);
  if (inputQ) inputQ.onkeypress = (e) => { if (e.key === 'Enter') performSearch(inputQ.value); };

  if (btnReset && inputQ) btnReset.onclick = () => {
    inputQ.value = '';
    setDisplay('results', 'none');
    appState.pointSearchMode = false;
    const btnP = getEl('btnPointSearch');
    if (btnP) {
      btnP.textContent = '📍 ポイント選択';
      btnP.style.background = '';
      btnP.style.color = '';
    }
  };

  if (btnLocate) btnLocate.onclick = () => acquireLocation();

  if (btnClose) btnClose.onclick = () => {
    setDisplay('searchPanel', 'none');
    setDisplay('fabStack', appState.isNavigating ? 'flex' : 'none');
  };

  if (btnFabSearch) btnFabSearch.onclick = () => {
    setDisplay('searchPanel', 'block');
    setDisplay('fabStack', 'none');
  };

  if (btnStop) btnStop.onclick = stopNavigation;

  // 保存は通常IDで直結（編集はrouter側で必ず拾うのでここは保険）
  const btnSaveLocation = getEl('btnSaveLocation');
  if (btnSaveLocation) btnSaveLocation.onclick = showSaveLocationDialog;

  const btnEditLocation = getEl('btnEditLocation');
  if (btnEditLocation) btnEditLocation.onclick = () => {
    closeEditOverlayHard();
    showEditLocationDialog();
  };

  const btnPoint = getEl('btnPointSearch');
  if (btnPoint) btnPoint.onclick = () => {
    appState.pointSearchMode = !appState.pointSearchMode;
    btnPoint.textContent = appState.pointSearchMode ? '📍 選択中...' : '📍 ポイント選択';
    btnPoint.style.background = appState.pointSearchMode ? '#25d07a' : '';
    btnPoint.style.color = appState.pointSearchMode ? '#fff' : '';
  };

  const btnMapPhoto = getEl('btnMapPhoto');
  const btnMapRoadmap = getEl('btnMapRoadmap');
  const btnMap3D = getEl('btnMap3D');

  if (btnMapPhoto) btnMapPhoto.onclick = () => changeMapMode('photo');
  if (btnMapRoadmap) btnMapRoadmap.onclick = () => changeMapMode('roadmap');
  if (btnMap3D) btnMap3D.onclick = () => changeMapMode('3d');

  const r10 = getEl('r10');
  const r20 = getEl('r20');
  const r30 = getEl('r30');

  if (r10) r10.onclick = () => {
    r10.classList.add('active');
    r20?.classList.remove('active');
    r30?.classList.remove('active');
    setText('radiusLabel', '10km');
    appState.searchRadiusM = 10000;
  };
  if (r20) r20.onclick = () => {
    r20.classList.add('active');
    r10?.classList.remove('active');
    r30?.classList.remove('active');
    setText('radiusLabel', '20km');
    appState.searchRadiusM = 20000;
  };
  if (r30) r30.onclick = () => {
    r30.classList.add('active');
    r10?.classList.remove('active');
    r20?.classList.remove('active');
    setText('radiusLabel', '30km');
    appState.searchRadiusM = 30000;
  };
}

/* =========================
   Start
   ========================= */

function startApp() {
  try {
    setDisplay('searchPanel', 'block');
    setDisplay('fabStack', 'none');
    setDisplay('btnSearch', 'flex');

    loadSavedLocations();
    loadMapMode();

    // ★ これが「編集ボタン不動」を最優先で直す根本
    installEditButtonEventRouter();

    bindUI();
    updateMapModeButtons(appState.mapMode);
    switchPanelTab('search');

    acquireLocation();
    startCompassListener();
  } catch (e) {
    console.error('[WalkNav] startApp fatal:', e);
    alert('初期化エラー（コンソールを確認）');
  }
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