'use strict';

// WalkNav app.js - v33: Unified Weather UI

const ISSUE_ID = 'idx20251212_v33_unified_weather';

// Google Maps APIキー
const API_KEY = 'AIzaSyBuX-4y1Cgl6jdKcHZWWlsoosDWK_RGqF0';

// Cloudflare Worker
const WORKER_ORIGIN = 'https://ors-proxy.miyata-connect-jp.workers.dev';
const MAP_ID = '9110fb2763169e9d8f2b317e'; 

const DEFAULT_MASK = 'places.displayName,places.formattedAddress,places.location,places.id,places.types';
const MAX_RETRY = 3;
const RETRY_DELAY = 1000;
const LOCATION_OPTIONS = { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 };
const SAVED_LOCATIONS_KEY = 'walknav_saved_locations';
const MAP_MODE_KEY = 'walknav_map_mode';
const PROFILE_KEY = 'walknav_user_profile';

const WN = (window.__WN_GLOBAL__ = window.__WN_GLOBAL__ || {
  booted: false, locks: Object.create(null), alerts: Object.create(null)
});

function lock(key, ms) {
  const now = Date.now(); if (now < (WN.locks[key] || 0)) return false;
  WN.locks[key] = now + ms; return true;
}
function alertOnce(key, msg, ms = 1200) {
  const now = Date.now(); if (now - (WN.alerts[key] || 0) < ms) return;
  WN.alerts[key] = now; alert(msg);
}

