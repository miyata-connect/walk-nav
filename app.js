'use strict';

/*
  WalkNav - app.js (Full)
  - HTTP/HTTPS 両対応（天気: Open-Meteo直叩き／Worker経由フォールバック）
  - Google Maps JS API + Places/Directions（表示は index.html 側の <script> でロード）
  - 全機能維持（検索、ポイント選択、保存地点、道順コピー、ナビ、方位、天気表示）
*/

// ==========================================
// 定数定義
// ==========================================
const ISSUE_ID = 'idx202511050540'; // トラッキング用
const API_KEY = 'AIzaSyBXC6CB2yaUkrJ5UYj3mymAsruQe4MzGPk'; // Maps表示用のみ（index.htmlで読み込む）
const WORKER_ORIGIN = 'https://ors-proxy.miyata-connect-jp.workers.dev';
const DEFAULT_MASK = 'places.displayName,places.formattedAddress,places.location,places.id,places.types';
const MAX_RETRY = 3;
const RETRY_DELAY = 1000;
const LOCATION_OPTIONS = {
  enableHighAccuracy: true,
  timeout: 30000,
  maximumAge: 0
};

// Open-Meteo エンドポイント（APIキー不要）
const OPEN_METEO_ENDPOINT = 'https://api.open-meteo.com/v1/forecast';

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
// API (Worker経由: Places/Search)
// ==========================================
async function placesTextSearch(payload, fieldMask) {
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
  return resp.json();
}

