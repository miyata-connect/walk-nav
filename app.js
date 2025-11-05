'use strict';

// ==========================================
// 定数定義
// ==========================================
const ISSUE_ID = 'idx202511050540'; // 更新：パネル表示ロジック、ボタン配置
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
// トースト通知システム
// ==========================================
let lastToastTime = 0;
let lastToastMessage = '';

function showToast(message, type = 'info', duration = 3000) {
  const now = Date.now();
  
  if (message === lastToastMessage && now - lastToastTime < 1500) {
    console.log(`[Toast:${type}] Debounced: ${message}`);
    return;
  }
  
  lastToastTime = now;
  lastToastMessage = message;
  
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  const icons = {
    error: '❌',
    success: '✅',
    warning: '⚠️',
    info: 'ℹ️'
  };
  
  toast.innerHTML = `
    <div class="toast-icon">${icons[type] || icons.info}</div>
    <div class="toast-message">${message}</div>
  `;
  
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-20px)';
    setTimeout(() => toast.remove(), 300);
  }, duration);
  
  console.log(`[Toast:${type}] ${message}`);
}

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
    showToast(`検索エラー: ${error.message}`, 'error');
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
    showToast(`検索エラー: ${error.message}`, 'error');
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
    pin.style.width = '26px';
    pin.style.height = '26px';
    
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
  showToast('検索地点を設定しました', 'success');
  
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
    showToast('ルート線の取得に失敗しました', 'error');
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
  
  // iOS 13+ の許可リクエスト
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
     DeviceOrientationEvent.requestPermission()
      .then(permissionState => {
        if (permissionState === 'granted') {
          window.addEventListener('deviceorientationabsolute', compassHandler, true);
          window.addEventListener('deviceorientation', compassHandler, true);
          appState.compassWatchId = 1; // 監視中フラグ
        }
      })
      .catch(console.error);
  } else {
    // Androidなど許可が不要な場合
    window.addEventListener('deviceorientationabsolute', compassHandler, true);
    window.addEventListener('deviceorientation', compassHandler, true);
    appState.compassWatchId = 1; // 監視中フラグ
  }
}

function stopCompassListener() {
  if (appState.compassWatchId) {
    console.log('[Compass] Stopping compass listener...');
    window.removeEventListener('deviceorientationabsolute', compassHandler, true);
    window.removeEventListener('deviceorientation', compassHandler, true);
    appState.compassWatchId = null;
  }
}

function updateMarkerRotation() {
  const icon = document.getElementById('user-marker-icon');
  if (icon) {
    // マップは回転しない前提
    icon.style.transform = `rotate(${appState.currentHeading}deg)`;
  }
}

// ==========================================
// リアルタイム位置情報監視（ナビ中）
// ==========================================
function startLocationWatcher() {
  if (appState.locationWatchId) {
    navigator.geolocation.clearWatch(appState.locationWatchId);
    appState.locationWatchId = null;
  }
  console.log('[Location] Starting watchPosition (Nav Mode)...');

  const onWatchSuccess = (pos) => {
    const { latitude, longitude } = pos.coords;
    console.log(`[Location] Watch update: ${latitude}, ${longitude}`);
    
    setUserMarker(latitude, longitude);
    
    // 住所もリアルタイム更新
    fetchLocationNameGoogle(latitude, longitude);
    
    // ナビ中で一時停止中でなければ
    if (appState.isNavigating && !appState.isPaused) {
      appState.map.panTo({ lat: latitude, lng: longitude });

      // マーカーの向きを目的地に合わせる
      if (appState.currentDestination && google.maps.geometry) {
        const currentLatLng = new google.maps.LatLng(latitude, longitude);
        const destLatLng = new google.maps.LatLng(appState.currentDestination.lat, appState.currentDestination.lng);
        
        let headingDeg = google.maps.geometry.spherical.computeHeading(currentLatLng, destLatLng);
        if (headingDeg < 0) { headingDeg += 360; }  
        
        appState.currentHeading = headingDeg;
        updateMarkerRotation();
      }
    }
  };

  const onWatchError = (error) => {
    console.error('[Location] Watch error:', error.message);
    showToast('リアルタイム位置情報の取得に失敗', 'error');
    stopLocationWatcher();
  };

  appState.locationWatchId = navigator.geolocation.watchPosition(
    onWatchSuccess,
    onWatchError,
    LOCATION_OPTIONS
  );
}

function stopLocationWatcher() {
   if (appState.locationWatchId) {
    console.log('[Location] Stopping watchPosition (Nav Mode)...');
    navigator.geolocation.clearWatch(appState.locationWatchId);
    appState.locationWatchId = null;
  }
}


