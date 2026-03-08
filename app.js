'use strict';

/**

- WalkNav app.js - v84.10 (Ripple Effect User Marker)
- 修正内容:
- 1. setUserMarker() を波紋エフェクト付きマーカーに変更
- 1. PinElement の非推奨プロパティ 'glyph' を 'glyphText' に変更 (他の箇所)
   */

// ===============================================================================
// ▼▼▼ 設定エリア: ここに Map ID をコピペしてください ▼▼▼
// ===============================================================================
const CUSTOM_MAP_ID = '9110fb2763169e9d8f2b317e';
// ===============================================================================

const ISSUE_ID = 'idx20251220_v84_10_ripple_marker';
const API_KEY = 'AIzaSyBuX-4y1Cgl6jdKcHZWWlsoosDWK_RGqF0';
const WORKER_ORIGIN = 'https://ors-proxy.miyata-connect-jp.workers.dev';

const MAP_ID = CUSTOM_MAP_ID;

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
const FAB_POS_KEY = 'walknav_fab_pos';

const WN = (window.__WN_GLOBAL__ = window.__WN_GLOBAL__ || {
booted: false,
locks: Object.create(null),
alerts: Object.create(null)
});

/**

- 二重動作防止用ロック
  */
  function lock(key, ms) {
  const now = Date.now();
  if (now < (WN.locks[key] || 0)) return false;
  WN.locks[key] = now + ms;
  return true;
  }

/**

- 連続アラート防止用
  */
  function alertOnce(key, msg, ms = 1200) {
  const now = Date.now();
  if (now - (WN.alerts[key] || 0) < ms) return;
  WN.alerts[key] = now;
  alert(msg);
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
searchInfoWindows: [],
savedLocationMarkers: [],
currentDestination: null,
currentPolyline: null,
isNavigating: false,
locationWatchId: null,
compassWatchId: null,
currentHeading: 0,
isSimulation: false,
currentRouteData: null,
userProfile: {
luggage: 'None',
condition: 'Normal',
companion: 'None'
},
savedLocations: [],
mapMode: 'roadmap',
searchInFlight: false,
searchRadiusMeters: 10000, // デフォルト 10km
aiMode: 'normal',
incidentData: null,
cachedWeatherData: null,
lastFabSourceId: null,
fabPosition: { right: 12, bottom: 20 } // デフォルト位置
};

function getEl(id) { return document.getElementById(id); }
function setDisplay(id, displayVal) { const el = getEl(id); if (el) el.style.display = displayVal; }
function setText(id, text) { const el = getEl(id); if (el) el.textContent = text; }

function isPanelHiddenForce() {
const panel = getEl('searchPanel');
return !!(panel && panel.classList.contains('hidden-force'));
}

function isPanelOpen() {
const panel = getEl('searchPanel');
if (!panel) return false;
if (panel.classList.contains('hidden-force')) return false;
return !panel.classList.contains('collapsed');
}

function getActiveTabNameFromDOM() {
const paneSearch = getEl('tabPaneSearch');
const paneNav = getEl('tabPaneNav');
const paneSettings = getEl('tabPaneSettings');
if (paneSettings && paneSettings.classList.contains('active')) return 'settings';
if (paneNav && paneNav.classList.contains('active')) return 'nav';
if (paneSearch && paneSearch.classList.contains('active')) return 'search';
return 'search';
}

/* === FAB Logic === */
function getFabBtnIds() {
return ['btnSearchFab', 'btnLocateFab', 'btnDestFab', 'btnSettingsFab', 'btnNavFab', 'btnShareFab', 'btnStopFab'];
}

function setFabLabel(btnId, text, isClose = false) {
const btn = getEl(btnId);
if (!btn) return;
const label = btn.querySelector('.fab-label');
if (label) label.textContent = text;
btn.classList.toggle('is-close', !!isClose);
}

function restoreFabLabels() {
getFabBtnIds().forEach(id => {
const btn = getEl(id);
if (!btn) return;
const def = btn.getAttribute('data-label') || '';
if (def) setFabLabel(id, def, false);
else btn.classList.remove('is-close');
});
appState.lastFabSourceId = null;
}

function showCloseHintOn(btnId) {
restoreFabLabels();
setFabLabel(btnId, '閉じる', true);
appState.lastFabSourceId = btnId;
}

function updateFabVisibility() {
const fab = getEl('fabStack');
if (fab) {
fab.classList.remove('initial-hidden');
fab.style.display = 'flex';
fab.style.visibility = 'visible';
fab.style.opacity = '1';
}
}

/* — FAB Position Logic (v84.7+) — */
function loadSavedFabPosition() {
try {
const raw = localStorage.getItem(FAB_POS_KEY);
if (raw) {
const p = JSON.parse(raw);
if (typeof p.right === 'number' && typeof p.bottom === 'number') {
appState.fabPosition = p;
}
}
} catch (_) {}
applyFabPosition();
}

function saveFabPosition() {
localStorage.setItem(FAB_POS_KEY, JSON.stringify(appState.fabPosition));
applyFabPosition();
}

function applyFabPosition() {
const fab = getEl('fabStack');
if (fab) {
fab.style.right = appState.fabPosition.right + 'px';
fab.style.bottom = appState.fabPosition.bottom + 'px';
}
}

