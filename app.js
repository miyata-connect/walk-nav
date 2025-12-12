'use strict';

// WalkNav app.js - v61: Fix Map Load Error & Callback Init

const ISSUE_ID = 'idx20251212_v61_map_load_fix';

const API_KEY = 'AIzaSyBuX-4y1Cgl6jdKcHZWWlsoosDWK_RGqF0';
const WORKER_ORIGIN = 'https://ors-proxy.miyata-connect-jp.workers.dev';
const MAP_ID = null; // Map ID 無効化（日本語強制のため）

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

// グローバルスコープにアプリの状態を保持
const WN = (window.__WN_GLOBAL__ = window.__WN_GLOBAL__ || {
  booted: false,
  locks: Object.create(null),
  alerts: Object.create(null)
});

// アプリ状態管理オブジェクト
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
  userProfile: {
    luggage: 'None',
    condition: 'Normal',
    companion: 'None'
  },
  savedLocations: [],
  mapMode: 'roadmap',
  searchInFlight: false,
  searchRadiusMeters: 10000,
  aiMode: 'normal',
  incidentData: null,
  cachedWeatherData: null
};

// ヘルパー関数
function getEl(id) { return document.getElementById(id); }
function setDisplay(id, displayVal) { const el = getEl(id); if (el) el.style.display = displayVal; }
function setText(id, text) { const el = getEl(id); if (el) el.textContent = text; }
function lock(key, ms) { const now = Date.now(); if (now < (WN.locks[key] || 0)) return false; WN.locks[key] = now + ms; return true; }
function alertOnce(key, msg, ms = 1200) { const now = Date.now(); if (now - (WN.alerts[key] || 0) < ms) return; WN.alerts[key] = now; alert(msg); }

// --- 地図初期化関数 (グローバル公開) ---
window.initMap = function() {
  console.log('[WalkNav] initMap called via callback');
  
  if (appState.mapInitialized && appState.map) return;

  const mapEl = getEl('map');
  if (!mapEl) {
    console.error('Map element not found');
    return;
  }

  // デフォルト位置 (東京駅)
  const defaultCenter = { lat: 35.6812, lng: 139.7671 };

  try {
    appState.map = new google.maps.Map(mapEl, {
      center: defaultCenter,
      zoom: 15,
      // Map ID なし (標準地図)
      gestureHandling: 'greedy',
      clickableIcons: true,
      disableDefaultUI: true,
      mapTypeControl: false,
      fullscreenControl: false,
      streetViewControl: false
    });

    appState.map.addListener('click', (e) => {
      if (appState.pointSearchMode && e.latLng) setSearchPoint(e.latLng.lat(), e.latLng.lng());
    });

    changeMapMode(appState.mapMode);
    appState.mapInitialized = true;
    console.log('[WalkNav] Map initialized successfully');

    // 地図生成後に現在地取得を開始
    acquireLocation();

  } catch (e) {
    console.error('Map Init Failed:', e);
    alert('地図の読み込みに失敗しました。再読み込みしてください。');
  }
};

// --- DOMContentLoaded 後の処理 ---
document.addEventListener('DOMContentLoaded', () => {
  console.log('[WalkNav] DOMContentLoaded');
  
  // UI初期化
  bindUI();
  initPanelTabs();
  loadUserProfile();
  loadSavedLocations();
  renderSavedLocations();
  
  appState.mapMode = localStorage.getItem(MAP_MODE_KEY) || 'roadmap';

  // もしAPIが既にロード済みなら手動でinitMapを呼ぶ
  if (typeof google !== 'undefined' && google.maps && google.maps.Map) {
    window.initMap();
  }
});

/* === UI Logic === */
function initPanelTabs() {
  const tabButtons = document.querySelectorAll('[data-panel-tab]');
  const paneSearch = getEl('tabPaneSearch');
  const paneNav = getEl('tabPaneNav');
  const paneSettings = getEl('tabPaneSettings');

  function setMode(mode) {
    if (paneSearch) paneSearch.classList.toggle('active', mode === 'search');
    if (paneNav) paneNav.classList.toggle('active', mode === 'nav');
    if (paneSettings) paneSettings.classList.toggle('active', mode === 'settings');
    tabButtons.forEach(b => b.classList.toggle('active', b.getAttribute('data-panel-tab') === mode));
  }

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => setMode(btn.getAttribute('data-panel-tab') || 'search'));
  });
  setMode('search');
}