async function placesNearby(payload, fieldMask) {
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
           style="width:100%;height:100%;transform:rotate(${appState.currentHeading}deg);
                  transition:transform .2s ease-out;filter:drop-shadow(0 2px 4px rgba(0,0,0,.4));">
        <path d="M12 2L4.5 20.5L12 16.5L19.5 20.5L12 2Z"
              fill="#3aa0ff" stroke="#ffffff" stroke-width="2" stroke-linejoin="round" />
      </svg>`;
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
  if (appState.searchPointMarker) appState.searchPointMarker.map = null;

  const pin = document.createElement('div');
  pin.style.width = '30px';
  pin.style.height = '30px';
  pin.style.borderRadius = '50% 50% 50% 0';
  pin.style.background = '#ff6565';
  pin.style.border = '3px solid #fff';
  pin.style.transform = 'rotate(-45deg)';
  pin.style.boxShadow = '0 4px 8px rgba(0,0,0,.3)';
  pin.style.transition = 'all .3s ease-out';

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
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) ** 2;
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
// ルートポリライン描画
// ==========================================
function getEncodedPolylineFromRoute(route) {
  if (route?.overview_polyline?.points) return route.overview_polyline.points;
  if (route?.polyline?.encodedPolyline) return route.polyline.encodedPolyline;
  if (route?.overviewPolyline?.encodedPolyline) return route.overviewPolyline.encodedPolyline;
  return null;
}
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
    path,
    geodesic: true,
    strokeColor: '#62b5ff',
    strokeOpacity: 0.8,
    strokeWeight: 6,
    map: appState.map
  });
}

// ==========================================
// コンパス（デバイスの向き）監視
// ==========================================
const compassHandler = (event) => {
  if (appState.isNavigating) return;
  let heading = null;
  if (event.webkitCompassHeading) heading = event.webkitCompassHeading; // iOS
  else if (event.absolute === true && event.alpha !== null) heading = event.alpha; // Android
  if (heading !== null) {
    appState.currentHeading = heading;
    updateMarkerRotation();
  }
};
function startCompassListener() {
  if (appState.compassWatchId || !window.DeviceOrientationEvent) {
    if (!window.DeviceOrientationEvent) console.warn('[Compass] not supported');
    return;
  }
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission()
      .then((state) => {
        if (state === 'granted') {
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
    window.removeEventListener('deviceorientationabsolute', compassHandler, true);
    window.removeEventListener('deviceorientation', compassHandler, true);
    appState.compassWatchId = null;
  }
}
function updateMarkerRotation() {
  const icon = document.getElementById('user-marker-icon');
  if (icon) icon.style.transform = `rotate(${appState.currentHeading}deg)`;
}

// ==========================================
// リアルタイム位置情報監視（ナビ中）
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
        const currentLatLng = new google.maps.LatLng(latitude, longitude);
        const destLatLng = new google.maps.LatLng(appState.currentDestination.lat, appState.currentDestination.lng);
        let headingDeg = google.maps.geometry.spherical.computeHeading(currentLatLng, destLatLng);
        if (headingDeg < 0) headingDeg += 360;
        appState.currentHeading = headingDeg;
        updateMarkerRotation();
      }
    }
  };
  const onWatchError = (error) => {
    console.error('[Location] Watch error:', error.message);
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
// ナビゲーション開始 (シミュレーション対応)
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
    console.error('起点が設定されていません');
    return;
  }

  appState.currentDestination = destination;
  appState.isNavigating = true;
  appState.isPaused = false;

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
          const cleanInstruction = (step.html_instructions || '').replace(/<[^>]+>/g, ' ');
          item.textContent = `${cleanInstruction} (${step.distance.text})`;
          instructionsList.appendChild(item);
        });
      }
      document.getElementById('navPanel').style.display = 'block';

      appState.currentRouteData = {
        steps: l0?.steps || [],
        summary: r0.summary || '',
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

      // 天気表示
      fetchWeather(originLat, originLng);

      if (appState.isSimulation) {
        setUserMarker(originLat, originLng);
        fetchLocationNameGoogle(originLat, originLng);
        if (appState.currentDestination && google.maps.geometry) {
          const currentLatLng = new google.maps.LatLng(originLat, originLng);
          const destLatLng = new google.maps.LatLng(appState.currentDestination.lat, appState.currentDestination.lng);
          let headingDeg = google.maps.geometry.spherical.computeHeading(currentLatLng, destLatLng);
          if (headingDeg < 0) headingDeg += 360;
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
    } else {
      throw new Error('ルートが取得できませんでした');
    }
  } catch (error) {
    console.error('[Navigation] Error:', error);
    appState.isNavigating = false;
    appState.isSimulation = false;
    document.getElementById('fabStack').style.display = 'none';
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

  const btnPause = document.getElementById('btnPause');
  btnPause.textContent = '一時停止';
  btnPause.classList.remove('paused');

  appState.searchMarkers.forEach(marker => marker.map = null);
  appState.searchMarkers = [];

  if (appState.currentPos && appState.map) {
    appState.map.panTo(appState.currentPos);
    appState.map.setZoom(17);
  }

  updateMarkerRotation();
  document.getElementById('appBody').classList.add('panel-open');
}

// ==========================================
// 一時停止/再開
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
// 検索処理
// ==========================================
const TYPE_MAP = {
  'コンビニ': 'convenience_store',
  'スーパー': 'supermarket',
  'レストラン': 'restaurant',
  'カフェ': 'cafe',
  'ホテル': 'lodging',
  '病院': 'hospital',
  '薬局': 'pharmacy',
  'ガソリンスタンド': 'gas_station',
  '駐車場': 'parking',
  '銀行': 'bank'
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

  const radiusKm = parseInt(document.getElementById('radiusLabel').textContent);
  const radiusMeters = radiusKm * 1000;

  try {
    const data = await placesTextSearch({
      textQuery: query.trim(),
      locationBias: { circle: { center: { latitude: centerLat, longitude: centerLng }, radius: radiusMeters } },
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
        locationRestriction: { circle: { center: { latitude: centerLat, longitude: centerLng }, radius: radiusMeters } },
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
  document.getElementById('results').style.display = 'none';
  document.getElementById('navPanel').style.display = 'block';
}

// ==========================================
// 検索結果表示
// ==========================================
function displayResults(places, centerLat, centerLng) {
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
      <div style="font-size:11px;color:#62b5ff;margin-top:4px">📍 ${distanceKm}km</div>
    `;
    item.onclick = () => {
      startNavigation({ name, lat, lng });
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

// ==========================================
// 音声認識
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

  const btnVoiceIcon = document.getElementById('btnVoiceIcon');
  appState.recognition.onstart = () => {
    btnVoiceIcon.classList.add('recording');
  };
  appState.recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    document.getElementById('q').value = transcript;
    performSearch(transcript);
  };
  appState.recognition.onerror = () => {
    btnVoiceIcon.classList.remove('recording');
  };
  appState.recognition.onend = () => {
    btnVoiceIcon.classList.remove('recording');
  };
  return true;
}
function startVoiceSearch() {
  if (!appState.recognition) {
    if (!initSpeechRecognition()) {
      console.error('お使いのブラウザは音声認識に対応していません');
      return;
    }
  }
  try {
    appState.recognition.start();
  } catch {
    try {
      appState.recognition.stop();
      setTimeout(() => appState.recognition.start(), 120);
    } catch {}
  }
}