if (WN.booted) {
  console.warn('[WalkNav] duplicate app.js blocked:', ISSUE_ID);
} else {
  WN.booted = true;

  const appState = {
    map: null, userMarker: null, userMarkerElement: null, currentPos: null,
    pointSearchMode: false, searchPoint: null, searchPointMarker: null,
    mapInitialized: false, searchMarkers: [], currentDestination: null,
    currentPolyline: null, isNavigating: false, locationWatchId: null,
    compassWatchId: null, currentHeading: 0, isSimulation: false,
    currentRouteData: null, userProfile: { luggage: 'None', condition: 'Normal', companion: 'None' },
    savedLocations: [], isEditingSaved: false,
    mapMode: 'roadmap', searchInFlight: false, searchRadiusMeters: 10000,
    aiMode: 'normal', incidentData: null, cachedWeatherData: null
  };

  function getEl(id) { return document.getElementById(id); }
  function setDisplay(id, displayVal) { const el = getEl(id); if (el) el.style.display = displayVal; }
  function setText(id, text) { const el = getEl(id); if (el) el.textContent = text; }

  /* === Save/Load Logic === */
  function loadSavedLocations() {
    try { const raw = localStorage.getItem(SAVED_LOCATIONS_KEY); if (raw) appState.savedLocations = JSON.parse(raw); } catch (_) { appState.savedLocations = []; }
  }
  function saveLocations() {
    try { localStorage.setItem(SAVED_LOCATIONS_KEY, JSON.stringify(appState.savedLocations)); } catch (_) {}
    renderSavedLocations();
  }
  function addSavedLocation(name, lat, lng, address) {
    appState.savedLocations.push({ name, lat, lng, address });
    saveLocations();
    alert('保存しました: ' + name);
  }
  function removeSavedLocation(index) {
    if (confirm('削除しますか？')) {
      appState.savedLocations.splice(index, 1);
      saveLocations();
    }
  }
  function renameSavedLocation(index) {
    const oldName = appState.savedLocations[index].name;
    const newName = prompt('新しい名前を入力してください', oldName);
    if (newName && newName !== oldName) {
      appState.savedLocations[index].name = newName;
      saveLocations();
    }
  }
  function toggleEditMode() {
    appState.isEditingSaved = !appState.isEditingSaved;
    renderSavedLocations();
    const btn = getEl('btnEditSaved');
    if (btn) {
      btn.textContent = appState.isEditingSaved ? '完了' : '登録地修正';
      btn.style.backgroundColor = appState.isEditingSaved ? '#25d07a' : '';
      btn.style.color = appState.isEditingSaved ? '#fff' : '';
    }
  }
  function renderSavedLocations() {
    let listContainer = getEl('savedLocationsList');
    if (!listContainer) {
      const tabPane = getEl('tabPaneSearch');
      if (!tabPane) return;
      const section = document.createElement('div');
      section.className = 'saved-section';
      section.innerHTML = `<div class="nav-section-title">📂 保存した場所</div><div id="savedLocationsList" class="saved-list"></div>`;
      tabPane.appendChild(section);
      listContainer = getEl('savedLocationsList');
    }
    listContainer.innerHTML = '';
    if (appState.savedLocations.length === 0) {
      listContainer.innerHTML = '<div style="font-size:12px; color:#888; text-align:center;">保存された場所はありません</div>';
      return;
    }
    appState.savedLocations.forEach((loc, index) => {
      const item = document.createElement('div');
      item.className = 'saved-item';
      if (appState.isEditingSaved) item.classList.add('editing');
      const renameBtnHtml = appState.isEditingSaved ? `<button class="rename-btn" style="margin-right:4px;" data-idx="${index}">🖊️</button>` : '';
      item.innerHTML = `
        <div class="saved-info">
          <div class="saved-name">${loc.name}</div>
          <div class="saved-address">${loc.address || ''}</div>
        </div>
        <div class="saved-actions">
          ${renameBtnHtml}
          <button class="delete-btn" data-idx="${index}">削除</button>
        </div>
      `;
      item.onclick = (e) => {
        if (e.target.tagName === 'BUTTON') return;
        if (appState.isEditingSaved) { renameSavedLocation(index); }
        else { startNavigation({ name: loc.name, lat: loc.lat, lng: loc.lng }); }
      };
      item.querySelector('.delete-btn').onclick = (e) => { e.stopPropagation(); removeSavedLocation(index); };
      const renBtn = item.querySelector('.rename-btn');
      if(renBtn) renBtn.onclick = (e) => { e.stopPropagation(); renameSavedLocation(index); };
      listContainer.appendChild(item);
    });
  }

  function loadUserProfile() {
    try { const raw = localStorage.getItem(PROFILE_KEY); if (raw) appState.userProfile = JSON.parse(raw); } catch (_) {}
  }

  /* === Cloudflare Proxy Calls === */
  async function fetchWithRetry(url, options = {}, retries = MAX_RETRY) {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await fetch(url, options);
        if (!response.ok && i < retries - 1) { await new Promise(r => setTimeout(r, RETRY_DELAY * (i + 1))); continue; }
        return response;
      } catch (error) {
        if (i === retries - 1) throw error;
        await new Promise(r => setTimeout(r, RETRY_DELAY * (i + 1)));
      }
    }
  }
  async function fetchWeatherProxy(endpoint, lat, lng) {
    try {
      const resp = await fetchWithRetry(`${WORKER_ORIGIN}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat, lng, language: 'ja', units: 'metric' })
      });
      if (!resp.ok) throw new Error(`Proxy Error: ${resp.status}`);
      return await resp.json();
    } catch (e) { console.error('Weather Proxy failed', e); return null; }
  }
  async function fetchCurrentWeather(lat, lng) { return fetchWeatherProxy('weather', lat, lng); }
  async function fetchForecast(lat, lng) { return fetchWeatherProxy('forecast', lat, lng); }

  async function fetchAddressNominatim(lat, lng) {
    try {
      const resp = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`);
      if (!resp.ok) return '住所不明';
      const data = await resp.json(); return data.display_name || '現在地';
    } catch (e) { return '現在地'; }
  }

  // ★統合された天気カード生成 (v33改修)
  function buildWeatherHtml(current, forecast) {
    if (!current) return '<div style="font-size:12px;color:#888;padding:8px;">☁️ 天気情報取得中...</div>';
    
    // 現在の天気データ
    const curIcon = `https://openweathermap.org/img/wn/${current.weather[0].icon}@2x.png`;
    const curTemp = Math.round(current.main.temp);
    const curDesc = current.weather[0].description;
    
    // 降水確率（直近予報から取得）
    let curPop = 0;
    if (forecast && forecast.list && forecast.list[0]) {
      curPop = Math.round(forecast.list[0].pop * 100);
    }
    
    // 未来の天気 (3h, 6h, 9h)
    let forecastItemsHtml = '';
    if (forecast && forecast.list) {
      // 1=3h後, 2=6h後, 3=9h後
      for (let i = 1; i <= 3; i++) {
        const item = forecast.list[i];
        if (item) {
          const fTime = `${i*3}h`;
          const fIcon = `https://openweathermap.org/img/wn/${item.weather[0].icon}.png`;
          const fTemp = Math.round(item.main.temp);
          const fPop = Math.round(item.pop * 100);
          
          forecastItemsHtml += `
            <div class="weather-forecast-item">
              <span class="wf-time">${fTime}</span>
              <img src="${fIcon}" class="wf-icon" alt="">
              <span class="wf-temp">${fTemp}℃</span>
              <span class="wf-pop">${fPop}%</span>
            </div>
          `;
        }
      }
    }

    // 統合カードHTML
    return `
      <div class="weather-unified-card">
        <div class="weather-current-section">
          <img src="${curIcon}" class="weather-main-icon" alt="${curDesc}">
          <div class="weather-main-temp">${curTemp}℃</div>
          <div class="weather-main-desc">${curDesc}</div>
          <div class="weather-pop-badge">☂ ${curPop}%</div>
        </div>
        
        <div class="weather-forecast-row">
          ${forecastItemsHtml}
        </div>
      </div>
    `;
  }

  async function updateAllWeatherUI(lat, lng) {
    // データ取得
    const [current, forecast] = await Promise.all([fetchCurrentWeather(lat, lng), fetchForecast(lat, lng)]);
    appState.cachedWeatherData = { current, forecast };
    
    // HTML生成
    const html = buildWeatherHtml(current, forecast);

    // 1. 検索タブ (tabPaneSearch) の表示更新
    // 住所カードの下あたりに挿入または更新
    const searchPane = getEl('tabPaneSearch');
    if (searchPane) {
      let wEl = getEl('weatherDisplaySearch');
      if (!wEl) {
        // まだ無ければ作成（住所カードの下）
        wEl = document.createElement('div');
        wEl.id = 'weatherDisplaySearch';
        const addrCard = document.querySelector('.address-card');
        if (addrCard && addrCard.parentNode === searchPane) {
          searchPane.insertBefore(wEl, addrCard.nextSibling);
        } else {
          // なければradiusチップの下あたり
          const chips = searchPane.querySelector('.filter-chips-row');
          if (chips) searchPane.insertBefore(wEl, chips.nextSibling);
        }
      }
      wEl.innerHTML = html; 
      wEl.style.display = 'block';
    }

    // 2. ナビタブ (tabPaneNav) の表示更新
    const navPane = getEl('tabPaneNav');
    if (navPane) {
      let wEl = getEl('weatherDisplayNav');
      if (!wEl) {
        wEl = document.createElement('div');
        wEl.id = 'weatherDisplayNav';
        // 「現在地情報」の下あたり
        const locInfo = navPane.querySelector('.location-info');
        if (locInfo && locInfo.parentNode) {
          locInfo.parentNode.insertBefore(wEl, locInfo.nextSibling);
        } else {
          navPane.prepend(wEl);
        }
      }
      wEl.innerHTML = html;
      wEl.style.display = 'block';
    }

    return current ? { desc: current.weather[0].description, temp: Math.round(current.main.temp) } : { desc: null };
  }

  async function handleVoiceAnnounce() {
    if (!appState.currentPos) return alertOnce('no_pos', '現在地なし');
    if (navigator.vibrate) navigator.vibrate(50);
    const [addr, w] = await Promise.all([fetchAddressNominatim(appState.currentPos.lat, appState.currentPos.lng), updateAllWeatherUI(appState.currentPos.lat, appState.currentPos.lng)]);
    const simple = addr.split(' ').pop().replace(/^日本、\s*/,'').replace(/、.*$/,'');
    let msg = `現在地は${simple}です。`;
    if (w.temp !== null) msg += `天気は${w.desc}、気温は${w.temp}度です。`;
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(msg); u.lang = 'ja-JP'; window.speechSynthesis.speak(u);
    }
  }

  /* === Share URL Corrected === */
  function handleShareLocation() {
    let textBody, url;
    if (appState.isNavigating && appState.currentRouteData && appState.currentDestination) {
      const dest = appState.currentDestination;
      const leg = appState.currentRouteData.routes[0].legs[0];
      const startAddr = leg.start_address ? leg.start_address.replace(/^日本、\s*/, '') : '指定地点';
      const startLoc = leg.start_location;
      const endLoc = leg.end_location;
      textBody = `🏁 ルート共有 (WalkNav)\n出発: ${startAddr}\n到着: ${dest.name}\n🚶 徒歩: ${leg.duration.text} (${leg.distance.text})`;
      const sLat = (typeof startLoc.lat === 'function') ? startLoc.lat() : startLoc.lat;
      const sLng = (typeof startLoc.lng === 'function') ? startLoc.lng() : startLoc.lng;
      const dLat = (typeof endLoc.lat === 'function') ? endLoc.lat() : endLoc.lat;
      const dLng = (typeof endLoc.lng === 'function') ? endLoc.lng() : endLoc.lng;
      url = `https://www.google.com/maps/dir/?api=1&origin=${sLat},${sLng}&destination=${dLat},${dLng}&travelmode=walking`;
    } else if (appState.pointSearchMode && appState.searchPoint) {
      textBody = `📍 指定地点 (WalkNav)`;
      url = `https://www.google.com/maps/search/?api=1&query=${appState.searchPoint.lat},${appState.searchPoint.lng}`;
    } else if (appState.currentPos) {
      textBody = `📍 現在地 (WalkNav)`;
      url = `https://www.google.com/maps/search/?api=1&query=${appState.currentPos.lat},${appState.currentPos.lng}`;
    } else {
      alertOnce('share_err', '位置情報がありません'); return;
    }

    if (navigator.share) {
      navigator.share({ title: 'WalkNav', text: textBody, url: url }).catch(e => console.log('Share canceled', e));
    } else {
      const copyText = `${textBody}\n${url}`;
      navigator.clipboard.writeText(copyText).then(() => alert('リンクをコピーしました')).catch(() => prompt('URL:', url));
    }
  }

  function handleSaveCurrentLocation() {
    if (!appState.currentPos) return alert('現在地が取得できていません');
    const name = prompt('保存する名前を入力してください（例：自宅）');
    if (!name) return;
    const addr = getEl('locAddress')?.textContent || '現在地';
    addSavedLocation(name, appState.currentPos.lat, appState.currentPos.lng, addr);
  }
  function handleSavePointLocation() {
    if (!appState.searchPoint) return;
    const name = prompt('この場所の名前を入力してください');
    if (!name) return;
    const addr = getEl('pointAddress')?.textContent || '指定地点';
    addSavedLocation(name, appState.searchPoint.lat, appState.searchPoint.lng, addr);
  }

  async function placesTextSearch(query, lat, lng) {
    const payload = { textQuery: query, locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: appState.searchRadiusMeters } }, languageCode: 'ja' };
    try {
      const resp = await fetchWithRetry(`${WORKER_ORIGIN}/places:searchText`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-FieldMask': DEFAULT_MASK },
        body: JSON.stringify(payload)
      });
      if (!resp.ok) throw new Error('Worker Error'); return await resp.json();
    } catch (e) { console.warn('Search failed', e); return {}; }
  }

  async function geocode(lat, lng) {
    try {
      const resp = await fetchWithRetry(`${WORKER_ORIGIN}/geocode`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latlng: { lat, lng }, language: 'ja' })
      });
      if (!resp.ok) throw new Error('Worker Error'); return await resp.json();
    } catch (e) {
      const resp = await fetchWithRetry(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&language=ja&key=${API_KEY}`);
      return await resp.json();
    }
  }

  async function fetchIncidentsAround(lat, lng) {
    try {
      const resp = await fetchWithRetry(`${WORKER_ORIGIN}/incidents`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat, lng, radiusKm: 10 })
      });
      const json = await resp.json();
      const sec = getEl('incidentSection'); const box = getEl('incidentText');
      if (sec && box) {
        if (!json) { sec.style.display = 'none'; return; }
        const parts = [];
        if (json.traffic?.length) parts.push('交通:' + json.traffic.map(x=>x.title).join(','));
        if (json.events?.length) parts.push('事故:' + json.events.map(x=>x.title).join(','));
        if (json.weather?.length) parts.push('気象:' + json.weather.map(x=>x.title).join(','));
        sec.style.display = 'block';
        box.textContent = parts.length ? parts.join(' / ') : '周辺の特筆すべきインシデントはありません';
      }
    } catch (_) {}
  }

  function initMap(center) {
    if (appState.map) { appState.map.setCenter(center); return; }
    const mapEl = getEl('map'); if (!mapEl) return;
    try {
      appState.map = new google.maps.Map(mapEl, { center, zoom: 17, mapId: MAP_ID, gestureHandling: 'greedy', clickableIcons: true, disableDefaultUI: true });
      appState.map.addListener('click', (e) => { if (appState.pointSearchMode && e.latLng) setSearchPoint(e.latLng.lat(), e.latLng.lng()); });
      changeMapMode(appState.mapMode);
      appState.mapInitialized = true;
      console.log('[WalkNav] Map initialized v33');
    } catch (e) {
      console.warn('Map ID Init Failed, Fallback', e);
      appState.map = new google.maps.Map(mapEl, { center, zoom: 17, gestureHandling: 'greedy', clickableIcons: true, disableDefaultUI: true });
    }
  }

  function setUserMarker(lat, lng) {
    appState.currentPos = { lat, lng };
    if (!appState.map) return;
    const useAdvanced = (google.maps.marker && google.maps.marker.AdvancedMarkerElement && appState.map.getMapCapabilities().isAdvancedMarkersAvailable !== false);
    if (useAdvanced) {
      if (!appState.userMarker) {
        const el = document.createElement('div'); el.className = 'wn-user-marker'; appState.userMarkerElement = el;
        appState.userMarker = new google.maps.marker.AdvancedMarkerElement({ map: appState.map, position: { lat, lng }, content: el, zIndex: 1000 });
      } else { appState.userMarker.position = { lat, lng }; }
      if (appState.userMarkerElement) appState.userMarkerElement.style.transform = `rotate(${appState.currentHeading}deg)`;
    } else {
      if (!appState.userMarker) {
        appState.userMarker = new google.maps.Marker({
          map: appState.map, position: { lat, lng }, zIndex: 1000,
          icon: { path: google.maps.SymbolPath.CIRCLE, scale: 10, fillColor: "#3aa0ff", fillOpacity: 1, strokeWeight: 2, strokeColor: "white" }
        });
      } else { appState.userMarker.setPosition({ lat, lng }); }
    }
  }

  function setSearchPoint(lat, lng) {
    appState.searchPoint = { lat, lng };
    if (!appState.map) return;
    if (appState.searchPointMarker) { if(appState.searchPointMarker.map) appState.searchPointMarker.map = null; appState.searchPointMarker = null; }
    const el = document.createElement('div'); el.className = 'wn-point-marker';
    appState.searchPointMarker = new google.maps.marker.AdvancedMarkerElement({ map: appState.map, position: { lat, lng }, content: el, zIndex: 999 });
    setText('pointAddress', '取得中…'); setDisplay('pointAddressBlock', 'flex'); setText('pointCoords', `Lat: ${lat.toFixed(5)}`);
    geocode(lat, lng).then(d => setText('pointAddress', d.results?.[0]?.formatted_address.replace(/^日本、\s*/,'') || '不明'));
    fetchIncidentsAround(lat, lng);
    const actionRow = document.querySelector('#pointAddressBlock + .action-buttons-row'); 
    if (actionRow && !getEl('btnSavePoint')) {
      const btn = document.createElement('button');
      btn.id = 'btnSavePoint'; btn.className = 'btn btn-outline'; 
      btn.style.borderColor = '#d97706'; btn.style.color = '#d97706';
      btn.textContent = '⭐ 保存'; btn.onclick = handleSavePointLocation;
      actionRow.appendChild(btn);
    }
  }

  function acquireLocation() {
    navigator.geolocation.getCurrentPosition(pos => {
      const { latitude, longitude } = pos.coords;
      getEl('loading')?.remove();
      if (!appState.mapInitialized) initMap({ lat: latitude, lng: longitude }); else appState.map.setCenter({ lat: latitude, lng: longitude });
      setUserMarker(latitude, longitude);
      setText('locCoords', `Lat: ${latitude.toFixed(5)}`);
      geocode(latitude, longitude).then(d => setText('locAddress', d.results?.[0]?.formatted_address.replace(/^日本、\s*/,'') || ''));
      updateAllWeatherUI(latitude, longitude); fetchIncidentsAround(latitude, longitude);
    }, () => {
      getEl('loading')?.remove(); const def = { lat: 35.0, lng: 135.0 };
      if (!appState.mapInitialized) initMap(def); setUserMarker(def.lat, def.lng);
      setText('locAddress', '取得失敗'); updateAllWeatherUI(def.lat, def.lng);
    }, LOCATION_OPTIONS);
  }

  function startCompassListener() {
    window.addEventListener('deviceorientation', (e) => {
      if (appState.isNavigating) return;
      const h = e.webkitCompassHeading || (e.absolute ? e.alpha : null);
      if (h != null && appState.userMarkerElement) {
        appState.currentHeading = h; appState.userMarkerElement.style.transform = `rotate(${h}deg)`;
      }
    }, true);
  }

  function startLocationWatcher() {
    if (appState.locationWatchId) navigator.geolocation.clearWatch(appState.locationWatchId);
    appState.locationWatchId = navigator.geolocation.watchPosition(pos => {
      setUserMarker(pos.coords.latitude, pos.coords.longitude);
      if (appState.isNavigating && appState.map && !appState.pointSearchMode) {
        appState.map.panTo({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      }
    }, null, LOCATION_OPTIONS);
  }

  function renderRoute(route, destName) {
    if (!route?.legs?.[0]) return;
    const leg = route.legs[0];
    const startName = leg.start_address ? leg.start_address.replace(/^日本、\s*/, '') : '現在地';
    const title = appState.pointSearchMode ? `🚩 出発: ${startName}\n🏁 到着: ${destName}` : destName || '目的地';
    setText('destinationName', title);
    setText('routeDistance', leg.distance?.text); setText('routeTime', `徒歩 ${leg.duration?.text}`);
    
    const list = getEl('navPanelInstructions');
    if (list) {
      list.innerHTML = '';
      leg.steps.forEach(s => {
        const d = document.createElement('div'); d.className = 'nav-instruction-item';
        d.textContent = s.html_instructions.replace(/<[^>]+>/g,'') + (s.distance?.text ? ` (${s.distance.text})` : '');
        list.appendChild(d);
      });
    }
    setDisplay('instructionsSection', 'block');
    if (appState.currentPolyline) appState.currentPolyline.setMap(null);
    if (google.maps.geometry) {
      appState.currentPolyline = new google.maps.Polyline({
        path: google.maps.geometry.encoding.decodePath(route.overview_polyline.points),
        map: appState.map, strokeColor: '#62b5ff', strokeWeight: 6
      });
    }
    const b = new google.maps.LatLngBounds(); b.extend(appState.currentPos); b.extend(leg.end_location);
    if (leg.start_location) b.extend(leg.start_location);
    appState.map.fitBounds(b, { padding: 50 });
    setDisplay('routeInfoSection', 'block');
    if (appState.cachedWeatherData?.current) updateAllWeatherUI(appState.currentPos.lat, appState.currentPos.lng);
  }

  async function startNavigation(dest) {
    if (!appState.currentPos) return;
    let originLat, originLng;
    if (appState.pointSearchMode && appState.searchPoint) {
      originLat = appState.searchPoint.lat; originLng = appState.searchPoint.lng;
    } else {
      originLat = appState.currentPos.lat; originLng = appState.currentPos.lng;
    }

    appState.currentDestination = dest; appState.isNavigating = true;
    getEl('searchPanel').classList.add('collapsed');
    setDisplay('fabStack', 'flex'); setDisplay('searchPanel', 'block'); switchPanelTab('nav'); setDisplay('routeControlSection', 'block'); setDisplay('results', 'none');
    try {
      const resp = await fetchWithRetry(`${WORKER_ORIGIN}/directions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin: `${originLat},${originLng}`, destination: `${dest.lat},${dest.lng}`, mode: 'walking', language: 'ja' })
      });
      const json = await resp.json();
      let chosen = { route: json.routes[0], index: 0 };
      if (window.RouteEvaluator?.pickBestRoute) chosen = window.RouteEvaluator.pickBestRoute(json.routes, appState.userProfile, appState.aiMode);
      appState.currentRouteData = { routes: json.routes, selectedIndex: chosen.index };
      renderRoute(chosen.route, dest.name);
      startLocationWatcher(); fetchIncidentsAround(dest.lat, dest.lng);
    } catch (e) { alertOnce('route_err', 'ルート取得失敗'); stopNavigation(); }
  }

  function stopNavigation() {
    if (appState.locationWatchId) navigator.geolocation.clearWatch(appState.locationWatchId);
    appState.isNavigating = false;
    if (appState.currentPolyline) appState.currentPolyline.setMap(null);
    setDisplay('routeControlSection', 'none'); setDisplay('instructionsSection', 'none'); setDisplay('routeInfoSection', 'none');
    setDisplay('btnDestination', 'none'); setDisplay('fabStack', 'none'); setDisplay('btnSearch', 'flex');
    switchPanelTab('search');
    if (appState.currentPos && appState.map) { appState.map.panTo(appState.currentPos); appState.map.setZoom(17); }
  }

  function switchPanelTab(mode) {
    const s = getEl('tabPaneSearch'), n = getEl('tabPaneNav'), st = getEl('tabPaneSettings');
    if (s) s.classList.toggle('active', mode !== 'nav' && mode !== 'settings');
    if (n) n.classList.toggle('active', mode === 'nav');
    if (st) st.classList.toggle('active', mode === 'settings');
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.panelTab === (mode==='settings'?'settings':mode==='nav'?'nav':'search')));
  }

  function changeMapMode(mode) {
    localStorage.setItem(MAP_MODE_KEY, mode); appState.mapMode = mode;
    if (appState.map) {
      appState.map.setMapTypeId(mode === 'photo' ? google.maps.MapTypeId.SATELLITE : mode === '3d' ? google.maps.MapTypeId.HYBRID : google.maps.MapTypeId.ROADMAP);
      appState.map.setTilt(mode === '3d' ? 45 : 0);
    }
    ['btnMapPhoto', 'btnMapRoadmap', 'btnMap3D'].forEach(id => getEl(id)?.classList.toggle('active', getEl(id).dataset.mode === mode));
  }

  function bindUI() {
    const q = getEl('q');
    if (getEl('btnSearchIcon')) getEl('btnSearchIcon').onclick = () => {
      let lat, lng;
      if (appState.pointSearchMode && appState.searchPoint) { lat = appState.searchPoint.lat; lng = appState.searchPoint.lng; }
      else { lat = appState.currentPos.lat; lng = appState.currentPos.lng; }
      placesTextSearch(q.value, lat, lng).then(d => displayResults(d.places || []));
    };
    if (q) q.onkeypress = (e) => { if (e.key === 'Enter') getEl('btnSearchIcon').click(); };
    if (getEl('btnReset')) getEl('btnReset').onclick = () => { q.value = ''; setDisplay('results', 'none'); appState.pointSearchMode = false; getEl('btnPointSearch').textContent = '📍 ポイント選択'; getEl('btnPointSearch').classList.remove('active'); };
    if (getEl('btnLocate')) getEl('btnLocate').onclick = acquireLocation;
    if (getEl('btnLocatePanel')) getEl('btnLocatePanel').onclick = acquireLocation;
    if (getEl('btnClosePanel')) getEl('btnClosePanel').onclick = () => getEl('searchPanel').classList.add('collapsed');
    if (getEl('btnSearch')) getEl('btnSearch').onclick = () => getEl('searchPanel').classList.remove('collapsed');
    if (getEl('btnStopRoute')) getEl('btnStopRoute').onclick = stopNavigation;
    [10, 20, 30].forEach(d => {
      const el = getEl(`r${d}`);
      if (el) el.onclick = () => { appState.searchRadiusMeters = d * 1000; setText('radiusLabel', `${d}km`); document.querySelectorAll('.chip').forEach(c => c.classList.remove('active')); el.classList.add('active'); };
    });
    if (getEl('btnPointSearch')) getEl('btnPointSearch').onclick = () => {
      appState.pointSearchMode = !appState.pointSearchMode;
      const b = getEl('btnPointSearch');
      b.textContent = appState.pointSearchMode ? '📍 選択中...' : '📍 ポイント選択';
      b.classList.toggle('active', appState.pointSearchMode);
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
    const ph = document.querySelector('.panel-handle-area');
    if(ph) ph.onclick = () => getEl('searchPanel').classList.toggle('collapsed');

    const addressCard = document.querySelector('.address-card');
    if (addressCard) {
      let actionRow = addressCard.nextElementSibling;
      if (!actionRow || !actionRow.classList.contains('action-buttons-row')) {
        actionRow = document.createElement('div');
        actionRow.className = 'action-buttons-row';
        addressCard.parentNode.insertBefore(actionRow, addressCard.nextSibling);
      }
      if (!getEl('btnSaveCurrent')) {
        const btn = document.createElement('button');
        btn.id = 'btnSaveCurrent'; btn.className = 'btn btn-outline'; 
        btn.textContent = '⭐ 現在地保存';
        btn.onclick = handleSaveCurrentLocation;
        actionRow.appendChild(btn);
      }
      if (!getEl('btnEditSaved')) {
        const btn = document.createElement('button');
        btn.id = 'btnEditSaved'; btn.className = 'btn btn-outline'; btn.textContent = '登録地修正';
        btn.onclick = toggleEditMode;
        actionRow.appendChild(btn);
      }
    }
  }

  function displayResults(places) {
    const div = getEl('results'); if (!div) return;
    div.innerHTML = ''; setDisplay('results', 'block'); setDisplay('instructionsSection', 'none');
    appState.searchMarkers.forEach(m => { if(m.map) m.map=null; if(m.setMap) m.setMap(null); });
    appState.searchMarkers = [];
    
    places.slice(0, 5).forEach((p, i) => {
      const item = document.createElement('div'); item.className = 'result-item';
      item.innerHTML = `<div>${i + 1}. ${p.displayName?.text || '名称不明'}</div><div style="font-size:0.8em;opacity:0.7">${p.formattedAddress || ''}</div>`;
      item.onclick = () => startNavigation({ name: p.displayName?.text, lat: p.location.latitude, lng: p.location.longitude });
      div.appendChild(item);
      if (google.maps.marker?.AdvancedMarkerElement) {
        const el = document.createElement('div'); el.className = 'wn-search-marker'; el.textContent = String(i + 1);
        appState.searchMarkers.push(new google.maps.marker.AdvancedMarkerElement({ map: appState.map, position: { lat: p.location.latitude, lng: p.location.longitude }, content: el, title: p.displayName?.text }));
      }
    });
  }

  function startApp() {
    console.log('[WalkNav] Starting v33 (Unified Weather UI)...');
    loadUserProfile(); loadSavedLocations();
    bindUI(); renderSavedLocations();
    appState.mapMode = localStorage.getItem(MAP_MODE_KEY) || 'roadmap';
    switchPanelTab('search'); acquireLocation(); startCompassListener();
  }

  function initializeWhenReady() {
    if (typeof google !== 'undefined' && google.maps && google.maps.Map) { startApp(); }
    else { console.log('[WalkNav] Waiting for Maps...'); setTimeout(initializeWhenReady, 200); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeWhenReady);
  else initializeWhenReady();
}
