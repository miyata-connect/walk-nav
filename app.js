'use strict';

/* =========================================================
   WalkNav - app.js (Unified Panel / Worker経由API / 差分禁止)
   ISSUE: idx202511120515
   ========================================================= */

/* -----------------------------
   Constants
----------------------------- */
const ISSUE_ID = 'idx202511120515';
const WORKER_ORIGIN = 'https://ors-proxy.miyata-connect-jp.workers.dev';
const DEFAULT_MASK = 'places.displayName,places.formattedAddress,places.location,places.id,places.types';
const MAX_RETRY = 3;
const RETRY_DELAY = 1000;
const LOCATION_OPTIONS = { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 };

/* -----------------------------
   State
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
   Fetch with retry
----------------------------- */
async function fetchWithRetry(url, options = {}, retries = MAX_RETRY) {
  for (let i = 0; i < retries; i++) {
    try {
      const resp = await fetch(url, options);
      if (!resp.ok && i < retries - 1) {
        await new Promise(r => setTimeout(r, RETRY_DELAY * (i + 1)));
        continue;
      }
      return resp;
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(r => setTimeout(r, RETRY_DELAY * (i + 1)));
    }
  }
}

/* -----------------------------
   Worker API wrappers
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
  if (!resp.ok) throw new Error(`TextSearch ${resp.status}: ${await resp.text()}`);
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
  if (!resp.ok) throw new Error(`Nearby ${resp.status}: ${await resp.text()}`);
  return await resp.json();
}

/* -----------------------------
   Map
----------------------------- */
function initMap(center) {
  appState.map = new google.maps.Map(document.getElementById('map'), {
    center, zoom: 17, mapId: 'DEMO_MAP',
    gestureHandling: 'greedy', clickableIcons: true, disableDefaultUI: true
  });

  appState.map.addListener('click', (e) => {
    if (!appState.pointSearchMode) return;
    if (e.latLng) setSearchPoint(e.latLng.lat(), e.latLng.lng());
  });

  appState.mapInitialized = true;
  console.log('[Boot] map ok');
}

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
      </svg>
    `;
    appState.userMarker = new google.maps.marker.AdvancedMarkerElement({
      map: appState.map, position: { lat, lng }, content: pin, zIndex: 1000
    });
  } else {
    appState.userMarker.position = { lat, lng };
  }
}

function updateMarkerRotation() {
  const icon = document.getElementById('user-marker-icon');
  if (icon) icon.style.transform = `rotate(${appState.currentHeading}deg)`;
}

/* -----------------------------
   Point select
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
    map: appState.map, position: { lat, lng }, content: pin, zIndex: 999
  });

  fetchPointAddress(lat, lng);
}

/* -----------------------------
   Math helpers
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
    const min = Math.max(1, Math.round(sec / 60));
    return `${min} 分`;
  }
  return leg?.localizedValues?.duration?.text || '--';
}

/* -----------------------------
   Polyline
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
  if (!encoded) return;
  const path = google.maps.geometry.encoding.decodePath(encoded);
  appState.currentPolyline = new google.maps.Polyline({
    path, geodesic: true, strokeColor: '#62b5ff', strokeOpacity: 0.8, strokeWeight: 6, map: appState.map
  });
}

/* -----------------------------
   Compass
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
      })
      .catch(() => {});
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

/* -----------------------------
   Location watch
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
  const onWatchError = () => { stopLocationWatcher(); };

  appState.locationWatchId = navigator.geolocation.watchPosition(
    onWatchSuccess, onWatchError, LOCATION_OPTIONS
  );
}
function stopLocationWatcher() {
  if (!appState.locationWatchId) return;
  navigator.geolocation.clearWatch(appState.locationWatchId);
  appState.locationWatchId = null;
}

/* -----------------------------
   Navigation
----------------------------- */
async function startNavigation(destination) {
  let originLat, originLng;
  if (appState.pointSearchMode && appState.searchPoint) {
    originLat = appState.searchPoint.lat; originLng = appState.searchPoint.lng; appState.isSimulation = true;
  } else if (appState.currentPos) {
    originLat = appState.currentPos.lat; originLng = appState.currentPos.lng; appState.isSimulation = false;
  } else {
    return;
  }

  appState.currentDestination = destination;
  appState.isNavigating = true; appState.isPaused = false;

  document.getElementById('routePanel').style.display = 'block';
  document.getElementById('unifiedPanel').style.display = 'none';
  document.getElementById('fabStack').style.display = 'flex';
  stopCompassListener();

  try {
    const params = new URLSearchParams({
      origin: `${originLat},${originLng}`,
      destination: `${destination.lat},${destination.lng}`,
      mode: 'walking', language: 'ja'
    });
    const response = await fetchWithRetry(`${WORKER_ORIGIN}/directions?${params.toString()}`, {}, 3);
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

      const instructionsList = document.getElementById('navPanelInstructions');
      instructionsList.innerHTML = '';
      if (l0 && Array.isArray(l0.steps) && l0.steps.length > 0) {
        l0.steps.forEach(step => {
          const item = document.createElement('div');
          item.className = 'nav-instruction-item';
          const cleanInstruction = (step.html_instructions || '').replace(/<[^>]+>/g, ' ').trim();
          const distText = step?.distance?.text || step?.distance || '';
          item.textContent = distText ? `${cleanInstruction} (${distText})` : cleanInstruction;
          instructionsList.appendChild(item);
        });
      }

      appState.currentRouteData = {
        steps: l0?.steps || [],
        summary: r0.summary,
        distance: distanceText,
        duration: durationText,
        destinationName: destination.name,
        warnings: r0.warnings || []
      };

      const incidentPanel = document.getElementById('incidentPanel');
      const incidentList = document.getElementById('incidentList');
      incidentList.innerHTML = '';
      if (r0.warnings && r0.warnings.length > 0) {
        r0.warnings.forEach(w => {
          const div = document.createElement('div');
          div.className = 'incident-item other';
          div.innerHTML = `<div class="incident-type">注意</div><div class="incident-description">${w.replace(/<[^>]+>/g, ' ')}</div>`;
          incidentList.appendChild(div);
        });
        incidentPanel.style.display = 'block';
      } else {
        incidentPanel.style.display = 'none';
      }

      await fetchWeather(originLat, originLng);

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

    } else {
      throw new Error('Route not found');
    }
  } catch (e) {
    appState.isNavigating = false;
    appState.isSimulation = false;
    document.getElementById('fabStack').style.display = 'none';
    startCompassListener();
  }
}

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
  appState.isNavigating = false; appState.isPaused = false;

  document.getElementById('routePanel').style.display = 'none';
  document.getElementById('navPanelInstructions').innerHTML = '';
  const incidentPanel = document.getElementById('incidentPanel');
  if (incidentPanel) { incidentPanel.style.display = 'none'; document.getElementById('incidentList').innerHTML = ''; }

  document.getElementById('weather1h').textContent = '--';
  document.getElementById('weather2h').textContent = '--';
  document.getElementById('weather3h').textContent = '--';

  document.getElementById('fabStack').style.display = 'none';
  openUnifiedTab('nav');
  showUnifiedPanel(true);

  appState.searchMarkers.forEach(marker => marker.map = null);
  appState.searchMarkers = [];

  if (appState.currentPos && appState.map) {
    appState.map.panTo(appState.currentPos);
    appState.map.setZoom(17);
  }
  updateMarkerRotation();
}

/* -----------------------------
   Pause
----------------------------- */
function togglePause() {
  if (appState.isSimulation) return;
  if (!appState.isNavigating) return;

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
   Search
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
  if (!query || !query.trim()) return;

  let centerLat, centerLng;
  if (appState.pointSearchMode && appState.searchPoint) {
    centerLat = appState.searchPoint.lat; centerLng = appState.searchPoint.lng;
  } else if (appState.currentPos) {
    centerLat = appState.currentPos.lat; centerLng = appState.currentPos.lng;
  } else {
    return;
  }

  const radiusKm = parseInt(document.getElementById('radiusLabel').textContent);
  const radiusMeters = radiusKm * 1000;

  try {
    const data = await placesTextSearch({
      textQuery: query.trim(),
      locationBias: { circle: { center: { latitude: centerLat, longitude: centerLng }, radius: radiusMeters } },
      maxResultCount: 20, languageCode: 'ja'
    }, DEFAULT_MASK);

    if (data.places?.length) { displayResults(data.places, centerLat, centerLng); return; }
  } catch (_) {}

  const typeKey = TYPE_MAP[query.trim()] || TYPE_MAP[query.trim().replace(/\s/g, '')];
  if (typeKey) {
    try {
      const data = await placesNearby({
        includedTypes: [typeKey], maxResultCount: 20,
        locationRestriction: { circle: { center: { latitude: centerLat, longitude: centerLng }, radius: radiusMeters } },
        languageCode: 'ja'
      }, DEFAULT_MASK);
      if (data.places?.length) { displayResults(data.places, centerLat, centerLng); return; }
    } catch (_) {}
  }

  document.getElementById('results').style.display = 'none';
  openUnifiedTab('nav');
}

function displayResults(places, centerLat, centerLng) {
  appState.searchMarkers.forEach(m => m.map = null);
  appState.searchMarkers = [];

  const placesWithDistance = places.map(p => {
    const lat = p.location.latitude; const lng = p.location.longitude;
    const distance = calculateDistance(centerLat, centerLng, lat, lng);
    return { ...p, distance };
  }).sort((a, b) => a.distance - b.distance).slice(0, 5);

  const resultsDiv = document.getElementById('results');
  resultsDiv.innerHTML = ''; resultsDiv.style.display = 'block';

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
      <div style="font-size:11px;color:#62b5ff;margin-top:4px">📍 ${distanceKm}km</div>
    `;
    item.onclick = () => { startNavigation({ name, lat, lng }); };
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
      map: appState.map, position: { lat, lng }, content: markerPin, zIndex: 500 + index, title: name
    });
    appState.searchMarkers.push(marker);
  });
}

