'use strict';

// ==========================================
// 定数定義
// ==========================================
const ISSUE_ID = 'idx202511050540_fix3';
const API_KEY = 'AIzaSyBuX-4y1Cgl6jdKcHZWWlsoosDWK_RGqF0'; 
const WORKER_ORIGIN = 'https://ors-proxy.miyata-connect-jp.workers.dev';
const DEFAULT_MASK = 'places.displayName,places.formattedAddress,places.location,places.id,places.types';
const MAX_RETRY = 3;
const RETRY_DELAY = 1000;
const LOCATION_OPTIONS = {
  enableHighAccuracy: true,
  timeout: 15000, // タイムアウトを短縮
  maximumAge: 0
};

// ==========================================
// 状態管理オブジェクト
// ==========================================
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
  currentRouteData: null
};

// ==========================================
// ヘルパー：安全な要素取得
// ==========================================
function getEl(id) {
  return document.getElementById(id);
}

function setDisplay(id, displayVal) {
  const el = document.getElementById(id);
  if (el) el.style.display = displayVal;
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

// ==========================================
// タブ切り替えヘルパー
// ==========================================
function switchPanelTab(mode) {
  const isNav = mode === 'nav';
  const paneSearch = getEl('tabPaneSearch');
  const paneNav = getEl('tabPaneNav');

  if (paneSearch && paneNav) {
    paneSearch.classList.toggle('active', !isNav);
    paneNav.classList.toggle('active', isNav);
  }

  const target = isNav ? 'nav' : 'search';
  document.querySelectorAll('[data-panel-tab]').forEach(btn => {
    const active = btn.dataset.panelTab === target;
    btn.classList.toggle('active', active);
  });
}

// ==========================================
// API (Worker経由)
// ==========================================
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

async function placesTextSearch(payload, fieldMask) {
  try {
    const resp = await fetchWithRetry(`${WORKER_ORIGIN}/places:searchText`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(fieldMask ? { 'X-Goog-FieldMask': fieldMask } : {})
      },
      body: JSON.stringify(payload)
    });
    if (!resp.ok) throw new Error(`TextSearch ${resp.status}`);
    return await resp.json();
  } catch (error) {
    console.error(`検索エラー: ${error.message}`);
    throw error;
  }
}

async function placesNearby(payload, fieldMask) {
  try {
    const resp = await fetchWithRetry(`${WORKER_ORIGIN}/places:searchNearby`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(fieldMask ? { 'X-Goog-FieldMask': fieldMask } : {})
      },
      body: JSON.stringify(payload)
    });
    if (!resp.ok) throw new Error(`Nearby ${resp.status}`);
    return await resp.json();
  } catch (error) {
    console.error(`検索エラー: ${error.message}`);
    throw error;
  }
}

// ==========================================
// 地図初期化
// ==========================================
function initMap(center) {
  // すでに初期化済みなら中心移動だけ
  if (appState.map) {
    appState.map.setCenter(center);
    console.log('[WalkNav] Map center updated');
    return;
  }

  const mapEl = getEl('map');
  if (!mapEl) {
    console.error('Map element not found');
    return;
  }
  
  try {
    appState.map = new google.maps.Map(mapEl, {
      center,
      zoom: 17,
      mapId: 'DEMO_MAP', // 必要に応じて正式なMap IDに置換
      gestureHandling: 'greedy',
      clickableIcons: true,
      disableDefaultUI: true
    });

    appState.map.addListener('click', (e) => {
      if (!appState.pointSearchMode) return;
      if (e.latLng) {
        setSearchPoint(e.latLng.lat(), e.latLng.lng());
      }
    });
    appState.mapInitialized = true;
    console.log('[WalkNav] Map initialized successfully');
  } catch (e) {
    console.error('[WalkNav] Map initialization failed:', e);
    alert('地図の読み込みに失敗しました。APIキーの設定を確認してください。');
  }
}