// ==========================================
// 現在地取得（初回）
// ==========================================
function acquireLocation() {
  const onSuccess = (pos) => {
    const { latitude, longitude } = pos.coords;
    document.getElementById('loading')?.remove();
    if (!appState.map) initMap({ lat: latitude, lng: longitude });
    appState.map.setCenter({ lat: latitude, lng: longitude });
    setUserMarker(latitude, longitude);
    fetchLocationNameGoogle(latitude, longitude);
  };
  const onError = (error) => {
    console.log('[WalkNav] geolocation error', error?.message || error);
    document.getElementById('loading')?.remove();
    if (!appState.map) initMap({ lat: 35.6812, lng: 139.7671 }); // 東京駅
    const addressElement = document.getElementById('locAddress');
    const coordsElement = document.getElementById('locCoords');
    if (addressElement) addressElement.textContent = '位置情報を確認できません';
    if (coordsElement) coordsElement.textContent = '現在地：取得失敗';
  };
  try {
    navigator.geolocation.getCurrentPosition(onSuccess, onError, LOCATION_OPTIONS);
  } catch (e) {
    console.log('[WalkNav] geolocation exception', e);
  }
}

// ==========================================
// 地名取得（逆ジオコーディング）- Cloudflare経由
// ==========================================
async function fetchLocationNameGoogle(lat, lng) {
  const addressElement = document.getElementById('locAddress');
  const coordsElement = document.getElementById('locCoords');
  if (!addressElement || !coordsElement) return;

  coordsElement.textContent = `現在地：緯度 ${lat.toFixed(6)} / 経度 ${lng.toFixed(6)}`;
  try {
    const params = new URLSearchParams({ lat, lng, language: 'ja' });
    const response = await fetchWithRetry(`${WORKER_ORIGIN}/geocode?${params.toString()}`);
    if (!response.ok) {
      addressElement.textContent = '住所情報なし';
      return;
    }
    const data = await response.json();
    if (data.status === 'OK' && data.results[0]) {
      const address = data.results[0].formatted_address;
      const cleanAddress = address.replace(/^日本、\s*/, '');
      addressElement.textContent = `${cleanAddress} 付近`;
    } else {
      addressElement.textContent = '住所情報なし';
    }
  } catch {
    addressElement.textContent = '住所取得エラー';
  }
}

// ==========================================
// ポイント選択時の地名取得
// ==========================================
async function fetchPointAddress(lat, lng) {
  const addressBlock = document.getElementById('pointAddressBlock');
  const addressElement = document.getElementById('pointAddress');
  const coordsElement = document.getElementById('pointCoords');
  if (!addressElement || !coordsElement || !addressBlock) return;

  addressElement.textContent = 'ポイント：住所取得中...';
  coordsElement.textContent = `(緯度 ${lat.toFixed(6)} / 経度 ${lng.toFixed(6)})`;
  addressBlock.style.display = 'flex';

  try {
    const params = new URLSearchParams({ lat, lng, language: 'ja' });
    const response = await fetchWithRetry(`${WORKER_ORIGIN}/geocode?${params.toString()}`);
    if (!response.ok) {
      addressElement.textContent = 'ポイント：住所情報なし';
      return;
    }
    const data = await response.json();
    if (data.status === 'OK' && data.results[0]) {
      const address = data.results[0].formatted_address;
      const cleanAddress = address.replace(/^日本、\s*/, '');
      addressElement.textContent = `ポイント：${cleanAddress} 付近`;
    } else {
      addressElement.textContent = 'ポイント：住所情報なし';
    }
  } catch {
    addressElement.textContent = 'ポイント：住所取得エラー';
  }
}

// ==========================================
// 天気予報取得（Open-Meteo 優先 / Worker フォールバック）
// ==========================================

// Open-Meteo weathercode → 絵文字
function weatherCodeToEmoji(code) {
  // 参照: https://open-meteo.com/en/docs
  if (code === 0) return '☀️';                               // Clear
  if ([1, 2, 3].includes(code)) return '🌤️';                 // Mainly clear / partly cloudy / overcast
  if ([45, 48].includes(code)) return '🌫️';                  // Fog
  if ([51, 53, 55].includes(code)) return '🌦️';              // Drizzle
  if ([61, 63, 65].includes(code)) return '🌧️';              // Rain
  if ([66, 67].includes(code)) return '🌧️';                  // Freezing rain
  if ([71, 73, 75, 77].includes(code)) return '❄️';          // Snow
  if ([80, 81, 82].includes(code)) return '🌧️';              // Rain showers
  if ([85, 86].includes(code)) return '❄️';                  // Snow showers
  if ([95, 96, 99].includes(code)) return '⛈️';              // Thunderstorm
  return '❔';
}

