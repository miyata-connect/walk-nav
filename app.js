'use strict';

const ISSUE_ID = 'idx20251119_fix_loc_tsurugi_v5';
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
  geoHardTimeoutId: null,
  searchRadiusM: 10000,
  recognition: null,
  isRecognizing: false
};

function getEl(id) { return document.getElementById(id); }

function setDisplay(id, displayVal) {
  const el = document.getElementById(id);
  if (el) el.style.display = displayVal;
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function removeLoadingIfAny() {
  const el = getEl('loading');
  if (el) el.remove();
}

function clearGeoHardTimeout() {
  if (appState.geoHardTimeoutId) {
    clearTimeout(appState.geoHardTimeoutId);
    appState.geoHardTimeoutId = null;
  }
}

function bindClick(ids, handler) {
  ids.forEach((id) => {
    const el = getEl(id);
    if (!el) return;
    el.addEventListener('click', (e) => {
      if (e && typeof e.preventDefault === 'function') e.preventDefault();
      handler(e);
    }, { passive: false });
  });
}

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
  loadSavedLocations();

  if (appState.savedLocations.length === 0) {
    alert('登録地がありません');
    return;
  }

  if (appState.isEditDialogOpen) return;
  appState.isEditDialogOpen = true;

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
    itemTitle.textContent = loc.name;

    const itemSubtitle = document.createElement('div');
    itemSubtitle.className = 'edit-dialog-item-subtitle';
    itemSubtitle.textContent = loc.address;

    item.appendChild(itemTitle);
    item.appendChild(itemSubtitle);

    item.onclick = () => {
      document.body.removeChild(overlay);
      appState.isEditDialogOpen = false;
      showLocationEditMenu(index);
    };

    list.appendChild(item);
  });

  dialog.appendChild(list);

  const btnClose = document.createElement('button');
  btnClose.className = 'edit-dialog-btn edit-dialog-btn-secondary';
  btnClose.textContent = 'キャンセル';
  btnClose.onclick = () => {
    document.body.removeChild(overlay);
    appState.isEditDialogOpen = false;
  };

  dialog.appendChild(btnClose);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
}

function showLocationEditMenu(index) {
  const location = appState.savedLocations[index];

  const overlay = document.createElement('div');
  overlay.className = 'edit-dialog-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'edit-dialog';

  const title = document.createElement('h3');
  title.textContent = `「${location.name}」を編集`;
  dialog.appendChild(title);

  const btnEdit = document.createElement('button');
  btnEdit.className = 'edit-dialog-btn edit-dialog-btn-primary';
  btnEdit.textContent = '修正';
  btnEdit.onclick = () => {
    document.body.removeChild(overlay);
    showLocationEditForm(index);
  };

  const btnDelete = document.createElement('button');
  btnDelete.className = 'edit-dialog-btn edit-dialog-btn-danger';
  btnDelete.textContent = '削除';
  btnDelete.onclick = () => {
    document.body.removeChild(overlay);
    showLocationDeleteConfirm(index);
  };

  const btnCancel = document.createElement('button');
  btnCancel.className = 'edit-dialog-btn edit-dialog-btn-secondary';
  btnCancel.textContent = 'キャンセル';
  btnCancel.onclick = () => {
    document.body.removeChild(overlay);
    appState.isEditDialogOpen = false;
  };

  dialog.appendChild(btnEdit);
  dialog.appendChild(btnDelete);
  dialog.appendChild(btnCancel);

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
}

function showLocationDeleteConfirm(index) {
  const location = appState.savedLocations[index];

  const overlay = document.createElement('div');
  overlay.className = 'edit-dialog-overlay';

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
  btnNo.onclick = () => {
    document.body.removeChild(overlay);
    appState.isEditDialogOpen = false;
  };

  const btnYes = document.createElement('button');
  btnYes.className = 'edit-dialog-btn edit-dialog-btn-danger';
  btnYes.textContent = 'はい';
  btnYes.onclick = () => {
    appState.savedLocations.splice(index, 1);
    saveSavedLocations();
    document.body.removeChild(overlay);
    appState.isEditDialogOpen = false;
    alert('削除しました');
  };

  btnGroup.appendChild(btnNo);
  btnGroup.appendChild(btnYes);

  dialog.appendChild(btnGroup);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
}

function showLocationEditForm(index) {
  const location = appState.savedLocations[index];

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
    document.body.removeChild(overlay);
    appState.isEditDialogOpen = false;
    alert('更新しました');
  };

  const btnCancel = document.createElement('button');
  btnCancel.className = 'edit-dialog-btn edit-dialog-btn-secondary';
  btnCancel.textContent = 'キャンセル';
  btnCancel.onclick = () => {
    document.body.removeChild(overlay);
    appState.isEditDialogOpen = false;
  };

  dialog.appendChild(btnComplete);
  dialog.appendChild(btnCancel);

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  setTimeout(() => input.focus(), 100);
}

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