function adjustFabPosition(dx, dy) {
// dx: 右からの距離 (プラスで左へ移動), dy: 下からの距離
appState.fabPosition.right += dx;
appState.fabPosition.bottom += dy;

// 境界チェック (最小値)
if (appState.fabPosition.right < 0) appState.fabPosition.right = 0;
if (appState.fabPosition.bottom < 0) appState.fabPosition.bottom = 0;

saveFabPosition();

}

function togglePanel() {
const panel = getEl('searchPanel');
if (!panel) return;
panel.classList.toggle('collapsed');
if (!isPanelOpen()) restoreFabLabels();
}

function collapsePanel() {
const panel = getEl('searchPanel');
if (!panel) return;
panel.classList.add('collapsed');
restoreFabLabels();
}

function openPanel() {
const panel = getEl('searchPanel');
if (!panel) return;
panel.classList.remove('collapsed');
}

function switchPanelTab(mode) {
const panel = getEl('searchPanel');
const s = getEl('tabPaneSearch');
const n = getEl('tabPaneNav');
const st = getEl('tabPaneSettings');

if (s) s.classList.toggle('active', mode === 'search');
if (n) n.classList.toggle('active', mode === 'nav');
if (st) st.classList.toggle('active', mode === 'settings');

document.querySelectorAll('.tab-btn').forEach(b => {
  const t = b.getAttribute('data-panel-tab');
  b.classList.toggle('active', t === mode);
});

if (panel) panel.setAttribute('data-current-tab', mode);

}

function togglePanelFromFab(targetTab, sourceBtnId) {
if (isPanelHiddenForce()) return;
const open = isPanelOpen();
const active = getActiveTabNameFromDOM();
if (open && active === targetTab) {
collapsePanel();
return;
}
switchPanelTab(targetTab);
openPanel();
showCloseHintOn(sourceBtnId);
}

async function shareLocation() {
const target = appState.currentDestination || appState.currentPos;
if (!target) return alert('場所が特定されていません');

let lat, lng, name;
if (target.lat && target.lng) {
  lat = target.lat; lng = target.lng; name = target.name || '選択地点';
} else if (target.location) {
  lat = target.location.latitude; lng = target.location.longitude; name = target.displayName?.text || '地点';
} else {
  lat = appState.currentPos.lat; lng = appState.currentPos.lng; name = '現在地';
}

const url = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
const text = `WalkNav: ${name} ${url}`;

if (navigator.share) {
  try {
    await navigator.share({
      title: 'WalkNav 場所共有',
      text: text,
      url: url
    });
  } catch (e) {
    console.warn('Share canceled or failed', e);
  }
} else {
  // フォールバック: クリップボード
  const dummy = document.createElement('textarea');
  dummy.value = text;
  document.body.appendChild(dummy);
  dummy.select();
  document.execCommand('copy');
  document.body.removeChild(dummy);
  alert('共有リンクをクリップボードにコピーしました');
}

}

/* === Save/Load Logic === */
function loadSavedLocations() {
try {
const raw = localStorage.getItem(SAVED_LOCATIONS_KEY);
if (raw) appState.savedLocations = JSON.parse(raw);
} catch (_) {
appState.savedLocations = [];
}
if (appState.mapInitialized) refreshSavedMarkers();
}

function saveLocations() {
try {
localStorage.setItem(SAVED_LOCATIONS_KEY, JSON.stringify(appState.savedLocations));
renderSavedLocations();
refreshSavedMarkers();
} catch (e) {
alert('保存容量がいっぱいです。古い写真メモ等を削除してください。');
}
}

function addSavedLocation(name, lat, lng, address, imageData = null) {
const newItem = { name, lat, lng, address, timestamp: Date.now() };
if (imageData) {
newItem.image = imageData;
newItem.type = 'photo';
} else {
newItem.type = 'location';
}
appState.savedLocations.unshift(newItem);
saveLocations();
alert(imageData ? '写真を記録しました' : '場所を保存しました');
}

async function refreshSavedMarkers() {
if (!appState.map) return;
appState.savedLocationMarkers.forEach(m => m.map = null);
appState.savedLocationMarkers = [];

const { AdvancedMarkerElement, PinElement } = await google.maps.importLibrary("marker");

appState.savedLocations.forEach(loc => {
  const isPhoto = (loc.type === 'photo');
  // 修正: 'glyph' プロパティを非推奨警告に従い 'glyphText' へ変更
  const pin = new PinElement({
    glyphText: isPhoto ? '📷' : '★',
    background: isPhoto ? '#25d07a' : '#f59e0b',
    borderColor: '#ffffff',
  });

  const marker = new AdvancedMarkerElement({
    map: appState.map,
    position: { lat: loc.lat, lng: loc.lng },
    content: pin.element,
    title: loc.name
  });

  const infoDiv = document.createElement('div');
  infoDiv.className = 'info-window-content';
  
  const titleDiv = document.createElement('div');
  titleDiv.style.fontWeight = 'bold';
  titleDiv.style.marginBottom = '4px';
  titleDiv.textContent = loc.name;
  infoDiv.appendChild(titleDiv);

  const addrDiv = document.createElement('div');
  addrDiv.style.fontSize = '11px';
  addrDiv.style.color = '#666';
  addrDiv.style.marginBottom = '4px';
  addrDiv.textContent = loc.address || '';
  infoDiv.appendChild(addrDiv);

  if (loc.image) {
    const img = document.createElement('img');
    img.src = loc.image;
    img.style.maxWidth = '200px';
    img.style.maxHeight = '200px';
    img.style.display = 'block';
    img.style.borderRadius = '4px';
    img.style.marginTop = '4px';
    infoDiv.appendChild(img);
  }

  const navBtn = document.createElement('button');
  navBtn.textContent = 'ここへ行く';
  navBtn.style.marginTop = '8px';
  navBtn.style.padding = '4px 10px';
  navBtn.style.background = '#2563eb';
  navBtn.style.color = 'white';
  navBtn.style.border = 'none';
  navBtn.style.borderRadius = '4px';
  navBtn.onclick = () => startNavigation(loc);
  infoDiv.appendChild(navBtn);
  
  const infoWindow = new google.maps.InfoWindow({ content: infoDiv });
  
  marker.addListener('click', () => {
    appState.searchInfoWindows.forEach(w => w.close());
    infoWindow.open(appState.map, marker);
  });

  appState.savedLocationMarkers.push(marker);
});

}

