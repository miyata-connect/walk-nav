'use strict';

// WalkNav app.js - v86: UI binds before Google Maps load + Maps load failure handling
const ISSUE_ID = 'idx20251217_v86_ui_bind_before_maps';

const API_KEY = 'AIzaSyBuX-4y1Cgl6jdKcHZWWlsoosDWK_RGqF0';
const WORKER_ORIGIN = 'https://ors-proxy.miyata-connect-jp.workers.dev';

// Map ID は無効値だと表示不具合の要因になり得るため null 推奨（必要なら実MapIDを設定）
const MAP_ID = null;

const DEFAULT_MASK = 'places.displayName,places.formattedAddress,places.location,places.id,places.types';
const MAX_RETRY = 3;
const RETRY_DELAY = 1000;
const LOCATION_OPTIONS = { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 };

const SAVED_LOCATIONS_KEY = 'walknav_saved_locations';
const MAP_MODE_KEY = 'walknav_map_mode';
const PROFILE_KEY = 'walknav_user_profile';

const WN = (window.__WN_GLOBAL__ = window.__WN_GLOBAL__ || {
  booted: false,
  locks: Object.create(null),
  alerts: Object.create(null),
  mapsReady: false,
  mapsFailed: false
});

function lock(key, ms) {
  const now = Date.now();
  if (now < (WN.locks[key] || 0)) return false;
  WN.locks[key] = now + ms;
  return true;
}

function alertOnce(key, msg, ms = 1200) {
  const now = Date.now();
  if (now - (WN.alerts[key] || 0) < ms) return;
  WN.alerts[key] = now;
  alert(msg);
}

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

/* ======================
   App State
====================== */
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

  currentHeading: 0,
  isSimulation: false,
  currentRouteData: null,

  userProfile: { luggage: 'None', condition: 'Normal', companion: 'None' },
  savedLocations: [],

  mapMode: 'roadmap',
  searchRadiusMeters: 10000, // default 10km
  aiMode: 'normal',

  incidentData: null
};

/* ======================
   Maps load failure hooks
====================== */
window.gm_authFailure = function () {
  WN.mapsFailed = true;
  alertOnce('gm_auth', 'Google Mapsの認証に失敗しました。APIキーのリファラー制限・API有効化・Billingを確認してください。', 3000);
};

window.__WN_onMapsFail = function () {
  WN.mapsFailed = true;
  alertOnce('gm_load', 'Google Mapsの読み込みに失敗しました。ネットワーク・APIキー制限・API有効化を確認してください。', 3000);
};

/* ======================
   FAB
====================== */
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
}

function showCloseHintOn(btnId) {
  restoreFabLabels();
  setFabLabel(btnId, '閉じる', true);
}

function updateFabVisibility() {
  const fab = getEl('fabStack');
  if (!fab) return;
  fab.style.display = 'flex';
  fab.style.visibility = 'visible';
  fab.style.opacity = '1';
}

/* ======================
   Panel & Tabs
====================== */
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

/* ======================
   Storage: Saved Locations
====================== */
function loadSavedLocations() {
  try {
    const raw = localStorage.getItem(SAVED_LOCATIONS_KEY);
    if (raw) appState.savedLocations = JSON.parse(raw);
  } catch (_) {
    appState.savedLocations = [];
  }
  renderSavedLocations();
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

function renderSavedLocations() {
  const listContainer = getEl('savedSectionContainer');
  if (!listContainer) return;

  listContainer.innerHTML = '';
  const section = document.createElement('div');
  section.className = 'saved-section';
  section.innerHTML = `<div class="nav-section-title">📂 保存した場所・メモ</div><div id="savedLocationsList"></div>`;
  listContainer.appendChild(section);

  const listEl = section.querySelector('#savedLocationsList');
  if (!listEl) return;

  if (appState.savedLocations.length === 0) {
    listEl.innerHTML = '<div style="font-size:12px; color:#888; text-align:center;">保存された場所はありません</div>';
    return;
  }

  appState.savedLocations.forEach((loc) => {
    const item = document.createElement('div');
    item.className = 'saved-item';
    const icon = (loc.type === 'photo') ? '📸' : '📍';
    item.innerHTML =
      `<div class="saved-info">
         <div class="saved-name">${icon} ${escapeHtml(loc.name)}</div>
         <div class="saved-address">${escapeHtml(loc.address || '')}</div>
       </div>
       <div style="font-size:20px; color:#555;">›</div>`;

    item.onclick = () => startNavigation({ name: loc.name, lat: loc.lat, lng: loc.lng });
    listEl.appendChild(item);
  });
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

/* ======================
   Edit Modal
====================== */
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
      item.innerHTML =
        `<div class="edit-item-inputs">
           <input type="text" class="edit-input-name" value="${escapeHtml(loc.name)}" data-idx="${idx}">
           <div class="edit-text-addr">${loc.type === 'photo' ? '📸 写真メモ' : ''} ${escapeHtml(loc.address || '住所不明')}</div>
         </div>
         <button class="btn-delete-icon" data-delete-idx="${idx}" type="button">×</button>`;
      list.appendChild(item);
    });

    list.querySelectorAll('.btn-delete-icon').forEach(btn => {
      btn.onclick = (e) => {
        const row = e.target.closest('.edit-list-item');
        if (row) row.remove();
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
    if (!input) return;
    const idx = parseInt(input.dataset.idx, 10);
    const newName = (input.value || '').trim();
    if (!newName) return;

    const original = appState.savedLocations[idx];
    if (!original) return;
    original.name = newName;
    newLocations.push(original);
  });

  appState.savedLocations = newLocations;
  saveLocations();
  closeEditModal();
}

