'use strict';

// ==========================================
// 定数定義
// ==========================================
const ISSUE_ID = 'idx202511050540'; // 更新：パネル表示ロJック、ボタン配置
const API_KEY = 'AIzaSyBXC6CB2yaUkrJ5UYj3mymAsruQe4MzGPk'; // Maps表示用のみ
const WORKER_ORIGIN = 'https://ors-proxy.miyata-connect-jp.workers.dev';
const DEFAULT_MASK = 'places.displayName,places.formattedAddress,places.location,places.id,places.types';
const MAX_RETRY = 3;
const RETRY_DELAY = 1000;
const LOCATION_OPTIONS = {
  enableHighAccuracy: true,
  timeout: 30000,
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
// トースト通知システム (廃止)
// ==========================================


// ==========================================
// リトライ機能付きfetch
// ==========================================
async function fetchWithRetry(url, options = {}, retries = MAX_RETRY) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      if (!response.ok && i < retries - 1) {
        console.log(`[Retry] ${i + 1}/${retries}: ${url}`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (i + 1)));
        continue;
      }
      return response;
    } catch (error) {
      if (i === retries - 1) throw error;
      console.log(`[Retry] ${i + 1}/${retries}: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (i + 1)));
    }
  }
}

// ==========================================
// API (Worker経由)
// ==========================================
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
    
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`TextSearch ${resp.status}: ${text}`);
    }
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
    
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Nearby ${resp.status}: ${text}`);
    }
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
    if (e.latLng) {
      setSearchPoint(e.latLng.lat(), e.latLng.lng());
    }
  });

  appState.mapInitialized = true;
  console.log('[WalkNav] Map initialized');
}

// ==========================================
// ユーザー位置マーカー設定 (SVG矢印)
// ==========================================
function setUserMarker(lat, lng) {
  appState.currentPos = { lat, lng };
  
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
              fill="#3aa0ff"  
              stroke="#ffffff"  
              stroke-width="2"  
              stroke-linejoin="round" />
      </svg>
    `;
    
    appState.userMarker = new google.maps.marker.AdvancedMarkerElement({
      map: appState.map,
      position: { lat, lng },
      content: pin,
      zIndex: 1000
    });
    
  } else {
    appState.userMarker.position = { lat, lng };
  }
}

// ==========================================
// 検索地点設定
// ==========================================
function setSearchPoint(lat, lng) {
  appState.searchPoint = { lat, lng };
  
  if (appState.searchPointMarker) {
    appState.searchPointMarker.map = null;
  }

  const pin = document.createElement('div');
  pin.style.width = '30px';
  pin.style.height = '30px';
  pin.style.borderRadius = '50% 50% 50% 0';
  pin.style.background = '#ff6565';
  pin.style.border = '3px solid #fff';
  pin.style.transform = 'rotate(-45deg)';
  pin.style.boxShadow = '0 4px 8px rgba(0,0,0,.3)';
  pin.style.transition = 'all 0.3s ease-out';

  appState.searchPointMarker = new google.maps.marker.AdvancedMarkerElement({
    map: appState.map,
    position: { lat, lng },
    content: pin,
    zIndex: 999
  });

  console.log(`[WalkNav] 検索地点設定: ${lat.toFixed(6)}, ${lng.toFixed(6)}`);
  console.log('検索地点を設定しました'); 
  
  fetchPointAddress(lat, lng);
}

// ==========================================
// 距離計算
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

// ==========================================
// レスポンスから距離/時間を取得
// ==========================================
function readLegDistanceText(leg) {
  if (leg?.distance?.text) return leg.distance.text;
  if (typeof leg?.distanceMeters === 'number') {
    const km = (leg.distanceMeters / 1000).toFixed(1);
    return `${km} km`;
  }
  return leg?.localizedValues?.distance?.text || '--';
}

function readLegDurationText(leg) {
  if (leg?.duration?.text) return leg.duration.text;
  if (typeof leg?.duration === 'string' && leg.duration.endsWith('s')) {
    const sec = parseInt(leg.duration.replace('s', ''), 10) || 0;
    const min = Math.max(1, Math.round(sec / 60));
    return `${min} 分`;
  }
  return leg?.localizedValues?.duration?.text || '--';
}

// ==========================================
// エンコードされたポリラインを取得
// ==========================================
function getEncodedPolylineFromRoute(route) {
  if (route?.overview_polyline?.points) return route.overview_polyline.points;
  if (route?.polyline?.encodedPolyline) return route.polyline.encodedPolyline;
  if (route?.overviewPolyline?.encodedPolyline) return route.overviewPolyline.encodedPolyline;
  return null;
}

// ==========================================
// ルートポリライン描画
// ==========================================
function drawRoutePolyline(route) {
  if (appState.currentPolyline) {
    appState.currentPolyline.setMap(null);
    appState.currentPolyline = null;
  }

  const encoded = getEncodedPolylineFromRoute(route);
  if (!encoded) {
    console.error('[Navigation] No encoded polyline found');
    console.error('ルート線の取得に失敗しました'); 
    return;
  }

  const path = google.maps.geometry.encoding.decodePath(encoded);
  appState.currentPolyline = new google.maps.Polyline({
    path: path,
    geodesic: true,
    strokeColor: '#62b5ff',
    strokeOpacity: 0.8,
    strokeWeight: 6,
    map: appState.map
  });

  console.log('[Navigation] Polyline drawn');
}

// ==========================================
// コンパス（デバイスの向き）監視
// ==========================================
const compassHandler = (event) => {
  // ナビ中はコンパスを無視 (目的地を指すため)
  if (appState.isNavigating) return;  
  
  let heading = null;
  if (event.webkitCompassHeading) { // iOS
    heading = event.webkitCompassHeading;
  } else if (event.absolute === true && event.alpha !== null) { // Android (北基準)
    heading = event.alpha;
  }

  if (heading !== null) {
    appState.currentHeading = heading;
    updateMarkerRotation();
  }
};

function startCompassListener() {
  if (appState.compassWatchId || !window.DeviceOrientationEvent) {
    if(!window.DeviceOrientationEvent) console.warn('[Compass] DeviceOrientationEvent is not supported.');
    return;
  }
  console.log('[Compass] Starting compass listener...');
  
  // iOS 1