function renderSavedLocations() {
let listContainer = getEl('savedSectionContainer');
if (!listContainer) return;
listContainer.innerHTML = '';
const section = document.createElement('div');
section.className = 'saved-section';
section.innerHTML = `<div class="nav-section-title">📂 保存した場所・メモ</div><div id="savedLocationsList"></div>`;
listContainer.appendChild(section);
const listEl = section.querySelector('#savedLocationsList');
if (appState.savedLocations.length === 0) {
listEl.innerHTML = '<div style="font-size:12px; color:#888; text-align:center;">保存された場所はありません</div>';
return;
}
appState.savedLocations.forEach((loc) => {
const item = document.createElement('div');
item.className = 'saved-item';
const icon = (loc.type === 'photo') ? '📸' : '📍';
item.innerHTML = `<div class="saved-info"> <div class="saved-name">${icon} ${loc.name}</div> <div class="saved-address">${loc.address || ''}</div> </div> <div style="font-size:20px; color:#555;">›</div>`;
item.onclick = () => {
startNavigation({ name: loc.name, lat: loc.lat, lng: loc.lng });
};
listEl.appendChild(item);
});
}

function handleCameraInput(e) {
const file = e.target.files[0];
if (!file) return;
let lat, lng;
if (appState.pointSearchMode && appState.searchPoint) {
lat = appState.searchPoint.lat;
lng = appState.searchPoint.lng;
} else if (appState.currentPos) {
lat = appState.currentPos.lat;
lng = appState.currentPos.lng;
} else {
alert('現在地が不明なため記録できません');
return;
}
const reader = new FileReader();
reader.onload = function(event) {
const img = new Image();
img.onload = function() {
const canvas = document.createElement('canvas');
const MAX_SIZE = 800;
let width = img.width;
let height = img.height;
if (width > height) {
if (width > MAX_SIZE) { height *= MAX_SIZE / width; width = MAX_SIZE; }
} else {
if (height > MAX_SIZE) { width *= MAX_SIZE / height; height = MAX_SIZE; }
}
canvas.width = width;
canvas.height = height;
const ctx = canvas.getContext('2d');
ctx.drawImage(img, 0, 0, width, height);
const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
const name = prompt('この写真のメモを入力:', '写真メモ');
if (name !== null) {
const addr = getEl('locAddress')?.textContent || '住所不明';
addSavedLocation(name || '無題の写真', lat, lng, addr, dataUrl);
}
e.target.value = '';
};
img.src = event.target.result;
};
reader.readAsDataURL(file);
}

function quickSearch(keyword) {
if (!appState.currentPos) return alert('現在地を取得してください');
const q = getEl('q');
if (q) {
q.value = keyword;
placesTextSearch(keyword, appState.currentPos.lat, appState.currentPos.lng)
.then(d => {
displayResults(d.places || []);
});
}
}

function openEditModal() {
const modal = getEl('editSavedModal');
const list = getEl('editModalList');
if (!modal || !list) return;
list.innerHTML = '';
if (appState.savedLocations.length === 0) {
list.innerHTML = '<div style="text-align:center; color:#888; margin-top:20px;">保存された場所はありません</div>';
} else {
appState.savedLocations.forEach((loc, idx) => {
const item = document.createElement('div');
item.className = 'edit-list-item';
item.innerHTML = `<div class="edit-item-inputs"> <input type="text" class="edit-input-name" value="${loc.name}" data-idx="${idx}"> <div class="edit-text-addr">${loc.type === 'photo' ? '📸 写真メモ' : ''} ${loc.address || '住所不明'}</div> </div> <button class="btn-delete-icon" data-delete-idx="${idx}" type="button">×</button>`;
list.appendChild(item);
});
list.querySelectorAll('.btn-delete-icon').forEach(btn => {
btn.onclick = (e) => {
e.target.closest('.edit-list-item').remove();
};
});
}
modal.style.display = 'flex';
}

function closeEditModal() {
const modal = getEl('editSavedModal');
if (modal) modal.style.display = 'none';
}

function saveEditModalChanges() {
const list = getEl('editModalList');
if (!list) return;
const newLocations = [];
const items = list.querySelectorAll('.edit-list-item');
items.forEach(item => {
const input = item.querySelector('.edit-input-name');
const idx = parseInt(input.dataset.idx);
const newName = input.value.trim();
if (newName) {
const original = appState.savedLocations[idx];
if (original) {
original.name = newName;
newLocations.push(original);
}
}
});
appState.savedLocations = newLocations;
saveLocations();
closeEditModal();
}