/* ======================
   Camera
====================== */
function handleCameraInput(e) {
  const file = e.target.files && e.target.files[0];
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
  reader.onload = function (event) {
    const img = new Image();
    img.onload = function () {
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
      if (!ctx) return;

      ctx.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
      const name = prompt('この写真のメモを入力:', '写真メモ');
      if (name !== null) {
        const addr = (getEl('locAddress') && getEl('locAddress').textContent) || '住所不明';
        addSavedLocation(name || '無題の写真', lat, lng, addr, dataUrl);
      }
      e.target.value = '';
    };
    img.src = event.target.result;
  };
  reader.readAsDataURL(file);
}

/* ======================
   User Profile
====================== */
function loadUserProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (raw) {
      appState.userProfile = JSON.parse(raw);
      const luggage = getEl('userLuggage');
      const condition = getEl('userCondition');
      const companion = getEl('userCompanion');
      if (luggage) luggage.value = appState.userProfile.luggage || 'None';
      if (condition) condition.value = appState.userProfile.condition || 'Normal';
      if (companion) companion.value = appState.userProfile.companion || 'None';
    }
  } catch (_) {}
}

function saveUserProfile() {
  const luggage = getEl('userLuggage');
  const condition = getEl('userCondition');
  const companion = getEl('userCompanion');

  if (luggage) appState.userProfile.luggage = luggage.value;
  if (condition) appState.userProfile.condition = condition.value;
  if (companion) appState.userProfile.companion = companion.value;

  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(appState.userProfile)); } catch (_) {}
}

/* ======================
   Network helpers
====================== */
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
  return null;
}

async function fetchWeatherProxy(endpoint, lat, lng) {
  try {
    const resp = await fetchWithRetry(`${WORKER_ORIGIN}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat, lng, language: 'ja', units: 'metric' })
    });
    if (!resp || !resp.ok) throw new Error('Proxy Error');
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
    if (!resp || !resp.ok) throw new Error('Worker Error');
    return await resp.json();
  } catch (e) {
    const resp = await fetchWithRetry(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&language=ja&key=${API_KEY}`);
    if (!resp) return {};
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
    if (!resp) return;
    const json = await resp.json();
    const sec = getEl('incidentSection');
    const box = getEl('incidentText');
    if (sec && box) {
      if (!json) { sec.style.display = 'none'; return; }
      const parts = [];
      if (json.traffic && json.traffic.length) parts.push('交通:' + json.traffic.map(x => x.title).join(','));
      if (json.events && json.events.length) parts.push('事故:' + json.events.map(x => x.title).join(','));
      sec.style.display = 'block';
      box.textContent = parts.length ? parts.join(' / ') : '特になし';
    }
  } catch (_) {}
}

/* ======================
   Weather UI
====================== */
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
      } else {
        navPane.appendChild(wEl);
      }
    }
    wEl.innerHTML = html;
    wEl.style.display = 'block';
  }
}

function buildWeatherHtml(current, forecast) {
  if (!current || !current.weather || !current.weather[0]) {
    return '<div style="font-size:12px;color:#888;padding:8px;">☁️ 天気情報取得中…</div>';
  }
  const curIcon = `https://openweathermap.org/img/wn/${current.weather[0].icon}@2x.png`;
  const curTemp = Math.round(current.main.temp);
  const curDesc = current.weather[0].description;

  let curPop = 0;
  if (forecast && forecast.list && forecast.list[0]) curPop = Math.round(forecast.list[0].pop * 100);

  let forecastItemsHtml = '';
  if (forecast && forecast.list) {
    for (let i = 1; i <= 3; i++) {
      const item = forecast.list[i];
      if (!item || !item.weather || !item.weather[0]) continue;
      const fTime = `${i * 3}時間後`;
      const fIcon = `https://openweathermap.org/img/wn/${item.weather[0].icon}.png`;
      const fTemp = Math.round(item.main.temp);
      const fPop = Math.round(item.pop * 100);
      forecastItemsHtml +=
        `<div class="weather-forecast-item">
          <span class="wf-time">${fTime}</span>
          <img src="${fIcon}" class="wf-icon" alt="">
          <span class="wf-temp">${fTemp}℃</span>
          <span class="wf-pop">${fPop}%</span>
        </div>`;
    }
  }

  return `<div class="weather-unified-card">
    <div class="weather-current-section">
      <img src="${curIcon}" class="weather-main-icon" alt="${escapeHtml(curDesc)}">
      <div class="weather-main-temp">${curTemp}℃</div>
      <div class="weather-main-desc">${escapeHtml(curDesc)}</div>
      <div class="weather-pop-badge">☂ ${curPop}%</div>
    </div>
    <div class="weather-forecast-row">${forecastItemsHtml}</div>
  </div>`;
}