// Open-Meteo から3h/6h/9h後の weathercode を取得して反映
async function fetchWeatherOpenMeteo(lat, lng) {
  // 1時間刻みの予報から、+3H/+6H/+9H の index を選ぶ
  const url = `${OPEN_METEO_ENDPOINT}?latitude=${lat}&longitude=${lng}&hourly=weather_code,temperature_2m&timezone=auto`;
  const resp = await fetchWithRetry(url, { method: 'GET' });
  if (!resp.ok) throw new Error(`Open-Meteo HTTP ${resp.status}`);
  const data = await resp.json();

  const now = new Date();
  const hourlyTimes = data?.hourly?.time || [];
  const codes = data?.hourly?.weather_code || [];
  if (!hourlyTimes.length || !codes.length) throw new Error('Open-Meteo: empty hourly');

  // 最初の未来タイムのインデックス
  const nowISO = now.toISOString().slice(0, 13); // "YYYY-MM-DDTHH"
  let startIdx = hourlyTimes.findIndex(t => t.slice(0, 13) > nowISO);
  if (startIdx < 0) startIdx = 0;

  const idx3 = startIdx + 3;
  const idx6 = startIdx + 6;
  const idx9 = startIdx + 9;

  const code3 = codes[idx3] ?? null;
  const code6 = codes[idx6] ?? null;
  const code9 = codes[idx9] ?? null;

  document.getElementById('weather3h').textContent = weatherCodeToEmoji(code3);
  document.getElementById('weather6h').textContent = weatherCodeToEmoji(code6);
  document.getElementById('weather9h').textContent = weatherCodeToEmoji(code9);
}

// 既存Worker（/weather）フォールバック
async function fetchWeatherViaWorker(lat, lng) {
  const params = new URLSearchParams({ lat, lng });
  const response = await fetchWithRetry(`${WORKER_ORIGIN}/weather?${params.toString()}`);
  if (!response.ok) {
    const t = await response.text().catch(() => '');
    throw new Error(`Worker weather failed: ${response.status} ${t}`);
  }
  const data = await response.json();
  const w3 = data?.hourly?.[2]?.weather?.[0]?.icon || null;
  const w6 = data?.hourly?.[5]?.weather?.[0]?.icon || null;
  const w9 = data?.hourly?.[8]?.weather?.[0]?.icon || null;

  const iconMap = {
    '01d': '☀️', '01n': '🌙', '02d': '🌤️', '02n': '☁️',
    '03d': '☁️', '03n': '☁️', '04d': '☁️', '04n': '☁️',
    '09d': '🌦️', '09n': '🌦️', '10d': '🌧️', '10n': '🌧️',
    '11d': '⛈️', '11n': '⛈️', '13d': '❄️', '13n': '❄️',
    '50d': '🌫️', '50n': '🌫️',
  };
  const em = (c) => iconMap[c] || '❔';

  document.getElementById('weather3h').textContent = em(w3);
  document.getElementById('weather6h').textContent = em(w6);
  document.getElementById('weather9h').textContent = em(w9);
}

