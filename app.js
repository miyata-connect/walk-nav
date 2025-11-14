'use strict';
const ISSUE_ID = 'idx202511050540';
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
function switchPanelTab(mode) {
const isNav = mode === 'nav';
const isSettings = mode === 'settings';
const paneSearch = document.getElementById('tabPaneSearch');
const paneNav = document.getElementById('tabPaneNav');
const paneSettings = document.getElementById('tabPaneSettings');
if (paneSearch && paneNav && paneSettings) {
paneSearch.classList.toggle('active', !isNav && !isSettings);
paneNav.classList.toggle('active', isNav);
paneSettings.classList.toggle('active', isSettings);
}
const target = isSettings ? 'settings' : (isNav ? 'nav' : 'search');
document.querySelectorAll('[data-panel-tab]').forEach(btn => {
const active = btn.dataset.panelTab === target;
btn.classList.toggle('active', active);
});
}
function updateNavigationUI(isNavigating) {
const routeInfoSection = document.getElementById('routeInfoSection');
const incidentSection = document.getElementById('incidentSection');
const instructionsSection = document.getElementById('instructionsSection');
const routeControlSection = document.getElementById('routeControlSection');
if (routeInfoSection) {
routeInfoSection.style.display = isNavigating ? 'block' : 'none';
}
if (instructionsSection) {
instructionsSection.style.display = isNavigating ? 'block' : 'none';
}
if (routeControlSection) {
routeControlSection.style.display = isNavigating ? 'block' : 'none';
}
}
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
function initMap(center) {
if (!appState.map) {
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
console.log('[WalkNav] Map initialized');
} else {
appState.map.setCenter(center);
console.log('[WalkNav] Map center updated');
}
appState.mapInitialized = true;
}
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
if (!window.DeviceOrientationEvent) console.warn('[Compass] DeviceOrientationEvent is not supported.');
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
const icon = document.getElementById('user-marker-icon');
if (icon) {
icon.style.transform = `rotate(${appState.currentHeading}deg)`;
}
}
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
console.error('リアルタイム位置情報の取得に失敗');
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
const searchPanelEl = document.getElementById('searchPanel');
const fabStackEl = document.getElementById('fabStack');
const appBodyEl = document.getElementById('appBody');
if (searchPanelEl) searchPanelEl.style.display = 'block';
if (fabStackEl) fabStackEl.style.display = 'flex';
if (appBodyEl) appBodyEl.classList.add('panel-open');
switchPanelTab('nav');
updateNavigationUI(true);
stopCompassListener();
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
console.log('[Navigation] Directions Response:', result);