/* ======================
   Search / Results
====================== */
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
    if (!resp || !resp.ok) throw new Error('Worker Error');
    return await resp.json();
  } catch (e) { return {}; }
}

async function displayResults(places) {
  const div = getEl('results');
  if (!div) return;

  div.innerHTML = '';
  setDisplay('results', 'block');

  // 旧マーカー掃除
  if (appState.searchMarkers && appState.searchMarkers.length) {
    appState.searchMarkers.forEach(m => { try { m.map = null; } catch (_) {} });
  }
  appState.searchMarkers = [];
  if (appState.searchInfoWindows && appState.searchInfoWindows.length) {
    appState.searchInfoWindows.forEach(w => { try { w.close(); } catch (_) {} });
  }
  appState.searchInfoWindows = [];

  const top = (places || []).slice(0, 5);
  top.forEach((p, i) => {
    const name = (p.displayName && p.displayName.text) ? p.displayName.text : '名称不明';
    const addr = p.formattedAddress || '';
    const lat = p.location && p.location.latitude;
    const lng = p.location && p.location.longitude;

    const item = document.createElement('div');
    item.className = 'result-item';
    item.innerHTML = `<div>${i + 1}. ${escapeHtml(name)}</div><div style="font-size:0.8em;opacity:0.7">${escapeHtml(addr)}</div>`;

    item.onclick = () => startNavigation({ name, lat, lng });
    div.appendChild(item);
  });

  // Maps が生きている場合だけ番号マーカー
  if (WN.mapsReady && appState.map && window.google && google.maps && google.maps.importLibrary) {
    try {
      const { AdvancedMarkerElement } = await google.maps.importLibrary('marker');
      top.forEach((p, i) => {
        if (!p.location) return;

        const markerContent = document.createElement('div');
        markerContent.className = 'marker-container';
        markerContent.innerHTML =
          `<div class="marker-pin">${i + 1}</div>
           <div class="marker-label">${escapeHtml((p.displayName && p.displayName.text) ? p.displayName.text : '名称不明')}</div>`;

        const m = new AdvancedMarkerElement({
          map: appState.map,
          position: { lat: p.location.latitude, lng: p.location.longitude },
          content: markerContent,
          title: (p.displayName && p.displayName.text) ? p.displayName.text : ''
        });

        m.addListener('click', () => {
          startNavigation({
            name: (p.displayName && p.displayName.text) ? p.displayName.text : '名称不明',
            lat: p.location.latitude,
            lng: p.location.longitude
          });
        });

        appState.searchMarkers.push(m);
      });
    } catch (_) {}
  }

  const panelBody = getEl('panelScrollContainer');
  if (panelBody) {
    setTimeout(() => {
      openPanel();
      div.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  }
}

function quickSearch(keyword) {
  if (!appState.currentPos) return alert('現在地を取得してください');
  const q = getEl('q');
  if (!q) return;
  q.value = keyword;
  placesTextSearch(keyword, appState.currentPos.lat, appState.currentPos.lng)
    .then(d => displayResults(d.places || []));
}

/* ======================
   Point select mode
====================== */
function togglePointSearchMode() {
  appState.pointSearchMode = !appState.pointSearchMode;
  const btn = getEl('btnPointSearch');

  if (appState.pointSearchMode) {
    if (btn) {
      btn.textContent = '✓ ポイント選択中（地図をタップ）';
      btn.style.background = 'rgba(37, 208, 122, 0.2)';
      btn.style.borderColor = '#25d07a';
      btn.style.color = '#25d07a';
    }
    alert('地図上の任意の場所をタップしてポイントを選択してください');
  } else {
    if (btn) {
      btn.textContent = '📍 ポイント選択';
      btn.style.background = '';
      btn.style.borderColor = '';
      btn.style.color = '';
    }
    if (appState.searchPointMarker) {
      try { appState.searchPointMarker.map = null; } catch (_) {}
      appState.searchPointMarker = null;
    }
    appState.searchPoint = null;
    setDisplay('pointAddressBlock', 'none');
  }
}

/* ======================
   Reset
====================== */
function resetApp() {
  const resultsDiv = getEl('results');
  if (resultsDiv) {
    resultsDiv.innerHTML = '';
    resultsDiv.style.display = 'none';
  }

  if (appState.searchMarkers && appState.searchMarkers.length) {
    appState.searchMarkers.forEach(m => { try { m.map = null; } catch (_) {} });
  }
  appState.searchMarkers = [];
  if (appState.searchInfoWindows && appState.searchInfoWindows.length) {
    appState.searchInfoWindows.forEach(w => { try { w.close(); } catch (_) {} });
  }
  appState.searchInfoWindows = [];

  if (appState.pointSearchMode) togglePointSearchMode();

  const searchInput = getEl('q');
  if (searchInput) searchInput.value = '';

  alert('リセットしました');
}

/* ======================
   Maps core
====================== */
async function initMap(center) {
  if (!WN.mapsReady) return;

  if (appState.map) {
    appState.map.setCenter(center);
    return;
  }

  const mapEl = getEl('map');
  if (!mapEl) return;

  try {
    const { Map } = await google.maps.importLibrary('maps');
    await google.maps.importLibrary('marker');

    const opts = {
      center,
      zoom: 17,
      gestureHandling: 'greedy',
      clickableIcons: true,
      disableDefaultUI: true
    };
    if (MAP_ID) opts.mapId = MAP_ID;

    appState.map = new Map(mapEl, opts);

    appState.map.addListener('click', (e) => {
      if (appState.pointSearchMode && e.latLng) {
        setSearchPoint(e.latLng.lat(), e.latLng.lng());
      }
    });

    changeMapMode(appState.mapMode);
    appState.mapInitialized = true;
    refreshSavedMarkers();

    console.log('[WalkNav] Map initialized v86');
  } catch (e) {
    console.warn('Map Init Failed', e);
  }
}

async function setUserMarker(lat, lng) {
  appState.currentPos = { lat, lng };
  if (!WN.mapsReady || !appState.map) return;

  try {
    const { AdvancedMarkerElement, PinElement } = await google.maps.importLibrary('marker');
    if (appState.userMarker) {
      appState.userMarker.position = { lat, lng };
    } else {
      const pin = new PinElement({
        glyph: '',
        background: '#3aa0ff',
        borderColor: '#ffffff',
        scale: 1.2
      });
      appState.userMarker = new AdvancedMarkerElement({
        map: appState.map,
        position: { lat, lng },
        content: pin.element
      });
    }
  } catch (_) {}
}

async function setSearchPoint(lat, lng) {
  appState.searchPoint = { lat, lng };

  setText('pointAddress', '取得中…');
  setDisplay('pointAddressBlock', 'flex');
  setText('pointCoords', `Lat: ${lat.toFixed(6)}, Lng: ${lng.toFixed(6)}`);

  if (WN.mapsReady && appState.map) {
    try {
      const { AdvancedMarkerElement } = await google.maps.importLibrary('marker');
      if (appState.searchPointMarker) {
        try { appState.searchPointMarker.map = null; } catch (_) {}
      }
      appState.searchPointMarker = new AdvancedMarkerElement({
        map: appState.map,
        position: { lat, lng },
        zIndex: 999
      });
    } catch (_) {}
  }

  geocode(lat, lng).then(d => {
    const addr = (d.results && d.results[0] && d.results[0].formatted_address)
      ? d.results[0].formatted_address.replace(/^日本、\s*/, '')
      : '不明';
    setText('pointAddress', addr);
  });
}

function acquireLocation() {
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { latitude, longitude } = pos.coords;

      const loading = getEl('loading');
      if (loading) loading.remove();

      // 住所・表示は Maps が死んでいても更新する
      appState.currentPos = { lat: latitude, lng: longitude };
      setText('locCoords', `📍 ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);

      geocode(latitude, longitude).then(d => {
        const addr = (d.results && d.results[0] && d.results[0].formatted_address)
          ? d.results[0].formatted_address.replace(/^日本、\s*/, '')
          : '';
        setText('locAddress', addr);
      });

      updateAllWeatherUI(latitude, longitude);
      fetchIncidentsAround(latitude, longitude);

      // Maps が準備できていれば地図も更新
      if (WN.mapsReady) {
        if (!appState.mapInitialized) {
          await initMap({ lat: latitude, lng: longitude });
        } else if (appState.map) {
          appState.map.panTo({ lat: latitude, lng: longitude });
          appState.map.setZoom(19);
        }
        await setUserMarker(latitude, longitude);
      } else if (WN.mapsFailed) {
        // すでに失敗確定なら通知
        alertOnce('maps_dead', '地図が読み込めていないため、地図操作は利用できません。', 2500);
      }
    },
    async () => {
      const loading = getEl('loading');
      if (loading) loading.remove();

      // Maps が準備できれば日本中心で初期化
      if (WN.mapsReady) {
        await initMap({ lat: 35.0, lng: 135.0 });
      } else {
        alertOnce('geo_fail', '現在地の取得に失敗しました。位置情報の許可を確認してください。', 2500);
      }
    },
    LOCATION_OPTIONS
  );
}

function startLocationWatcher() {
  if (appState.locationWatchId) navigator.geolocation.clearWatch(appState.locationWatchId);
  appState.locationWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      appState.currentPos = { lat, lng };
      setText('locCoords', `📍 ${lat.toFixed(5)}, ${lng.toFixed(5)}`);

      setUserMarker(lat, lng);

      if (appState.isNavigating && appState.map && !appState.pointSearchMode) {
        try { appState.map.panTo({ lat, lng }); } catch (_) {}
      }
    },
    null,
    LOCATION_OPTIONS
  );
}

/* ======================
   Navigation
====================== */
function renderRoute(route, destName) {
  if (!route || !route.legs || !route.legs[0]) return;
  const leg = route.legs[0];

  const startName = leg.start_address ? leg.start_address.replace(/^日本、\s*/, '') : '現在地';
  const title = appState.pointSearchMode ? `🚩 出発: ${startName}\n🏁 到着: ${destName}` : (destName || '目的地');

  setText('destinationName', title);
  setText('routeDistance', (leg.distance && leg.distance.text) ? leg.distance.text : '--');
  setText('routeTime', `徒歩 ${(leg.duration && leg.duration.text) ? leg.duration.text : '--'}`);

  const list = getEl('navPanelInstructions');
  if (list) {
    list.innerHTML = '';
    (leg.steps || []).forEach(s => {
      const d = document.createElement('div');
      d.className = 'nav-instruction-item';
      const txt = (s.html_instructions || '').replace(/<[^>]+>/g, '');
      d.textContent = txt + ((s.distance && s.distance.text) ? ` (${s.distance.text})` : '');
      list.appendChild(d);
    });
  }

  setDisplay('instructionsSection', 'block');

  if (appState.currentPolyline) {
    try { appState.currentPolyline.setMap(null); } catch (_) {}
  }

  if (WN.mapsReady && window.google && google.maps && google.maps.geometry && route.overview_polyline && route.overview_polyline.points) {
    try {
      appState.currentPolyline = new google.maps.Polyline({
        path: google.maps.geometry.encoding.decodePath(route.overview_polyline.points),
        map: appState.map,
        strokeColor: '#62b5ff',
        strokeWeight: 6
      });
    } catch (_) {}
  }

  if (WN.mapsReady && appState.map && window.google && google.maps && google.maps.LatLngBounds) {
    try {
      const b = new google.maps.LatLngBounds();
      if (appState.currentPos) b.extend(appState.currentPos);
      if (leg.end_location) b.extend(leg.end_location);
      appState.map.fitBounds(b, { padding: 50 });
    } catch (_) {}
  }

  setDisplay('routeInfoSection', 'block');
}

async function startNavigation(dest) {
  if (!dest || typeof dest.lat !== 'number' || typeof dest.lng !== 'number') return;
  if (!appState.currentPos && !(appState.pointSearchMode && appState.searchPoint)) {
    alert('現在地を取得してください');
    return;
  }

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

  const fabStop = getEl('btnStopFab');
  if (fabStop) fabStop.style.display = 'flex';

  setDisplay('routeControlSection', 'block');
  setDisplay('results', 'none');

  switchPanelTab('nav');

  if (WN.mapsReady && appState.map) {
    try {
      appState.map.panTo({ lat: dest.lat, lng: dest.lng });
      appState.map.setZoom(18);
    } catch (_) {}
  } else {
    // Maps が死んでいてもルートAPIだけは試す（パネル表示は可能）
    if (WN.mapsFailed) alertOnce('nav_no_map', '地図が読み込めないため、地図上のルート描画はできません。', 2500);
  }

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
    if (!resp) throw new Error('no response');
    const json = await resp.json();

    let chosen = { route: (json.routes && json.routes[0]) ? json.routes[0] : null, index: 0 };
    if (window.RouteEvaluator && window.RouteEvaluator.pickBestRoute && json.routes && json.routes.length) {
      chosen = window.RouteEvaluator.pickBestRoute(json.routes, appState.userProfile, appState.aiMode);
    }
    if (!chosen.route) throw new Error('no route');

    appState.currentRouteData = { routes: json.routes, selectedIndex: chosen.index };
    renderRoute(chosen.route, finalDestName);
    startLocationWatcher();
  } catch (e) {
    alertOnce('route_err', 'ルート取得失敗', 2500);
    stopNavigation();
  }
}

function stopNavigation() {
  if (appState.locationWatchId) navigator.geolocation.clearWatch(appState.locationWatchId);
  appState.isNavigating = false;

  if (appState.currentPolyline) {
    try { appState.currentPolyline.setMap(null); } catch (_) {}
  }

  const panel = getEl('searchPanel');
  if (panel) panel.classList.remove('hidden-force');

  restoreFabLabels();
  updateFabVisibility();

  const fabSearch = getEl('btnSearchFab');
  if (fabSearch) fabSearch.style.display = 'flex';

  const fabStop = getEl('btnStopFab');
  if (fabStop) fabStop.style.display = 'none';

  setDisplay('routeControlSection', 'none');
  setDisplay('instructionsSection', 'none');
  setDisplay('routeInfoSection', 'none');

  switchPanelTab('search');
  openPanel();

  if (appState.currentPos && WN.mapsReady && appState.map) {
    try {
      appState.map.panTo(appState.currentPos);
      appState.map.setZoom(17);
    } catch (_) {}
  }
}

/* ======================
   Mode controls
====================== */
function changeMapMode(mode) {
  try { localStorage.setItem(MAP_MODE_KEY, mode); } catch (_) {}
  appState.mapMode = mode;

  if (WN.mapsReady && appState.map && window.google && google.maps) {
    try {
      appState.map.setMapTypeId(
        mode === 'photo' ? google.maps.MapTypeId.SATELLITE :
        mode === '3d' ? google.maps.MapTypeId.HYBRID :
        google.maps.MapTypeId.ROADMAP
      );
      appState.map.setTilt(mode === '3d' ? 45 : 0);
    } catch (_) {}
  }

  ['btnMapPhoto', 'btnMapRoadmap', 'btnMap3D'].forEach(id => {
    const el = getEl(id);
    if (el) el.classList.toggle('active', el.dataset.mode === mode);
  });
}

function changeAiMode(mode) {
  appState.aiMode = mode;
  ['btnRouteNormal', 'btnRouteAiShortest'].forEach(id => {
    const el = getEl(id);
    if (!el) return;
    const btnMode = id === 'btnRouteNormal' ? 'normal' : 'shortest';
    el.classList.toggle('active', btnMode === mode);
  });

  // ルート再描画（ルートデータがある場合）
  if (appState.currentDestination && appState.currentRouteData && appState.currentRouteData.routes) {
    const routes = appState.currentRouteData.routes;
    let chosen = { route: routes[0], index: 0 };
    if (window.RouteEvaluator && window.RouteEvaluator.pickBestRoute) {
      chosen = window.RouteEvaluator.pickBestRoute(routes, appState.userProfile, mode);
    }
    appState.currentRouteData.selectedIndex = chosen.index;
    renderRoute(chosen.route, appState.currentDestination.name);
  }
}

function setSearchRadius(km) {
  appState.searchRadiusMeters = km * 1000;
  ['r5', 'r10', 'r20'].forEach(id => {
    const el = getEl(id);
    if (el) el.classList.toggle('active', id === ('r' + km));
  });
  setText('radiusLabel', km + 'km');
}

/* ======================
   Saved markers on map
====================== */
async function refreshSavedMarkers() {
  if (!WN.mapsReady || !appState.map || !window.google || !google.maps || !google.maps.importLibrary) return;

  try {
    appState.savedLocationMarkers.forEach(m => { try { m.map = null; } catch (_) {} });
    appState.savedLocationMarkers = [];

    const { AdvancedMarkerElement, PinElement } = await google.maps.importLibrary('marker');

    appState.savedLocations.forEach(loc => {
      const isPhoto = (loc.type === 'photo');
      const pin = new PinElement({
        glyph: isPhoto ? '📷' : '★',
        background: isPhoto ? '#25d07a' : '#f59e0b',
        borderColor: '#ffffff'
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
        try {
          appState.searchInfoWindows.forEach(w => w.close());
        } catch (_) {}
        infoWindow.open(appState.map, marker);
      });

      appState.savedLocationMarkers.push(marker);
    });
  } catch (_) {}
}

/* ======================
   Voice input
====================== */
function startVoiceInput() {
  const has = ('webkitSpeechRecognition' in window) || ('SpeechRecognition' in window);
  if (!has) {
    alert('音声入力はこのブラウザではサポートされていません');
    return;
  }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = new SpeechRecognition();
  recognition.lang = 'ja-JP';
  recognition.continuous = false;
  recognition.interimResults = false;

  recognition.onstart = () => {
    const btn = getEl('btnVoiceInput');
    if (btn) {
      const svg = btn.querySelector('svg');
      if (svg) svg.style.fill = '#ef4444';
    }
  };

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    const searchInput = getEl('q');
    if (searchInput) {
      searchInput.value = transcript;
      if (appState.currentPos) {
        placesTextSearch(transcript, appState.currentPos.lat, appState.currentPos.lng)
          .then(d => displayResults(d.places || []));
      }
    }
  };

  recognition.onerror = () => {
    alert('音声認識に失敗しました');
  };

  recognition.onend = () => {
    const btn = getEl('btnVoiceInput');
    if (btn) {
      const svg = btn.querySelector('svg');
      if (svg) svg.style.fill = '#f97316';
    }
  };

  recognition.start();
}

/* ======================
   Share / Dest FAB
====================== */
function handleShare() {
  const parts = [];
  if (appState.currentDestination) {
    parts.push(`目的地: ${appState.currentDestination.name || ''}`);
    parts.push(`https://www.google.com/maps?q=${appState.currentDestination.lat},${appState.currentDestination.lng}`);
  } else if (appState.currentPos) {
    parts.push('現在地');
    parts.push(`https://www.google.com/maps?q=${appState.currentPos.lat},${appState.currentPos.lng}`);
  } else {
    alert('共有できる位置情報がありません');
    return;
  }

  const text = parts.join('\n');
  if (navigator.share) {
    navigator.share({ text }).catch(() => {});
  } else {
    navigator.clipboard && navigator.clipboard.writeText(text).then(() => {
      alertOnce('copied', '共有テキストをコピーしました', 1500);
    }).catch(() => {
      prompt('コピーしてください', text);
    });
  }
}

function handleDestFab() {
  if (appState.currentDestination && WN.mapsReady && appState.map) {
    try {
      appState.map.panTo({ lat: appState.currentDestination.lat, lng: appState.currentDestination.lng });
      appState.map.setZoom(18);
    } catch (_) {}
    return;
  }
  if (appState.searchPoint && WN.mapsReady && appState.map) {
    try {
      appState.map.panTo({ lat: appState.searchPoint.lat, lng: appState.searchPoint.lng });
      appState.map.setZoom(18);
    } catch (_) {}
    return;
  }
  alert('目的地が未設定です');
}

/* ======================
   Save current location
====================== */
function handleSaveCurrentLocation() {
  let lat, lng, addrText;

  if (appState.pointSearchMode && appState.searchPoint) {
    lat = appState.searchPoint.lat;
    lng = appState.searchPoint.lng;
    addrText = (getEl('pointAddress') && getEl('pointAddress').textContent) || '住所不明';
  } else if (appState.currentPos) {
    lat = appState.currentPos.lat;
    lng = appState.currentPos.lng;
    addrText = (getEl('locAddress') && getEl('locAddress').textContent) || '現在地';
  } else {
    alert('現在地が取得できていません');
    return;
  }

  const name = prompt('保存する名前を入力してください（例：自宅）');
  if (!name) return;
  addSavedLocation(name, lat, lng, addrText);
}

/* ======================
   UI binding (must run even if Maps fails)
====================== */
function bindPanelHeaderTabs() {
  document.querySelectorAll('.tab-btn[data-panel-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-panel-tab') || 'search';
      if (isPanelHiddenForce()) return;

      const open = isPanelOpen();
      const active = getActiveTabNameFromDOM();
      if (open && active === tab) { collapsePanel(); return; }

      switchPanelTab(tab);
      openPanel();
      restoreFabLabels();
    });
  });
}

