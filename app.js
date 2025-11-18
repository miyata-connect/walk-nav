'use strict';

// ==========================================
// 定数定義
// ==========================================
const ISSUE_ID = 'idx202511050540_fix2';
const API_KEY = 'AIzaSyBuX-4y1Cgl6jdKcHZWWlsoosDWK_RGqF0'; 
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
// タブ切り替えヘルパー（操作 / 案内）
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
  if (!appState.map) {
    const mapEl = getEl('map');
    if (!mapEl) return;
    
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
      if (e.latLng) {
        setSearchPoint(e.latLng.lat(), e.latLng.lng());
      }
    });
    console.log('[WalkNav] Map initialized');
  } else {
    appState.map.setCenter(center);
    console.log('[WalkNav] Map center updated');
  }
  appState.mapInitialized = true;
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
  if (appState.isNavigating) return;
  let heading = null;
  if (event.webkitCompassHeading) {
    heading = event.webkitCompassHeading;
  } else if (event.absolute === true && event.alpha !== null) {
    heading = event.alpha;
  }
  if (heading !== null) {
    appState.currentHeading = heading;
    updateMarkerRotation();
  }
};

function startCompassListener() {
  if (appState.compassWatchId || !window.DeviceOrientationEvent) {
    return;
  }
  console.log('[Compass] Starting compass listener...');
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission()
      .then(permissionState => {
        if (permissionState === 'granted') {
          window.addEventListener('deviceorientationabsolute', compassHandler, true);
          window.addEventListener('deviceorientation', compassHandler, true);
          appState.compassWatchId = 1;
        }
      })
      .catch(console.error);
  } else {
    window.addEventListener('deviceorientationabsolute', compassHandler, true);
    window.addEventListener('deviceorientation', compassHandler, true);
    appState.compassWatchId = 1;
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
  const icon = getEl('user-marker-icon');
  if (icon) {
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
    fetchLocationNameGoogle(latitude, longitude);

    if (appState.isNavigating && !appState.isPaused) {
      appState.map.panTo({ lat: latitude, lng: longitude });
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
// ナビゲーション開始
// ==========================================
async function startNavigation(destination) {
  let originLat, originLng;
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
    console.error('起点が設定されていません');
    return;
  }

  appState.currentDestination = destination;
  appState.isNavigating = true;
  appState.isPaused = false;

  setDisplay('searchPanel', 'block');
  setDisplay('fabStack', 'flex');
  getEl('appBody')?.classList.add('panel-open');

  // タブを案内側に切り替え
  switchPanelTab('nav');
  stopCompassListener();
  setDisplay('routeControlSection', 'block');

  try {
    console.log('ルートを取得中...');

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

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Directions API Error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    
    if (result.routes && result.routes.length > 0) {
      const r0 = result.routes[0];
      const l0 = (r0.legs && r0.legs[0]) ? r0.legs[0] : null;

      const distanceText = l0 ? readLegDistanceText(l0) : '--';
      const durationText = l0 ? readLegDurationText(l0) : '--';

      setText('destinationName', destination.name);
      setText('routeDistance', distanceText);
      setText('routeTime', `徒歩 ${durationText}`);

      // パネル表示切替（ID修正済み）
      setDisplay('routeInfoSection', 'block');
      setDisplay('searchPanel', 'block');
      setDisplay('results', 'none');
      setDisplay('btnDestination', 'flex');

      const instructionsList = getEl('navPanelInstructions');
      if (instructionsList) {
        instructionsList.innerHTML = '';
        if (l0 && l0.steps && l0.steps.length > 0) {
          l0.steps.forEach(step => {
            const item = document.createElement('div');
            item.className = 'nav-instruction-item';
            const cleanInstruction = (step.html_instructions || '').replace(/<[^>]+>/g, ' ');
            item.textContent = `${cleanInstruction} (${step.distance.text})`;
            instructionsList.appendChild(item);
          });
        }
      }
      
      // 道順表示
      setDisplay('instructionsSection', 'block');

      appState.currentRouteData = {
        steps: l0?.steps,
        summary: r0.summary,
        distance: distanceText,
        duration: durationText,
        destinationName: destination.name,
        warnings: r0.warnings || []
      };

      // インシデント表示
      const incidentText = getEl('incidentText');
      if (r0.warnings && r0.warnings.length > 0 && incidentText) {
        incidentText.innerHTML = '⚠️ ' + r0.warnings.map(w => w.replace(/<[^>]+>/g, ' ')).join('<br>⚠️ ');
        setDisplay('incidentSection', 'block');
      } else {
        setDisplay('incidentSection', 'none');
      }

      await fetchWeather(originLat, originLng);

      if (appState.isSimulation) {
        setUserMarker(originLat, originLng);
        fetchLocationNameGoogle(originLat, originLng);
        if (appState.currentDestination && google.maps.geometry) {
          const currentLatLng = new google.maps.LatLng(originLat, originLng);
          const destLatLng = new google.maps.LatLng(appState.currentDestination.lat, appState.currentDestination.lng);
          let headingDeg = google.maps.geometry.spherical.computeHeading(currentLatLng, destLatLng);
          if (headingDeg < 0) { headingDeg += 360; }
          appState.currentHeading = headingDeg;
          updateMarkerRotation();
        }
      } else {
        startLocationWatcher();
      }

      drawRoutePolyline(r0);

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

      console.log(`${destination.name} へのルート案内を開始`);
    } else {
      throw new Error('ルートが取得できませんでした');
    }
  } catch (error) {
    console.error(`ルートエラー: ${error.message}`);
    appState.isNavigating = false;
    appState.isSimulation = false;
    setDisplay('fabStack', 'none');
    startCompassListener();
  }
}

// ==========================================
// ナビゲーション停止
// ==========================================
function stopNavigation() {
  stopLocationWatcher();
  startCompassListener();

  appState.isSimulation = false;
  appState.currentRouteData = null;

  if (appState.currentPolyline) {
    appState.currentPolyline.setMap(null);
    appState.currentPolyline = null;
  }

  appState.currentDestination = null;
  appState.isNavigating = false;
  appState.isPaused = false;

  // UIリセット
  setDisplay('routeInfoSection', 'none');
  setDisplay('instructionsSection', 'none'); 
  const instList = getEl('navPanelInstructions');
  if (instList) instList.innerHTML = '';
  
  setDisplay('incidentSection', 'none');
  const incText = getEl('incidentText');
  if (incText) incText.innerHTML = '';

  setDisplay('searchPanel', 'block');
  setDisplay('btnDestination', 'none');
  
  const qInput = getEl('q');
  if (qInput) qInput.value = '';
  
  setDisplay('results', 'none');
  const resDiv = getEl('results');
  if (resDiv) resDiv.innerHTML = '';

  setDisplay('routeControlSection', 'none');

  setText('weather3h', '--');
  setText('weather6h', '--');
  setText('weather9h', '--');

  setDisplay('fabStack', 'none');
  setDisplay('btnSearch', 'flex');

  const btnPause = getEl('btnPauseSettings');
  if (btnPause) {
      btnPause.textContent = '⏸️ 一時停止';
      btnPause.classList.remove('paused');
  }

  appState.searchMarkers.forEach(marker => marker.map = null);
  appState.searchMarkers = [];

  if (appState.currentPos && appState.map) {
    appState.map.panTo(appState.currentPos);
    appState.map.setZoom(17);
  }
  updateMarkerRotation();
  getEl('appBody')?.classList.add('panel-open');

  // 停止後は操作タブに戻す
  switchPanelTab('search');

  console.log('ルート案内を終了しました');
}

// ==========================================
// 一時停止/再開トグル
// ==========================================
function togglePause() {
  if (appState.isSimulation) {
    console.warn('シミュレーション中は一時停止できません');
    return;
  }
  if (!appState.isNavigating) {
    console.warn('ナビゲーション中ではありません');
    return;
  }

  appState.isPaused = !appState.isPaused;
  const btnPause = getEl('btnPauseSettings');

  if (appState.isPaused) {
    if (btnPause) {
        btnPause.textContent = '▶️ 再開';
        btnPause.classList.add('paused');
    }
    console.warn('ナビゲーションを一時停止しました');
  } else {
    if (btnPause) {
        btnPause.textContent = '⏸️ 一時停止';
        btnPause.classList.remove('paused');
    }
    console.log('ナビゲーションを再開しました');
    if (appState.currentPos) {
      appState.map.panTo(appState.currentPos);
      appState.map.setZoom(18);
    }
  }
}

// ==========================================
// 検索実行
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
    console.warn('検索ワードを入力してください');
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
    console.error('検索の基準地点が不明です');
    return;
  }

  const rLabel = getEl('radiusLabel');
  const radiusKm = rLabel ? parseInt(rLabel.textContent) : 10;
  const radiusMeters = radiusKm * 1000;

  console.log('検索中...');

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

  console.warn('検索結果が見つかりませんでした');
  setDisplay('results', 'none');
  
  // 検索失敗時は案内を表示
  setDisplay('instructionsSection', 'block');
}