/* -----------------------------
   Voice
----------------------------- */
function initSpeechRecognition() {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) return false;
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  appState.recognition = new SpeechRecognition();
  appState.recognition.lang = 'ja-JP'; appState.recognition.continuous = false; appState.recognition.interimResults = false;

  const btnVoiceIcon = document.getElementById('btnVoiceIcon');
  appState.recognition.onstart = () => { btnVoiceIcon.classList.add('recording'); };
  appState.recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    document.getElementById('q').value = transcript;
    performSearch(transcript);
  };
  appState.recognition.onerror = () => { btnVoiceIcon.classList.remove('recording'); };
  appState.recognition.onend = () => { btnVoiceIcon.classList.remove('recording'); };
  return true;
}
function startVoiceSearch() {
  if (!appState.recognition) if (!initSpeechRecognition()) return;
  try { appState.recognition.start(); } catch (_) {
    try { appState.recognition.stop(); setTimeout(() => appState.recognition.start(), 120); } catch (_) {}
  }
}

/* -----------------------------
   Geolocation
----------------------------- */
function acquireLocation() {
  const onSuccess = (pos) => {
    const { latitude, longitude } = pos.coords;
    document.getElementById('loading')?.remove();
    if (!appState.map) initMap({ lat: latitude, lng: longitude });
    appState.map.setCenter({ lat: latitude, lng: longitude });
    setUserMarker(latitude, longitude);
    fetchLocationNameGoogle(latitude, longitude);
    fetchWeather(latitude, longitude);
  };
  const onError = () => {
    document.getElementById('loading')?.remove();
    if (!appState.map) initMap({ lat: 35.0, lng: 135.0 });
    const addressElement = document.getElementById('locAddress');
    const coordsElement = document.getElementById('locCoords');
    if (addressElement) addressElement.textContent = '位置情報を確認できません';
    if (coordsElement) coordsElement.textContent = '現在地：取得失敗';
  };
  try { navigator.geolocation.getCurrentPosition(onSuccess, onError, LOCATION_OPTIONS); }
  catch (_) { onError(); }
}