// 最終公開関数：Open-Meteo優先、失敗時Worker
async function fetchWeather(lat, lng) {
  try {
    await fetchWeatherOpenMeteo(lat, lng);
  } catch (e1) {
    console.warn('[Weather] Open-Meteo error, fallback to Worker:', e1?.message || e1);
    try {
      await fetchWeatherViaWorker(lat, lng);
    } catch (e2) {
      console.error('[Weather] Fallback failed:', e2?.message || e2);
      document.getElementById('weather3h').textContent = 'X';
      document.getElementById('weather6h').textContent = 'X';
      document.getElementById('weather9h').textContent = 'X';
    }
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
// 現在地登録・編集
// ==========================================
function showSaveLocationDialog() {
  if (!appState.currentPos) {
    console.error('現在地が取得できていません');
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
      input.style.borderColor = 'var(--danger)';
      setTimeout(() => { input.style.borderColor = 'var(--stroke)'; }, 2000);
      return;
    }
    const locations = JSON.parse(localStorage.getItem('savedLocations') || '[]');
    locations.push({ name: locationName, lat: appState.currentPos.lat, lng: appState.currentPos.lng, timestamp: Date.now() });
    localStorage.setItem('savedLocations', JSON.stringify(locations));
    dialog.remove();
  };
  input.addEventListener('keypress', (e) => { if (e.key === 'Enter') btnConfirm.click(); });
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
      </div>`;
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

  document.querySelectorAll('.location-item-btn.nav').forEach(btn => {
    btn.onclick = () => {
      const index = parseInt(btn.dataset.index);
      const loc = locations[index];
      dialog.remove();
      startNavigation({ name: loc.name, lat: loc.lat, lng: loc.lng });
    };
  });

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
      setTimeout(() => { renameInput.focus(); renameInput.select(); }, 100);
      document.getElementById('btnCancelRename').onclick = () => renameDialog.remove();
      document.getElementById('btnConfirmRename').onclick = () => {
        const newName = renameInput.value.trim();
        if (!newName) {
          renameInput.style.borderColor = 'var(--danger)';
          setTimeout(() => { renameInput.style.borderColor = 'var(--stroke)'; }, 2000);
          return;
        }
        locations[index].name = newName;
        localStorage.setItem('savedLocations', JSON.stringify(locations));
        renameDialog.remove();
        dialog.remove();
      };
      renameInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') document.getElementById('btnConfirmRename').click(); });
    };
  });

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
      };
    };
  });
}

// ==========================================
// 道順をクリップボードにコピー
// ==========================================
function exportRouteToClipboard() {
  if (!appState.currentRouteData) {
    console.warn('コピーするルートデータがありません');
    return;
  }
  const data = appState.currentRouteData;
  let textOutput = `■ 目的地: ${data.destinationName}\n`;
  textOutput += `■ 概要: ${data.summary} (約 ${data.distance}, 徒歩 ${data.duration})\n\n`;
  if (data.warnings.length > 0) {
    textOutput += '■ 警告:\n';
    data.warnings.forEach(w => { textOutput += `・ ${w.replace(/<[^>]+>/g, ' ')}\n`; });
    textOutput += '\n';
  }
  textOutput += '■ 道順:\n';
  if (data.steps && data.steps.length > 0) {
    data.steps.forEach((step, index) => {
      const instruction = (step.html_instructions || '').replace(/<[^>]+>/g, ' ');
      textOutput += `${index + 1}. ${instruction} (${step.distance.text})\n`;
    });
  } else {
    textOutput += '詳細な道順はありません。\n';
  }
  if (navigator.clipboard) {
    navigator.clipboard.writeText(textOutput).catch(() => console.error('コピーに失敗しました'));
  } else {
    console.error('お使いのブラウザはコピー機能に非対応です');
  }
}

// ==========================================
// 現在地へ移動（FAB / パネルから共用）
// ==========================================
let lastLocateTime = 0;
function locateUser() {
  if (typeof DeviceOrientationEvent?.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission().then((state) => {
      if (state === 'granted') {
        stopCompassListener();
        appState.compassWatchId = null;
        startCompassListener();
      }
    }).catch(console.error);
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
  const searchInput = document.getElementById('q');
  const searchPanel = document.getElementById('searchPanel');
  const appBody = document.getElementById('appBody');
  const navPanel = document.getElementById('navPanel');

  searchInput.addEventListener('focus', () => {
    appBody.classList.add('keyboard-open');
    navPanel.style.display = 'none';
    setTimeout(() => {
      const inputTopInPanel = searchInput.offsetTop;
      searchPanel.scrollTop = inputTopInPanel - 20;
    }, 350);
  });

  searchInput.addEventListener('blur', () => {
    appBody.classList.remove('keyboard-open');
    searchPanel.scrollTop = 0;
    const resultsVisible = document.getElementById('results').style.display === 'block';
    if (!resultsVisible && !appState.pointSearchMode) {
      navPanel.style.display = 'block';
    }
  });
}

// ==========================================
// UI イベントバインディング
// ==========================================
function bindSearchPanelEvents() {
  const radiusLabel = document.getElementById('radiusLabel');
  const r10 = document.getElementById('r10');
  const r20 = document.getElementById('r20');
  const r30 = document.getElementById('r30');
  const btnPointSearch = document.getElementById('btnPointSearch');
  const navPanel = document.getElementById('navPanel');

  r10.onclick = () => { r10.classList.add('active'); r20.classList.remove('active'); r30.classList.remove('active'); radiusLabel.textContent = '10km'; };
  r20.onclick = () => { r20.classList.add('active'); r10.classList.remove('active'); r30.classList.remove('active'); radiusLabel.textContent = '20km'; };
  r30.onclick = () => { r30.classList.add('active'); r10.classList.remove('active'); r20.classList.remove('active'); radiusLabel.textContent = '30km'; };

  btnPointSearch.onclick = () => {
    appState.pointSearchMode = !appState.pointSearchMode;
    if (appState.pointSearchMode) {
      btnPointSearch.textContent = '📍 ポイント選択中...';
      btnPointSearch.style.background = '#25d07a';
      btnPointSearch.style.color = '#0a2818';
      btnPointSearch.style.borderColor = 'transparent';
      navPanel.style.display = 'none';
    } else {
      btnPointSearch.textContent = '📍 ポイント選択';
      btnPointSearch.style.background = 'rgba(255,255,255,.08)';
      btnPointSearch.style.color = 'var(--text)';
      btnPointSearch.style.borderColor = 'var(--stroke)';
      if (document.getElementById('results').style.display === 'none') navPanel.style.display = 'block';
    }
  };
}
function bindLocationEvents() {
  document.getElementById('btnSaveLocation').onclick = showSaveLocationDialog;
  document.getElementById('btnEditLocation').onclick = showEditLocationDialog;
}
function bindSearchEvents() {
  document.getElementById('btnSearchIcon').onclick = () => {
    const q = document.getElementById('q').value.trim();
    if (q) performSearch(q);
  };
  document.getElementById('q').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const q = document.getElementById('q').value.trim();
      if (q) performSearch(q);
    }
  });
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

    document.getElementById('navPanel').style.display = 'block';

    document.getElementById('r10').classList.add('active');
    document.getElementById('r20').classList.remove('active');
    document.getElementById('r30').classList.remove('active');
    document.getElementById('radiusLabel').textContent = '10km';
  };

  document.getElementById('btnLocatePanel').onclick = locateUser;
}
function bindFABEvents() {
  document.getElementById('btnSearch').onclick = () => {
    document.getElementById('searchPanel').style.display = 'block';
    document.getElementById('fabStack').style.display = 'none';
    document.getElementById('appBody').classList.add('panel-open');
    if (document.getElementById('results').style.display === 'none' && !appState.pointSearchMode) {
      document.getElementById('navPanel').style.display = 'block';
    }
    document.getElementById('navPanelInstructions').innerHTML = '';
    document.getElementById('incidentPanel').style.display = 'none';
  };
  document.getElementById('btnClosePanel').onclick = () => {
    document.getElementById('searchPanel').style.display = 'none';
    if (!appState.isNavigating) {
      document.getElementById('fabStack').style.display = 'none';
      document.getElementById('navPanel').style.display = 'none';
    } else {
      document.getElementById('fabStack').style.display = 'flex';
    }
    document.getElementById('appBody').classList.remove('panel-open');
  };
  document.getElementById('btnLocate').onclick = locateUser;
  document.getElementById('btnDestination').onclick = () => {
    if (appState.currentDestination && appState.map) {
      appState.map.panTo({ lat: appState.currentDestination.lat, lng: appState.currentDestination.lng });
      appState.map.setZoom(18);
    }
  };
  document.getElementById('btnPause').onclick = togglePause;
  document.getElementById('btnReroute').onclick = () => {
    if (appState.currentDestination) startNavigation(appState.currentDestination);
    else console.warn('目的地が設定されていません');
  };
}
function bindRoutePanelEvents() {
  document.getElementById('btnStopRoute').onclick = stopNavigation;
  document.getElementById('btnExportText').onclick = exportRouteToClipboard;
}
function bindUI() {
  bindSearchPanelEvents();
  bindLocationEvents();
  bindSearchEvents();
  bindFABEvents();
  bindRoutePanelEvents();
  bindKeyboardWatch();
}

// ==========================================
// アプリケーション起動
// ==========================================
function startApp() {
  document.documentElement.lang = 'ja';
  document.getElementById('searchPanel').style.display = 'block';
  document.getElementById('fabStack').style.display = 'none';
  document.getElementById('btnSearch').style.display = 'flex';
  document.getElementById('appBody').classList.add('panel-open');
  document.getElementById('navPanel').style.display = 'block';

  bindUI();
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

// DOMContentLoadedからロード監視を開始
window.addEventListener('DOMContentLoaded', initializeWhenReady);