if (result.routes && result.routes.length > 0) {
  const r0 = result.routes[0];
  const l0 = (r0.legs && r0.legs[0]) ? r0.legs[0] : null;

  const distanceText = l0 ? readLegDistanceText(l0) : '--';
  const durationText = l0 ? readLegDurationText(l0) : '--';

  const destNameEl = document.getElementById('destinationName');
  const routeDistEl = document.getElementById('routeDistance');
  const routeTimeEl = document.getElementById('routeTime');
  const resultsEl = document.getElementById('results');
  const btnDestEl = document.getElementById('btnDestination');

  if (destNameEl) destNameEl.textContent = destination.name;
  if (routeDistEl) routeDistEl.textContent = distanceText;
  if (routeTimeEl) routeTimeEl.textContent = `徒歩 ${durationText}`;
  if (searchPanelEl) searchPanelEl.style.display = 'block';
  if (resultsEl) resultsEl.style.display = 'none';
  if (btnDestEl) btnDestEl.style.display = 'flex';

  const instructionsList = document.getElementById('navPanelInstructions');
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

  appState.currentRouteData = {
    steps: l0?.steps,
    summary: r0.summary,
    distance: distanceText,
    duration: durationText,
    destinationName: destination.name,
    warnings: r0.warnings || []
  };

  const incidentSection = document.getElementById('incidentSection');
  const incidentText = document.getElementById('incidentText');
  if (r0.warnings && r0.warnings.length > 0 && incidentSection && incidentText) {
    incidentText.innerHTML = r0.warnings.map(w => w.replace(/<[^>]+>/g, ' ')).join('<br>');
    incidentSection.style.display = 'block';
  } else if (incidentSection) {
    incidentSection.style.display = 'none';
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
  console.log(`[Navigation] ルート案内開始: ${destination.name}`);
} else {
  throw new Error('ルートが取得できませんでした');
}
} catch (error) {
console.error('[Navigation] Error:', error);
console.error(`ルートエラー: ${error.message}`);
appState.isNavigating = false;
appState.isSimulation = false;
updateNavigationUI(false);
if (fabStackEl) fabStackEl.style.display = 'none';
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
appState.isNavigating = false;
appState.isPaused = false;
updateNavigationUI(false);
const instructionsList = document.getElementById('navPanelInstructions');
if (instructionsList) instructionsList.innerHTML = '';
const incidentSection = document.getElementById('incidentSection');
if (incidentSection) incidentSection.style.display = 'none';
const searchPanel = document.getElementById('searchPanel');
const btnDestination = document.getElementById('btnDestination');
const qInput = document.getElementById('q');
const results = document.getElementById('results');
if (searchPanel) searchPanel.style.display = 'block';
if (btnDestination) btnDestination.style.display = 'none';
if (qInput) qInput.value = '';
if (results) {
results.style.display = 'none';
results.innerHTML = '';
}
const weather3h = document.getElementById('weather3h');
const weather6h = document.getElementById('weather6h');
const weather9h = document.getElementById('weather9h');
if (weather3h) weather3h.textContent = '--';
if (weather6h) weather6h.textContent = '--';
if (weather9h) weather9h.textContent = '--';
const fabStack = document.getElementById('fabStack');
const btnSearch = document.getElementById('btnSearch');
if (fabStack) fabStack.style.display = 'none';
if (btnSearch) btnSearch.style.display = 'flex';
const btnPauseSettings = document.getElementById('btnPauseSettings');
if (btnPauseSettings) {
btnPauseSettings.textContent = '⏸️ 一時停止';
btnPauseSettings.classList.remove('paused');
}
appState.searchMarkers.forEach(marker => marker.map = null);
appState.searchMarkers = [];
if (appState.currentPos && appState.map) {
appState.map.panTo(appState.currentPos);
appState.map.setZoom(17);
}
updateMarkerRotation();
const appBody = document.getElementById('appBody');
if (appBody) appBody.classList.add('panel-open');
switchPanelTab('search');
console.log('ルート案内を終了しました');
console.log('[Navigation] ルート案内終了');
}
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
const btnPauseSettings = document.getElementById('btnPauseSettings');
if (appState.isPaused) {
if (btnPauseSettings) {
btnPauseSettings.textContent = '▶️ 再開';
btnPauseSettings.classList.add('paused');
}
console.warn('ナビゲーションを一時停止しました');
console.log('[Navigation] 一時停止');
} else {
if (btnPauseSettings) {
btnPauseSettings.textContent = '⏸️ 一時停止';
btnPauseSettings.classList.remove('paused');
}
console.log('ナビゲーションを再開しました');
console.log('[Navigation] 再開');
if (appState.currentPos) {
appState.map.panTo(appState.currentPos);
appState.map.setZoom(18);
}
}
}
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
const radiusLabel = document.getElementById('radiusLabel');
const radiusKm = radiusLabel ? parseInt(radiusLabel.textContent) : 10;
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
const results = document.getElementById('results');
if (results) results.style.display = 'none';
}
function displayResults(places, centerLat, centerLng) {
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
if (!resultsDiv) return;
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
console.log(`${limitedResults.length}件の検索結果`);
console.log(`[Search] ${limitedResults.length}件の結果を表示しました`);
}
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
console.log('[Voice] 音声認識開始');
if (btnVoiceIcon) btnVoiceIcon.classList.add('recording');
};
appState.recognition.onresult = (event) => {
const transcript = event.results[0][0].transcript;
console.log('[Voice] 認識結果:', transcript);
const qInput = document.getElementById('q');
if (qInput) qInput.value = transcript;
performSearch(transcript);
console.log(`音声認識: ${transcript}`);
};
appState.recognition.onerror = (event) => {
console.error('[Voice] エラー:', event.error);
if (btnVoiceIcon) btnVoiceIcon.classList.remove('recording');
console.error('音声認識エラーが発生しました');
};
appState.recognition.onend = () => {
console.log('[Voice] 音声認識終了');
if (btnVoiceIcon) btnVoiceIcon.classList.remove('recording');
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
} catch (e) {
console.error('[Voice] 開始エラー:', e);
appState.recognition.stop();
setTimeout(() => {
try {
appState.recognition.start();
} catch (e2) {
console.error('[Voice] 再開エラー:', e2);
console.error('音声認識の開始に失敗しました');
}
}, 100);
}
}
function pickBestGeocodeResult(results) {
if (!Array.isArray(results) || results.length === 0) return null;
const priorityTypes = [
'street_address',
'premise',
'subpremise',
'route',
'plus_code'
];
for (const t of priorityTypes) {
const candidate = results.find(r => Array.isArray(r.types) && r.types.includes(t));
if (candidate && candidate.formatted_address) {
return candidate;
}
}
return results[0];
}
function acquireLocation() {
const onSuccess = (pos) => {
const { latitude, longitude } = pos.coords;
const loadingEl = document.getElementById('loading');
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
const loadingEl = document.getElementById('loading');
if (loadingEl) loadingEl.remove();
if (!appState.mapInitialized) {
  initMap({ lat: 35.0, lng: 135.0 });
}

const addressElement = document.getElementById('locAddress');
const coordsElement = document.getElementById('locCoords');
if (addressElement) addressElement.textContent = '位置情報を確認できません';
if (coordsElement) coordsElement.textContent = '現在地：取得失敗';
console.error('現在地の取得に失敗しました');
};
try {
navigator.geolocation.getCurrentPosition(onSuccess, onError, LOCATION_OPTIONS);
} catch (e) {
console.log('[WalkNav] geolocation exception', e);
console.error('位置情報へのアクセスが拒否されました');
}
}
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
const response = await fetchWithRetry(`${WORKER_ORIGIN}/geocode`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    latlng: { lat: lat, lng: lng },
    language: 'ja'
  })
});