/* -----------------------------
   Reverse Geocoding via Worker
----------------------------- */
async function fetchLocationNameGoogle(lat, lng) {
  const addressElement = document.getElementById('locAddress');
  const coordsElement = document.getElementById('locCoords');
  if (!addressElement || !coordsElement) return;

  coordsElement.textContent = `現在地：緯度 ${lat.toFixed(6)} / 経度 ${lng.toFixed(6)}`;

  try {
    const params = new URLSearchParams({ lat, lng, language: 'ja' });
    const response = await fetchWithRetry(`${WORKER_ORIGIN}/geocode?${params.toString()}`);
    if (!response.ok) throw new Error(`Geocode ${response.status}: ${await response.text()}`);
    const data = await response.json();
    const results = Array.isArray(data?.results) ? data.results : [];
    if (data.status === 'OK' && results[0]) {
      const address = results[0].formatted_address || '';
      const clean = address.replace(/^日本、\s*/, '');
      addressElement.textContent = `${clean} 付近`;
    } else {
      addressElement.textContent = '住所情報なし';
    }
  } catch (_) {
    addressElement.textContent = '住所取得エラー';
  }
}

async function fetchPointAddress(lat, lng) {
  const addressBlock = document.getElementById('pointAddressBlock');
  const addressElement = document.getElementById('pointAddress');
  const coordsElement = document.getElementById('pointCoords');
  if (!addressBlock || !addressElement || !coordsElement) return;

  addressElement.textContent = 'ポイント：住所取得中...';
  coordsElement.textContent = `(緯度 ${lat.toFixed(6)} / 経度 ${lng.toFixed(6)})`;
  addressBlock.style.display = 'flex';

  try {
    const params = new URLSearchParams({ lat, lng, language: 'ja' });
    const response = await fetchWithRetry(`${WORKER_ORIGIN}/geocode?${params.toString()}`);
    if (!response.ok) throw new Error(`Geocode ${response.status}: ${await response.text()}`);
    const data = await response.json();
    const results = Array.isArray(data?.results) ? data.results : [];
    if (data.status === 'OK' && results[0]) {
      const address = results[0].formatted_address || '';
      const clean = address.replace(/^日本、\s*/, '');
      addressElement.textContent = `ポイント：${clean} 付近`;
    } else {
      addressElement.textContent = 'ポイント：住所情報なし';
    }
  } catch (_) {
    addressElement.textContent = 'ポイント：住所取得エラー';
  }
}