function baseHeaders(extra = {}) {
  return {
    'Content-Type': 'application/json',
    'X-Goog-Api-Key': API_KEY,
    ...extra
  };
}

async function placesTextSearch(payload, fieldMask) {
  payload.languageCode = 'ja';

  const resp = await fetchWithRetry(`${WORKER_ORIGIN}/places:searchText`, {
    method: 'POST',
    headers: baseHeaders(fieldMask ? { 'X-Goog-FieldMask': fieldMask } : {}),
    body: JSON.stringify(payload),
    cache: 'no-store'
  });

  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    console.error('[Places TextSearch] HTTP', resp.status, t);
    throw new Error(`TextSearch ${resp.status}`);
  }
  return await resp.json();
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
    pin.innerHTML = ` <svg id="user-marker-icon" viewBox="0 0 24 24" style="width: 100%; height: 100%; transform: rotate(${appState.currentHeading}deg); transition: transform 0.2s ease-out; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4));">
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
  const encoded = route?.overview_polyline?.points ||
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
    const response = await fetchWithRetry(`${WORKER_ORIGIN}/directions`, {
      method: 'POST',
      headers: baseHeaders(),
      body: JSON.stringify({
        origin: `${originLat},${originLng}`,
        destination: `${destination.lat},${destination.lng}`,
        mode: 'walking',
        language: 'ja'
      }),
      cache: 'no-store'
    });

    if (!response.ok) {
      const t = await response.text().catch(() => '');
      console.error('[Directions] HTTP', response.status, t);
      throw new Error('Route API Error');
    }

    const result = await response.json();

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

    setText('locAddress', '現在地取得失敗 (吉成鶴巻表示)');
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

async function fetchLocationNameGoogle(lat, lng) {
  setText('locCoords', `Lat: ${lat.toFixed(5)} / Lng: ${lng.toFixed(5)}`);
  try {
    const res = await fetchWithRetry(`${WORKER_ORIGIN}/geocode`, {
      method: 'POST',
      headers: baseHeaders(),
      body: JSON.stringify({
        latlng: { lat, lng },
        language: 'ja'
      }),
      cache: 'no-store'
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      console.error('[Geocode] HTTP', res.status, t);
      return;
    }
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
      headers: baseHeaders(),
      body: JSON.stringify({
        latlng: { lat, lng },
        language: 'ja'
      }),
      cache: 'no-store'
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      console.error('[Geocode(Point)] HTTP', res.status, t);
      setText('pointAddress', '取得エラー');
      return;
    }
    const data = await res.json();
    if (data.results?.[0]) {
      setText('pointAddress', data.results[0].formatted_address.replace(/^日本、\s*/, ''));
    }
  } catch (e) {
    setText('pointAddress', '取得エラー');
  }
}

async function performSearch(query) {
  if (!query) return;

  const input = getEl('q');
  if (input) input.blur();

  console.log('Search:', query);

  const center = (appState.pointSearchMode && appState.searchPoint)
    ? appState.searchPoint
    : (appState.currentPos || appState.map.getCenter().toJSON());

  try {
    const data = await placesTextSearch({
      textQuery: query,
      locationBias: {
        circle: {
          center: {
            latitude: center.lat,
            longitude: center.lng
          },
          radius: appState.searchRadiusM
        }
      },
      languageCode: 'ja'
    }, DEFAULT_MASK);

    const results = data.places || [];
    displayResults(results);
  } catch (e) {
    console.error(e);
    alert('検索に失敗しました');
  }
}

function displayResults(places) {
  const resDiv = getEl('results');
  if (!resDiv) return;

  resDiv.innerHTML = '';
  setDisplay('results', 'block');
  setDisplay('instructionsSection', 'none');

  appState.searchMarkers.forEach(m => { m.map = null; });
  appState.searchMarkers = [];

  places.forEach((p, i) => {
    if (i >= 5) return;

    const lat = p.location.latitude;
    const lng = p.location.longitude;

    const item = document.createElement('div');
    item.className = 'result-item';
    item.innerHTML = `<div>${i + 1}. ${p.displayName.text}</div><div style="font-size:0.8em;opacity:0.7">${p.formattedAddress}</div>`;
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

function initSpeechRecognition() {
  if (appState.recognition) return appState.recognition;

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;

  const rec = new SR();
  rec.lang = 'ja-JP';
  rec.interimResults = false;
  rec.maxAlternatives = 1;

  rec.onstart = () => {
    appState.isRecognizing = true;
    console.log('[Speech] start');
  };

  rec.onend = () => {
    appState.isRecognizing = false;
    console.log('[Speech] end');
  };

  rec.onerror = (e) => {
    appState.isRecognizing = false;
    console.error('[Speech] error', e);
    alert('音声入力に失敗しました');
  };

  rec.onresult = (e) => {
    const txt = e?.results?.[0]?.[0]?.transcript || '';
    const q = getEl('q');
    if (q) q.value = txt;
    if (txt) performSearch(txt);
  };

  appState.recognition = rec;
  return rec;
}

function startVoiceInput() {
  const rec = initSpeechRecognition();
  if (!rec) {
    alert('このブラウザはWeb音声入力に対応していません（iOS Safariは非対応のことがあります）。');
    return;
  }
  if (appState.isRecognizing) {
    try { rec.stop(); } catch (_) {}
    return;
  }
  try {
    rec.start();
  } catch (e) {
    console.error(e);
    alert('音声入力を開始できませんでした');
  }
}

function bindSearchAndMicBySelector() {
  document.addEventListener('click', (e) => {
    const t = e.target;

    // 検索アイコン（ID不明でも拾う）
    const searchHit =
      t?.closest?.('#btnSearchIcon') ||
      t?.closest?.('[data-action="search"]') ||
      t?.closest?.('.icon-search');

    if (searchHit) {
      e.preventDefault();
      const q = getEl('q');
      performSearch(q ? q.value : '');
      return;
    }

    // マイクアイコン（ID不明でも拾う）
    const micHit =
      t?.closest?.('#btnMic') ||
      t?.closest?.('#btnVoice') ||
      t?.closest?.('[data-action="mic"]') ||
      t?.closest?.('.icon-mic');

    if (micHit) {
      e.preventDefault();
      startVoiceInput();
      return;
    }
  }, { passive: false });
}

function bindUI() {
  const inputQ = getEl('q');

  if (inputQ) {
    inputQ.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') performSearch(inputQ.value);
    });
  }

  bindClick(['btnReset'], () => {
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

  bindClick(['btnLocatePanel'], () => acquireLocation());

  bindClick(['btnClosePanel'], () => {
    setDisplay('searchPanel', 'none');
    setDisplay('fabStack', appState.isNavigating ? 'flex' : 'none');
  });

  bindClick(['btnSearch'], () => {
    setDisplay('searchPanel', 'block');
    setDisplay('fabStack', 'none');
  });

  bindClick(['btnStopRoute'], () => stopNavigation());

  bindClick(['btnSaveLocation', 'btnSaveLocations'], () => showSaveLocationDialog());

  bindClick(
    ['btnEditLocation', 'btnEditLocations', 'btnEditSavedLocation', 'btnEditSavedLocations'],
    () => showEditLocationDialog()
  );

  const btnPoint = getEl('btnPointSearch');
  if (btnPoint) {
    btnPoint.addEventListener('click', (e) => {
      e.preventDefault();
      appState.pointSearchMode = !appState.pointSearchMode;
      btnPoint.textContent = appState.pointSearchMode ? '📍 選択中...' : '📍 ポイント選択';
      btnPoint.style.background = appState.pointSearchMode ? '#25d07a' : '';
      btnPoint.style.color = appState.pointSearchMode ? '#fff' : '';
    }, { passive: false });
  }

  bindClick(['btnMapPhoto'], () => changeMapMode('photo'));
  bindClick(['btnMapRoadmap'], () => changeMapMode('roadmap'));
  bindClick(['btnMap3D'], () => changeMapMode('3d'));

  const r10 = getEl('r10');
  const r20 = getEl('r20');
  const r30 = getEl('r30');

  if (r10) r10.addEventListener('click', (e) => {
    e.preventDefault();
    r10.classList.add('active');
    r20?.classList.remove('active');
    r30?.classList.remove('active');
    setText('radiusLabel', '10km');
    appState.searchRadiusM = 10000;
  }, { passive: false });

  if (r20) r20.addEventListener('click', (e) => {
    e.preventDefault();
    r20.classList.add('active');
    r10?.classList.remove('active');
    r30?.classList.remove('active');
    setText('radiusLabel', '20km');
    appState.searchRadiusM = 20000;
  }, { passive: false });

  if (r30) r30.addEventListener('click', (e) => {
    e.preventDefault();
    r30.classList.add('active');
    r10?.classList.remove('active');
    r20?.classList.remove('active');
    setText('radiusLabel', '30km');
    appState.searchRadiusM = 30000;
  }, { passive: false });

  // IDが分からないアイコンはセレクタで拾う
  bindSearchAndMicBySelector();
}

function startApp() {
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