function loadUserProfile() {
try {
const raw = localStorage.getItem(PROFILE_KEY);
if (raw) appState.userProfile = JSON.parse(raw);
} catch (_) {}
}

/* === API Calls === */
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

async function fetchWeatherProxy(endpoint, lat, lng) {
try {
const resp = await fetchWithRetry(`${WORKER_ORIGIN}/${endpoint}`, {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ lat, lng, language: 'ja', units: 'metric' })
});
if (!resp.ok) throw new Error('Proxy Error');
return await resp.json();
} catch (e) { return null; }
}
async function fetchCurrentWeather(lat, lng) { return fetchWeatherProxy('weather', lat, lng); }
async function fetchForecast(lat, lng) { return fetchWeatherProxy('forecast', lat, lng); }

async function geocode(lat, lng) {
try {
const resp = await fetchWithRetry(`${WORKER_ORIGIN}/geocode`, {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ latlng: { lat, lng }, language: 'ja' })
});
if (!resp.ok) throw new Error('Worker Error');
return await resp.json();
} catch (e) {
// フォールバック
const resp = await fetchWithRetry(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&language=ja&key=${API_KEY}`);
return await resp.json();
}
}

async function fetchIncidentsAround(lat, lng) {
try {
const resp = await fetchWithRetry(`${WORKER_ORIGIN}/incidents`, {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ lat, lng, radiusKm: 10 })
});
const json = await resp.json();
const sec = getEl('incidentSection');
const box = getEl('incidentText');
if (sec && box) {
if (!json) { sec.style.display = 'none'; return; }
const parts = [];
if (json.traffic?.length) parts.push('交通:' + json.traffic.map(x => x.title).join(','));
if (json.events?.length) parts.push('事故:' + json.events.map(x => x.title).join(','));
sec.style.display = 'block';
box.textContent = parts.length ? parts.join(' / ') : '特になし';
}
} catch (_) {}
}

/* === Initialization === */
async function initMap(center) {
if (appState.map) {
appState.map.setCenter(center);
return;
}
const mapEl = getEl('map');
if (!mapEl) return;

try {
  const { Map } = await google.maps.importLibrary("maps");
  const { AdvancedMarkerElement, PinElement } = await google.maps.importLibrary("marker");

  appState.map = new Map(mapEl, {
    center,
    zoom: 17,
    gestureHandling: 'greedy',
    clickableIcons: true,
    disableDefaultUI: true,
    mapId: MAP_ID
  });

  appState.map.addListener('click', (e) => {
    if (appState.pointSearchMode && e.latLng) setSearchPoint(e.latLng.lat(), e.latLng.lng());
  });

  changeMapMode(appState.mapMode);
  appState.mapInitialized = true;
  refreshSavedMarkers();
  console.log('[WalkNav] Map initialized with ID:', MAP_ID);
} catch (e) {
  console.warn('Map Init Failed', e);
}

}

async function setUserMarker(lat, lng) {
appState.currentPos = { lat, lng };
if (!appState.map) return;

const { AdvancedMarkerElement } = await google.maps.importLibrary("marker");

// 波紋エフェクト付き現在地マーカー
const rippleContainer = document.createElement('div');
rippleContainer.className = 'user-ripple-container';
rippleContainer.innerHTML = `
  <div class="ripple-wave"></div>
  <div class="ripple-wave"></div>
  <div class="ripple-wave"></div>
  <div class="ripple-dot"></div>
`;

if (appState.userMarker) {
  appState.userMarker.position = { lat, lng };
} else {
  appState.userMarker = new AdvancedMarkerElement({
    map: appState.map,
    position: { lat, lng },
    content: rippleContainer
  });
}

}

async function setSearchPoint(lat, lng) {
appState.searchPoint = { lat, lng };
if (!appState.map) return;

const { AdvancedMarkerElement } = await google.maps.importLibrary("marker");

if (appState.searchPointMarker) {
  appState.searchPointMarker.map = null;
}

appState.searchPointMarker = new AdvancedMarkerElement({
  map: appState.map,
  position: { lat, lng },
  zIndex: 999
});

setText('pointAddress', '取得中…');
setDisplay('pointAddressBlock', 'flex');
setText('pointCoords', `Lat: ${lat.toFixed(6)}, Lng: ${lng.toFixed(6)}`);
geocode(lat, lng).then(d => {
  const addr = d.results?.[0]?.formatted_address ? d.results[0].formatted_address.replace(/^日本、\s*/, '') : '不明';
  setText('pointAddress', addr);
});

}

function acquireLocation() {
navigator.geolocation.getCurrentPosition(pos => {
const { latitude, longitude } = pos.coords;
getEl('loading')?.remove();
if (!appState.mapInitialized) {
initMap({ lat: latitude, lng: longitude });
} else {
appState.map.panTo({ lat: latitude, lng: longitude });
appState.map.setZoom(19);
}
setUserMarker(latitude, longitude);
const latStr = latitude.toFixed(5);
const lngStr = longitude.toFixed(5);
setText('locCoords', `📍 ${latStr}, ${lngStr}`);
geocode(latitude, longitude).then(d => {
const addr = d.results?.[0]?.formatted_address ? d.results[0].formatted_address.replace(/^日本、\s*/, '') : '';
setText('locAddress', addr);
});
updateAllWeatherUI(latitude, longitude);
}, () => {
getEl('loading')?.remove();
initMap({ lat: 35.0, lng: 135.0 });
}, LOCATION_OPTIONS);
}

function startLocationWatcher() {
if (appState.locationWatchId) navigator.geolocation.clearWatch(appState.locationWatchId);
appState.locationWatchId = navigator.geolocation.watchPosition(pos => {
setUserMarker(pos.coords.latitude, pos.coords.longitude);
if (appState.isNavigating && appState.map && !appState.pointSearchMode) {
appState.map.panTo({ lat: pos.coords.latitude, lng: pos.coords.longitude });
}
}, null, LOCATION_OPTIONS);
}

function renderRoute(route, destName) {
if (!route?.legs?.[0]) return;
const leg = route.legs[0];
const startName = leg.start_address ? leg.start_address.replace(/^日本、\s*/, '') : '現在地';
const title = appState.pointSearchMode ? `🚩 出発: ${startName}\n🏁 到着: ${destName}` : (destName || '目的地');

setText('destinationName', title);
setText('routeDistance', leg.distance?.text || '--');
setText('routeTime', `徒歩 ${leg.duration?.text || '--'}`);

const list = getEl('navPanelInstructions');
if (list) {
  list.innerHTML = '';
  (leg.steps || []).forEach(s => {
    const d = document.createElement('div');
    d.className = 'nav-instruction-item';
    d.textContent = (s.html_instructions || '').replace(/<[^>]+>/g, '') + (s.distance?.text ? ` (${s.distance.text})` : '');
    list.appendChild(d);
  });
}
setDisplay('instructionsSection', 'block');
if (appState.currentPolyline) appState.currentPolyline.setMap(null);
if (google.maps.geometry && route.overview_polyline?.points) {
  appState.currentPolyline = new google.maps.Polyline({
    path: google.maps.geometry.encoding.decodePath(route.overview_polyline.points),
    map: appState.map,
    strokeColor: '#62b5ff',
    strokeWeight: 6
  });
}
const b = new google.maps.LatLngBounds();
if (appState.currentPos) b.extend(appState.currentPos);
if (leg.end_location) b.extend(leg.end_location);
if (appState.map) appState.map.fitBounds(b, { padding: 50 });
setDisplay('routeInfoSection', 'block');

}

async function startNavigation(dest) {
if (!appState.currentPos) return;

const finalDestName = dest.name || '選択した場所';

let originLat, originLng;
if (appState.pointSearchMode && appState.searchPoint) {
  originLat = appState.searchPoint.lat;
  originLng = appState.searchPoint.lng;
} else {
  originLat = appState.currentPos.lat;
  originLng = appState.currentPos.lng;
}
appState.currentDestination = dest;
appState.isNavigating = true;
const panel = getEl('searchPanel');
if (panel) { panel.classList.add('collapsed'); panel.classList.add('hidden-force'); }
restoreFabLabels();
updateFabVisibility();
const fabNav = getEl('btnNavFab');
const fabSearch = getEl('btnSearchFab');
if (fabSearch) fabSearch.style.display = 'none';
if (fabNav) fabNav.style.display = 'flex';
setDisplay('routeControlSection', 'block');
setDisplay('results', 'none');
switchPanelTab('nav');
if (appState.map) {
  appState.map.panTo({ lat: dest.lat, lng: dest.lng });
  appState.map.setZoom(18);
}

fetchIncidentsAround(dest.lat, dest.lng);

try {
  const resp = await fetchWithRetry(`${WORKER_ORIGIN}/directions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      origin: `${originLat},${originLng}`,
      destination: `${dest.lat},${dest.lng}`,
      mode: 'walking',
      language: 'ja'
    })
  });
  const json = await resp.json();
  let chosen = { route: json.routes[0], index: 0 };
  if (window.RouteEvaluator?.pickBestRoute) chosen = window.RouteEvaluator.pickBestRoute(json.routes, appState.userProfile, appState.aiMode);
  appState.currentRouteData = { routes: json.routes, selectedIndex: chosen.index };
  renderRoute(chosen.route, finalDestName);
  startLocationWatcher();
} catch (e) {
  alertOnce('route_err', 'ルート取得失敗');
  stopNavigation();
}

}