/* -----------------------------
   Weather via Worker (OpenWeather)
----------------------------- */
async function fetchWeather(lat, lng) {
  try {
    const params = new URLSearchParams({ lat: String(lat), lng: String(lng), units: 'metric', lang: 'ja' });
    const resp = await fetchWithRetry(`${WORKER_ORIGIN}/weather?${params.toString()}`, {}, 3);
    if (!resp.ok) throw new Error(`Weather ${resp.status}: ${await resp.text()}`);
    const data = await resp.json();
    const list = Array.isArray(data?.list) ? data.list : [];

    ['weather1h','weather2h','weather3h'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = '--'; });
    if (list.length === 0) return;

    const now = Date.now(), targets = [1,2,3];
    targets.forEach(tHour => {
      const targetMs = now + tHour * 3600 * 1000;
      let best = null, bestDiff = Infinity;
      for (const item of list) {
        const ts = (item?.dt || 0) * 1000;
        const diff = Math.abs(ts - targetMs);
        if (diff < bestDiff) { bestDiff = diff; best = item; }
      }
      const el = document.getElementById(`weather${tHour}h`);
      if (el && best) {
        const temp = Math.round(best?.main?.temp ?? NaN);
        const cond = (best?.weather && best.weather[0]?.description) ? best.weather[0].description : '';
        el.textContent = Number.isNaN(temp) ? (cond || '--') : `${temp}℃ / ${cond}`;
      }
    });
  } catch (_) {
    ['weather1h','weather2h','weather3h'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = '--'; });
  }
}

