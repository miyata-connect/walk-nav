'use strict';

/* =========================================================
   WalkNav - app.js（Unified Panel 直制御・常時表示）
   ========================================================= */

/* -----------------------------
   定数定義
----------------------------- */
const ISSUE_ID = 'idx20251112-unified-direct';
const WORKER_ORIGIN = 'https://ors-proxy.miyata-connect-jp.workers.dev';
const DEFAULT_MASK = 'places.displayName,places.formattedAddress,places.location,places.id,places.types';
const MAX_RETRY = 3;
const RETRY_DELAY = 1000;
const LOCATION_OPTIONS = {
  enableHighAccuracy: true,
  timeout: 30000,
  maximumAge: 0
};

/* -----------------------------
   状態管理
----------------------------- */
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

/* -----------------------------
   fetch（リトライ付き）
----------------------------- */
async function fetchWithRetry(url, options = {}, retries = MAX_RETRY) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      if (!response.ok && i < retries - 1) {
        console.log(`[Retry] ${i + 1}/${retries}: ${url}`);
        await new Promise(r => setTimeout(r, RETRY_DELAY * (i + 1)));
        continue;
      }
      return response;
    } catch (error) {
      if (i === retries - 1) throw error;
      console.log(`[Retry] ${i + 1}/${retries}: ${error.message}`);
      await new Promise(r => setTimeout(r, RETRY_DELAY * (i + 1)));
    }
  }
}

/* -----------------------------
   Worker 経由 API
----------------------------- */
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
  return await resp.json();
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
  return await resp.json();
}

/* -----------------------------
   Unified Panel 制御（常時表示）
----------------------------- */
function openUnified(tab = 'nav') {
  const unified = document.getElementById('unifiedPanel');
  if (unified) unified.style.display = 'flex';
  if (tab === 'search') {
    document.getElementById('tabSearch')?.click();
    try { localStorage.setItem('activeTab', 'search'); } catch (_) {}
  } else {
    document.getElementById('tabNav')?.click();
    try { localStorage.setItem('activeTab', 'nav'); } catch (_) {}
  }
}
function closeUnified() {
  // 規約：「常時固定」。閉じる操作でも非表示にしない。
  openUnified('nav'); // 代わりに案内タブへ戻す
}

/* -----------------------------
   地図初期化
----------------------------- */
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