function bindUI() {
  const btnSearchFab = getEl('btnSearchFab');
  const btnLocateFab = getEl('btnLocateFab');
  const btnNavFab = getEl('btnNavFab');
  const btnSettingsFab = getEl('btnSettingsFab');
  const btnStopFab = getEl('btnStopFab');
  const btnDestFab = getEl('btnDestFab');
  const btnShareFab = getEl('btnShareFab');

  if (btnSearchFab) btnSearchFab.onclick = () => togglePanelFromFab('search', 'btnSearchFab');
  if (btnSettingsFab) btnSettingsFab.onclick = () => togglePanelFromFab('settings', 'btnSettingsFab');
  if (btnNavFab) btnNavFab.onclick = () => togglePanelFromFab('nav', 'btnNavFab');
  if (btnLocateFab) btnLocateFab.onclick = acquireLocation;
  if (btnStopFab) btnStopFab.onclick = stopNavigation;
  if (btnDestFab) btnDestFab.onclick = handleDestFab;
  if (btnShareFab) btnShareFab.onclick = handleShare;

  // Panel buttons
  const btnPointSearch = getEl('btnPointSearch');
  if (btnPointSearch) btnPointSearch.onclick = togglePointSearchMode;

  const btnReset = getEl('btnReset');
  if (btnReset) btnReset.onclick = resetApp;

  const btnLocatePanel = getEl('btnLocatePanel');
  if (btnLocatePanel) btnLocatePanel.onclick = acquireLocation;

  const btnClosePanel = getEl('btnClosePanel');
  if (btnClosePanel) btnClosePanel.onclick = collapsePanel;

  const btnStopRoute = getEl('btnStopRoute');
  if (btnStopRoute) btnStopRoute.onclick = stopNavigation;

  const btnCamera = getEl('btnCamera');
  const cameraInput = getEl('cameraInput');
  if (btnCamera && cameraInput) {
    btnCamera.onclick = () => cameraInput.click();
    cameraInput.onchange = handleCameraInput;
  }

  // Quick search
  if (getEl('btnSearchStation')) getEl('btnSearchStation').onclick = () => quickSearch('駅');
  if (getEl('btnSearchBus')) getEl('btnSearchBus').onclick = () => quickSearch('バス停');
  if (getEl('btnSearchTaxi')) getEl('btnSearchTaxi').onclick = () => quickSearch('タクシー乗り場');
  if (getEl('btnSearchToilet')) getEl('btnSearchToilet').onclick = () => quickSearch('公衆トイレ コンビニ');
  if (getEl('btnSearchConv')) getEl('btnSearchConv').onclick = () => quickSearch('コンビニ');
  if (getEl('btnSearchWifi')) getEl('btnSearchWifi').onclick = () => quickSearch('Free Wi-Fi');

  // Radius
  if (getEl('r5')) getEl('r5').onclick = () => setSearchRadius(5);
  if (getEl('r10')) getEl('r10').onclick = () => setSearchRadius(10);
  if (getEl('r20')) getEl('r20').onclick = () => setSearchRadius(20);

  // Map mode
  if (getEl('btnMapPhoto')) getEl('btnMapPhoto').onclick = () => changeMapMode('photo');
  if (getEl('btnMapRoadmap')) getEl('btnMapRoadmap').onclick = () => changeMapMode('roadmap');
  if (getEl('btnMap3D')) getEl('btnMap3D').onclick = () => changeMapMode('3d');

  // AI mode
  if (getEl('btnRouteNormal')) getEl('btnRouteNormal').onclick = () => changeAiMode('normal');
  if (getEl('btnRouteAiShortest')) getEl('btnRouteAiShortest').onclick = () => changeAiMode('shortest');

  // Profile
  const luggage = getEl('userLuggage');
  const condition = getEl('userCondition');
  const companion = getEl('userCompanion');
  if (luggage) luggage.onchange = saveUserProfile;
  if (condition) condition.onchange = saveUserProfile;
  if (companion) companion.onchange = saveUserProfile;

  if (getEl('btnOpenEditModal')) getEl('btnOpenEditModal').onclick = openEditModal;
  if (getEl('btnSaveEdits')) getEl('btnSaveEdits').onclick = saveEditModalChanges;
  if (getEl('btnCancelEdit')) getEl('btnCancelEdit').onclick = closeEditModal;

  const ph = document.querySelector('.panel-handle-area');
  if (ph) ph.onclick = togglePanel;

  // Search icon
  if (getEl('btnSearchIcon')) getEl('btnSearchIcon').onclick = () => {
    const q = getEl('q');
    if (!q) return;
    const lat = appState.currentPos ? appState.currentPos.lat : 0;
    const lng = appState.currentPos ? appState.currentPos.lng : 0;
    placesTextSearch(q.value, lat, lng).then(d => displayResults(d.places || []));
  };

  if (getEl('btnVoiceInput')) getEl('btnVoiceInput').onclick = startVoiceInput;
  if (getEl('btnSaveCurrent')) getEl('btnSaveCurrent').onclick = handleSaveCurrentLocation;

  bindPanelHeaderTabs();
  updateFabVisibility();
  restoreFabLabels();
}