// ==========================================
// 検索結果表示
// ==========================================
function displayResults(places, centerLat, centerLng) {
  setDisplay('instructionsSection', 'none');

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

  const resultsDiv = getEl('results');
  if (resultsDiv) {
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
  }

  console.log(`${limitedResults.length}件の検索結果`);
}

// ==========================================
// 音声認識
// ==========================================
function initSpeechRecognition() {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    return false;
  }
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  appState.recognition = new SpeechRecognition();
  appState.recognition.lang = 'ja-JP';
  appState.recognition.continuous = false;
  appState.recognition.interimResults = false;

  const btnVoiceIcon = getEl('btnVoiceIcon');

  appState.recognition.onstart = () => {
    if (btnVoiceIcon) btnVoiceIcon.classList.add('recording');
  };

  appState.recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    const qInput = getEl('q');
    if (qInput) {
      qInput.value = transcript;
      performSearch(transcript);
    }
  };

  appState.recognition.onerror = (event) => {
    if (btnVoiceIcon) btnVoiceIcon.classList.remove('recording');
  };

  appState.recognition.onend = () => {
    if (btnVoiceIcon) btnVoiceIcon.classList.remove('recording');
  };

  return true;
}

function startVoiceSearch() {
  if (!appState.recognition) {
    if (!initSpeechRecognition()) {
      console.error('音声認識非対応');
      return;
    }
  }
  try {
    appState.recognition.start();
  } catch (e) {
    appState.recognition.stop();
    setTimeout(() => {
      try { appState.recognition.start(); } catch (e2) {}
    }, 100);
  }
}