function stopNavigation() {
if (appState.locationWatchId) navigator.geolocation.clearWatch(appState.locationWatchId);
appState.isNavigating = false;
if (appState.currentPolyline) appState.currentPolyline.setMap(null);
const panel = getEl('searchPanel');
if (panel) panel.classList.remove('hidden-force');
restoreFabLabels();
updateFabVisibility();
if(getEl('btnSearchFab')) getEl('btnSearchFab').style.display = 'flex';
setDisplay('routeControlSection', 'none');
setDisplay('instructionsSection', 'none');
setDisplay('routeInfoSection', 'none');
switchPanelTab('search');
openPanel();
if (appState.currentPos && appState.map) {
appState.map.panTo(appState.currentPos);
appState.map.setZoom(17);
}
}

function changeMapMode(mode) {
localStorage.setItem(MAP_MODE_KEY, mode);
appState.mapMode = mode;
if (appState.map) {
appState.map.setMapTypeId(
mode === 'photo' ? google.maps.MapTypeId.SATELLITE :
mode === '3d' ? google.maps.MapTypeId.HYBRID :
google.maps.MapTypeId.ROADMAP
);
appState.map.setTilt(mode === '3d' ? 45 : 0);
}
['btnMapPhoto', 'btnMapRoadmap', 'btnMap3D'].forEach(id => {
const el = getEl(id);
if(el) el.classList.toggle('active', el.dataset.mode === mode);
});
}