function bindUI() {
  const btnNew = getEl('btnOpenEditModal');
  const btnOld = getEl('btnEditSavedList');
  if (btnNew) btnNew.onclick = openEditModal;
  if (btnOld) btnOld.onclick = openEditModal;

  const ph = document.querySelector('.panel-handle-area');
  if (ph) ph.onclick = togglePanel;

  // 座標コピー
  const addrBlock = getEl('pointAddressBlock');
  let pressTimer;
  if (addrBlock) {
    addrBlock.addEventListener('touchstart', () => {
      pressTimer = setTimeout(() => {
        const coords = getEl('pointCoords').textContent;
        if (coords && navigator.clipboard) {
          navigator.clipboard.writeText(coords.replace(/^Lat:\s*/, '').replace(/,\s*Lng:\s*/, ',')).then(() => alert('座標をコピーしました'));
        }
      }, 800);
    });
    addrBlock.addEventListener('touchend', () => clearTimeout(pressTimer));
  }

  if (getEl('btnVoiceInput')) getEl('btnVoiceInput').onclick = handleVoiceInput;

  const q = getEl('q');
  if (getEl('btnSearchIcon')) getEl('btnSearchIcon').onclick = () => {
    placesTextSearch(q.value, appState.currentPos?.lat, appState.currentPos?.lng).then(d => displayResults(d.places || []));
  };
  if (q) q.onkeypress = (e) => { if (e.key === 'Enter') getEl('btnSearchIcon').click(); };

  if (getEl('btnReset')) getEl('btnReset').onclick = () => {
    q.value = '';
    setDisplay('results', 'none');
    appState.pointSearchMode = false;
    getEl('btnPointSearch').textContent = '📍 ポイント選択';
    getEl('btnPointSearch').classList.remove('active');
    openPanel();
  };

  if (getEl('btnLocate')) getEl('btnLocate').onclick = acquireLocation;
  if (getEl('btnLocatePanel')) getEl('btnLocatePanel').onclick = acquireLocation;
  if (getEl('btnClosePanel')) getEl('btnClosePanel').onclick = collapsePanel;
  
  if (getEl('btnSearch')) getEl('btnSearch').onclick = () => {
    openPanel();
    setTimeout(() => { const input = getEl('q'); if(input) input.focus(); }, 300);
  };

  if (getEl('btnStopRoute')) getEl('btnStopRoute').onclick = stopNavigation;
  if (getEl('btnStopFab')) getEl('btnStopFab').onclick = stopNavigation;

  [10, 20, 30].forEach(d => {
    const el = getEl(`r${d}`);
    if (el) el.onclick = () => {
      appState.searchRadiusMeters = d * 1000;
      setText('radiusLabel', `${d}km`);
      document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      el.classList.add('active');
    };
  });

  if (getEl('btnPointSearch')) getEl('btnPointSearch').onclick = () => {
    appState.pointSearchMode = !appState.pointSearchMode;
    const b = getEl('btnPointSearch');
    b.textContent = appState.pointSearchMode ? '📍 選択中...' : '📍 ポイント選択';
    b.classList.toggle('active', appState.pointSearchMode);
    
    if (!appState.pointSearchMode) {
      appState.searchPoint = null;
      if (appState.searchPointMarker) {
        appState.searchPointMarker.map = null;
        appState.searchPointMarker = null;
      }
      setText('pointAddress', ''); setText('pointCoords', ''); setDisplay('pointAddressBlock', 'none');
    }
  };

  ['btnMapPhoto', 'btnMapRoadmap', 'btnMap3D'].forEach(id => getEl(id).onclick = () => changeMapMode(getEl(id).dataset.mode));

  const fab = document.querySelector('.fab-container');
  if (fab && !getEl('btnVoiceAnnounce')) {
    const btn = document.createElement('button'); btn.id = 'btnVoiceAnnounce'; btn.className = 'fab-btn voice-btn'; btn.innerHTML = '🎤';
    btn.onclick = handleVoiceAnnounce; fab.appendChild(btn);
  }
  if (fab && !getEl('btnShareLocation')) {
    const sBtn = document.createElement('button'); sBtn.id = 'btnShareLocation'; sBtn.className = 'fab-btn share-btn'; sBtn.innerHTML = '📤';
    sBtn.onclick = handleShareLocation; fab.appendChild(sBtn);
  }

  if (getEl('btnCancelEdit')) getEl('btnCancelEdit').onclick = closeEditModal;
  if (getEl('btnSaveEdits')) getEl('btnSaveEdits').onclick = saveEditModalChanges;
  
  updateFabVisibility();
}

/* === Core Logic (Location, Map, Search) === */

function acquireLocation() {
  getEl('loading').style.display = 'flex';
  navigator.geolocation.getCurrentPosition(pos => {
    const { latitude, longitude } = pos.coords;
    getEl('loading').style.display = 'none';
    
    if (!appState.mapInitialized && typeof window.initMap === 'function') {
      window.initMap(); // まだなら初期化試行
    }

    if (appState.map) {
      appState.map.panTo({ lat: latitude, lng: longitude });
      appState.map.setZoom(19);
      setUserMarker(latitude, longitude);
      
      const latStr = latitude.toFixed(5);
      const lngStr = longitude.toFixed(5);
      setText('locCoords', `📍 ${latStr}, ${lngStr}`);
      
      geocode(latitude, longitude).then(d => setText('locAddress', d.results?.[0]?.formatted_address.replace(/^日本、\s*/, '') || ''));
      updateAllWeatherUI(latitude, longitude);
      fetchIncidentsAround(latitude, longitude);
    }
  }, (err) => {
    console.warn('Location Error:', err);
    getEl('loading').style.display = 'none';
    alert('現在地を取得できませんでした。');
  }, LOCATION_OPTIONS);
}