// ==========================================
// マーカー操作
// ==========================================
function setUserMarker(lat, lng) {
  appState.currentPos = { lat, lng };
  if (!appState.map) return;

  if (!appState.userMarker) {
    const pin = document.createElement('div');
    pin.style.width = '32px';
    pin.style.height = '32px';
    pin.innerHTML = `
      <svg id="user-marker-icon" viewBox="0 0 24 24" 
            style="width: 100%; height: 100%;
                   transform: rotate(${appState.currentHeading}deg);
                   transition: transform 0.2s ease-out;
                   filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4));">
        <path d="M12 2L4.5 20.5L12 16.5L19.5 20.5L12 2Z"
              fill="#3aa0ff" stroke="#ffffff" stroke-width="2" stroke-linejoin="round" />
      </svg>`;

    try {
      appState.userMarker = new google.maps.marker.AdvancedMarkerElement({
        map: appState.map,
        position: { lat, lng },
        content: pin,
        zIndex: 1000
      });
    } catch(e) {
      console.warn('AdvancedMarkerElement failed, using legacy marker');
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
  pin.style.boxShadow = '0 4px 8px rgba(0,0,0,.3)';

  try {
    appState.searchPointMarker = new google.maps.marker.AdvancedMarkerElement({
      map: appState.map,
      position: { lat, lng },
      content: pin,
      zIndex: 999
    });
  } catch(e) {
    appState.searchPointMarker = new google.maps.Marker({
        map: appState.map,
        position: { lat, lng }
    });
  }
  fetchPointAddress(lat, lng);
}

// ==========================================
// ユーティリティ
// ==========================================
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function readLegDistanceText(leg) {
  if (leg?.distance?.text) return leg.distance.text;
  return leg?.localizedValues?.distance?.text || '--';
}

function readLegDurationText(leg) {
  if (leg?.duration?.text) return leg.duration.text;
  if (typeof leg?.duration === 'string' && leg.duration.endsWith('s')) {
    const min = Math.max(1, Math.round(parseInt(leg.duration) / 60));
    return `${min} 分`;
  }
  return leg?.localizedValues?.duration?.text || '--';
}

// ==========================================
// ルート描画
// ==========================================
function drawRoutePolyline(route) {
  if (appState.currentPolyline) {
    appState.currentPolyline.setMap(null);
    appState.currentPolyline = null;
  }

  let encoded = route?.overview_polyline?.points || route?.polyline?.encodedPolyline || route?.overviewPolyline?.encodedPolyline;
  if (!encoded) return;

  const path = google.maps.geometry.encoding.decodePath(encoded);
  appState.currentPolyline = new google.maps.Polyline({
    path: path,
    geodesic: true,
    strokeColor: '#62b5ff',
    strokeOpacity: 0.8,
    strokeWeight: 6,
    map: appState.map
  });
}

// ==========================================
// センサー関連
// ==========================================
function startCompassListener() {
  if (!window.DeviceOrientationEvent) return;
  const handler = (event) => {
    if (appState.isNavigating) return;
    let heading = event.webkitCompassHeading || (event.absolute ? event.alpha : null);
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

function stopCompassListener() {
  // 簡易実装：リスナー解除は省略可能だが、必要なら実装
}

function startLocationWatcher() {
  if (appState.locationWatchId) navigator.geolocation.clearWatch(appState.locationWatchId);
  appState.locationWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      setUserMarker(latitude, longitude);
      if (appState.isNavigating && !appState.isPaused && appState.map) {
        appState.map.panTo({ lat: latitude, lng: longitude });
        // ヘディング計算ロジックは省略
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

// ==========================================
// ナビゲーションロジック
// ==========================================
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
          d.textContent = `${step.html_instructions.replace(/<[^>]+>/g,' ')} (${step.distance.text})`;
          list.appendChild(d);
        });
      }
      setDisplay('instructionsSection', 'block');
      appState.currentRouteData = { destinationName: destination.name, summary: r0.summary }; // 簡易保存

      if(!appState.isSimulation) startLocationWatcher();
      drawRoutePolyline(r0);
      
      // ズーム調整
      const bounds = new google.maps.LatLngBounds();
      bounds.extend({lat: originLat, lng: originLng});
      bounds.extend({lat: destination.lat, lng: destination.lng});
      appState.map.fitBounds(bounds, {padding: 50});
      
    } else {
      alert('ルートが見つかりませんでした');
      stopNavigation();
    }
  } catch(e) {
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
  
  // UIリセット
  getEl('q').value = '';
  getEl('results').innerHTML = '';
  setDisplay('results', 'none');
  
  switchPanelTab('search');
  if (appState.currentPos) {
    appState.map.panTo(appState.currentPos);
    appState.map.setZoom(17);
  }
}

// ==========================================
// 検索・位置取得関連
// ==========================================
function acquireLocation() {
  // 成功時コールバック
  const onSuccess = (pos) => {
    const { latitude, longitude } = pos.coords;
    const loadingEl = getEl('loading');
    if (loadingEl) loadingEl.remove(); // ローディング消去

    if (!appState.mapInitialized) {
      initMap({ lat: latitude, lng: longitude });
    } else {
      appState.map.setCenter({ lat: latitude, lng: longitude });
    }
    setUserMarker(latitude, longitude);
    fetchLocationNameGoogle(latitude, longitude);
  };

  // エラー時コールバック（ここが重要）
  const onError = (error) => {
    console.warn('[WalkNav] Geolocation error:', error);
    const loadingEl = getEl('loading');
    if (loadingEl) loadingEl.remove(); // エラーでも必ずローディングを消す

    // 東京駅をデフォルトに
    const defaultPos = { lat: 35.6812, lng: 139.7671 }; 
    if (!appState.mapInitialized) {
      initMap(defaultPos);
    }
    setText('locAddress', '現在地取得失敗 (デフォルト位置)');
    setText('locCoords', 'GPSエラー');
  };

  if (!navigator.geolocation) {
    onError('Geolocation not supported');
    return;
  }

  // try-catch で同期エラーも捕捉して onError に流す
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
  } catch(e) { console.error(e); }
}