async function placesTextSearch(query, lat, lng) {
const payload = {
textQuery: query,
locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: appState.searchRadiusMeters } },
languageCode: 'ja'
};
try {
const resp = await fetchWithRetry(`${WORKER_ORIGIN}/places:searchText`, {
method: 'POST',
headers: { 'Content-Type': 'application/json', 'X-Goog-FieldMask': DEFAULT_MASK },
body: JSON.stringify(payload)
});
if (!resp.ok) throw new Error('Worker Error');
return await resp.json();
} catch (e) { return {}; }
}

async function updateAllWeatherUI(lat, lng) {
const [current, forecast] = await Promise.all([fetchCurrentWeather(lat, lng), fetchForecast(lat, lng)]);
const html = buildWeatherHtml(current, forecast);
const searchPane = getEl('tabPaneSearch');
if (searchPane) {
let wEl = getEl('weatherDisplaySearch');
if (!wEl) {
wEl = document.createElement('div');
wEl.id = 'weatherDisplaySearch';
const savedContainer = getEl('savedSectionContainer');
if (savedContainer && savedContainer.parentNode === searchPane) {
searchPane.insertBefore(wEl, savedContainer.nextSibling);
} else {
searchPane.appendChild(wEl);
}
}
wEl.innerHTML = html;
wEl.style.display = 'block';
}
const navPane = getEl('tabPaneNav');
if (navPane) {
let wEl = getEl('weatherDisplayNav');
if (!wEl) {
wEl = document.createElement('div');
wEl.id = 'weatherDisplayNav';
const locInfo = navPane.querySelector('.location-info');
if (locInfo && locInfo.parentNode) {
locInfo.parentNode.insertBefore(wEl, locInfo.nextSibling);
}
}
wEl.innerHTML = html;
wEl.style.display = 'block';
}
}

function buildWeatherHtml(current, forecast) {
if (!current) return '<div style="font-size:12px;color:#888;padding:8px;">☁️ 天気情報取得中…</div>';
const curIcon = `https://openweathermap.org/img/wn/${current.weather[0].icon}@2x.png`;
const curTemp = Math.round(current.main.temp);
const curDesc = current.weather[0].description;
let curPop = 0;
if (forecast && forecast.list && forecast.list[0]) curPop = Math.round(forecast.list[0].pop * 100);
let forecastItemsHtml = '';
if (forecast && forecast.list) {
for (let i = 1; i <= 3; i++) {
const item = forecast.list[i];
if (item) {
const fTime = `${i * 3}時間後`;
const fIcon = `https://openweathermap.org/img/wn/${item.weather[0].icon}.png`;
const fTemp = Math.round(item.main.temp);
const fPop = Math.round(item.pop * 100);
forecastItemsHtml += `<div class="weather-forecast-item"><span class="wf-time">${fTime}</span><img src="${fIcon}" class="wf-icon" alt=""><span class="wf-temp">${fTemp}℃</span><span class="wf-pop">${fPop}%</span></div>`;
}
}
}
return `<div class="weather-unified-card"><div class="weather-current-section"><img src="${curIcon}" class="weather-main-icon" alt="${curDesc}"><div class="weather-main-temp">${curTemp}℃</div><div class="weather-main-desc">${curDesc}</div><div class="weather-pop-badge">☂ ${curPop}%</div></div><div class="weather-forecast-row">${forecastItemsHtml}</div></div>`;
}

function bindPanelHeaderTabs() {
document.querySelectorAll('.tab-btn[data-panel-tab]').forEach(btn => {
btn.addEventListener('click', () => {
const tab = btn.getAttribute('data-panel-tab') || 'search';
if (isPanelHiddenForce()) return;
const open = isPanelOpen();
const active = getActiveTabNameFromDOM();
if (open && active === tab) { collapsePanel(); return; }
switchPanelTab(tab); openPanel(); restoreFabLabels();
});
});
}

function setSearchRadius(km) {
appState.searchRadiusMeters = km * 1000;
['r5', 'r10', 'r20'].forEach(id => {
const el = getEl(id);
if(el) el.classList.toggle('active', id === 'r' + km);
});
const label = getEl('radiusLabel');
if(label) label.textContent = km + 'km';
}