if (!response.ok) {
  const errorText = await response.text();
  throw new Error(`Geocode Worker Error ${response.status}: ${errorText}`);
}
const data = await response.json();
console.log('[Geocode] Raw results:', data.results);

if (data.status === 'OK' && Array.isArray(data.results) && data.results.length > 0) {
  const best = pickBestGeocodeResult(data.results);
  if (best && best.formatted_address) {
    const address = best.formatted_address;
    const cleanAddress = address.replace(/^日本、\s*/, '');
    const formattedAddress = cleanAddress + ' 付近';
    addressElement.textContent = formattedAddress;
    console.log('[Geocode] Selected address:', address, '=>', formattedAddress);
  } else {
    addressElement.textContent = '住所情報なし';
    console.warn('[Geocode] No formatted_address in best result');
  }
} else {
  addressElement.textContent = '住所情報なし';
  if (data.status !== 'ZERO_RESULTS') {
    console.error(`住所取得エラー: ${data.status}`);
  }
}
} catch (error) {
console.error('[Geocode] Fetch error:', error);
addressElement.textContent = '住所取得エラー';
}
}
async function fetchPointAddress(lat, lng) {
const addressBlock = document.getElementById('pointAddressBlock');
const addressElement = document.getElementById('pointAddress');
const coordsElement = document.getElementById('pointCoords');
if (!addressElement || !coordsElement || !addressBlock) {
console.error('[DEBUG] Point Elements not found!');
return;
}
addressElement.textContent = 'ポイント：住所取得中...';
coordsElement.textContent = `緯度 ${lat.toFixed(6)} / 経度 ${lng.toFixed(6)}`;
addressBlock.style.display = 'flex';
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
  const errorText = await response.text();
  throw new Error(`Geocode Worker Error ${response.status}: ${errorText}`);
}
const data = await response.json();
console.log('[Geocode][Point] Raw results:', data.results);

if (data.status === 'OK' && Array.isArray(data.results) && data.results.length > 0) {
  const best = pickBestGeocodeResult(data.results);
  if (best && best.formatted_address) {
    const address = best.formatted_address;
    const cleanAddress = address.replace(/^日本、\s*/, '');
    const formattedAddress = 'ポイント：' + cleanAddress + ' 付近';
    addressElement.textContent = formattedAddress;
    console.log('[Geocode][Point] Selected address:', address, '=>', formattedAddress);
  } else {
    addressElement.textContent = 'ポイント：住所情報なし';
    console.warn('[Geocode][Point] No formatted_address in best result');
  }
} else {
  addressElement.textContent = 'ポイント：住所情報なし';
}
} catch (error) {
console.error('[Geocode] Fetch error for Point:', error);
addressElement.textContent = 'ポイント：住所取得エラー';
}
}
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
console.log('[Weather] Fetching OpenWeather (via Worker)...');
try {
const payload = {
lat: lat,
lon: lng,
units: 'metric'
};
const response = await fetchWithRetry(`${WORKER_ORIGIN}/weather`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
});