/* ======================
   App start flow
====================== */
function startAppLight() {
  loadUserProfile();
  loadSavedLocations();
  bindUI();

  // MapMode is stored even if Maps not ready
  try { appState.mapMode = localStorage.getItem(MAP_MODE_KEY) || 'roadmap'; } catch (_) { appState.mapMode = 'roadmap'; }
  switchPanelTab('search');

  // 現在地はUIとしては取得する（Mapsが後から来ても反映）
  acquireLocation();
}

async function startMapsFull() {
  if (!WN.mapsReady || WN.mapsFailed) return;
  if (appState.mapInitialized) return;
  if (appState.currentPos) {
    await initMap({ lat: appState.currentPos.lat, lng: appState.currentPos.lng });
    await setUserMarker(appState.currentPos.lat, appState.currentPos.lng);
    refreshSavedMarkers();
  }
}

function initializeWhenReadyLight() {
  // UIは即開始
  startAppLight();

  // Mapsが既にあるなら即フル開始
  if (window.google && google.maps && google.maps.importLibrary) {
    WN.mapsReady = true;
    startMapsFull();
  }
}

window.__WN_onMapsReady = function () {
  WN.mapsReady = true;
  WN.mapsFailed = false;
  startMapsFull();
};

if (WN.booted) {
  console.warn('[WalkNav] duplicate app.js blocked:', ISSUE_ID);
} else {
  WN.booted = true;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeWhenReadyLight);
  } else {
    initializeWhenReadyLight();
  }
}