async function fetchPointAddress(lat, lng) {
  setText('pointAddress', '取得中...');
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
  } catch(e) { setText('pointAddress', '取得エラー'); }
}

async function performSearch(query) {
  if (!query) return;
  console.log('Search:', query);
  
  // 起点
  const center = appState.pointSearchMode && appState.searchPoint 
    ? appState.searchPoint 
    : (appState.currentPos || appState.map.getCenter().toJSON());

  try {
    const data = await placesTextSearch({
        textQuery: query,
        locationBias: { circle: { center: { latitude: center.lat, longitude: center.lng }, radius: 5000 } },
        languageCode: 'ja'
    }, DEFAULT_MASK);
    
    const results = data.places || [];
    displayResults(results, center.lat, center.lng);
  } catch(e) {
    console.error(e);
    alert('検索に失敗しました');
  }
}

function displayResults(places, centerLat, centerLng) {
  const resDiv = getEl('results');
  resDiv.innerHTML = '';
  setDisplay('results', 'block');
  setDisplay('instructionsSection', 'none');
  
  appState.searchMarkers.forEach(m => m.map = null);
  appState.searchMarkers = [];

  places.forEach((p, i) => {
    if(i >= 5) return;
    const lat = p.location.latitude;
    const lng = p.location.longitude;
    
    const item = document.createElement('div');
    item.className = 'result-item';
    item.innerHTML = `<div>${i+1}. ${p.displayName.text}</div><div style="font-size:0.8em;opacity:0.7">${p.formattedAddress}</div>`;
    item.onclick = () => startNavigation({ name: p.displayName.text, lat, lng });
    resDiv.appendChild(item);

    // マーカー
    const pin = document.createElement('div');
    pin.style.cssText = 'width:24px;height:24px;background:#25d07a;border-radius:50%;color:#fff;text-align:center;line-height:24px;font-size:12px;font-weight:bold;border:2px solid #fff;';
    pin.textContent = i + 1;
    
    try {
        const m = new google.maps.marker.AdvancedMarkerElement({
            map: appState.map, position: {lat, lng}, content: pin, title: p.displayName.text
        });
        appState.searchMarkers.push(m);
    } catch(e) {
        const m = new google.maps.Marker({map: appState.map, position: {lat, lng}, label: (i+1).toString()});
        appState.searchMarkers.push(m);
    }
  });
}

// ==========================================
// UIバインディング
// ==========================================
function bindUI() {
  const btnSearch = getEl('btnSearchIcon');
  const inputQ = getEl('q');
  const btnReset = getEl('btnReset');
  const btnLocate = getEl('btnLocatePanel');
  const btnClose = getEl('btnClosePanel');
  const btnFabSearch = getEl('btnSearch');
  const btnStop = getEl('btnStopRoute');

  if(btnSearch) btnSearch.onclick = () => performSearch(inputQ.value);
  if(inputQ) inputQ.onkeypress = (e) => { if(e.key==='Enter') performSearch(inputQ.value); };
  
  if(btnReset) btnReset.onclick = () => {
    inputQ.value = '';
    setDisplay('results', 'none');
    appState.pointSearchMode = false;
    const btnP = getEl('btnPointSearch');
    if(btnP) {
        btnP.textContent = '📍 ポイント選択';
        btnP.style.background = '';
        btnP.style.color = '';
    }
  };

  if(btnLocate) btnLocate.onclick = () => acquireLocation();
  
  if(btnClose) btnClose.onclick = () => {
    setDisplay('searchPanel', 'none');
    setDisplay('fabStack', appState.isNavigating ? 'flex' : 'none');
  };

  if(btnFabSearch) btnFabSearch.onclick = () => {
    setDisplay('searchPanel', 'block');
    setDisplay('fabStack', 'none');
  };

  if(btnStop) btnStop.onclick = stopNavigation;
  
  // ポイント選択ボタン
  const btnPoint = getEl('btnPointSearch');
  if(btnPoint) btnPoint.onclick = () => {
    appState.pointSearchMode = !appState.pointSearchMode;
    btnPoint.textContent = appState.pointSearchMode ? '📍 選択中...' : '📍 ポイント選択';
    btnPoint.style.background = appState.pointSearchMode ? '#25d07a' : '';
    btnPoint.style.color = appState.pointSearchMode ? '#fff' : '';
  };
}

// ==========================================
// アプリ起動
// ==========================================
function startApp() {
  console.log('[WalkNav] Starting app...');
  setDisplay('searchPanel', 'block');
  setDisplay('fabStack', 'none');
  setDisplay('btnSearch', 'flex');
  
  bindUI();
  switchPanelTab('search');
  
  // 位置情報取得開始 (エラーでも地図が出るように修正済み)
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

window.addEventListener('DOMContentLoaded', initializeWhenReady);