function bindUI() {
const btnSearchFab = getEl('btnSearchFab');
const btnLocateFab = getEl('btnLocateFab');
const btnNavFab = getEl('btnNavFab');
const btnSettingsFab = getEl('btnSettingsFab');
const btnStopFab = getEl('btnStopFab');
const btnShareFab = getEl('btnShareFab');

if (btnSearchFab) btnSearchFab.onclick = () => togglePanelFromFab('search', 'btnSearchFab');
if (btnSettingsFab) btnSettingsFab.onclick = () => togglePanelFromFab('settings', 'btnSettingsFab');
if (btnNavFab) btnNavFab.onclick = () => togglePanelFromFab('nav', 'btnNavFab');
if (btnLocateFab) btnLocateFab.onclick = acquireLocation;
if (btnStopFab) btnStopFab.onclick = stopNavigation;
if (btnShareFab) btnShareFab.onclick = shareLocation;

// 未バインド補完（マークダウン汚染で欠落していたもの）
const btnClosePanel = getEl('btnClosePanel');
const btnLocatePanel = getEl('btnLocatePanel');
const btnReset = getEl('btnReset');
const btnPointSearch = getEl('btnPointSearch');
const btnVoiceInput = getEl('btnVoiceInput');
const btnDestFab = getEl('btnDestFab');
const btnRouteNormal = getEl('btnRouteNormal');
const btnRouteAiShortest = getEl('btnRouteAiShortest');
const btnStopRoute = getEl('btnStopRoute');
const btnMapPhoto = getEl('btnMapPhoto');
const btnMapRoadmap = getEl('btnMapRoadmap');
const btnMap3D = getEl('btnMap3D');

if (btnClosePanel) btnClosePanel.onclick = collapsePanel;
if (btnLocatePanel) btnLocatePanel.onclick = acquireLocation;
if (btnReset) btnReset.onclick = () => {
  stopNavigation();
  appState.searchMarkers.forEach(m => m.map = null);
  appState.searchMarkers = [];
  appState.searchInfoWindows.forEach(w => w.close());
  appState.searchInfoWindows = [];
  const q = getEl('q');
  if (q) q.value = '';
  setDisplay('results', 'none');
};
if (btnPointSearch) btnPointSearch.onclick = () => {
  appState.pointSearchMode = !appState.pointSearchMode;
  if (btnPointSearch) {
    btnPointSearch.textContent = appState.pointSearchMode ? '✅ ポイント選択中（地図をタップ）' : '📍 ポイント選択';
    btnPointSearch.style.background = appState.pointSearchMode ? 'rgba(37,208,122,0.15)' : '';
  }
  if (!appState.pointSearchMode) {
    if (appState.searchPointMarker) { appState.searchPointMarker.map = null; appState.searchPointMarker = null; }
    appState.searchPoint = null;
    setDisplay('pointAddressBlock', 'none');
  }
};
if (btnVoiceInput) btnVoiceInput.onclick = () => {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) { alert('このブラウザは音声入力に対応していません'); return; }
  const recognition = new SpeechRecognition();
  recognition.lang = 'ja-JP';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  btnVoiceInput.style.opacity = '0.5';
  recognition.start();
  recognition.onresult = (e) => {
    const q = getEl('q');
    if (q) q.value = e.results[0][0].transcript;
    btnVoiceInput.style.opacity = '1';
  };
  recognition.onerror = () => { btnVoiceInput.style.opacity = '1'; };
  recognition.onend = () => { btnVoiceInput.style.opacity = '1'; };
};
if (btnDestFab) btnDestFab.onclick = () => {
  if (appState.currentDestination) {
    startNavigation(appState.currentDestination);
  }
};
if (btnRouteNormal) btnRouteNormal.onclick = () => {
  appState.aiMode = 'normal';
  if (appState.currentRouteData) {
    const chosen = window.RouteEvaluator?.pickBestRoute
      ? window.RouteEvaluator.pickBestRoute(appState.currentRouteData.routes, appState.userProfile, 'normal')
      : { route: appState.currentRouteData.routes[0], index: 0 };
    renderRoute(chosen.route, appState.currentDestination?.name || '目的地');
  }
  if (btnRouteNormal) btnRouteNormal.classList.add('active');
  if (btnRouteAiShortest) btnRouteAiShortest.classList.remove('active');
};
if (btnRouteAiShortest) btnRouteAiShortest.onclick = () => {
  appState.aiMode = 'ai_shortest';
  if (appState.currentRouteData) {
    const chosen = window.RouteEvaluator?.pickBestRoute
      ? window.RouteEvaluator.pickBestRoute(appState.currentRouteData.routes, appState.userProfile, 'ai_shortest')
      : { route: appState.currentRouteData.routes[0], index: 0 };
    renderRoute(chosen.route, appState.currentDestination?.name || '目的地');
  }
  if (btnRouteAiShortest) btnRouteAiShortest.classList.add('active');
  if (btnRouteNormal) btnRouteNormal.classList.remove('active');
};
if (btnStopRoute) btnStopRoute.onclick = stopNavigation;
if (btnMapPhoto) btnMapPhoto.onclick = () => changeMapMode('photo');
if (btnMapRoadmap) btnMapRoadmap.onclick = () => changeMapMode('roadmap');
if (btnMap3D) btnMap3D.onclick = () => changeMapMode('3d');

// ユーザープロファイルのセレクト変更
const selLuggage = getEl('userLuggage');
const selCondition = getEl('userCondition');
const selCompanion = getEl('userCompanion');
if (selLuggage) { selLuggage.value = appState.userProfile.luggage; selLuggage.onchange = () => { appState.userProfile.luggage = selLuggage.value; localStorage.setItem('walknav_user_profile', JSON.stringify(appState.userProfile)); }; }
if (selCondition) { selCondition.value = appState.userProfile.condition; selCondition.onchange = () => { appState.userProfile.condition = selCondition.value; localStorage.setItem('walknav_user_profile', JSON.stringify(appState.userProfile)); }; }
if (selCompanion) { selCompanion.value = appState.userProfile.companion; selCompanion.onchange = () => { appState.userProfile.companion = selCompanion.value; localStorage.setItem('walknav_user_profile', JSON.stringify(appState.userProfile)); }; }

const btnCamera = getEl('btnCamera');
const cameraInput = getEl('cameraInput');
if (btnCamera && cameraInput) {
  btnCamera.onclick = () => cameraInput.click();
  cameraInput.onchange = handleCameraInput;
}