/* -----------------------------
   ユーザーマーカー（SVG矢印）
----------------------------- */
function setUserMarker(lat, lng) {
  appState.currentPos = { lat, lng };

  if (!appState.userMarker) {
    const pin = document.createElement('div');
    pin.style.width = '32px';
    pin.style.height = '32px';
    pin.innerHTML = `
      <svg id="user-marker-icon" viewBox="0 0 24 24"
           style="width:100%;height:100%;
                  transform:rotate(${appState.currentHeading}deg);
                  transition:transform .2s ease-out;
                  filter:drop-shadow(0 2px 4px rgba(0,0,0,.4));">
        <path d="M12 2L4.5 20.5L12 16.5L19.5 20.5L12 2Z"
              fill="#3aa0ff" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/>
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

/* -----------------------------
   検索地点設定
----------------------------- */
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

/* -----------------------------
   ユーティリティ
----------------------------- */
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

function readLegDistanceText(leg) {
  if (leg?.distance?.text) return leg.distance.text;
  if (typeof leg?.distanceMeters === 'number') return `${(leg.distanceMeters / 1000).toFixed(1)} km`;
  return leg?.localizedValues?.distance?.text || '--';
}
function readLegDurationText(leg) {
  if (leg?.duration?.text) return leg.duration.text;
  if (typeof leg?.duration === 'string' && leg.duration.endsWith('s')) {
    const sec = parseInt(leg.duration.replace('s', ''), 10) || 0;
    return `${Math.max(1, Math.round(sec / 60))} 分`;
  }
  return leg?.localizedValues?.duration?.text || '--';
}

/* -----------------------------
   ルートポリライン
----------------------------- */
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
    path, geodesic: true, strokeColor: '#62b5ff', strokeOpacity: 0.8, strokeWeight: 6, map: appState.map
  });
}

/* -----------------------------
   コンパス
----------------------------- */
const compassHandler = (event) => {
  if (appState.isNavigating) return;
  let heading = null;
  if (event.webkitCompassHeading) heading = event.webkitCompassHeading;
  else if (event.absolute === true && event.alpha !== null) heading = event.alpha;
  if (heading !== null) {
    appState.currentHeading = heading;
    updateMarkerRotation();
  }
};
function startCompassListener() {
  if (appState.compassWatchId || !window.DeviceOrientationEvent) return;
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission()
      .then(state => {
        if (state === 'granted') {
          window.addEventListener('deviceorientationabsolute', compassHandler, true);
          window.addEventListener('deviceorientation', compassHandler, true);
          appState.compassWatchId = 1;
        }
      }).catch(console.error);
  } else {
    window.addEventListener('deviceorientationabsolute', compassHandler, true);
    window.addEventListener('deviceorientation', compassHandler, true);
    appState.compassWatchId = 1;
  }
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

/* -----------------------------
   位置監視
----------------------------- */
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
  const onWatchError = (error) => {
    console.error('[Location] Watch error:', error.message);
    stopLocationWatcher();
  };
  appState.locationWatchId = navigator.geolocation.watchPosition(onWatchSuccess, onWatchError, LOCATION_OPTIONS);
}
function stopLocationWatcher() {
  if (!appState.locationWatchId) return;
  navigator.geolocation.clearWatch(appState.locationWatchId);
  appState.locationWatchId = null;
}

/* -----------------------------
   ナビ開始
----------------------------- */
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

  // Unified Panel は常時表示。案内タブへ。
  openUnified('nav');

  document.getElementById('fabStack').style.display = 'flex';
  document.getElementById('btnDestination').style.display = 'flex';
  stopCompassListener();

  try {
    const params = new URLSearchParams({
      origin: `${originLat},${originLng}`,
      destination: `${destination.lat},${destination.lng}`,
      mode: 'walking',
      language: 'ja'
    });
    const response = await fetchWithRetry(`${WORKER_ORIGIN}/directions?${params.toString()}`, {}, 3);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Directions API Error: ${response.status} - ${errorText}`);
    }
    const result = await response.json();

    if (!result.routes?.length) throw new Error('ルートが取得できませんでした');

    const r0 = result.routes[0];
    const l0 = (r0.legs && r0.legs[0]) ? r0.legs[0] : null;

    document.getElementById('destinationName').textContent = destination.name;
    document.getElementById('routeDistance').textContent = l0 ? readLegDistanceText(l0) : '--';
    document.getElementById('routeTime').textContent = `徒歩 ${l0 ? readLegDurationText(l0) : '--'}`;
    document.getElementById('routePanel').style.display = 'block';

    const list = document.getElementById('navPanelInstructions');
    list.innerHTML = '';
    if (l0?.steps?.length) {
      l0.steps.forEach(step => {
        const item = document.createElement('div');
        item.className = 'nav-instruction-item';
        const clean = (step.html_instructions || '').replace(/<[^>]+>/g, ' ').trim();
        const distText = step?.distance?.text || step?.distance || '';
        item.textContent = distText ? `${clean} (${distText})` : clean;
        list.appendChild(item);
      });
    }
    document.getElementById('navPanel').style.display = 'block';

    appState.currentRouteData = {
      steps: l0?.steps || [],
      summary: r0.summary,
      distance: l0 ? readLegDistanceText(l0) : '--',
      duration: l0 ? readLegDurationText(l0) : '--',
      destinationName: destination.name,
      warnings: r0.warnings || []
    };

    // warnings → インシデント枠
    const incidentPanel = document.getElementById('incidentPanel');
    const incidentList = document.getElementById('incidentList');
    if (incidentPanel && incidentList) {
      incidentList.innerHTML = '';
      if (r0.warnings?.length) {
        r0.warnings.forEach(w => {
          const div = document.createElement('div');
          div.className = 'incident-item other';
          div.innerHTML = `
            <div class="incident-type"><span class="incident-icon">⚠️</span><span>注意</span></div>
            <div class="incident-description">${(w || '').replace(/<[^>]+>/g, ' ')}</div>`;
          incidentList.appendChild(div);
        });
        incidentPanel.classList.add('has-incidents');
        incidentPanel.style.display = 'block';
      } else {
        incidentPanel.classList.remove('has-incidents');
        incidentPanel.style.display = 'none';
      }
    }

    // 天気
    await fetchWeather(originLat, originLng);

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

    const bounds = new google.maps.LatLngBounds();
    bounds.extend(new google.maps.LatLng(originLat, originLng));
    bounds.extend(new google.maps.LatLng(destination.lat, destination.lng));
    appState.map.fitBounds(bounds, { top: 100, right: 150, bottom: 300, left: 50 });

  } catch (error) {
    console.error('[Navigation] Error:', error);
    appState.isNavigating = false;
    appState.isSimulation = false;
    document.getElementById('fabStack').style.display = 'none';
    startCompassListener();
  }
}