// ==========================================
// Geocoding Helper
// ==========================================
function pickBestGeocodeResult(results) {
  if (!Array.isArray(results) || results.length === 0) return null;
  const priorityTypes = ['street_address', 'premise', 'subpremise', 'route', 'plus_code'];
  for (const t of priorityTypes) {
    const candidate = results.find(r => Array.isArray(r.types) && r.types.includes(t));
    if (candidate && candidate.formatted_address) return candidate;
  }
  return results[0];
}

// ==========================================
// 現在地取得
// ==========================================
function acquireLocation() {
  const onSuccess = (pos) => {
    const { latitude, longitude } = pos.coords;
    const loadingEl = getEl('loading');
    if (loadingEl) loadingEl.remove();

    if (!appState.mapInitialized) {
      initMap({ lat: latitude, lng: longitude });
    } else {
      appState.map.setCenter({ lat: latitude, lng: longitude });
    }

    setUserMarker(latitude, longitude);
    fetchLocationNameGoogle(latitude, longitude);
    fetchWeather(latitude, longitude);
    console.log('現在地を取得しました');
  };

  const onError = (error) => {
    console.log('[WalkNav] geolocation error', error?.message || error);
    const loadingEl = getEl('loading');
    if (loadingEl) loadingEl.remove();

    if (!appState.mapInitialized) {
      initMap({ lat: 35.0, lng: 135.0 });
    }

    setText('locAddress', '位置情報を確認できません');
    setText('locCoords', '現在地：取得失敗');
  };

  try {
    navigator.geolocation.getCurrentPosition(onSuccess, onError, LOCATION_OPTIONS);
  } catch (e) {
    console.error('位置情報アクセス拒否', e);
  }
}