if(getEl('btnSearchStation')) getEl('btnSearchStation').onclick = () => quickSearch('駅');
if(getEl('btnSearchBus')) getEl('btnSearchBus').onclick = () => quickSearch('バス停');
if(getEl('btnSearchTaxi')) getEl('btnSearchTaxi').onclick = () => quickSearch('タクシー乗り場');
if(getEl('btnSearchToilet')) getEl('btnSearchToilet').onclick = () => quickSearch('公衆トイレ コンビニ');
if(getEl('btnSearchConv')) getEl('btnSearchConv').onclick = () => quickSearch('コンビニ');
if(getEl('btnSearchWifi')) getEl('btnSearchWifi').onclick = () => quickSearch('Free Wi-Fi');

if(getEl('r5')) getEl('r5').onclick = () => setSearchRadius(5);
if(getEl('r10')) getEl('r10').onclick = () => setSearchRadius(10);
if(getEl('r20')) getEl('r20').onclick = () => setSearchRadius(20);

if (getEl('btnOpenEditModal')) getEl('btnOpenEditModal').onclick = openEditModal;
const ph = document.querySelector('.panel-handle-area');
if (ph) ph.onclick = togglePanel;

if (getEl('btnSearchIcon')) getEl('btnSearchIcon').onclick = () => {
    const q = getEl('q');
    if(!q) return;
    let lat = appState.currentPos ? appState.currentPos.lat : 0;
    let lng = appState.currentPos ? appState.currentPos.lng : 0;
    placesTextSearch(q.value, lat, lng).then(d => displayResults(d.places || []));
};

if (getEl('btnSaveCurrent')) getEl('btnSaveCurrent').onclick = handleSaveCurrentLocation;
if (getEl('btnSaveEdits')) getEl('btnSaveEdits').onclick = saveEditModalChanges;
if (getEl('btnCancelEdit')) getEl('btnCancelEdit').onclick = closeEditModal;

// FAB Position Control Bindings
const btnFabUp = getEl('btnFabUp');
const btnFabDown = getEl('btnFabDown');
const btnFabLeft = getEl('btnFabLeft');
const btnFabRight = getEl('btnFabRight');
const MOVE_STEP = 20;

if (btnFabUp) btnFabUp.onclick = () => adjustFabPosition(0, MOVE_STEP);
if (btnFabDown) btnFabDown.onclick = () => adjustFabPosition(0, -MOVE_STEP);
if (btnFabLeft) btnFabLeft.onclick = () => adjustFabPosition(MOVE_STEP, 0);
if (btnFabRight) btnFabRight.onclick = () => adjustFabPosition(-MOVE_STEP, 0);

bindPanelHeaderTabs();
updateFabVisibility();
restoreFabLabels();

}

function handleSaveCurrentLocation() {
if (!appState.currentPos) return alert('現在地が取得できていません');
const name = prompt('保存する名前を入力してください(例:自宅)');
if (!name) return;
const addr = getEl('locAddress')?.textContent || '現在地';
addSavedLocation(name, appState.currentPos.lat, appState.currentPos.lng, addr);
}

async function displayResults(places) {
const div = getEl('results');
if (!div) return;
div.innerHTML = '';
setDisplay('results', 'block');

appState.searchMarkers.forEach(m => m.map = null);
appState.searchMarkers = [];
appState.searchInfoWindows.forEach(w => w.close());
appState.searchInfoWindows = [];

const { AdvancedMarkerElement } = await google.maps.importLibrary("marker");

places.slice(0, 5).forEach((p, i) => {
  const item = document.createElement('div');
  item.className = 'result-item';
  item.innerHTML = `<div>${i + 1}. ${p.displayName?.text}</div><div style="font-size:0.8em;opacity:0.7">${p.formattedAddress || ''}</div>`;
  
  item.onclick = () => {
    startNavigation({ 
      name: p.displayName?.text || '名称不明', 
      lat: p.location.latitude, 
      lng: p.location.longitude 
    });
  };
  div.appendChild(item);

  const markerContent = document.createElement('div');
  markerContent.className = 'marker-container';
  markerContent.innerHTML = `
    <div class="marker-pin">${i + 1}</div>
    <div class="marker-label">${p.displayName?.text || '名称不明'}</div>
  `;

  const m = new AdvancedMarkerElement({
    map: appState.map,
    position: { lat: p.location.latitude, lng: p.location.longitude },
    content: markerContent,
    title: p.displayName?.text
  });

  m.addListener('click', () => {
    startNavigation({ 
      name: p.displayName?.text || '名称不明', 
      lat: p.location.latitude, 
      lng: p.location.longitude 
    });
  });

  appState.searchMarkers.push(m);
});

const panelBody = getEl('panelScrollContainer');
if(panelBody && div) {
  setTimeout(() => {
    openPanel();
    div.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);
}

}

function startApp() {
console.log('[WalkNav] Starting v84.10 (Ripple User Marker)…');
loadUserProfile();
loadSavedLocations();
loadSavedFabPosition();
bindUI();
renderSavedLocations();
appState.mapMode = localStorage.getItem(MAP_MODE_KEY) || 'roadmap';
switchPanelTab('search');
acquireLocation();
}

function initializeWhenReady() {
if (typeof google !== 'undefined' && google.maps && google.maps.Map) {
startApp();
} else {
setTimeout(initializeWhenReady, 200);
}
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeWhenReady);
else initializeWhenReady();
}