'use strict';

const ISSUE_ID = 'idx20251202_fix_search_and_alert_once_v1';
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
  isEditDialogOpen: false,

  mapMode: 'roadmap',

  // ===== 検索の多重実行 & 多重アラート対策 =====
  searchInFlight: false,
  alertGuard: Object.create(null),

  // ===== 天気（既存のまま残す）=====
  weatherLastFetchAt: 0,
  weatherLastLat: null,
  weatherLastLng: null,

  // ===== 検索半径（UIに合わせる）=====
  searchRadiusM: 10000 // 10km
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

function safeRemove(el) {
  try {
    if (el && el.parentNode) el.parentNode.removeChild(el);
  } catch (_) {}
}

function alertOnce(message, cooldownMs = 1500) {
  const now = Date.now();
  const last = appState.alertGuard[message] || 0;
  if (now - last < cooldownMs) return;
  appState.alertGuard[message] = now;
  alert(message);
}

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
    appState.map.setTilt(0);
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
}

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

async function placesTextSearch(payload, fieldMask) {
  payload.languageCode = 'ja';
  const resp = await fetchWithRetry(`${WORKER_ORIGIN}/places:searchText`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(fieldMask ? { 'X-Goog-FieldMask': fieldMask } : {})
    },
    body: JSON.stringify(payload)
  });

  // ★ここで status / body を握っておく（原因調査が一気に楽になる）
  if (!resp.ok) {
    let t = '';
    try { t = await resp.text(); } catch (_) {}
    throw new Error(`TextSearch ${resp.status} ${t}`);
  }
  return await resp.json();
}

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
    alertOnce('地図の読み込みに失敗しました。APIキーの設定を確認してください。');
  }
}

function setUserMarker(lat, lng) {
  appState.currentPos = { lat, lng };
  if (!appState.map) return;

  if (!appState.userMarker) {
    const pin = document.createElement('div');
    pin.style.width = '32px';
    pin.style.height = '32px';
    pin.innerHTML = `\
<svg id="user-marker-icon" viewBox="0 0 24 24" style="width:100%;height:100%;transform:rotate(${appState.currentHeading}deg);transition:transform 0.2s ease-out;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.4));">\
<path d="M12 2L4.5 20.5L12 16.5L19.5 20.5L12 2Z" fill="#3aa0ff" stroke="#ffffff" stroke-width="2" stroke-linejoin="round" />\
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
    const res = await fetchWithRetry(`${WORKER_ORIGIN}/geocode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latlng: { lat, lng }, language: 'ja' })
    });
    const data = await res.json();
    if (data.results?.[0]) {
      setText('locAddress', data.results[0].formatted_address.replace(/^日本、\s*/, ''));
    }
  } catch (e) {
    console.error(e);
  }
}