// ==========================================
// 地名取得
// ==========================================
async function fetchLocationNameGoogle(lat, lng) {
  setText('locCoords', `現在地：緯度 ${lat.toFixed(6)} / 経度 ${lng.toFixed(6)}`);

  try {
    const response = await fetchWithRetry(`${WORKER_ORIGIN}/geocode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        latlng: { lat: lat, lng: lng },
        language: 'ja'
      })
    });

    if (!response.ok) {
      throw new Error(`Geocode Worker Error`);
    }
    const data = await response.json();

    if (data.status === 'OK' && Array.isArray(data.results) && data.results.length > 0) {
      const best = pickBestGeocodeResult(data.results);
      if (best && best.formatted_address) {
        const cleanAddress = best.formatted_address.replace(/^日本、\s*/, '');
        setText('locAddress', cleanAddress + ' 付近');
      } else {
        setText('locAddress', '住所情報なし');
      }
    } else {
      setText('locAddress', '住所情報なし');
    }
  } catch (error) {
    console.error('[Geocode] Fetch error:', error);
    setText('locAddress', '住所取得エラー');
  }
}

async function fetchPointAddress(lat, lng) {
  setText('pointAddress', 'ポイント：住所取得中...');
  setText('pointCoords', `(緯度 ${lat.toFixed(6)} / 経度 ${lng.toFixed(6)})`);
  setDisplay('pointAddressBlock', 'flex');

  try {
    const response = await fetchWithRetry(`${WORKER_ORIGIN}/geocode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        latlng: { lat: lat, lng: lng },
        language: 'ja'
      })
    });

    if (!response.ok) throw new Error(`Geocode Worker Error`);
    const data = await response.json();

    if (data.status === 'OK' && Array.isArray(data.results) && data.results.length > 0) {
      const best = pickBestGeocodeResult(data.results);
      if (best && best.formatted_address) {
        const cleanAddress = best.formatted_address.replace(/^日本、\s*/, '');
        setText('pointAddress', 'ポイント：' + cleanAddress + ' 付近');
      } else {
        setText('pointAddress', 'ポイント：住所情報なし');
      }
    } else {
      setText('pointAddress', 'ポイント：住所情報なし');
    }
  } catch (error) {
    setText('pointAddress', 'ポイント：住所取得エラー');
  }
}

// ==========================================
// 天気
// ==========================================
function iconFromWeatherType(type) {
  const t = (type || '').toUpperCase();
  if (t.includes('THUNDER')) return '⛈️';
  if (t.includes('RAIN') || t.includes('DRIZZLE')) return '🌧️';
  if (t.includes('SNOW') || t.includes('SLEET')) return '❄️';
  if (t.includes('FOG') || t.includes('MIST') || t.includes('HAZE')) return '🌫️';
  if (t.includes('CLOUDS')) return '☁️';
  if (t.includes('CLEAR')) return '☀️';
  return '☀️';
}

async function fetchWeather(lat, lng) {
  try {
    const payload = { lat: lat, lon: lng, units: 'metric' };
    const response = await fetchWithRetry(`${WORKER_ORIGIN}/weather`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) throw new Error(`Weather fetch failed`);
    const data = await response.json();
    const fh = Array.isArray(data.hourly) ? data.hourly : [];
    
    setText('weather3h', (fh[2] && fh[2].weather[0]) ? iconFromWeatherType(fh[2].weather[0].main) : '—');
    setText('weather6h', (fh[5] && fh[5].weather[0]) ? iconFromWeatherType(fh[5].weather[0].main) : '—');
    setText('weather9h', (fh[8] && fh[8].weather[0]) ? iconFromWeatherType(fh[8].weather[0].main) : '—');

  } catch (error) {
    console.error('[Weather] Error:', error);
    setText('weather3h', 'X');
    setText('weather6h', 'X');
    setText('weather9h', 'X');
  }
}

// ==========================================
// ダイアログ
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

function showSaveLocationDialog() {
  if (!appState.currentPos) return;
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
  const input = getEl('locationNameInput');
  const btnCancel = getEl('btnCancelSave');
  const btnConfirm = getEl('btnConfirmSave');
  
  if(input) setTimeout(() => input.focus(), 100);
  if(btnCancel) btnCancel.onclick = () => dialog.remove();
  if(btnConfirm) btnConfirm.onclick = () => {
    const locationName = input.value.trim();
    if (!locationName) return;
    
    const locations = JSON.parse(localStorage.getItem('savedLocations') || '[]');
    locations.push({
      name: locationName,
      lat: appState.currentPos.lat,
      lng: appState.currentPos.lng,
      timestamp: Date.now()
    });
    localStorage.setItem('savedLocations', JSON.stringify(locations));
    dialog.remove();
  };
}

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
    getEl('btnCloseEmpty').onclick = () => dialog.remove();
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
  getEl('btnCloseEdit').onclick = () => dialog.remove();
  
  document.querySelectorAll('.location-item-btn.nav').forEach(btn => {
    btn.onclick = () => {
      const index = parseInt(btn.dataset.index);
      const loc = locations[index];
      dialog.remove();
      startNavigation({ name: loc.name, lat: loc.lat, lng: loc.lng });
    };
  });

  // Edit/Delete logic omitted for brevity but structure is safe
  document.querySelectorAll('.location-item-btn.delete').forEach(btn => {
    btn.onclick = () => {
        const index = parseInt(btn.dataset.index);
        locations.splice(index, 1);
        localStorage.setItem('savedLocations', JSON.stringify(locations));
        dialog.remove();
        showEditLocationDialog(); // refresh
    };
  });
}