/* -----------------------------
   ナビ停止
----------------------------- */
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

  const incidentPanel = document.getElementById('incidentPanel');
  if (incidentPanel) {
    incidentPanel.style.display = 'none';
    incidentPanel.classList.remove('has-incidents');
    const list = document.getElementById('incidentList');
    if (list) list.innerHTML = '';
  }

  document.getElementById('btnDestination').style.display = 'none';

  // Unified は常時表示のまま 案内タブに固定
  openUnified('nav');

  // 検索系のリセット
  document.getElementById('q').value = '';
  const results = document.getElementById('results');
  results.style.display = 'none';
  results.innerHTML = '';

  appState.searchMarkers.forEach(m => m.map = null);
  appState.searchMarkers = [];

  if (appState.searchPointMarker) appState.searchPointMarker.map = null;
  appState.searchPointMarker = null;
  appState.searchPoint = null;

  document.getElementById('weather1h').textContent = '--';
  document.getElementById('weather2h').textContent = '--';
  document.getElementById('weather3h').textContent = '--';

  console.log('[Navigation] ルート案内終了');
}

/* -----------------------------
   一時停止/再開
----------------------------- */
function togglePause() {
  if (appState.isSimulation) return console.warn('シミュレーション中は一時停止できません');
  if (!appState.isNavigating) return console.warn('ナビゲーション中ではありません');

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

/* -----------------------------
   検索（Worker経由）
----------------------------- */
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
  if (!query || !query.trim()) return console.warn('検索ワードを入力してください');

  let centerLat, centerLng;
  if (appState.pointSearchMode && appState.searchPoint) {
    centerLat = appState.searchPoint.lat;
    centerLng = appState.searchPoint.lng;
  } else if (appState.currentPos) {
    centerLat = appState.currentPos.lat;
    centerLng = appState.currentPos.lng;
  } else {
    return console.error('検索の基準地点が不明です');
  }

  const radiusKm = parseInt(document.getElementById('radiusLabel').textContent);
  const radiusMeters = radiusKm * 1000;

  openUnified('search');

  try {
    const data = await placesTextSearch({
      textQuery: query.trim(),
      locationBias: { circle: { center: { latitude: centerLat, longitude: centerLng }, radius: radiusMeters } },
      maxResultCount: 20, languageCode: 'ja'
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

/* -----------------------------
   検索結果表示
----------------------------- */
function displayResults(places, centerLat, centerLng) {
  document.getElementById('navPanel').style.display = 'none';

  appState.searchMarkers.forEach(marker => marker.map = null);
  appState.searchMarkers = [];

  const placesWithDistance = places.map(place => {
    const lat = place.location.latitude;
    const lng = place.location.longitude;
    return { ...place, distance: calculateDistance(centerLat, centerLng, lat, lng) };
  }).sort((a, b) => a.distance - b.distance)
    .slice(0, 5);

  const resultsDiv = document.getElementById('results');
  resultsDiv.innerHTML = '';
  resultsDiv.style.display = 'block';

  placesWithDistance.forEach((place, index) => {
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
      <div style="font-size:11px;color:#62b5ff;margin-top:4px">📍 ${distanceKm}km</div>`;
    item.onclick = () => startNavigation({ name, lat, lng });
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

/* -----------------------------
   音声認識
----------------------------- */
function initSpeechRecognition() {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    console.log('[Voice] 音声認識は非対応です'); return false;
  }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  appState.recognition = new SR();
  appState.recognition.lang = 'ja-JP';
  appState.recognition.continuous = false;
  appState.recognition.interimResults = false;

  const btn = document.getElementById('btnVoiceIcon');
  appState.recognition.onstart = () => btn.classList.add('recording');
  appState.recognition.onend = () => btn.classList.remove('recording');
  appState.recognition.onerror = () => btn.classList.remove('recording');
  appState.recognition.onresult = (e) => {
    const t = e.results[0][0].transcript;
    document.getElementById('q').value = t;
    performSearch(t);
  };
  return true;
}
function startVoiceSearch() {
  if (!appState.recognition && !initSpeechRecognition()) return;
  try { appState.recognition.start(); }
  catch (e) { try { appState.recognition.stop(); appState.recognition.start(); } catch (e2) {} }
}

/* -----------------------------
   現在地（初期）
----------------------------- */
function acquireLocation() {
  const onSuccess = (pos) => {
    const { latitude, longitude } = pos.coords;
    document.getElementById('loading')?.remove();
    if (!appState.map) initMap({ lat: latitude, lng: longitude });
    appState.map.setCenter({ lat, lng });
    setUserMarker(latitude, longitude);
    fetchLocationNameGoogle(latitude, longitude);
    fetchWeather(latitude, longitude);
  };
  const onError = () => {
    document.getElementById('loading')?.remove();
    if (!appState.map) initMap({ lat: 35.0, lng: 135.0 });
    const addr = document.getElementById('locAddress');
    const coords = document.getElementById('locCoords');
    if (addr) addr.textContent = '位置情報を確認できません';
    if (coords) coords.textContent = '現在地：取得失敗';
  };
  try { navigator.geolocation.getCurrentPosition(onSuccess, onError, LOCATION_OPTIONS); }
  catch { onError(); }
}

/* -----------------------------
   逆ジオコーディング（現在地/ポイント）※ Worker 経由
----------------------------- */
async function fetchLocationNameGoogle(lat, lng) {
  const adr = document.getElementById('locAddress');
  const crd = document.getElementById('locCoords');
  if (!adr || !crd) return;
  crd.textContent = `現在地：緯度 ${lat.toFixed(6)} / 経度 ${lng.toFixed(6)}`;
  try {
    const response = await fetchWithRetry(`${WORKER_ORIGIN}/geocode?${new URLSearchParams({ lat, lng, language: 'ja' })}`);
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    const results = Array.isArray(data?.results) ? data.results : [];
    if (data.status === 'OK' && results[0]) {
      adr.textContent = `${(results[0].formatted_address || '').replace(/^日本、\s*/, '')} 付近`;
    } else {
      adr.textContent = '住所情報なし';
    }
  } catch (e) {
    adr.textContent = '住所取得エラー';
  }
}
async function fetchPointAddress(lat, lng) {
  const block = document.getElementById('pointAddressBlock');
  const adr = document.getElementById('pointAddress');
  const crd = document.getElementById('pointCoords');
  if (!block || !adr || !crd) return;
  adr.textContent = 'ポイント：住所取得中...';
  crd.textContent = `(緯度 ${lat.toFixed(6)} / 経度 ${lng.toFixed(6)})`;
  block.style.display = 'flex';
  try {
    const response = await fetchWithRetry(`${WORKER_ORIGIN}/geocode?${new URLSearchParams({ lat, lng, language: 'ja' })}`);
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    const results = Array.isArray(data?.results) ? data.results : [];
    if (data.status === 'OK' && results[0]) {
      adr.textContent = `ポイント：${(results[0].formatted_address || '').replace(/^日本、\s*/, '')} 付近`;
    } else {
      adr.textContent = 'ポイント：住所情報なし';
    }
  } catch {
    adr.textContent = 'ポイント：住所取得エラー';
  }
}

/* -----------------------------
   天気（OpenWeather 3時間予報 ≒ 1/2/3h 相当）
----------------------------- */
async function fetchWeather(lat, lng) {
  try {
    const response = await fetchWithRetry(`${WORKER_ORIGIN}/weather?${new URLSearchParams({
      lat: String(lat), lng: String(lng), units: 'metric', lang: 'ja'
    })}`, {}, 3);
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    const list = Array.isArray(data?.list) ? data.list : [];
    ['weather1h', 'weather2h', 'weather3h'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent='--'; });
    if (!list.length) return;
    const now = Date.now();
    [1,2,3].forEach(h => {
      const target = now + h*3600*1000;
      let best = null, bestDiff = Infinity;
      for (const item of list) {
        const t = (item?.dt || 0) * 1000;
        const diff = Math.abs(t - target);
        if (diff < bestDiff) { best = item; bestDiff = diff; }
      }
      const el = document.getElementById(`weather${h}h`);
      if (el && best) {
        const temp = Math.round(best?.main?.temp ?? NaN);
        const cond = best?.weather?.[0]?.description || '';
        el.textContent = Number.isNaN(temp) ? (cond || '--') : `${temp}℃ / ${cond}`;
      }
    });
  } catch (e) {
    ['weather1h','weather2h','weather3h'].forEach(id => { const el=document.getElementById(id); if (el) el.textContent='--'; });
  }
}

/* -----------------------------
   ダイアログ（保存/編集）
----------------------------- */
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
  if (!appState.currentPos) return console.error('現在地が取得できていません');
  const dialog = createDialog({
    id: 'saveLocationDialog',
    content: `
      <h3 class="dialog-title">現在地点登録画面</h3>
      <p class="dialog-text">登録する地点名を入力してください:</p>
      <input type="text" id="locationNameInput" class="dialog-input" placeholder="地点名を入力" />
      <div class="dialog-actions">
        <button id="btnCancelSave" class="dialog-btn cancel">キャンセル</button>
        <button id="btnConfirmSave" class="dialog-btn confirm">OK</button>
      </div>`
  });
  const input = document.getElementById('locationNameInput');
  setTimeout(() => input.focus(), 100);
  document.getElementById('btnCancelSave').onclick = () => dialog.remove();
  document.getElementById('btnConfirmSave').onclick = () => {
    const name = input.value.trim();
    if (!name) { input.style.borderColor = 'var(--danger)'; setTimeout(()=>input.style.borderColor='var(--stroke)', 2000); return; }
    const list = JSON.parse(localStorage.getItem('savedLocations') || '[]');
    const saved = { name, lat: appState.currentPos.lat, lng: appState.currentPos.lng, timestamp: Date.now() };
    list.push(saved);
    localStorage.setItem('savedLocations', JSON.stringify(list));
    dialog.remove();
  };
  input.addEventListener('keypress', e => { if (e.key === 'Enter') document.getElementById('btnConfirmSave').click(); });
}
function showEditLocationDialog() {
  const list = JSON.parse(localStorage.getItem('savedLocations') || '[]');
  if (!list.length) {
    const dialog = createDialog({
      id: 'editDialog',
      content: `
        <h3 class="dialog-title">登録地点修正</h3>
        <p class="dialog-muted">登録された地点がありません</p>
        <button id="btnCloseEmpty" class="dialog-btn confirm full">閉じる</button>`
    });
    document.getElementById('btnCloseEmpty').onclick = () => dialog.remove();
    return;
  }
  let html = '<div class="location-list">';
  list.forEach((loc, i) => {
    html += `
      <div class="location-item">
        <div class="location-item-name">${loc.name}</div>
        <div class="location-item-coords">緯度: ${loc.lat.toFixed(6)} / 経度: ${loc.lng.toFixed(6)}</div>
        <div class="location-item-actions">
          <button class="location-item-btn nav" data-i="${i}">ナビ開始</button>
          <button class="location-item-btn edit" data-i="${i}">名前変更</button>
          <button class="location-item-btn delete" data-i="${i}">削除</button>
        </div>
      </div>`;
  });
  html += '</div>';
  const dialog = createDialog({
    id: 'editDialog', wide: true, scroll: true,
    content: `<h3 class="dialog-title">登録地点修正</h3>${html}<button id="btnCloseEdit" class="dialog-btn cancel full" style="margin-top:16px">閉じる</button>`
  });
  document.getElementById('btnCloseEdit').onclick = () => dialog.remove();
  dialog.querySelectorAll('.location-item-btn.nav').forEach(btn => {
    btn.onclick = () => { const i = +btn.dataset.i; const loc = list[i]; dialog.remove(); startNavigation({ name: loc.name, lat: loc.lat, lng: loc.lng }); };
  });
  dialog.querySelectorAll('.location-item-btn.edit').forEach(btn => {
    btn.onclick = () => {
      const i = +btn.dataset.i; const loc = list[i];
      const rd = createDialog({
        id: 'renameDialog',
        content: `
          <h3 class="dialog-title">地点名変更</h3>
          <input type="text" id="renameInput" value="${loc.name}" class="dialog-input" />
          <div class="dialog-actions">
            <button id="btnCancelRename" class="dialog-btn cancel">キャンセル</button>
            <button id="btnConfirmRename" class="dialog-btn confirm">OK</button>
          </div>`
      });
      const ri = document.getElementById('renameInput'); setTimeout(()=>{ri.focus(); ri.select();},100);
      document.getElementById('btnCancelRename').onclick = () => rd.remove();
      document.getElementById('btnConfirmRename').onclick = () => {
        const nn = ri.value.trim();
        if (!nn) { ri.style.borderColor='var(--danger)'; setTimeout(()=>ri.style.borderColor='var(--stroke)', 2000); return; }
        list[i].name = nn; localStorage.setItem('savedLocations', JSON.stringify(list)); rd.remove(); dialog.remove();
      };
      ri.addEventListener('keypress', e => { if (e.key === 'Enter') document.getElementById('btnConfirmRename').click(); });
    };
  });
  dialog.querySelectorAll('.location-item-btn.delete').forEach(btn => {
    btn.onclick = () => {
      const i = +btn.dataset.i; const loc = list[i];
      const cd = createDialog({
        id: 'confirmDeleteDialog',
        content: `
          <h3 class="dialog-title">削除確認</h3>
          <p class="dialog-text">「${loc.name}」を削除しますか？</p>
          <div class="dialog-actions">
            <button id="btnCancelDelete" class="dialog-btn cancel">キャンセル</button>
            <button id="btnConfirmDelete" class="dialog-btn delete">削除</button>
          </div>`
      });
      document.getElementById('btnCancelDelete').onclick = () => cd.remove();
      document.getElementById('btnConfirmDelete').onclick = () => {
        list.splice(i, 1); localStorage.setItem('savedLocations', JSON.stringify(list)); cd.remove(); dialog.remove();
      };
    };
  });
}

/* -----------------------------
   道順コピー
----------------------------- */
function exportRouteToClipboard() {
  if (!appState.currentRouteData) return console.warn('コピーするルートデータがありません');
  const d = appState.currentRouteData;
  let text = `■ 目的地: ${d.destinationName}\n■ 概要: ${d.summary} (約 ${d.distance}, 徒歩 ${d.duration})\n\n`;
  if (d.warnings.length) {
    text += '■ 警告:\n';
    d.warnings.forEach(w => text += `・ ${w.replace(/<[^>]+>/g, ' ')}\n`);
    text += '\n';
  }
  text += '■ 道順:\n';
  if (d.steps?.length) {
    d.steps.forEach((s, i) => {
      const ins = (s.html_instructions || '').replace(/<[^>]+>/g, ' ').trim();
      const dist = s?.distance?.text || s?.distance || '';
      text += `${i + 1}. ${ins}${dist ? ` (${dist})` : ''}\n`;
    });
  } else text += '詳細な道順はありません。\n';
  navigator.clipboard?.writeText(text).then(()=>{}).catch(()=>{});
}

/* -----------------------------
   現在地へ移動
----------------------------- */
let lastLocateTime = 0;
function locateUser() {
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission().then(state => {
      if (state === 'granted') { stopCompassListener(); appState.compassWatchId = null; startCompassListener(); }
    }).catch(()=>{});
  }
  const now = Date.now(); if (now - lastLocateTime < 1000) return; lastLocateTime = now;
  if (appState.currentPos && appState.map) {
    appState.map.panTo(appState.currentPos);
    appState.map.setZoom(18);
  } else {
    acquireLocation();
  }
}

/* -----------------------------
   キーボード表示監視（検索入力）
----------------------------- */
function bindKeyboardWatch() {
  const searchInput = document.getElementById('q');
  const navPanel = document.getElementById('navPanel');
  searchInput.addEventListener('focus', () => { document.getElementById('appBody').classList.add('keyboard-open'); navPanel.style.display='none'; });
  searchInput.addEventListener('blur', () => {
    document.getElementById('appBody').classList.remove('keyboard-open');
    if (document.getElementById('results').style.display !== 'block' && !appState.pointSearchMode) {
      navPanel.style.display = 'block';
    }
  });
}

/* -----------------------------
   UI イベント
----------------------------- */
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
    appState.searchMarkers.forEach(m => m.map = null);
    appState.searchMarkers = [];
    appState.searchPoint = null;
    if (appState.searchPointMarker) { appState.searchPointMarker.map = null; appState.searchPointMarker = null; }
    const block = document.getElementById('pointAddressBlock');
    const adr = document.getElementById('pointAddress');
    const crd = document.getElementById('pointCoords');
    block.style.display = 'none'; adr.textContent = ''; crd.textContent = '';
    appState.pointSearchMode = false;
    document.getElementById('btnPointSearch').textContent = '📍 ポイント選択';
    document.getElementById('btnPointSearch').style.background = 'rgba(255,255,255,.08)';
    document.getElementById('btnPointSearch').style.color = 'var(--text)';
    document.getElementById('btnPointSearch').style.borderColor = 'var(--stroke)';
    document.getElementById('navPanel').style.display = 'block';
    document.getElementById('r10').classList.add('active');
    document.getElementById('r20').classList.remove('active');
    document.getElementById('r30').classList.remove('active');
    document.getElementById('radiusLabel').textContent = '10km';
    openUnified('nav');
  };
  document.getElementById('btnLocatePanel').onclick = locateUser;
}
function bindFABEvents() {
  document.getElementById('btnSearch').onclick = () => { openUnified('search'); document.getElementById('fabStack').style.display = 'none'; };
  document.getElementById('btnClosePanel').onclick = () => { openUnified('nav'); document.getElementById('fabStack').style.display = appState.isNavigating ? 'flex' : 'none'; };
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

/* -----------------------------
   起動
----------------------------- */
function startApp() {
  document.documentElement.lang = 'ja';

  // Unified Panel を常時表示し、案内タブで開始
  openUnified('nav');

  document.getElementById('fabStack').style.display = 'none';
  document.getElementById('btnSearch').style.display = 'flex';

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
window.addEventListener('DOMContentLoaded', initializeWhenReady);