/* -----------------------------
   Dialogs
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
  const input = document.getElementById('locationNameInput');
  const btnCancel = document.getElementById('btnCancelSave');
  const btnConfirm = document.getElementById('btnConfirmSave');
  setTimeout(() => input.focus(), 100);
  btnCancel.onclick = () => dialog.remove();
  btnConfirm.onclick = () => {
    const name = input.value.trim();
    if (!name) { input.style.borderColor = 'var(--danger)'; setTimeout(()=>input.style.borderColor='var(--stroke') , 1800); return; }
    const list = JSON.parse(localStorage.getItem('savedLocations') || '[]');
    list.push({ name, lat: appState.currentPos.lat, lng: appState.currentPos.lng, timestamp: Date.now() });
    localStorage.setItem('savedLocations', JSON.stringify(list));
    dialog.remove();
  };
  input.addEventListener('keypress', (e) => { if (e.key === 'Enter') btnConfirm.click(); });
}

function showEditLocationDialog() {
  const list = JSON.parse(localStorage.getItem('savedLocations') || '[]');
  if (list.length === 0) {
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
  list.forEach((loc, i) => {
    listHTML += `
      <div class="location-item">
        <div class="location-item-name">${loc.name}</div>
        <div class="location-item-coords">緯度: ${loc.lat.toFixed(6)} / 経度: ${loc.lng.toFixed(6)}</div>
        <div class="location-item-actions">
          <button class="location-item-btn nav" data-index="${i}">ナビ開始</button>
          <button class="location-item-btn edit" data-index="${i}">名前変更</button>
          <button class="location-item-btn delete" data-index="${i}">削除</button>
        </div>
      </div>
    `;
  });
  listHTML += '</div>';
  const dialog = createDialog({
    id: 'editDialog', wide: true, scroll: true,
    content: `
      <h3 class="dialog-title">登録地点修正</h3>
      ${listHTML}
      <button id="btnCloseEdit" class="dialog-btn cancel full" style="margin-top:16px">閉じる</button>
    `
  });
  document.getElementById('btnCloseEdit').onclick = () => dialog.remove();
  document.querySelectorAll('.location-item-btn.nav').forEach(btn => {
    btn.onclick = () => {
      const idx = parseInt(btn.dataset.index); const loc = list[idx];
      dialog.remove(); startNavigation({ name: loc.name, lat: loc.lat, lng: loc.lng });
    };
  });
  document.querySelectorAll('.location-item-btn.edit').forEach(btn => {
    btn.onclick = () => {
      const idx = parseInt(btn.dataset.index); const loc = list[idx];
      const rd = createDialog({
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
      const inp = document.getElementById('renameInput');
      setTimeout(()=>{inp.focus();inp.select();},100);
      document.getElementById('btnCancelRename').onclick = () => rd.remove();
      document.getElementById('btnConfirmRename').onclick = () => {
        const newName = inp.value.trim(); if (!newName) { inp.style.borderColor='var(--danger)'; setTimeout(()=>inp.style.borderColor='var(--stroke') ,1800); return; }
        list[idx].name = newName; localStorage.setItem('savedLocations', JSON.stringify(list));
        rd.remove(); dialog.remove();
      };
      inp.addEventListener('keypress',(e)=>{ if(e.key==='Enter') document.getElementById('btnConfirmRename').click(); });
    };
  });
  document.querySelectorAll('.location-item-btn.delete').forEach(btn => {
    btn.onclick = () => {
      const idx = parseInt(btn.dataset.index); const loc = list[idx];
      const cd = createDialog({
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
      document.getElementById('btnCancelDelete').onclick = () => cd.remove();
      document.getElementById('btnConfirmDelete').onclick = () => {
        list.splice(idx,1); localStorage.setItem('savedLocations', JSON.stringify(list));
        cd.remove(); dialog.remove();
      };
    };
  });
}

/* -----------------------------
   Export route
----------------------------- */
function exportRouteToClipboard() {
  if (!appState.currentRouteData) return;
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
    data.steps.forEach((step, idx) => {
      const instruction = (step.html_instructions || '').replace(/<[^>]+>/g, ' ').trim();
      const distText = step?.distance?.text || step?.distance || '';
      textOutput += `${idx + 1}. ${instruction}${distText ? ` (${distText})` : ''}\n`;
    });
  } else {
    textOutput += '詳細な道順はありません。\n';
  }
  if (navigator.clipboard) navigator.clipboard.writeText(textOutput).catch(()=>{});
}