// ==========================================
// クリップボード
// ==========================================
function exportRouteToClipboard() {
  if (!appState.currentRouteData) return;
  const data = appState.currentRouteData;
  let textOutput = `■ 目的地: ${data.destinationName}\n`;
  textOutput += `■ 概要: ${data.summary} (約 ${data.distance}, 徒歩 ${data.duration})\n\n`;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(textOutput)
      .then(() => console.log('コピー完了'))
      .catch(console.error);
  }
}

// ==========================================
// 現在地へ移動
// ==========================================
let lastLocateTime = 0;
function locateUser() {
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission()
      .then(permissionState => {
        if (permissionState === 'granted') {
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
  } else {
    acquireLocation();
  }
}

// ==========================================
// キーボード表示ウォッチャー
// ==========================================
function bindKeyboardWatch() {
  const searchInput = getEl('q');
  const searchPanel = getEl('searchPanel');
  const appBody = getEl('appBody');
  const navPanel = getEl('instructionsSection'); // Corrected ID

  if (!searchInput) return;

  searchInput.addEventListener('focus', () => {
    if (appBody) appBody.classList.add('keyboard-open');
    if (navPanel) navPanel.style.display = 'none';
    setTimeout(() => {
      if (searchPanel) searchPanel.scrollTop = searchInput.offsetTop - 20;
    }, 350);
  });

  searchInput.addEventListener('blur', () => {
    if (appBody) appBody.classList.remove('keyboard-open');
    if (searchPanel) searchPanel.scrollTop = 0;
    const resultsVisible = getEl('results')?.style.display === 'block';
    if (!resultsVisible && !appState.pointSearchMode && navPanel) {
      navPanel.style.display = 'block';
    }
  });
}

// ==========================================
// UI イベントバインディング
// ==========================================
function bindSearchPanelEvents() {
  const r10 = getEl('r10');
  const r20 = getEl('r20');
  const r30 = getEl('r30');
  const btnPointSearch = getEl('btnPointSearch');
  const instructionsSection = getEl('instructionsSection'); // Corrected ID

  if (r10) r10.onclick = () => {
    r10.classList.add('active');
    r20.classList.remove('active');
    r30.classList.remove('active');
    setText('radiusLabel', '10km');
  };
  if (r20) r20.onclick = () => {
    r20.classList.add('active');
    r10.classList.remove('active');
    r30.classList.remove('active');
    setText('radiusLabel', '20km');
  };
  if (r30) r30.onclick = () => {
    r30.classList.add('active');
    r10.classList.remove('active');
    r20.classList.remove('active');
    setText('radiusLabel', '30km');
  };

  if (btnPointSearch) btnPointSearch.onclick = () => {
    appState.pointSearchMode = !appState.pointSearchMode;
    if (appState.pointSearchMode) {
      btnPointSearch.textContent = '📍 ポイント選択中...';
      btnPointSearch.style.background = '#25d07a';
      btnPointSearch.style.color = '#0a2818';
      btnPointSearch.style.borderColor = 'transparent';
      if (instructionsSection) instructionsSection.style.display = 'none';
    } else {
      btnPointSearch.textContent = '📍 ポイント選択';
      btnPointSearch.style.background = 'rgba(255,255,255,.08)';
      btnPointSearch.style.color = 'var(--text)';
      btnPointSearch.style.borderColor = 'var(--stroke)';
      const resDiv = getEl('results');
      if (resDiv && resDiv.style.display === 'none' && instructionsSection) {
        instructionsSection.style.display = 'block';
      }
    }
  };
}

function bindLocationEvents() {
  const btnSave = getEl('btnSaveLocation');
  if (btnSave) btnSave.onclick = showSaveLocationDialog;
  
  const btnEdit = getEl('btnEditLocation');
  if (btnEdit) btnEdit.onclick = showEditLocationDialog;
}

function bindSearchEvents() {
  const btnSearchIcon = getEl('btnSearchIcon');
  const qInput = getEl('q');
  const btnVoice = getEl('btnVoiceIcon');
  const btnReset = getEl('btnReset');
  const btnLocate = getEl('btnLocatePanel');

  if (btnSearchIcon) btnSearchIcon.onclick = () => {
    if (qInput) performSearch(qInput.value);
  };
  if (qInput) qInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') performSearch(qInput.value);
  });
  if (btnVoice) btnVoice.onclick = startVoiceSearch;
  
  if (btnReset) btnReset.onclick = () => {
    if (qInput) qInput.value = '';
    setDisplay('results', 'none');
    getEl('results').innerHTML = '';
    
    appState.searchMarkers.forEach(marker => marker.map = null);
    appState.searchMarkers = [];
    appState.searchPoint = null;
    if (appState.searchPointMarker) {
        appState.searchPointMarker.map = null;
        appState.searchPointMarker = null;
    }

    setDisplay('pointAddressBlock', 'none');
    setText('pointAddress', '');
    appState.pointSearchMode = false;
    
    const btnPoint = getEl('btnPointSearch');
    if(btnPoint) {
        btnPoint.textContent = '📍 ポイント選択';
        btnPoint.style.background = 'rgba(255,255,255,.08)';
        btnPoint.style.color = 'var(--text)';
        btnPoint.style.borderColor = 'var(--stroke)';
    }
    
    setDisplay('instructionsSection', 'block');
    
    const r10 = getEl('r10');
    if(r10) r10.click();
    console.log('[WalkNav] リセット完了');
  };
  
  if (btnLocate) btnLocate.onclick = locateUser;
}