if (!response.ok) {
  const errText = await response.text();
  throw new Error(`Weather fetch failed (${response.status}): ${errText}`);
}
const data = await response.json();

const fh = Array.isArray(data.hourly) ? data.hourly : [];
const icon3 = (fh[2] && fh[2].weather[0]) ? iconFromWeatherType(fh[2].weather[0].main) : null;
const icon6 = (fh[5] && fh[5].weather[0]) ? iconFromWeatherType(fh[5].weather[0].main) : null;
const icon9 = (fh[8] && fh[8].weather[0]) ? iconFromWeatherType(fh[8].weather[0].main) : null;

const weather3h = document.getElementById('weather3h');
const weather6h = document.getElementById('weather6h');
const weather9h = document.getElementById('weather9h');
if (weather3h) weather3h.textContent = icon3 || '—';
if (weather6h) weather6h.textContent = icon6 || '—';
if (weather9h) weather9h.textContent = icon9 || '—';
} catch (error) {
console.error('[Weather] Error:', error);
const weather3h = document.getElementById('weather3h');
const weather6h = document.getElementById('weather6h');
const weather9h = document.getElementById('weather9h');
if (weather3h) weather3h.textContent = 'X';
if (weather6h) weather6h.textContent = 'X';
if (weather9h) weather9h.textContent = 'X';
}
}
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
if (!appState.currentPos) {
console.error('現在地が取得できていません');
return;
}
const dialog = createDialog({
id: 'saveLocationDialog',
content: `<h3 class="dialog-title">現在地点登録画面</h3> <p class="dialog-text">登録する地点名を入力してください:</p> <input type="text" id="locationNameInput" class="dialog-input" placeholder="地点名を入力" /> <div class="dialog-actions"> <button id="btnCancelSave" class="dialog-btn cancel">キャンセル</button> <button id="btnConfirmSave" class="dialog-btn confirm">OK</button> </div>`
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
console.log(`「${locationName}」を登録しました`);
};
input.addEventListener('keypress', (e) => {
if (e.key === 'Enter') btnConfirm.click();
});
}
function showEditLocationDialog() {
const locations = JSON.parse(localStorage.getItem('savedLocations') || '[]');
if (locations.length === 0) {
const dialog = createDialog({
id: 'editDialog',
content: `<h3 class="dialog-title">登録地点修正</h3> <p class="dialog-muted">登録された地点がありません</p> <button id="btnCloseEmpty" class="dialog-btn confirm full">閉じる</button>`
});
document.getElementById('btnCloseEmpty').onclick = () => dialog.remove();
return;
}
let listHTML = '';
locations.forEach((loc, index) => {
listHTML += `<div class="location-item"> <div class="location-item-name">${loc.name}</div> <div class="location-item-coords">緯度: ${loc.lat.toFixed(6)} / 経度: ${loc.lng.toFixed(6)}</div> <div class="location-item-actions"> <button class="location-item-btn nav" data-index="${index}">ナビ開始</button> <button class="location-item-btn edit" data-index="${index}">名前変更</button> <button class="location-item-btn delete" data-index="${index}">削除</button> </div> </div>`;
});
listHTML += '';
const dialog = createDialog({
id: 'editDialog',
wide: true,
scroll: true,
content: `<h3 class="dialog-title">登録地点修正</h3> ${listHTML} <button id="btnCloseEdit" class="dialog-btn cancel full" style="margin-top:16px">閉じる</button>`
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
content: `<h3 class="dialog-title">地点名変更</h3> <input type="text" id="renameInput" value="${loc.name}" class="dialog-input" /> <div class="dialog-actions"> <button id="btnCancelRename" class="dialog-btn cancel">キャンセル</button> <button id="btnConfirmRename" class="dialog-btn confirm">OK</button> </div>`
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
renameInput.style.borderColor = 'var(--danger)';
setTimeout(() => { renameInput.style.borderColor = 'var(--stroke)'; }, 2000);
return;
}
locations[index].name = newName;
localStorage.setItem('savedLocations', JSON.stringify(locations));
renameDialog.remove();
dialog.remove();
console.log(`地点名を「${newName}」に変更しました`);
};
renameInput.addEventListener('keypress', (e) => {
if (e.key === 'Enter') document.getElementById('btnConfirmRename').click();
});
};
});
document.querySelectorAll('.location-item-btn.delete').forEach(btn => {
btn.onclick = () => {
const index = parseInt(btn.dataset.index);
const loc = locations[index];
const confirmDialog = createDialog({
id: 'confirmDeleteDialog',
content: `<h3 class="dialog-title">削除確認</h3> <p class="dialog-text">「${loc.name}」を削除しますか？</p> <div class="dialog-actions"> <button id="btnCancelDelete" class="dialog-btn cancel">キャンセル</button> <button id="btnConfirmDelete" class="dialog-btn delete">削除</button> </div>`
});
document.getElementById('btnCancelDelete').onclick = () => confirmDialog.remove();
document.getElementById('btnConfirmDelete').onclick = () => {
locations.splice(index, 1);
localStorage.setItem('savedLocations', JSON.stringify(locations));
confirmDialog.remove();
dialog.remove();
console.log(`「${loc.name}」を削除しました`);
};
};
});
}
function exportRouteToClipboard() {
if (!appState.currentRouteData) {
console.warn('コピーするルートデータがありません');
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
.then(() => console.log('道順をクリップボードにコピーしました'))
.catch(err => {
console.error('Clipboard write error:', err);
console.error('コピーに失敗しました');
});
} else {
console.error('お使いのブラウザはコピー機能に非対応です');
}
}
let lastLocateTime = 0;
function locateUser() {
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
console.log('現在地に移動しました');
} else {
console.log('現在地を取得します…');
acquireLocation();
}
}
function bindKeyboardWatch() {
const searchInput = document.getElementById('q');
const searchPanel = document.getElementById('searchPanel');
const appBody = document.getElementById('appBody');
if (!searchInput || !searchPanel || !appBody) return;
searchInput.addEventListener('focus', () => {
console.log('[Keyboard] Input focused');
appBody.classList.add('keyboard-open');
setTimeout(() => {
const inputTopInPanel = searchInput.offsetTop;
searchPanel.scrollTop = inputTopInPanel - 20;
console.log(`[Keyboard] Scrolled panel to ${searchPanel.scrollTop}`);
}, 350);
});
searchInput.addEventListener('blur', () => {
console.log('[Keyboard] Input blurred');
appBody.classList.remove('keyboard-open');
searchPanel.scrollTop = 0;
});
}
function bindSearchPanelEvents() {
const radiusLabel = document.getElementById('radiusLabel');
const r10 = document.getElementById('r10');
const r20 = document.getElementById('r20');
const r30 = document.getElementById('r30');
const btnPointSearch = document.getElementById('btnPointSearch');
if (!radiusLabel || !r10 || !r20 || !r30 || !btnPointSearch) return;
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
console.log('地図をタップして検索地点を選択');
} else {
btnPointSearch.textContent = '📍 ポイント選択';
btnPointSearch.style.background = 'rgba(255,255,255,.08)';
btnPointSearch.style.color = 'var(--text)';
btnPointSearch.style.borderColor = 'var(--stroke)';
}
};
}
function bindLocationEvents() {
const btnSave = document.getElementById('btnSaveLocation');
const btnEdit = document.getElementById('btnEditLocation');
if (btnSave) btnSave.onclick = showSaveLocationDialog;
if (btnEdit) btnEdit.onclick = showEditLocationDialog;
}
function bindSearchEvents() {
const btnSearchIcon = document.getElementById('btnSearchIcon');
const qInput = document.getElementById('q');
const btnVoiceIcon = document.getElementById('btnVoiceIcon');
const btnReset = document.getElementById('btnReset');
const btnLocatePanel = document.getElementById('btnLocatePanel');
if (btnSearchIcon) {
btnSearchIcon.onclick = () => {
const q = document.getElementById('q');
if (q) {
const query = q.value.trim();
if (query) performSearch(query);
}
};
}
if (qInput) {
qInput.addEventListener('keypress', (e) => {
if (e.key === 'Enter') {
const query = qInput.value.trim();
if (query) performSearch(query);
}
});
}
if (btnVoiceIcon) btnVoiceIcon.onclick = startVoiceSearch;
if (btnReset) {
btnReset.onclick = () => {
const q = document.getElementById('q');
const results = document.getElementById('results');
if (q) q.value = '';
if (results) {
results.style.display = 'none';
results.innerHTML = '';
}
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
if (addressBlock) addressBlock.style.display = 'none';
if (addressElement) addressElement.textContent = '';
if (coordsElement) coordsElement.textContent = '';
appState.pointSearchMode = false;
const btnPointSearch = document.getElementById('btnPointSearch');
if (btnPointSearch) {
btnPointSearch.textContent = '📍 ポイント選択';
btnPointSearch.style.background = 'rgba(255,255,255,.08)';
btnPointSearch.style.color = 'var(--text)';
btnPointSearch.style.borderColor = 'var(--stroke)';
}
const r10 = document.getElementById('r10');
const r20 = document.getElementById('r20');
const r30 = document.getElementById('r30');
const radiusLabel = document.getElementById('radiusLabel');
if (r10) r10.classList.add('active');
if (r20) r20.classList.remove('active');
if (r30) r30.classList.remove('active');
if (radiusLabel) radiusLabel.textContent = '10km';
console.log('リセットしました');
console.log('[WalkNav] リセット完了');
};
}
if (btnLocatePanel) btnLocatePanel.onclick = locateUser;
}
function bindFABEvents() {
const btnSearch = document.getElementById('btnSearch');
const btnClosePanel = document.getElementById('btnClosePanel');
const btnLocate = document.getElementById('btnLocate');
const btnDestination = document.getElementById('btnDestination');
if (btnSearch) {
btnSearch.onclick = () => {
const searchPanel = document.getElementById('searchPanel');
const fabStack = document.getElementById('fabStack');
const appBody = document.getElementById('appBody');
const instructionsList = document.getElementById('navPanelInstructions');
const incidentSection = document.getElementById('incidentSection');
if (searchPanel) searchPanel.style.display = 'block';
  if (fabStack) fabStack.style.display = 'none';
  if (appBody) appBody.classList.add('panel-open');
  if (instructionsList) instructionsList.innerHTML = '';
  if (incidentSection) incidentSection.style.display = 'none';

  switchPanelTab('search');
};
}
if (btnClosePanel) {
btnClosePanel.onclick = () => {
const searchPanel = document.getElementById('searchPanel');
const fabStack = document.getElementById('fabStack');
const appBody = document.getElementById('appBody');
if (searchPanel) searchPanel.style.display = 'none';
  if (!appState.isNavigating) {
    if (fabStack) fabStack.style.display = 'none';
  } else {
    if (fabStack) fabStack.style.display = 'flex';
  }
  if (appBody) appBody.classList.remove('panel-open');
};
}
if (btnLocate) btnLocate.onclick = locateUser;
if (btnDestination) {
btnDestination.onclick = () => {
if (appState.currentDestination && appState.map) {
appState.map.panTo({ lat: appState.currentDestination.lat, lng: appState.currentDestination.lng });
appState.map.setZoom(18);
console.log('目的地に移動しました');
}
};
}
}
function bindRoutePanelEvents() {
const btnStopRoute = document.getElementById('btnStopRoute');
if (btnStopRoute) btnStopRoute.onclick = stopNavigation;
const btnExportText = document.getElementById('btnExportText');
if (btnExportText) btnExportText.onclick = exportRouteToClipboard;
const btnPauseSettings = document.getElementById('btnPauseSettings');
if (btnPauseSettings) btnPauseSettings.onclick = togglePause;
const btnRerouteSettings = document.getElementById('btnRerouteSettings');
if (btnRerouteSettings) {
btnRerouteSettings.onclick = () => {
if (appState.currentDestination) {
startNavigation(appState.currentDestination);
} else {
console.warn('目的地が設定されていません');
}
};
}
}
function bindUI() {
console.log('[WalkNav] Binding UI...');
bindSearchPanelEvents();
bindLocationEvents();
bindSearchEvents();
bindFABEvents();
bindRoutePanelEvents();
bindKeyboardWatch();
console.log('[WalkNav] UI binding complete');
}
function startApp() {
console.log('[WalkNav] Starting app...');
document.documentElement.lang = 'ja';
const searchPanel = document.getElementById('searchPanel');
const fabStack = document.getElementById('fabStack');
const btnSearch = document.getElementById('btnSearch');
const appBody = document.getElementById('appBody');
if (searchPanel) searchPanel.style.display = 'block';
if (fabStack) fabStack.style.display = 'none';
if (btnSearch) btnSearch.style.display = 'flex';
if (appBody) appBody.classList.add('panel-open');
switchPanelTab('search');
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