/* -----------------------------
   Locate
----------------------------- */
let lastLocateTime = 0;
function locateUser() {
  if (typeof DeviceOrientationEvent?.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission().then(state => {
      if (state === 'granted') { stopCompassListener(); appState.compassWatchId = null; startCompassListener(); }
    }).catch(()=>{});
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

/* -----------------------------
   UI Tabs / Panel control
----------------------------- */
function openUnifiedTab(name) {
  const tabNav = document.getElementById('tabNav');
  const tabSearch = document.getElementById('tabSearch');
  const pageNav = document.getElementById('pageNav');
  const pageSearch = document.getElementById('pageSearch');
  if (!tabNav || !tabSearch || !pageNav || !pageSearch) return;

  tabNav.classList.remove('active'); tabSearch.classList.remove('active');
  pageNav.classList.remove('active'); pageSearch.classList.remove('active');

  if (name === 'search') { tabSearch.classList.add('active'); pageSearch.classList.add('active'); }
  else { tabNav.classList.add('active'); pageNav.classList.add('active'); }

  localStorage.setItem('activeTab', name);
}
function showUnifiedPanel(show) {
  const up = document.getElementById('unifiedPanel');
  if (up) up.style.display = show ? 'block' : 'none';
}

/* -----------------------------
   Bind UI
----------------------------- */
function bindSearchPanelEvents() {
  const radiusLabel = document.getElementById('radiusLabel');
  const r10 = document.getElementById('r10');
  const r20 = document.getElementById('r20');
  const r30 = document.getElementById('r30');
  const btnPointSearch = document.getElementById('btnPointSearch');

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
      document.getElementById('navPanel').style.display = 'none';
    } else {
      btnPointSearch.textContent = '📍 ポイント選択';
      btnPointSearch.style.background = 'rgba(255,255,255,.08)';
      btnPointSearch.style.color = 'var(--text)';
      btnPointSearch.style.borderColor = 'var(--stroke)';
      document.getElementById('navPanel').style.display = 'block';
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
    const results = document.getElementById('results');
    results.style.display = 'none'; results.innerHTML = '';
    appState.searchMarkers.forEach(m => m.map = null); appState.searchMarkers = [];
    appState.searchPoint = null;
    if (appState.searchPointMarker) { appState.searchPointMarker.map = null; appState.searchPointMarker = null; }
    const addressBlock = document.getElementById('pointAddressBlock');
    const addressElement = document.getElementById('pointAddress');
    const coordsElement = document.getElementById('pointCoords');
    addressBlock.style.display = 'none';
    addressElement.textContent = ''; coordsElement.textContent = '';
    appState.pointSearchMode = false;
    const btnPointSearch = document.getElementById('btnPointSearch');
    btnPointSearch.textContent = '📍 ポイント選択';
    btnPointSearch.style.background = 'rgba(255,255,255,.08)';
    btnPointSearch.style.color = 'var(--text)';
    btnPointSearch.style.borderColor = 'var(--stroke)';
    openUnifiedTab('nav');
  };
  document.getElementById('btnLocatePanel').onclick = locateUser;
}

function bindFABEvents() {
  document.getElementById('btnSearch').onclick = () => { openUnifiedTab('search'); showUnifiedPanel(true); };
  document.getElementById('btnClosePanel').onclick = () => { showUnifiedPanel(false); };
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
  };
}

function bindRoutePanelEvents() {
  document.getElementById('btnStopRoute').onclick = stopNavigation;
  document.getElementById('btnExportText').onclick = exportRouteToClipboard;
}

function bindTabs() {
  const tabNav = document.getElementById('tabNav');
  const tabSearch = document.getElementById('tabSearch');
  tabNav.addEventListener('click', () => openUnifiedTab('nav'));
  tabSearch.addEventListener('click', () => openUnifiedTab('search'));

  const savedTab = localStorage.getItem('activeTab');
  openUnifiedTab(savedTab === 'search' ? 'search' : 'nav');
}

/* -----------------------------
   App start (no legacy searchPanel)
----------------------------- */
function startApp() {
  console.log('[Boot] start', ISSUE_ID);

  // Always ensure unified panel visible at boot (Nav tab)
  showUnifiedPanel(true);
  openUnifiedTab('nav');

  // Bind UI first to avoid null.style at boot
  bindTabs();
  bindSearchPanelEvents();
  bindLocationEvents();
  bindSearchEvents();
  bindFABEvents();
  bindRoutePanelEvents();

  // Start compass & geoloc
  startCompassListener();
  acquireLocation();
}

function initializeWhenReady() {
  if (typeof google !== 'undefined' && google.maps && google.maps.Map && google.maps.geometry) {
    startApp();
  } else {
    setTimeout(initializeWhenReady, 100);
  }
}
window.addEventListener('DOMContentLoaded', initializeWhenReady);