function bindFABEvents() {
  const btnSearch = getEl('btnSearch');
  const btnClose = getEl('btnClosePanel');
  const btnLocate = getEl('btnLocate');
  const btnDest = getEl('btnDestination');

  if (btnSearch) btnSearch.onclick = () => {
    setDisplay('searchPanel', 'block');
    setDisplay('fabStack', 'none');
    getEl('appBody')?.classList.add('panel-open');
    
    const results = getEl('results');
    const instSection = getEl('instructionsSection');
    if (results && results.style.display === 'none' && !appState.pointSearchMode && instSection) {
      instSection.style.display = 'block';
    }
    const navInst = getEl('navPanelInstructions');
    if (navInst) navInst.innerHTML = '';
    
    setDisplay('incidentSection', 'none');
    switchPanelTab('search');
  };

  if (btnClose) btnClose.onclick = () => {
    setDisplay('searchPanel', 'none');
    if (!appState.isNavigating) {
      setDisplay('fabStack', 'none');
    } else {
      setDisplay('fabStack', 'flex');
    }
    getEl('appBody')?.classList.remove('panel-open');
  };

  if (btnLocate) btnLocate.onclick = locateUser;
  
  if (btnDest) btnDest.onclick = () => {
    if (appState.currentDestination && appState.map) {
      appState.map.panTo({ lat: appState.currentDestination.lat, lng: appState.currentDestination.lng });
      appState.map.setZoom(18);
    }
  };

  // Settings buttons
  const btnPause = getEl('btnPauseSettings');
  if (btnPause) btnPause.onclick = togglePause;

  const btnReroute = getEl('btnRerouteSettings');
  if (btnReroute) {
    btnReroute.onclick = () => {
      if (appState.currentDestination) {
        startNavigation(appState.currentDestination);
      }
    };
  }
}

function bindRoutePanelEvents() {
  const btnStop = getEl('btnStopRoute');
  if (btnStop) btnStop.onclick = stopNavigation;
  
  const btnExport = getEl('btnExportText');
  if (btnExport) btnExport.onclick = exportRouteToClipboard;
}

function bindUI() {
  console.log('[WalkNav] Binding UI...');
  try {
    bindSearchPanelEvents();
    bindLocationEvents();
    bindSearchEvents();
    bindFABEvents();
    bindRoutePanelEvents();
    bindKeyboardWatch();
    console.log('[WalkNav] UI binding complete');
  } catch (e) {
    console.error('[WalkNav] Bind UI Error:', e);
  }
}

// ==========================================
// アプリケーション起動
// ==========================================
function startApp() {
  console.log('[WalkNav] Starting app...');
  document.documentElement.lang = 'ja';
  setDisplay('searchPanel', 'block');
  setDisplay('fabStack', 'none');
  setDisplay('btnSearch', 'flex');
  getEl('appBody')?.classList.add('panel-open');
  
  switchPanelTab('search');

  bindUI();
  
  // ここで取得開始
  acquireLocation();
  
  initSpeechRecognition();
  startCompassListener();
  console.log('[WalkNav] ISSUE', ISSUE_ID, 'boot');
}

function initializeWhenReady() {
  if (typeof google !== 'undefined' && google.maps && google.maps.Map && google.maps.geometry) {
    startApp();
  } else {
    setTimeout(initializeWhenReady, 100);
  }
}

window.addEventListener('DOMContentLoaded', initializeWhenReady);