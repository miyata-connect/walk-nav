'use strict';

// ==========================================
// 定数定義
// ==========================================
const ISSUE_ID = 'idx202511050540-android-pwa';
const WORKER_ORIGIN = 'https://ors-proxy.miyata-connect-jp.workers.dev';
const DEFAULT_MASK = 'places.displayName,places.formattedAddress,places.location,places.id,places.types';
const MAX_RETRY = 3;
const RETRY_DELAY = 1000;
const LOCATION_OPTIONS = { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 };
const MAX_RESULTS = 20;
const SHOW_RESULTS = 5;

// 検索用 AbortController（競合対策）
let searchAbort = null;

// ==========================================
// 状態管理
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
// リトライ付き fetch
// ==========================================
async function fetchWithRetry(url, options = {}, retries = MAX_RETRY) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      if (!response.ok && i < retries - 1) {
        await new Promise(r => setTimeout(r, RETRY_DELAY * (i + 1)));
        continue;
      }
      return response;
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise(r => setTimeout(r, RETRY_DELAY * (i + 1)));
    }
  }
}

// ==========================================
// API（Worker 経由）
// ==========================================
async function placesTextSearch(payload, fieldMask, signal) {
  const resp = await fetchWithRetry(`${WORKER_ORIGIN}/places:searchText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(fieldMask ? { 'X-Goog-FieldMask': fieldMask } : {}) },
    body: JSON.stringify(payload),
    signal
  });
  if (!resp.ok) throw new Error(`TextSearch ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

async function placesNearby(payload, fieldMask, signal) {
  const resp = await fetchWithRetry(`${WORKER_ORIGIN}/places:searchNearby`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(fieldMask ? { 'X-Goog-FieldMask': fieldMask } : {}) },
    body: JSON.stringify(payload),
    signal
  });
  if (!resp.ok) throw new Error(`Nearby ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

// ==========================================
// 地図初期化
// ==========================================
function initMap(center) {
  appState.map = new google.maps.Map(document.getElementById('map'), {
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

  appState.mapInitialized = true;
  console.log('[WalkNav] Map initialized');
}

// ==========================================
// ユーザー位置マーカー（矢印）
// ==========================================
function setUserMarker(lat, lng) {
  appState.currentPos = { lat, lng };
  if (!appState.userMarker) {
    const pin = document.createElement('div');
    pin.style.width = '32px';
    pin.style.height = '32px';
    pin.innerHTML = `
      <svg id="user-marker-icon" viewBox="0 0 24 24"
           style="width:100%;height:100%;transform:rotate(${appState.currentHeading}deg);
                  transition:transform .2s ease-out;filter:drop-shadow(0 2px 4px rgba(0,0,0,.4));">
        <path d="M12 2L4.5 20.5L12 16.5L19.5 20.5L12 2Z"
              fill="#3aa0ff" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/>
      </svg>`;
    appState.userMarker = new google.maps.marker.AdvancedMarkerElement({
      map: appState.map, position: { lat, lng }, content: pin, zIndex: 1000
    });
  } else {
    appState.userMarker.position = { lat, lng };
  }
}

// ==========================================
// 検索地点
// ==========================================
function setSearchPoint(lat, lng) {
  appState.searchPoint = { lat, lng };
  if (appState.searchPointMarker) appState.searchPointMarker.map = null;

  const pin = document.createElement('div');
  pin.style.width = '30px'; pin.style.height = '30px';
  pin.style.borderRadius = '50% 50% 50% 0'; pin.style.background = '#ff6565';
  pin.style.border = '3px solid #fff'; pin.style.transform = 'rotate(-45deg)';
  pin.style.boxShadow = '0 4px 8px rgba(0,0,0,.3)'; pin.style.transition = 'all .3s ease-out';

  appState.searchPointMarker = new google.maps.marker.AdvancedMarkerElement({
    map: appState.map, position: { lat, lng }, content: pin, zIndex: 999
  });

  console.log(`[WalkNav] 検索地点設定: ${lat.toFixed(6)}, ${lng.toFixed(6)}`);
  fetchPointAddress(lat, lng);
}

// ==========================================
// 距離・時間表記
// ==========================================
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}
function readLegDistanceText(leg) {
  if (leg?.distance?.text) return leg.distance.text;
  if (typeof leg?.distanceMeters === 'number') return `${(leg.distanceMeters/1000).toFixed(1)} km`;
  return leg?.localizedValues?.distance?.text || '--';
}
function readLegDurationText(leg) {
  if (leg?.duration?.text) return leg.duration.text;
  if (typeof leg?.duration === 'string' && leg.duration.endsWith('s')) {
    const sec = parseInt(leg.duration.replace('s',''),10)||0;
    return `${Math.max(1, Math.round(sec/60))} 分`;
  }
  return leg?.localizedValues?.duration?.text || '--';
}

// ==========================================
// ポリライン描画
// ==========================================
function getEncodedPolylineFromRoute(route) {
  if (route?.overview_polyline?.points) return route.overview_polyline.points;
  if (route?.polyline?.encodedPolyline) return route.polyline.encodedPolyline;
  if (route?.overviewPolyline?.encodedPolyline) return route.overviewPolyline.encodedPolyline;
  return null;
}
function drawRoutePolyline(route) {
  if (appState.currentPolyline) { appState.currentPolyline.setMap(null); appState.currentPolyline = null; }
  const encoded = getEncodedPolylineFromRoute(route);
  if (!encoded) { console.error('[Navigation] No polyline'); return; }
  const path = google.maps.geometry.encoding.decodePath(encoded);
  appState.currentPolyline = new google.maps.Polyline({
    path, geodesic:true, strokeColor:'#62b5ff', strokeOpacity:.8, strokeWeight:6, map:appState.map
  });
}

// ==========================================
// コンパス（端末差フォールバック付）
// ==========================================
const compassHandler = (event) => {
  if (appState.isNavigating) return;
  let heading = null;
  if (typeof event.webkitCompassHeading === 'number') {
    heading = event.webkitCompassHeading; // iOS
  } else if (event.absolute === true && typeof event.alpha === 'number') {
    heading = event.alpha; // Android（北基準）
  }
  if (heading !== null && isFinite(heading)) {
    appState.currentHeading = heading;
    updateMarkerRotation();
  }
};
function startCompassListener() {
  if (appState.compassWatchId || !window.DeviceOrientationEvent) return;
  // Android/iOS 権限
  const req = (typeof DeviceOrientationEvent.requestPermission === 'function')
    ? DeviceOrientationEvent.requestPermission().catch(()=> 'denied')
    : Promise.resolve('granted');
  req.then((state) => {
    if (state === 'granted' || state === 'prompt' || state === undefined) {
      window.addEventListener('deviceorientationabsolute', compassHandler, true);
      window.addEventListener('deviceorientation', compassHandler, true);
      appState.compassWatchId = 1;
    } else {
      console.warn('[Compass] permission denied; fallback to no-rotation');
    }
  });
}
function stopCompassListener() {
  if (!appState.compassWatchId) return;
  window.removeEventListener('deviceorientationabsolute', compassHandler, true);
  window.removeEventListener('deviceorientation', compassHandler, true);
  appState.compassWatchId = null;
}
function updateMarkerRotation() {
  const icon = document.getElementById('user-marker-icon');
  if (icon) icon.style.transform = `rotate(${appState.currentHeading}deg)`;
}

// ==========================================
// 位置監視（ナビ中）
// ==========================================
function startLocationWatcher() {
  if (appState.locationWatchId) {
    navigator.geolocation.clearWatch(appState.locationWatchId);
    appState.locationWatchId = null;
  }
  const onWatchSuccess = (pos) => {
    const { latitude, longitude } = pos.coords;
    setUserMarker(latitude, longitude);
    fetchLocationNameGoogle(latitude, longitude);
    if (appState.isNavigating && !appState.isPaused) {
      appState.map.panTo({ lat: latitude, lng: longitude });
      if (appState.currentDestination && google.maps.geometry) {
        const cur = new google.maps.LatLng(latitude, longitude);
        const dst = new google.maps.LatLng(appState.currentDestination.lat, appState.currentDestination.lng);
        let headingDeg = google.maps.geometry.spherical.computeHeading(cur, dst);
        if (headingDeg < 0) headingDeg += 360;
        appState.currentHeading = headingDeg;
        updateMarkerRotation();
      }
    }
  };
  const onWatchError = (e) => {
    console.error('[Location] watch error:', e?.message||e);
    stopLocationWatcher();
  };
  appState.locationWatchId = navigator.geolocation.watchPosition(onWatchSuccess, onWatchError, LOCATION_OPTIONS);
}
function stopLocationWatcher() {
  if (appState.locationWatchId) {
    navigator.geolocation.clearWatch(appState.locationWatchId);
    appState.locationWatchId = null;
  }
}

// ==========================================
// ナビ開始
// ==========================================
async function startNavigation(destination) {
  let originLat, originLng;
  if (appState.pointSearchMode && appState.searchPoint) {
    originLat = appState.searchPoint.lat; originLng = appState.searchPoint.lng; appState.isSimulation = true;
  } else if (appState.currentPos) {
    originLat = appState.currentPos.lat; originLng = appState.currentPos.lng; appState.isSimulation = false;
  } else {
    console.error('起点が設定されていません'); return;
  }
  appState.currentDestination = destination;
  appState.isNavigating = true; appState.isPaused = false;

  document.getElementById('searchPanel').style.display = 'none';
  document.getElementById('fabStack').style.display = 'flex';
  document.getElementById('appBody').classList.remove('panel-open');
  stopCompassListener();

  try {
    const params = new URLSearchParams({
      origin: `${originLat},${originLng}`,
      destination: `${destination.lat},${destination.lng}`,
      mode: 'walking',
      language: 'ja'
    });
    const response = await fetchWithRetry(`${WORKER_ORIGIN}/directions?${params.toString()}`);
    if (!response.ok) throw new Error(`Directions ${response.status}: ${await response.text()}`);
    const result = await response.json();

    if (result.routes && result.routes.length > 0) {
      const r0 = result.routes[0];
      const l0 = (r0.legs && r0.legs[0]) ? r0.legs[0] : null;

      const distanceText = l0 ? readLegDistanceText(l0) : '--';
      const durationText = l0 ? readLegDurationText(l0) : '--';

      document.getElementById('destinationName').textContent = destination.name;
      document.getElementById('routeDistance').textContent = distanceText;
      document.getElementById('routeTime').textContent = `徒歩 ${durationText}`;
      document.getElementById('routePanel').style.display = 'block';
      document.getElementById('results').style.display = 'none';
      document.getElementById('btnDestination').style.display = 'flex';

      const instructionsList = document.getElementById('navPanelInstructions');
      instructionsList.innerHTML = '';
      if (l0 && l0.steps && l0.steps.length > 0) {
        l0.steps.forEach(step => {
          const item = document.createElement('div');
          item.className = 'nav-instruction-item';
          const txt = (step.html_instructions || '').replace(/<[^>]+>/g, ' ');
          item.textContent = `${txt} (${step.distance.text})`;
          instructionsList.appendChild(item);
        });
      }
      document.getElementById('navPanel').style.display = 'block';

      appState.currentRouteData = {
        steps: l0?.steps || [],
        summary: r0.summary,
        distance: distanceText,
        duration: durationText,
        destinationName: destination.name,
        warnings: r0.warnings || []
      };

      const incidentPanel = document.getElementById('incidentPanel');
      if (r0.warnings && r0.warnings.length > 0) {
        incidentPanel.innerHTML = '⚠️ ' + r0.warnings.map(w => w.replace(/<[^>]+>/g, ' ')).join('<br>⚠️ ');
        incidentPanel.style.display = 'block';
      } else {
        incidentPanel.style.display = 'none';
      }

      fetchWeather(originLat, originLng);

      if (appState.isSimulation) {
        setUserMarker(originLat, originLng);
        fetchLocationNameGoogle(originLat, originLng);
        if (appState.currentDestination && google.maps.geometry) {
          const cur = new google.maps.LatLng(originLat, originLng);
          const dst = new google.maps.LatLng(appState.currentDestination.lat, appState.currentDestination.lng);
          let headingDeg = google.maps.geometry.spherical.computeHeading(cur, dst);
          if (headingDeg < 0) headingDeg += 360;
          appState.currentHeading = headingDeg;
          updateMarkerRotation();
        }
      } else {
        startLocationWatcher();
      }

      drawRoutePolyline(r0);

      // カメラ演出簡素化（酔い防止）
      const bounds = new google.maps.LatLngBounds();
      bounds.extend(new google.maps.LatLng(originLat, originLng));
      bounds.extend(new google.maps.LatLng(destination.lat, destination.lng));
      appState.map.fitBounds(bounds, { top: 80, right: 120, bottom: 220, left: 40 });

      console.log(`[Navigation] start: ${destination.name}`);
    } else {
      throw new Error('ルートが取得できませんでした');
    }
  } catch (e) {
    console.error('[Navigation] Error:', e);
    appState.isNavigating = false; appState.isSimulation = false;
    document.getElementById('fabStack').style.display = 'none';
    startCompassListener();
  }
}

// ==========================================
// ナビ停止
// ==========================================
function stopNavigation() {
  stopLocationWatcher();
  startCompassListener();

  appState.isSimulation = false;
  appState.currentRouteData = null;

  if (appState.currentPolyline) { appState.currentPolyline.setMap(null); appState.currentPolyline = null; }
  appState.currentDestination = null;
  appState.isNavigating = false;
  appState.isPaused = false;

  document.getElementById('routePanel').style.display = 'none';
  document.getElementById('navPanel').style.display = 'block';
  document.getElementById('navPanelInstructions').innerHTML = '';
  document.getElementById('incidentPanel').style.display = 'none';
  document.getElementById('incidentPanel').innerHTML = '';
  document.getElementById('searchPanel').style.display = 'block';
  document.getElementById('btnDestination').style.display = 'none';
  document.getElementById('q').value = '';
  document.getElementById('results').style.display = 'none';
  document.getElementById('results').innerHTML = '';
  document.getElementById('weather3h').textContent = '--';
  document.getElementById('weather6h').textContent = '--';
  document.getElementById('weather9h').textContent = '--';
  document.getElementById('fabStack').style.display = 'none';
  document.getElementById('btnSearch').style.display = 'flex';

  // フラグの取りこぼし対策
  document.getElementById('appBody').classList.remove('keyboard-open');
  document.getElementById('appBody').classList.add('panel-open');
  updateMarkerRotation();
}

// ==========================================
// 一時停止/再開
// ==========================================
function togglePause() {
  if (appState.isSimulation) { console.warn('シミュレーション中は一時停止できません'); return; }
  if (!appState.isNavigating) { console.warn('ナビゲーション中ではありません'); return; }

  appState.isPaused = !appState.isPaused;
  const btnPause = document.getElementById('btnPause');
  if (appState.isPaused) {
    btnPause.textContent = '再開';
    btnPause.classList.add('paused');
  } else {
    btnPause.textContent = '一時停止';
    btnPause.classList.remove('paused');
    if (appState.currentPos) {
      appState.map.panTo(appState.currentPos);
      appState.map.setZoom(18);
    }
  }
}

// ==========================================
// 検索（Abort/半径除外/状態表示）
// ==========================================
const TYPE_MAP = {
  "コンビニ": "convenience_store",
  "スーパー": "supermarket",
  "レストラン": "restaurant",
  "カフェ": "cafe",
  "ホテル": "lodging",
  "病院": "hospital",
  "薬局": "pharmacy",
  "ガソリンスタンド": "gas_station",
  "駐車場": "parking",
  "銀行": "bank"
};

function setSearching(on) {
  const btn = document.getElementById('btnSearchIcon');
  if (!btn) return;
  btn.style.opacity = on ? '0.5' : '1';
  btn.style.pointerEvents = on ? 'none' : 'auto';
  btn.setAttribute('aria-busy', on ? 'true' : 'false');
}

async function performSearch(query) {
  if (!query || !query.trim()) { console.warn('検索ワードを入力してください'); return; }

  let centerLat, centerLng;
  if (appState.pointSearchMode && appState.searchPoint) {
    centerLat = appState.searchPoint.lat; centerLng = appState