async function fetchPointAddress(lat, lng) {
  setText('pointAddress', '取得中…');
  setDisplay('pointAddressBlock', 'flex');
  setText('pointCoords', `Lat: ${lat.toFixed(5)}`);

  try {
    const res = await fetchWithRetry(`${WORKER_ORIGIN}/geocode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latlng: { lat, lng }, language: 'ja' })
    });
    const data = await res.json();
    if (data.results?.[0]) {
      setText('pointAddress', data.results[0].formatted_address.replace(/^日本、\s*/, ''));
    }
  } catch (_) {
    setText('pointAddress', '取得エラー');
  }
}

async function performSearch(query) {
  const q = String(query || '').trim();
  if (!q) return;

  // ★検索の多重実行を完全に止める
  if (appState.searchInFlight) return;
  appState.searchInFlight = true;

  const center = appState.pointSearchMode && appState.searchPoint
    ? appState.searchPoint
    : (appState.currentPos || appState.map?.getCenter()?.toJSON());

  if (!center) {
    appState.searchInFlight = false;
    alertOnce('現在地が取得できていません');
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
    console.error('[SearchFail]', e);
    alertOnce('検索に失敗しました', 2000);
  } finally {
    appState.searchInFlight = false;
  }
}

function displayResults(places) {
  const resDiv = getEl('results');
  if (!resDiv) return;

  resDiv.innerHTML = '';
  setDisplay('results', 'block');

  appState.searchMarkers.forEach(m => { try { m.map = null; } catch (_) {} });
  appState.searchMarkers = [];

  places.forEach((p, i) => {
    if (i >= 5) return;

    const lat = p.location?.latitude;
    const lng = p.location?.longitude;
    const name = p.displayName?.text || '(名称不明)';
    const addr = p.formattedAddress || '';

    const item = document.createElement('div');
    item.className = 'result-item';
    item.innerHTML = `<div>${i + 1}. ${name}</div><div style="font-size:0.8em;opacity:0.7">${addr}</div>`;
    item.addEventListener('click', () => {
      if (typeof lat !== 'number' || typeof lng !== 'number') return;
      startNavigation({ name, lat, lng }).catch(() => {});
    });

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
    alertOnce('起点が取得できません');
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
      alertOnce('ルートが見つかりませんでした');
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
    }
    setDisplay('instructionsSection', 'block');

    appState.currentRouteData = { destinationName: destination.name, summary: r0.summary };

    if (!appState.isSimulation) startLocationWatcher();
    drawRoutePolyline(r0);

    const bounds = new google.maps.LatLngBounds();
    bounds.extend({ lat: originLat, lng: originLng });
    bounds.extend({ lat: destination.lat, lng: destination.lng });
    appState.map.fitBounds(bounds, { padding: 50 });

  } catch (e) {
    console.error(e);
    alertOnce('ルート検索エラー');
    stopNavigation();
  }
}

function stopNavigation() {
  stopLocationWatcher();
  appState.isNavigating = false;

  try {
    appState.currentPolyline?.setMap(null);
  } catch (_) {}
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
}

/* =========================
   登録地：追加／編集
   ========================= */

function showSaveLocationDialog() {
  if (!appState.currentPos) {
    alertOnce('現在地が取得できていません');
    return;
  }

  const address = getEl('locAddress')?.textContent || '現在地';
  const lat = appState.currentPos.lat;
  const lng = appState.currentPos.lng;

  const name = prompt('登録地名を入力してください:', address);
  if (!name) return;

  loadSavedLocations();
  appState.savedLocations.push({ name, address, lat, lng, timestamp: Date.now() });
  saveSavedLocations();
  alertOnce(`「${name}」を登録しました`, 800);
}

function closeAnyEditOverlay() {
  const existing = document.querySelector('.edit-dialog-overlay');
  if (existing) safeRemove(existing);
  appState.isEditDialogOpen = false;
}

function showEditLocationDialog() {
  try {
    loadSavedLocations();

    if (appState.savedLocations.length === 0) {
      alertOnce('登録地がありません', 1200);
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

      item.addEventListener('click', () => {
        safeRemove(overlay);
        appState.isEditDialogOpen = false;
        showLocationEditMenu(index);
      });

      list.appendChild(item);
    });

    dialog.appendChild(list);

    const btnClose = document.createElement('button');
    btnClose.className = 'edit-dialog-btn edit-dialog-btn-secondary';
    btnClose.type = 'button';
    btnClose.textContent = 'キャンセル';
    btnClose.addEventListener('click', () => {
      safeRemove(overlay);
      appState.isEditDialogOpen = false;
    });

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
    alertOnce('登録地編集ダイアログの表示に失敗しました');
  }
}

function showLocationEditMenu(index) {
  loadSavedLocations();
  const location = appState.savedLocations[index];
  if (!location) {
    alertOnce('対象の登録地が見つかりません');
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
  btnEdit.addEventListener('click', () => {
    safeRemove(overlay);
    showLocationEditForm(index);
  });

  const btnDelete = document.createElement('button');
  btnDelete.className = 'edit-dialog-btn edit-dialog-btn-danger';
  btnDelete.type = 'button';
  btnDelete.textContent = '削除';
  btnDelete.addEventListener('click', () => {
    safeRemove(overlay);
    showLocationDeleteConfirm(index);
  });

  const btnCancel = document.createElement('button');
  btnCancel.className = 'edit-dialog-btn edit-dialog-btn-secondary';
  btnCancel.type = 'button';
  btnCancel.textContent = 'キャンセル';
  btnCancel.addEventListener('click', () => {
    safeRemove(overlay);
    appState.isEditDialogOpen = false;
  });

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
    alertOnce('対象の登録地が見つかりません');
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
  btnNo.addEventListener('click', () => {
    safeRemove(overlay);
    appState.isEditDialogOpen = false;
  });

  const btnYes = document.createElement('button');
  btnYes.className = 'edit-dialog-btn edit-dialog-btn-danger';
  btnYes.type = 'button';
  btnYes.textContent = 'はい';
  btnYes.addEventListener('click', () => {
    appState.savedLocations.splice(index, 1);
    saveSavedLocations();
    safeRemove(overlay);
    appState.isEditDialogOpen = false;
    alertOnce('削除しました', 800);
  });

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
    alertOnce('対象の登録地が見つかりません');
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
  btnComplete.addEventListener('click', () => {
    const newName = input.value.trim();
    if (!newName) {
      alertOnce('登録地名を入力してください');
      return;
    }
    location.name = newName;
    saveSavedLocations();
    safeRemove(overlay);
    appState.isEditDialogOpen = false;
    alertOnce('更新しました', 800);
  });

  const btnCancel = document.createElement('button');
  btnCancel.className = 'edit-dialog-btn edit-dialog-btn-secondary';
  btnCancel.type = 'button';
  btnCancel.textContent = 'キャンセル';
  btnCancel.addEventListener('click', () => {
    safeRemove(overlay);
    appState.isEditDialogOpen = false;
  });

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
   タップ取りこぼし／二重発火対策（iOS Safari 決定版）
   - PointerEventがあるなら pointerup のみ
   - ない場合は touchend + click をガード
   ========================= */

function bindReliableActivate(el, fn) {
  if (!el) return;

  const hasPointer = ('PointerEvent' in window);
  let lastTs = 0;

  const run = (e) => {
    const now = Date.now();
    if (now - lastTs < 900) return; // ★click遅延対策で長めに
    lastTs = now;

    try { if (e && e.cancelable) e.preventDefault(); } catch (_) {}
    try { if (e && typeof e.stopPropagation === 'function') e.stopPropagation(); } catch (_) {}

    try {
      fn(e);
    } catch (err) {
      console.error(err);
      alertOnce('操作の実行中にエラーが発生しました', 1500);
    }
  };

  if (hasPointer) {
    el.addEventListener('pointerup', run);
  } else {
    el.addEventListener('touchend', run, { passive: false });
    el.addEventListener('click', run);
  }
}

function bindUI() {
  const inputQ = getEl('q');

  bindReliableActivate(getEl('btnSearchIcon'), () => performSearch(inputQ ? inputQ.value : ''));
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
  });

  bindReliableActivate(getEl('btnLocatePanel'), () => acquireLocation());
  bindReliableActivate(getEl('btnLocate'), () => acquireLocation());

  bindReliableActivate(getEl('btnClosePanel'), () => {
    setDisplay('searchPanel', 'none');
    setDisplay('fabStack', appState.isNavigating ? 'flex' : 'none');
  });

  bindReliableActivate(getEl('btnSearch'), () => {
    setDisplay('searchPanel', 'block');
    setDisplay('fabStack', 'none');
  });

  bindReliableActivate(getEl('btnStopRoute'), () => stopNavigation());

  bindReliableActivate(getEl('btnSaveLocation'), () => showSaveLocationDialog());
  bindReliableActivate(getEl('btnEditLocation'), () => showEditLocationDialog());

  const btnPoint = getEl('btnPointSearch');
  if (btnPoint) {
    bindReliableActivate(btnPoint, () => {
      appState.pointSearchMode = !appState.pointSearchMode;
      btnPoint.textContent = appState.pointSearchMode ? '📍 選択中...' : '📍 ポイント選択';
      btnPoint.style.background = appState.pointSearchMode ? '#25d07a' : '';
      btnPoint.style.color = appState.pointSearchMode ? '#fff' : '';
    });
  }

  const btnMapPhoto = getEl('btnMapPhoto');
  const btnMapRoadmap = getEl('btnMapRoadmap');
  const btnMap3D = getEl('btnMap3D');

  if (btnMapPhoto) bindReliableActivate(btnMapPhoto, () => changeMapMode('photo'));
  if (btnMapRoadmap) bindReliableActivate(btnMapRoadmap, () => changeMapMode('roadmap'));
  if (btnMap3D) bindReliableActivate(btnMap3D, () => changeMapMode('3d'));

  const r10 = getEl('r10');
  const r20 = getEl('r20');
  const r30 = getEl('r30');

  if (r10) bindReliableActivate(r10, () => {
    r10.classList.add('active');
    r20 && r20.classList.remove('active');
    r30 && r30.classList.remove('active');
    setText('radiusLabel', '10km');
    appState.searchRadiusM = 10000;
  });

  if (r20) bindReliableActivate(r20, () => {
    r20.classList.add('active');
    r10 && r10.classList.remove('active');
    r30 && r30.classList.remove('active');
    setText('radiusLabel', '20km');
    appState.searchRadiusM = 20000;
  });

  if (r30) bindReliableActivate(r30, () => {
    r30.classList.add('active');
    r10 && r10.classList.remove('active');
    r20 && r20.classList.remove('active');
    setText('radiusLabel', '30km');
    appState.searchRadiusM = 30000;
  });
}

function startApp() {
  console.log('[WalkNav] Starting app…', ISSUE_ID);

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