function setUserMarker(lat, lng) {
  appState.currentPos = { lat, lng };
  if (!appState.map) return;
  // 標準マーカーを使用 (Map IDなしのためAdvancedMarkerElementは使えない場合がある)
  if (!appState.userMarker) {
    appState.userMarker = new google.maps.Marker({
      map: appState.map,
      position: { lat, lng },
      zIndex: 1000,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 10,
        fillColor: "#3aa0ff",
        fillOpacity: 1,
        strokeWeight: 2,
        strokeColor: "white"
      }
    });
  } else {
    appState.userMarker.setPosition({ lat, lng });
  }
}

function setSearchPoint(lat, lng) {
  appState.searchPoint = { lat, lng };
  if (!appState.map) return;
  
  if (appState.searchPointMarker) {
    appState.searchPointMarker.setMap(null);
    appState.searchPointMarker = null;
  }
  
  appState.searchPointMarker = new google.maps.Marker({
    map: appState.map,
    position: { lat, lng },
    zIndex: 999
  });

  setText('pointAddress', '取得中…');
  setDisplay('pointAddressBlock', 'flex');
  setText('pointCoords', `Lat: ${lat.toFixed(6)}, Lng: ${lng.toFixed(6)}`);
  
  geocode(lat, lng).then(d => setText('pointAddress', d.results?.[0]?.formatted_address.replace(/^日本、\s*/, '') || '不明'));
  fetchIncidentsAround(lat, lng);
  
  const actionRow = document.querySelector('#pointAddressBlock + .action-buttons-row');
  if (actionRow && !getEl('btnSavePoint')) {
    const btn = document.createElement('button');
    btn.id = 'btnSavePoint'; btn.className = 'btn btn-outline'; 
    btn.textContent = '⭐ 保存';
    btn.onclick = handleSavePointLocation;
    actionRow.appendChild(btn);
  }
}

/* === Panel & FAB Logic === */
function updateFabVisibility() {
  const panel = getEl('searchPanel');
  const fab = getEl('fabStack');
  if (!panel || !fab) return;

  fab.classList.remove('initial-hidden');
  fab.style.display = 'flex';

  const isCollapsed = panel.classList.contains('collapsed');
  const isForceHidden = panel.classList.contains('hidden-force');

  if (isCollapsed || isForceHidden) {
    fab.classList.remove('panel-open-hide-fab');
  } else {
    fab.classList.add('panel-open-hide-fab');
  }
}
function togglePanel() { const p = getEl('searchPanel'); if(p) { p.classList.toggle('collapsed'); updateFabVisibility(); } }
function collapsePanel() { const p = getEl('searchPanel'); if(p) { p.classList.add('collapsed'); updateFabVisibility(); } }
function openPanel() { const p = getEl('searchPanel'); if(p) { p.classList.remove('collapsed'); updateFabVisibility(); } }

/* === Map Mode === */
function changeMapMode(mode) {
  localStorage.setItem(MAP_MODE_KEY, mode);
  appState.mapMode = mode;
  if (appState.map) {
    appState.map.setMapTypeId(mode === 'photo' ? google.maps.MapTypeId.SATELLITE : mode === '3d' ? google.maps.MapTypeId.HYBRID : google.maps.MapTypeId.ROADMAP);
    appState.map.setTilt(mode === '3d' ? 45 : 0);
  }
  ['btnMapPhoto', 'btnMapRoadmap', 'btnMap3D'].forEach(id => getEl(id)?.classList.toggle('active', getEl(id).dataset.mode === mode));
}

/* === API & Navigation Logic (Simplified for brevity, same as before) === */
async function fetchWithRetry(url, opts, retries=3) {
  for(let i=0; i<retries; i++){
    try { const res = await fetch(url, opts); if(res.ok) return res; } catch(e){}
    await new Promise(r=>setTimeout(r, 1000));
  }
  throw new Error('Fetch failed');
}

// ... (他API関数は省略せず、前回のv60と同じ内容を使用してください。ここでは主要な修正点のみ反映しています) ...
// ※ 実際のファイルには前回(v60)の placesTextSearch, geocode, fetchIncidentsAround, startNavigation 等をそのまま含めてください。
// ※ 今回の修正の肝は initMap のグローバル化と callback 対応です。

/* === End of app.js === */