// ==========================================
// ナビゲーション開始 (シミュレーション対応)
// ==========================================
async function startNavigation(destination) {
  let originLat, originLng;
  
  // シミュレーションモード判定
  if (appState.pointSearchMode && appState.searchPoint) {
    originLat = appState.searchPoint.lat;
    originLng = appState.searchPoint.lng;
    appState.isSimulation = true;
    console.log('[Navigation] シミュレーションモードで開始');
  } else if (appState.currentPos) {
    originLat = appState.currentPos.lat;
    originLng = appState.currentPos.lng;
    appState.isSimulation = false;
    console.log('[Navigation] リアルタイムモードで開始');
  } else {
    showToast('起点が設定されていません', 'error');
    return;
  }

  appState.currentDestination = destination;
  appState.isNavigating = true;
  appState.isPaused = false;
  
  // UI制御
  document.getElementById('searchPanel').style.display = 'none';
  document.getElementById('fabStack').style.display = 'flex';  
  document.getElementById('appBody').classList.remove('panel-open');
  
  // コンパス（デバイス向き）監視を停止
  stopCompassListener();
  
  try {
    showToast('ルートを取得中...', 'info', 2000);

    const params = new URLSearchParams({
      origin: `${originLat},${originLng}`,
      destination: `${destination.lat},${destination.lng}`,
      mode: 'walking',
      language: 'ja'
    });

    const response = await fetchWithRetry(`${WORKER_ORIGIN}/directions?${params.toString()}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Directions API Error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    console.log('[Navigation] Directions Response:', result);

    if (result.routes && result.routes.length > 0) {
      const r0 = result.routes[0];
      const l0 = (r0.legs && r0.legs[0]) ? r0.legs[0]: null;

      const distanceText = l0 ? readLegDistanceText(l0) : '--';
      const durationText = l0 ? readLegDurationText(l0) : '--';

      // UI更新
      document.getElementById('destinationName').textContent = destination.name;
      document.getElementById('routeDistance').textContent = distanceText;
      document.getElementById('routeTime').textContent = `徒歩 ${durationText}`;
      document.getElementById('routePanel').style.display = 'block';
      document.getElementById('searchPanel').style.display = 'none';
      document.getElementById('results').style.display = 'none';
      document.getElementById('btnDestination').style.display = 'flex';

      // 道順案内パネルの処理
      const instructionsList = document.getElementById('navPanelInstructions');
      instructionsList.innerHTML = ''; // クリア
      if (l0 && l0.steps && l0.steps.length > 0) {
        l0.steps.forEach(step => {
          const item = document.createElement('div');
          item.className = 'nav-instruction-item';
          const cleanInstruction = (step.html_instructions || '').replace(/<[^>]+>/g, ' ');
          item.textContent = `${cleanInstruction} (${step.distance.text})`;
          instructionsList.appendChild(item);
        });
      }
      document.getElementById('navPanel').style.display = 'block';
      
      // 道順テキスト出力用にデータを保存
      appState.currentRouteData = {
        steps: l0.steps,
        summary: r0.summary,
        distance: distanceText,
        duration: durationText,
        destinationName: destination.name,
        warnings: r0.warnings || []
      };

      // インシデントパネルの処理
      const incidentPanel = document.getElementById('incidentPanel');
      if (r0.warnings && r0.warnings.length > 0) {
        incidentPanel.innerHTML = '⚠️ ' + r0.warnings.map(w => w.replace(/<[^>]+>/g, ' ')).join('<br>⚠️ ');
        incidentPanel.style.display = 'block';
      } else {
        incidentPanel.style.display = 'none';
      }
      
      // 天気予報の処理
      fetchWeather(originLat, originLng);
      
      // モードに応じて監視を開始
      if (appState.isSimulation) {
        // シミュレーションの場合
        setUserMarker(originLat, originLng); // マーカーを起点に設置
        fetchLocationNameGoogle(originLat, originLng); // 案内パネルの住所を更新
        // 目的地への向きを計算してマーカーを回転
        if (appState.currentDestination && google.maps.geometry) {
          const currentLatLng = new google.maps.LatLng(originLat, originLng);
          const destLatLng = new google.maps.LatLng(appState.currentDestination.lat, appState.currentDestination.lng);
          let headingDeg = google.maps.geometry.spherical.computeHeading(currentLatLng, destLatLng);
          if (headingDeg < 0) { headingDeg += 360; }  
          appState.currentHeading = headingDeg;
          updateMarkerRotation();
        }
      } else {
        // リアルタイムナビの場合
        startLocationWatcher();
      }

      // ポリライン描画
      drawRoutePolyline(r0);

      // カメラワーク
      const bounds = new google.maps.LatLngBounds();
      bounds.extend(new google.maps.LatLng(originLat, originLng));
      bounds.extend(new google.maps.LatLng(destination.lat, destination.lng));
      appState.map.fitBounds(bounds, { top: 100, right: 150, bottom: 300, left: 50 });  

      setTimeout(() => {
        appState.map.panTo({ lat: destination.lat, lng: destination.lng });
        appState.map.setZoom(18);
        setTimeout(() => {
          appState.map.panTo({ lat: originLat, lng: originLng });
          appState.map.setZoom(18);
        }, 2000);
      }, 2000);

      showToast(`${destination.name} へのルート案内を開始`, 'success');
      console.log(`[Navigation] ルート案内開始: ${destination.name}`);
    } else {
      throw new Error('ルートが取得できませんでした');
    }
  } catch (error) {
    console.error('[Navigation] Error:', error);
    showToast(`ルートエラー: ${error.message}`, 'error', 5000);
    appState.isNavigating = false;
    appState.isSimulation = false;
    document.getElementById('fabStack').style.display = 'none';  
    startCompassListener(); // エラー時はコンパス監視を再開
  }
}

// ==========================================
// ナビゲーション停止
// ==========================================
function stopNavigation() {
  stopLocationWatcher(); // リアルタイム監視を停止
  startCompassListener();  // コンパス監視を再開
  
  appState.isSimulation = false;  
  appState.currentRouteData = null;  
  
  if (appState.currentPolyline) {
    appState.currentPolyline.setMap(null);
    appState.currentPolyline = null;
  }
  
  appState.currentDestination = null;
  appState.isNavigating = false;
  appState.isPaused = false;
  
  // UI更新
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
  
  // 天気予報をリセット
  document.getElementById('weather3h').textContent = '--';
  document.getElementById('weather6h').textContent = '--';
  document.getElementById('weather9h').textContent = '--';
  
  // FABボタンを非表示
  document.getElementById('fabStack').style.display = 'none';
  document.getElementById('btnSearch').style.display = 'flex';  
  
  // 一時停止ボタンをリセット
  const btnPause = document.getElementById('btnPause');
  btnPause.textContent = '一時停止';
  btnPause.classList.remove('paused');
  
  // 検索マーカー削除
  appState.searchMarkers.forEach(marker => marker.map = null);
  appState.searchMarkers = [];
  
  // 現在地に戻る
  if (appState.currentPos && appState.map) {
    appState.map.panTo(appState.currentPos);
    appState.map.setZoom(17);
  }
  
  // マーカーの向きをコンパスに戻す
  updateMarkerRotation();  
  
  document.getElementById('appBody').classList.add('panel-open'); // トースト位置
  showToast('ルート案内を終了しました', 'info');
  console.log('[Navigation] ルート案内終了');
}

// ==========================================
// 一時停止/再開トグル
// ==========================================
function togglePause() {
  // シミュレーション中は一時停止不要
  if (appState.isSimulation) {
     showToast('シミュレーション中は一時停止できません', 'warning');
     return;
  }
  if (!appState.isNavigating) {
    showToast('ナビゲーション中ではありません', 'warning');
    return;
  }

  appState.isPaused = !appState.isPaused;
  const btnPause = document.getElementById('btnPause');
  
  if (appState.isPaused) {
    btnPause.textContent = '再開';
    btnPause.classList.add('paused');
    showToast('ナビゲーションを一時停止しました', 'warning');
    console.log('[Navigation] 一時停止');
  } else {
    btnPause.textContent = '一時停止';
    btnPause.classList.remove('paused');
    showToast('ナビゲーションを再開しました', 'success');
    console.log('[Navigation] 再開');
    // 再開時にマップを現在地に追従
    if(appState.currentPos) {
      appState.map.panTo(appState.currentPos);
      appState.map.setZoom(18);
    }
  }
}

// ==========================================
// 検索実行 (Worker経由)
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

async function performSearch(query) {
  if (!query || !query.trim()) {
    showToast('検索ワードを入力してください', 'warning');
    return;
  }

  let centerLat, centerLng;
  
  if (appState.pointSearchMode && appState.searchPoint) {
    centerLat = appState.searchPoint.lat;
    centerLng = appState.searchPoint.lng;
  } else if (appState.currentPos) {
    centerLat = appState.currentPos.lat;
    centerLng = appState.currentPos.lng;
  } else {
    showToast('検索の基準地点が不明です', 'error');
    return;
  }

  const radiusKm = parseInt(document.getElementById('radiusLabel').textContent);
  const radiusMeters = radiusKm * 1000;

  showToast('検索中...', 'info', 2000);

  // Text Search優先
  try {
    const data = await placesTextSearch({
      textQuery: query.trim(),
      locationBias: {
        circle: { center: { latitude: centerLat, longitude: centerLng }, radius: radiusMeters }
      },
      maxResultCount: 20,
      languageCode: 'ja'
    }, DEFAULT_MASK);

    if (data.places?.length) {
      displayResults(data.places, centerLat, centerLng);
      return;
    }
  } catch (e) {
    console.error('[Search] Text Search Error:', e);
  }

  // Nearby Search（タイプが一致する場合のみ）
  const typeKey = TYPE_MAP[query.trim()] || TYPE_MAP[query.trim().replace(/\s/g, '')];

  if (typeKey) {
    try {
      const data = await placesNearby({
        includedTypes: [typeKey],
        maxResultCount: 20,
        locationRestriction: {
          circle: { center: { latitude: centerLat, longitude: centerLng }, radius: radiusMeters }
        },
        languageCode: 'ja'
      }, DEFAULT_MASK);

      if (data.places?.length) {
        displayResults(data.places, centerLat, centerLng);
        return;
      }
    } catch (e) {
      console.error('[Search] Nearby Error:', e);
    }
  }

  showToast('検索結果が見つかりませんでした', 'warning');
  document.getElementById('results').style.display = 'none';
  
  // ★★★ 変更点 ★★★
  // 検索結果がない場合、案内パネルを再表示
  document.getElementById('navPanel').style.display = 'block';
}

// ==========================================
// 検索結果表示
// ==========================================
function displayResults(places, centerLat, centerLng) {
  // ★★★ 変更点 ★★★
  // 検索結果が表示されるため、案内パネルを非表示にする
  document.getElementById('navPanel').style.display = 'none';

  appState.searchMarkers.forEach(marker => marker.map = null);
  appState.searchMarkers = [];

  const placesWithDistance = places.map(place => {
    const lat = place.location.latitude;
    const lng = place.location.longitude;
    const distance = calculateDistance(centerLat, centerLng, lat, lng);
    return { ...place, distance };
  });

  placesWithDistance.sort((a, b) => a.distance - b.distance);
  const limitedResults = placesWithDistance.slice(0, 5);

  const resultsDiv = document.getElementById('results');
  resultsDiv.innerHTML = '';
  resultsDiv.style.display = 'block';

  limitedResults.forEach((place, index) => {
    const name = place.displayName?.text || place.displayName || '名称不明';
    const address = place.formattedAddress || '住所不明';
    const lat = place.location.latitude;
    const lng = place.location.longitude;
    const distanceKm = (place.distance / 1000).toFixed(2);

    const item = document.createElement('div');
    item.className = 'result-item';
    item.innerHTML = `
      <div class="result-name">${index + 1}. ${name}</div>
      <div class="result-address">${address}</div>
      <div style="font-size:11px;color:#62b5ff;margin-top:4px">
        📍 ${distanceKm}km
      </div>
    `;
    
    item.onclick = () => {
      startNavigation({
        name: name,
        lat: lat,
        lng: lng
      });
    };

    resultsDiv.appendChild(item);

    const markerPin = document.createElement('div');
    markerPin.style.width = '24px';
    markerPin.style.height = '24px';
    markerPin.style.borderRadius = '50%';
    markerPin.style.background = '#25d07a';
    markerPin.style.border = '2px solid #fff';
    markerPin.style.boxShadow = '0 2px 6px rgba(0,0,0,.3)';
    markerPin.style.display = 'flex';
    markerPin.style.alignItems = 'center';
    markerPin.style.justifyContent = 'center';
    markerPin.style.color = '#fff';
    markerPin.style.fontSize = '12px';
    markerPin.style.fontWeight = 'bold';
    markerPin.textContent = index + 1;

    const marker = new google.maps.marker.AdvancedMarkerElement({
      map: appState.map,
      position: { lat, lng },
      content: markerPin,
      zIndex: 500 + index,
      title: name
    });

    appState.searchMarkers.push(marker);
  });

  showToast(`${limitedResults.length}件の検索結果`, 'success');
  console.log(`[Search] ${limitedResults.length}件の結果を表示しました`);
}

// ==========================================
// 音声認識初期化
// ==========================================
function initSpeechRecognition() {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    console.log('[Voice] 音声認識は非対応です');
    return false;
  }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  appState.recognition = new SpeechRecognition();
  appState.recognition.lang = 'ja-JP';
  appState.recognition.continuous = false;
  appState.recognition.interimResults = false;

  appState.recognition.onstart = () => {
    console.log('[Voice] 音声認識開始');
    document.getElementById('btnVoiceIcon').style.background = 'var(--ok)';  
  };

  appState.recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    console.log('[Voice] 認識結果:', transcript);
    document.getElementById('q').value = transcript;
    performSearch(transcript);
    showToast(`音声認識: ${transcript}`, 'success');
  };

  appState.recognition.onerror = (event) => {
    console.error('[Voice] エラー:', event.error);
    document.getElementById('btnVoiceIcon').style.background = '';  
    showToast('音声認識エラーが発生しました', 'error');
  };

  appState.recognition.onend = () => {
    console.log('[Voice] 音声認識終了');
    document.getElementById('btnVoiceIcon').style.background = '';  
  };

  return true;
}

// ==========================================
// 音声検索開始
// ==========================================
function startVoiceSearch() {
  if (!appState.recognition) {
    if (!initSpeechRecognition()) {
      showToast('お使いのブラウザは音声認識に対応していません', 'error');
      return;
    }
  }

  try {
    appState.recognition.start();
  } catch (e) {
    console.error('[Voice] 開始エラー:', e);
    appState.recognition.stop();
    setTimeout(() => {
      try {
        appState.recognition.start();
      } catch (e2) {
        console.error('[Voice] 再開エラー:', e2);
        showToast('音声認識の開始に失敗しました', 'error');
      }
    }, 100);
  }
}

// ==========================================
// 現在地取得 (初回1回のみ)
// ==========================================
function acquireLocation() {
  const onSuccess = (pos) => {
    const { latitude, longitude } = pos.coords;
    document.getElementById('loading')?.remove();
    
    if (!appState.map) {
      initMap({ lat: latitude, lng: longitude });
    }
    
    appState.map.setCenter({ lat: latitude, lng: longitude });
    setUserMarker(latitude, longitude);  
    fetchLocationNameGoogle(latitude, longitude);  
    showToast('現在地を取得しました', 'success');
  };
  
  const onError = (error) => {
    console.log('[WalkNav] geolocation error', error?.message || error);
    document.getElementById('loading')?.remove();
    
    if (!appState.map) {
      initMap({ lat: 35.6812, lng: 139.7671 });  
    }
    
    const addressElement = document.getElementById('locAddress');
    const coordsElement = document.getElementById('locCoords');
    
    if (addressElement) {
      addressElement.textContent = '現在地：取得失敗';
    }
    if (coordsElement) {
      coordsElement.textContent = '位置情報を確認できません';
    }

    let errorMessage = '現在地の取得に失敗しました';
    if (error.code === 1) { // PERMISSION_DENIED
      errorMessage = '位置情報が許可されていません';
    } else if (error.code === 2) { // POSITION_UNAVAILABLE
      errorMessage = '位置情報が利用できません';
    } else if (error.code === 3) { // TIMEOUT
      errorMessage = '位置情報の取得がタイムアウトしました';
    }
    showToast(errorMessage, 'error');
  };
  
  try {
    navigator.geolocation.getCurrentPosition(onSuccess, onError, LOCATION_OPTIONS);
  } catch (e) {
    console.log('[WalkNav] geolocation exception', e);
    showToast('位置情報へのアクセスが拒否されました', 'error');
  }
}

// ==========================================
// 地名取得（逆ジオコーディング）- Cloudflare経由
// ==========================================
async function fetchLocationNameGoogle(lat, lng) {
  const addressElement = document.getElementById('locAddress');
  const coordsElement = document.getElementById('locCoords');

  if (!addressElement || !coordsElement) {
    console.error('[DEBUG] Elements not found!');
    return;
  }

  const coordsText = `緯度 ${lat.toFixed(6)} / 経度 ${lng.toFixed(6)}`;
  coordsElement.textContent = coordsText;

  try {
    console.log('[Geocode] Fetching address from Cloudflare...');
    const params = new URLSearchParams({ lat: lat, lng: lng, language: 'ja' });
    
    const response = await fetchWithRetry(`${WORKER_ORIGIN}/geocode?${params.toString()}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Geocode Worker Error ${response.status}: ${errorText}`);
    }

    const data = await response.json();

    if (data.status === 'OK' && data.results[0]) {
      const address = data.results[0].formatted_address;
      const cleanAddress = address.replace(/^日本、\s*/, '');
      const formattedAddress = '現在地：' + cleanAddress + ' 付近';
      
      addressElement.textContent = formattedAddress;
    } else {
      console.error('[Geocode] Geocode failed via Cloudflare. Status:', data.status);
      addressElement.textContent = '現在地：住所情報なし';
      if (data.status !== 'ZERO_RESULTS') {
         showToast(`住所取得エラー: ${data.status}`, 'error', 5000);
      }
    }
  } catch (error) {
    console.error('[Geocode] Fetch error:', error);
    addressElement.textContent = '現在地：住所取得エラー';
  }
}

// ==========================================
// ポイント選択時の地名取得
// ==========================================
async function fetchPointAddress(lat, lng) {
  const addressBlock = document.getElementById('pointAddressBlock');
  const addressElement = document.getElementById('pointAddress');
  const coordsElement = document.getElementById('pointCoords');

  if (!addressElement || !coordsElement || !addressBlock) {
    console.error('[DEBUG] Point Elements not found!');
    return;
  }

  addressElement.textContent = 'ポイント：住所取得中...';
  coordsElement.textContent = `(緯度 ${lat.toFixed(6)} / 経度 ${lng.toFixed(6)})`;
  addressBlock.style.display = 'flex';

  try {
    const params = new URLSearchParams({ lat: lat, lng: lng, language: 'ja' });
    const response = await fetchWithRetry(`${WORKER_ORIGIN}/geocode?${params.toString()}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Geocode Worker Error ${response.status}: ${errorText}`);
    }

    const data = await response.json();

    if (data.status === 'OK' && data.results[0]) {
      const address = data.results[0].formatted_address;
      const cleanAddress = address.replace(/^日本、\s*/, '');
      const formattedAddress = 'ポイント：' + cleanAddress + ' 付近';
      addressElement.textContent = formattedAddress;
    } else {
      addressElement.textContent = 'ポイント：住所情報なし';
    }
  } catch (error) {
    console.error('[Geocode] Fetch error for Point:', error);
    addressElement.textContent = 'ポイント：住所取得エラー';
  }
}

// ==========================================
// 天気予報取得
// ==========================================

// OpenWeatherMapのアイコンコードを絵文字にマッピング
function getWeatherIcon(iconCode) {
  const map = {
    '01d': '☀️', '01n': '🌙',
    '02d': '🌤️', '02n': '☁️',
    '03d': '☁️', '03n': '☁️',
    '04d': '☁️', '04n': '☁️',
    '09d': '🌦️', '09n': '🌦️',
    '10d': '🌧️', '10n': '🌧️',
    '11d': '⛈️', '11n': '⛈️',
    '13d': '❄️', '13n': '❄️',
    '50d': '🌫️', '50n': '🌫️',
  };
  return map[iconCode] || '❔';
}

async function fetchWeather(lat, lng) {
  console.log('[Weather] Fetching weather...');
  try {
    const params = new URLSearchParams({ lat: lat, lng: lng });
    const response = await fetchWithRetry(`${WORKER_ORIGIN}/weather?${params.toString()}`);
    
    if (!response.ok) {
       const errorData = await response.json();
       if (errorData.status === 'NOT_IMPLEMENTED') {
        console.warn('[Weather] ' + errorData.error_message);
        throw new Error(errorData.error_message);
       }
       throw new Error(errorData.error_message || `Weather fetch failed (${response.status})`);
    }
    
    const data = await response.json(); // OpenWeatherMapのhourly形式を想定
    
    // 3h, 6h, 9h 後のデータを取得 (インデックスは目安)
    const weather3h = data.hourly[2]?.weather[0]?.icon || null;  
    const weather6h = data.hourly[5]?.weather[0]?.icon || null;
    const weather9h = data.hourly[8]?.weather[0]?.icon || null;
    
    document.getElementById('weather3h').textContent = getWeatherIcon(weather3h);
    document.getElementById('weather6h').textContent = getWeatherIcon(weather6h);
    document.getElementById('weather9h').textContent = getWeatherIcon(weather9h);
    
  } catch (error) {
    console.error('[Weather] Error:', error);
    if (error.message.includes('configured')) {
       // APIキー未設定エラーはトースト表示しない
    } else {
       showToast(`天気予報の取得に失敗: ${error.message}`, 'warning');
    }
    document.getElementById('weather3h').textContent = 'X';
    document.getElementById('weather6h').textContent = 'X';
    document.getElementById('weather9h').textContent = 'X';
  }
}


// ==========================================
// ダイアログユーティリティ
// ==========================================
function createDialog(config) {
  const overlay = document.createElement('div');
  overlay.className = `dialog-overlay ${config.scroll ? 'scroll' : ''}`;
  overlay.id = config.id || 'dialog';
  
  const box = document.createElement('div');
  box.className = `dialog-box ${config.wide ? 'wide' : ''}`;
  box.innerHTML = config.content;
  
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  
  return overlay;
}

// ==========================================
// 現在地登録ダイアログ
// ==========================================
function showSaveLocationDialog() {
  if (!appState.currentPos) {
    showToast('現在地が取得できていません', 'error');
    return;
  }
  
  const dialog = createDialog({
    id: 'saveLocationDialog',
    content: `
      <h3 class="dialog-title">現在地点登録画面</h3>
      <p class="dialog-text">登録する地点名を入力してください:</p>
      <input type="text" id="locationNameInput" class="dialog-input" placeholder="地点名を入力" />
      <div class="dialog-actions">
        <button id="btnCancelSave" class="dialog-btn cancel">キャンセル</button>
        <button id="btnConfirmSave" class="dialog-btn confirm">OK</button>
      </div>
    `
  });
  
  const input = document.getElementById('locationNameInput');
  const btnCancel = document.getElementById('btnCancelSave');
  const btnConfirm = document.getElementById('btnConfirmSave');
  
  setTimeout(() => input.focus(), 100);
  
  btnCancel.onclick = () => dialog.remove();
  
  btnConfirm.onclick = () => {
    const locationName = input.value.trim();
    
    if (!locationName) {
      showToast('地点名を入力してください', 'warning');
      return;
    }
    
    const locations = JSON.parse(localStorage.getItem('savedLocations') || '[]');
    const savedLocation = {
      name: locationName,
      lat: appState.currentPos.lat,
      lng: appState.currentPos.lng,
      timestamp: Date.now()
    };
    locations.push(savedLocation);
    localStorage.setItem('savedLocations', JSON.stringify(locations));
    
    console.log('[SaveLocation] 現在地を登録:', savedLocation);
    dialog.remove();
    
    showToast(`「${locationName}」を登録しました`, 'success');
  };
  
  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') btnConfirm.click();
  });
}

// ==========================================
// 登録地点修正ダイアログ
// ==========================================
function showEditLocationDialog() {
  const locations = JSON.parse(localStorage.getItem('savedLocations') || '[]');
  
  if (locations.length === 0) {
    const dialog = createDialog({
      id: 'editDialog',
      content: `
        <h3 class="dialog-title">登録地点修正</h3>
        <p class="dialog-muted">登録された地点がありません</p>
        <button id="btnCloseEmpty" class="dialog-btn confirm full">閉じる</button>
      `
    });
    
    document.getElementById('btnCloseEmpty').onclick = () => dialog.remove();
    return;
  }
  
  let listHTML = '<div class="location-list">';
  locations.forEach((loc, index) => {
    listHTML += `
      <div class="location-item">
        <div class="location-item-name">${loc.name}</div>
        <div class="location-item-coords">緯度: ${loc.lat.toFixed(6)} / 経度: ${loc.lng.toFixed(6)}</div>
        <div class="location-item-actions">
          <button class="location-item-btn nav" data-index="${index}">ナビ開始</button>
          <button class="location-item-btn edit" data-index="${index}">名前変更</button>
          <button class="location-item-btn delete" data-index="${index}">削除</button>
        </div>
      </div>
    `;
  });
  listHTML += '</div>';
  
  const dialog = createDialog({
    id: 'editDialog',
    wide: true,
    scroll: true,
    content: `
      <h3 class="dialog-title">登録地点修正</h3>
      ${listHTML}
      <button id="btnCloseEdit" class="dialog-btn cancel full" style="margin-top:16px">閉じる</button>
    `
  });
  
  document.getElementById('btnCloseEdit').onclick = () => dialog.remove();
  
  // ナビ開始ボタン
  document.querySelectorAll('.location-item-btn.nav').forEach(btn => {
    btn.onclick = () => {
      const index = parseInt(btn.dataset.index);
      const loc = locations[index];
      dialog.remove();
      startNavigation({
        name: loc.name,
        lat: loc.lat,
        lng: loc.lng
      });
    };
  });
  
  // 名前変更ボタン
  document.querySelectorAll('.location-item-btn.edit').forEach(btn => {
    btn.onclick = () => {
      const index = parseInt(btn.dataset.index);
      const loc = locations[index];
      
      const renameDialog = createDialog({
        id: 'renameDialog',
        content: `
          <h3 class="dialog-title">地点名変更</h3>
          <input type="text" id="renameInput" value="${loc.name}" class="dialog-input" />
          <div class="dialog-actions">
            <button id="btnCancelRename" class="dialog-btn cancel">キャンセル</button>
            <button id="btnConfirmRename" class="dialog-btn confirm">OK</button>
          </div>
        `
      });
      
      const renameInput = document.getElementById('renameInput');
      setTimeout(() => {
        renameInput.focus();
        renameInput.select();
      }, 100);
      
      document.getElementById('btnCancelRename').onclick = () => renameDialog.remove();
      
      document.getElementById('btnConfirmRename').onclick = () => {
        const newName = renameInput.value.trim();
        if (!newName) {
          showToast('地点名を入力してください', 'warning');
          return;
        }
        
        locations[index].name = newName;
        localStorage.setItem('savedLocations', JSON.stringify(locations));
        
        renameDialog.remove();
        dialog.remove();
        showToast(`地点名を「${newName}」に変更しました`, 'success');
      };
      
      renameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') document.getElementById('btnConfirmRename').click();
      });
    };
  });
  
  // 削除ボタン
  document.querySelectorAll('.location-item-btn.delete').forEach(btn => {
    btn.onclick = () => {
      const index = parseInt(btn.dataset.index);
      const loc = locations[index];
      
      const confirmDialog = createDialog({
        id: 'confirmDeleteDialog',
        content: `
          <h3 class="dialog-title">削除確認</h3>
          <p class="dialog-text">「${loc.name}」を削除しますか？</p>
          <div class="dialog-actions">
            <button id="btnCancelDelete" class="dialog-btn cancel">キャンセル</button>
            <button id="btnConfirmDelete" class="dialog-btn delete">削除</button>
          </div>
        `
      });
      
      document.getElementById('btnCancelDelete').onclick = () => confirmDialog.remove();
      
      document.getElementById('btnConfirmDelete').onclick = () => {
        locations.splice(index, 1);
        localStorage.setItem('savedLocations', JSON.stringify(locations));
        
        confirmDialog.remove();
        dialog.remove();
        showToast(`「${loc.name}」を削除しました`, 'success');
      };
    };
  });
}

// ==========================================
// 道順をクリップボードにコピー
// ==========================================
function exportRouteToClipboard() {
  if (!appState.currentRouteData) {
    showToast('コピーするルートデータがありません', 'warning');
    return;
  }

  const data = appState.currentRouteData;
  let textOutput = `■ 目的地: ${data.destinationName}\n`;
  textOutput += `■ 概要: ${data.summary} (約 ${data.distance}, 徒歩 ${data.duration})\n\n`;
  
  if (data.warnings.length > 0) {
    textOutput += "■ 警告:\n";
    data.warnings.forEach(w => {
       textOutput += `・ ${w.replace(/<[^>]+>/g, ' ')}\n`;
    });
    textOutput += "\n";
  }

  textOutput += "■ 道順:\n";
  if (data.steps && data.steps.length > 0) {
    data.steps.forEach((step, index) => {
      const instruction = (step.html_instructions || '').replace(/<[^>]+>/g, ' ');
      textOutput += `${index + 1}. ${instruction} (${step.distance.text})\n`;
    });
  } else {
    textOutput += "詳細な道順はありません。\n";
  }

  if (navigator.clipboard) {
    navigator.clipboard.writeText(textOutput)
      .then(() => {
        showToast('道順をクリップボードにコピーしました', 'success');
      })
      .catch(err => {
        console.error('Clipboard write error:', err);
        showToast('コピーに失敗しました', 'error');
      });
  } else {
    showToast('お使いのブラウザはコピー機能に非対応です', 'error');
  }
}


// ==========================================
// UI イベントバインディング
// ==========================================

// ★★★ 変更点 ★★★ (内部ロジックの変更)
// 検索パネルのイベント
function bindSearchPanelEvents() {
  const radiusLabel = document.getElementById('radiusLabel');
  const r10 = document.getElementById('r10');
  const r20 = document.getElementById('r20');
  const r30 = document.getElementById('r30');
  const btnPointSearch = document.getElementById('btnPointSearch');
  const navPanel = document.getElementById('navPanel'); // ★ navPanelを取得

  r10.onclick = () => {  
    r10.classList.add('active');  
    r20.classList.remove('active');
    r30.classList.remove('active');
    radiusLabel.textContent = '10km';  
  };
  
  r20.onclick = () => {  
    r20.classList.add('active');  
    r10.classList.remove('active');
    r30.classList.remove('active');
    radiusLabel.textContent = '20km';  
  };
  
  r30.onclick = () => {  
    r30.classList.add('active');  
    r10.classList.remove('active');
    r20.classList.remove('active');
    radiusLabel.textContent = '30km';  
  };

  btnPointSearch.onclick = () => {
    appState.pointSearchMode = !appState.pointSearchMode;
    if (appState.pointSearchMode) {
      btnPointSearch.textContent = '📍 ポイント選択中...';
      btnPointSearch.style.background = '#25d07a';
      btnPointSearch.style.color = '#0a2818';
      btnPointSearch.style.borderColor = 'transparent';
      showToast('地図をタップして検索地点を選択', 'info');
      navPanel.style.display = 'none'; // ★ ポイント選択中は非表示
    } else {
      btnPointSearch.textContent = '📍 ポイント選択';
      btnPointSearch.style.background = 'rgba(255,255,255,.08)';
      btnPointSearch.style.color = 'var(--text)';
      btnPointSearch.style.borderColor = 'var(--stroke)';
      
      // ★ ポイント選択解除時、検索結果が表示されていなければnavPanelを表示
      if (document.getElementById('results').style.display === 'none') {
         navPanel.style.display = 'block';
      }
    }
  };
}

function bindLocationEvents() {
  document.getElementById('btnSaveLocation').onclick = showSaveLocationDialog;
  document.getElementById('btnEditLocation').onclick = showEditLocationDialog;
}

// ==========================================
// ★★★ 変更点 ★★★ (内部ロジックの変更)
// 検索イベント (アイコンをバインド)
// ==========================================
function bindSearchEvents() {
  // 検索アイコンのクリック
  document.getElementById('btnSearchIcon').onclick = () => {
    const q = document.getElementById('q').value.trim();
    if (q) performSearch(q);
  };
  
  // 検索窓でのEnterキー
  document.getElementById('q').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const q = document.getElementById('q').value.trim();
      if (q) performSearch(q);
    }
  });
  
  // マイクアイコンのクリック
  document.getElementById('btnVoiceIcon').onclick = startVoiceSearch;
  
  document.getElementById('btnReset').onclick = () => {
    document.getElementById('q').value = '';
    document.getElementById('results').style.display = 'none';
    document.getElementById('results').innerHTML = '';
    
    appState.searchMarkers.forEach(marker => marker.map = null);
    appState.searchMarkers = [];
    
    appState.searchPoint = null;
    if (appState.searchPointMarker) {
      appState.searchPointMarker.map = null;
      appState.searchPointMarker = null;
    }
    
    const addressBlock = document.getElementById('pointAddressBlock');
    const addressElement = document.getElementById('pointAddress');
    const coordsElement = document.getElementById('pointCoords');
    addressBlock.style.display = 'none';
    addressElement.textContent = '';
    coordsElement.textContent = '';
    
    appState.pointSearchMode = false;
    const btnPointSearch = document.getElementById('btnPointSearch');
    btnPointSearch.textContent = '📍 ポイント選択';
    btnPointSearch.style.background = 'rgba(255,255,255,.08)';
    btnPointSearch.style.color = 'var(--text)';
    btnPointSearch.style.borderColor = 'var(--stroke)';
    
    // ★ リセットでnavPanelを再表示 (これは正しい)
    document.getElementById('navPanel').style.display = 'block'; 
    
    document.getElementById('r10').classList.add('active');
    document.getElementById('r20').classList.remove('active');
    document.getElementById('r30').classList.remove('active');
    document.getElementById('radiusLabel').textContent = '10km';
    
    showToast('リセットしました', 'info');
    console.log('[WalkNav] リセット完了');
  };
}

// ==========================================
// FAB・パネル制御
// ==========================================
function bindFABEvents() {
  let lastLocateTime = 0;
  
  // 検索パネルボタン（FAB側）
  document.getElementById('btnSearch').onclick = () => {
    document.getElementById('searchPanel').style.display = 'block';
    document.getElementById('fabStack').style.display = 'none';  
    document.getElementById('appBody').classList.add('panel-open');  
    
    // ★ 検索パネルを開いた時、検索結果が表示されていなければnavPanelを表示
    if (document.getElementById('results').style.display === 'none' && !appState.pointSearchMode) {
        document.getElementById('navPanel').style.display = 'block';
    }
    
    document.getElementById('navPanelInstructions').innerHTML = '';  
    document.getElementById('incidentPanel').style.display = 'none';  
  };
  
  // 検索パネルを閉じるボタン（パネル側）
  document.getElementById('btnClosePanel').onclick = () => {
    document.getElementById('searchPanel').style.display = 'none';
    // ナビ中でなければFABを隠し、現在地パネルも隠す
    if (!appState.isNavigating) {
       document.getElementById('fabStack').style.display = 'none';
       document.getElementById('navPanel').style.display = 'none';
    } else {
       document.getElementById('fabStack').style.display = 'flex'; // ナビ中ならFAB表示
    }
     document.getElementById('appBody').classList.remove('panel-open');  
  };

  document.getElementById('btnLocate').onclick = () => {
    // iOS 13+ のための許可リクエスト
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission()
        .then(permissionState => {
          if (permissionState === 'granted') {
            console.log('[Compass] iOS permission granted.');
            stopCompassListener();  
            appState.compassWatchId = null;  
            startCompassListener();  
          }
        })
        .catch(console.error);
    }
    
    const now = Date.now();
    if (now - lastLocateTime < 1000) return;
    lastLocateTime = now;
    
    if (appState.currentPos && appState.map) {
      appState.map.panTo(appState.currentPos);
      appState.map.setZoom(18);
      showToast('現在地に移動しました', 'info');
    } else {  
      showToast('現在地を取得します…', 'info');  
      acquireLocation();  
    }  
  };
  
  document.getElementById('btnDestination').onclick = () => {
    const now = Date.now();
    if (now - lastLocateTime < 1000) return;
    lastLocateTime = now;
    
    if (appState.currentDestination && appState.map) {
      appState.map.panTo({ lat: appState.currentDestination.lat, lng: appState.currentDestination.lng });
      appState.map.setZoom(18);
      showToast('目的地に移動しました', 'info');
    }
  };
  
  document.getElementById('btnPause').onclick = togglePause;
  
  document.getElementById('btnReroute').onclick = () => {
    if (appState.currentDestination) {
      startNavigation(appState.currentDestination);
    } else {
      showToast('目的地が設定されていません', 'warning');
    }
  };
}

// ==========================================
// ルートパネルのボタン制御
// ==========================================
function bindRoutePanelEvents() {
   document.getElementById('btnStopRoute').onclick = stopNavigation;
   document.getElementById('btnExportText').onclick = exportRouteToClipboard;
}

function bindUI() {
  console.log('[WalkNav] Binding UI...');
  bindSearchPanelEvents();
  bindLocationEvents();
  bindSearchEvents();
  bindFABEvents();
  bindRoutePanelEvents();  
  console.log('[WalkNav] UI binding complete');
}

// ==========================================
// アプリケーション起動
// ==========================================
function startApp() {
  console.log('[WalkNav] Starting app...');
  document.documentElement.lang = 'ja';
  
  // 初期状態
  document.getElementById('searchPanel').style.display = 'block';
  document.getElementById('fabStack').style.display = 'none';  
  document.getElementById('btnSearch').style.display = 'flex';  
  document.getElementById('appBody').classList.add('panel-open');  
  document.getElementById('navPanel').style.display = 'block';
  
  bindUI();
  acquireLocation(); // 初回取得
  initSpeechRecognition();
  startCompassListener(); // コンパス監視を開始
  
  console.log('[WalkNav] ISSUE', ISSUE_ID, 'boot');
}

function initializeWhenReady() {
  // Google Maps API本体 と geometry ライブラリのロードを待つ
  if (typeof google !== 'undefined' && google.maps && google.maps.Map && google.maps.geometry) {
    startApp();
  } else {
    // 100ms待って再チェック
    setTimeout(initializeWhenReady, 100);
  }
}

// DOMContentLoadedからロード監視を開始
window.addEventListener('DOMContentLoaded', initializeWhenReady);
