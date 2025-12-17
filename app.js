'use strict';

// WalkNav app.js - v83: Fix Bounds & Destination Logic
// 検索時に全ピンが見えるようBounds調整＆ルート案内先が自宅になるバグの完全修正

const ISSUE_ID = 'idx20251213_v83_fix_bounds_and_destination';

const API_KEY = 'AIzaSyBuX-4y1Cgl6jdKcHZWWlsoosDWK_RGqF0';
const WORKER_ORIGIN = 'https://ors-proxy.miyata-connect-jp.workers.dev';
const MAP_ID_KEY = 'walknav_map_id';
const MAP_ID = (window.WALKNAV_MAP_ID || localStorage.getItem(MAP_ID_KEY) || '9110fb2763169e9d8f2b317e');

const DEFAULT_MASK = 'places.displayName,places.formattedAddress,places.location,places.id,places.types';
const MAX_RETRY = 3;
const RETRY_DELAY = 1000;
const LOCATION_OPTIONS = {
  enableHighAccuracy: true,
  timeout: 15000,
  maximumAge: 0
};
const SAVED_LOCATIONS_KEY = 'walknav_saved_locations';
const MAP_MODE_KEY = 'walknav_map_mode';
const PROFILE_KEY = 'walknav_user_profile';

const WN = (window.__WN_GLOBAL__ = window.__WN_GLOBAL__ || {
  booted: false,
  locks: Object.create(null),
  alerts: Object.create(null)
});

function lock(key, ms) {
  const now = Date.now();
  if (now < (WN.locks[key] || 0)) return false;
  WN.locks[key] = now + ms;
  return true;
}

function alertOnce(key, msg, ms = 1200) {
  const now = Date.now();
  if (now - (WN.alerts[key] || 0) < ms) return;
  WN.alerts[key] = now;
  alert(msg);
}

if (WN.booted) {
  console.warn('[WalkNav] duplicate app.js blocked:', ISSUE_ID);
} else {
  WN.booted = true;

  const appState = {
    map: null,
    userMarker: null,
    currentPos: null,
    pointSearchMode: false,
    searchPoint: null,
    searchPointMarker: null,
    mapInitialized: false,
    searchMarkers: [],
    searchInfoWindows: [],
    savedLocationMarkers: [],
    currentDestination: null,
    currentPolyline: null,
    isNavigating: false,
    locationWatchId: null,
    compassWatchId: null,
    currentHeading: 0,
    isSimulation: false,
    currentRouteData: null,
    userProfile: {
      luggage: 'None',
      condition: 'Normal',
      companion: 'None'
    },
    savedLocations: [],
    mapMode: 'roadmap',
    searchInFlight: false,
    searchRadiusMeters: 10000,
    aiMode: 'normal',
    incidentData: null,
    cachedWeatherData: null,
    lastFabSourceId: null
  };

  function getEl(id) { return document.getElementById(id); }
  function setDisplay(id, displayVal) { const el = getEl(id); if (el) el.style.display = displayVal; }
  function setText(id, text) { const el = getEl(id); if (el) el.textContent = text; }

  function isPanelHiddenForce() {
    const panel = getEl('searchPanel');
    return !!(panel && panel.classList.contains('hidden-force'));
  }

  function isPanelOpen() {
    const panel = getEl('searchPanel');
    if (!panel) return false;
    if (panel.classList.contains('hidden-force')) return false;
    return !panel.classList.contains('collapsed');
  }

  function getActiveTabNameFromDOM() {
    const paneSearch = getEl('tabPaneSearch');
    const paneNav = getEl('tabPaneNav');
    const paneSettings = getEl('tabPaneSettings');
    if (paneSettings && paneSettings.classList.contains('active')) return 'settings';
    if (paneNav && paneNav.classList.contains('active')) return 'nav';
    if (paneSearch && paneSearch.classList.contains('active')) return 'search';
    return 'search';
  }

  /* === FAB Logic === */
  function getFabBtnIds() {
    return ['btnSearchFab', 'btnLocateFab', 'btnDestFab', 'btnSettingsFab', 'btnNavFab', 'btnShareFab', 'btnStopFab'];
  }

  function setFabLabel(btnId, text, isClose = false) {
    const btn = getEl(btnId);
    if (!btn) return;
    const label = btn.querySelector('.fab-label');
    if (label) label.textContent = text;
    btn.classList.toggle('is-close', !!isClose);
  }

  function restoreFabLabels() {
    getFabBtnIds().forEach(id => {
      const btn = getEl(id);
      if (!btn) return;
      const def = btn.getAttribute('data-label') || '';
      if (def) setFabLabel(id, def, false);
      else btn.classList.remove('is-close');
    });
    appState.lastFabSourceId = null;
  }

  function showCloseHintOn(btnId) {
    restoreFabLabels();
    setFabLabel(btnId, '閉じる', true);
    appState.lastFabSourceId = btnId;
  }

  function updateFabVisibility() {
    const fab = getEl('fabStack');
    if (fab) {
      fab.classList.remove('initial-hidden');
      fab.style.display = 'flex';
      fab.style.visibility = 'visible';
      fab.style.opacity = '1';
    }
  }

  function togglePanel() {
    const panel = getEl('searchPanel');
    if (!panel) return;
    panel.classList.toggle('collapsed');
    if (!isPanelOpen()) restoreFabLabels();
  }

  function collapsePanel() {
    const panel = getEl('searchPanel');
    if (!panel) return;
    panel.classList.add('collapsed');
    restoreFabLabels();
  }

  function openPanel() {
    const panel = getEl('searchPanel');
    if (!panel) return;
    panel.classList.remove('collapsed');
  }

  function switchPanelTab(mode) {
    const panel = getEl('searchPanel');
    const s = getEl('tabPaneSearch');
    const n = getEl('tabPaneNav');
    const st = getEl('tabPaneSettings');

    if (s) s.classList.toggle('active', mode === 'search');
    if (n) n.classList.toggle('active', mode === 'nav');
    if (st) st.classList.toggle('active', mode === 'settings');

    document.querySelectorAll('.tab-btn').forEach(b => {
      const t = b.getAttribute('data-panel-tab');
      b.classList.toggle('active', t === mode);
    });

    if (panel) panel.setAttribute('data-current-tab', mode);
  }

  function togglePanelFromFab(targetTab, sourceBtnId) {
    if (isPanelHiddenForce()) return;
    const open = isPanelOpen();
    const active = getActiveTabNameFromDOM();
    if (open && active === targetTab) {
      collapsePanel();
      return;
    }
    switchPanelTab(targetTab);
    openPanel();
    showCloseHintOn(sourceBtnId);
  }

  /* === Save/Load Logic === */
  function loadSavedLocations() {
    try {
      const raw = localStorage.getItem(SAVED_LOCATIONS_KEY);
      if (raw) appState.savedLocations = JSON.parse(raw);
    } catch (_) {
      appState.savedLocations = [];
    }
    if (appState.mapInitialized) refreshSavedMarkers();
  }

  function saveLocations() {
    try {
      localStorage.setItem(SAVED_LOCATIONS_KEY, JSON.stringify(appState.savedLocations));
      renderSavedLocations();
      refreshSavedMarkers();
    } catch (e) {
      alert('保存容量がいっぱいです。古い写真メモ等を削除してください。');
    }
  }

  function addSavedLocation(name, lat, lng, address, imageData = null) {
    const newItem = { name, lat, lng, address, timestamp: Date.now() };
    if (imageData) {
      newItem.image = imageData;
      newItem.type = 'photo';
    } else {
      newItem.type = 'location';
    }
    appState.savedLocations.unshift(newItem);
    saveLocations();
    alert(imageData ? '写真を記録しました' : '場所を保存しました');
  }

  async function refreshSavedMarkers() {
    if (!appState.map) return;
    appState.savedLocationMarkers.forEach(m => m.setMap(null));
    appState.savedLocationMarkers = [];

    const { AdvancedMarkerElement, PinElement } = await google.maps.importLibrary("marker");

    appState.savedLocations.forEach(loc => {
      const isPhoto = (loc.type === 'photo');
      const pin = new PinElement({
        glyph: isPhoto ? '📷' : '★',
        background: isPhoto ? '#25d07a' : '#f59e0b',
        borderColor: '#ffffff',
      });

      const marker = new AdvancedMarkerElement({
        map: appState.map,
        position: { lat: loc.lat, lng: loc.lng },
        content: pin.element,
        title: loc.name
      });

      const infoContent = document.createElement('div');
      infoContent.className = 'info-window-content';
      let html = `<div style="font-weight:bold; margin-bottom:4px;">${loc.name}</div>`;
      html += `<div style="font-size:11px; color:#666; margin-bottom:4px;">${loc.address || ''}</div>`;
      if (loc.image) {
        html += `<img src="${loc.image}" style="max-width:200px; max-height:200px; display:block; border-radius:4px; margin-top:4px;">`;
      }
      html += `<button id="btnInfoNav" style="margin-top:8px; padding:4px 10px; background:#2563eb; color:white; border:none; border-radius:4px;">ここへ行く</button>`;
      
      infoContent.innerHTML = html;
      const infoWindow = new google.maps.InfoWindow({ content: infoContent });
      
      marker.addListener('click', () => {
        infoWindow.open(appState.map, marker);
        setTimeout(() => {
           const btn = document.querySelector('#btnInfoNav');
           if(btn) btn.onclick = () => startNavigation(loc);
        }, 200);
      });

      appState.savedLocationMarkers.push(marker);
    });
  }

  function renderSavedLocations() {
    let listContainer = getEl('savedSectionContainer');
    if (!listContainer) return;
    listContainer.innerHTML = '';
    const section = document.createElement('div');
    section.className = 'saved-section';
    section.innerHTML = `<div class="nav-section-title">📂 保存した場所・メモ</div><div id="savedLocationsList"></div>`;
    listContainer.appendChild(section);
    const listEl = section.querySelector('#savedLocationsList');
    if (appState.savedLocations.length === 0) {
      listEl.innerHTML = '<div style="font-size:12px; color:#888; text-align:center;">保存された場所はありません</div>';
      return;
    }
    appState.savedLocations.forEach((loc) => {
      const item = document.createElement('div');
      item.className = 'saved-item';
      const icon = (loc.type === 'photo') ? '📸' : '📍';
      item.innerHTML = `
        <div class="saved-info">
          <div class="saved-name">${icon} ${loc.name}</div>
          <div class="saved-address">${loc.address || ''}</div>
        </div>
        <div style="font-size:20px; color:#555;">›</div>
      `;
      item.onclick = () => {
        startNavigation({ name: loc.name, lat: loc.lat, lng: loc.lng });
      };
      listEl.appendChild(item);
    });
  }

  function handleCameraInput(e) {
    const file = e.target.files[0];
    if (!file) return;
    let lat, lng;
    if (appState.pointSearchMode && appState.searchPoint) {
      lat = appState.searchPoint.lat;
      lng = appState.searchPoint.lng;
    } else if (appState.currentPos) {
      lat = appState.currentPos.lat;
      lng = appState.currentPos.lng;
    } else {
      alert('現在地が不明なため記録できません');
      return;
    }
    const reader = new FileReader();
    reader.onload = function(event) {
      const img = new Image();
      img.onload = function() {
        const canvas = document.createElement('canvas');
        const MAX_SIZE = 800;
        let width = img.width;
        let height = img.height;
        if (width > height) {
          if (width > MAX_SIZE) { height *= MAX_SIZE / width; width = MAX_SIZE; }
        } else {
          if (height > MAX_SIZE) { width *= MAX_SIZE / height; height = MAX_SIZE; }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
        const name = prompt('この写真のメモを入力:', '写真メモ');
        if (name !== null) {
            const addr = getEl('locAddress')?.textContent || '住所不明';
            addSavedLocation(name || '無題の写真', lat, lng, addr, dataUrl);
        }
        e.target.value = '';
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  }

  function quickSearch(keyword) {
    if (!appState.currentPos) return alert('現在地を取得してください');
    const q = getEl('q');
    if (q) {
      q.value = keyword;
      placesTextSearch(keyword, appState.currentPos.lat, appState.currentPos.lng)
        .then(d => {
          displayResults(d.places || []);
        });
    }
  }

  function openEditModal() {
    const modal = getEl('editSavedModal');
    const list = getEl('editModalList');
    if (!modal || !list) return;
    list.innerHTML = '';
    if (appState.savedLocations.length === 0) {
      list.innerHTML = '<div style="text-align:center; color:#888; margin-top:20px;">保存された場所はありません</div>';
    } else {
      appState.savedLocations.forEach((loc, idx) => {
        const item = document.createElement('div');
        item.className = 'edit-list-item';
        item.innerHTML = `
          <div class="edit-item-inputs">
            <input type="text" class="edit-input-name" value="${loc.name}" data-idx="${idx}">
            <div class="edit-text-addr">${loc.type === 'photo' ? '📸 写真メモ' : ''} ${loc.address || '住所不明'}</div>
          </div>
          <button class="btn-delete-icon" data-delete-idx="${idx}" type="button">×</button>
        `;
        list.appendChild(item);
      });
      list.querySelectorAll('.btn-delete-icon').forEach(btn => {
        btn.onclick = (e) => {
          e.target.closest('.edit-list-item').remove();
        };
      });
    }
    modal.style.display = 'flex';
  }

  function closeEditModal() {
    const modal = getEl('editSavedModal');
    if (modal) modal.style.display = 'none';
  }

  function saveEditModalChanges() {
    const list = getEl('editModalList');
    if (!list) return;
    const newLocations = [];
    const items = list.querySelectorAll('.edit-list-item');
    items.forEach(item => {
      const input = item.querySelector('.edit-input-name');
      const idx = parseInt(input.dataset.idx);
      const newName = input.value.trim();
      if (newName) {
        const original = appState.savedLocations[idx];
        if (original) {
          original.name = newName;
          newLocations.push(original);
        }
      }
    });
    appState.savedLocations = newLocations;
    saveLocations();
    closeEditModal();
  }

  function loadUserProfile() {
    try {
      const raw = localStorage.getItem(PROFILE_KEY);
      if (raw) appState.userProfile = JSON.parse(raw);
    } catch (_) {}
  }

  async function fetchWithRetry(url, options = {}, retries = MAX_RETRY) {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await fetch(url, options);
        if (!response.ok && i < retries - 1) {
          await new Promise(r => setTimeout(r, RETRY_DELAY * (i + 1)));
          continue;
        }
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
      if (!resp.ok) throw new Error('Proxy Error');
      return await resp.json();
    } catch (e) { return null; }
  }
  async function fetchCurrentWeather(lat, lng) { return fetchWeatherProxy('weather', lat, lng); }
  async function fetchForecast(lat, lng) { return fetchWeatherProxy('forecast', lat, lng); }

  async function geocode(lat, lng) {
    try {
      const resp = await fetchWithRetry(`${WORKER_ORIGIN}/geocode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latlng: { lat, lng }, language: 'ja' })
      });
      if (!resp.ok) throw new Error('Worker Error');
      return await resp.json();
    } catch (e) {
      const resp = await fetchWithRetry(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&language=ja&key=${API_KEY}`);
      return await resp.json();
    }
  }

  async function fetchIncidentsAround(lat, lng) {
    try {
      const resp = await fetchWithRetry(`${WORKER_ORIGIN}/incidents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat, lng, radiusKm: 10 })
      });
      const json = await resp.json();
      const sec = getEl('incidentSection');
      const box = getEl('incidentText');
      if (sec && box) {
        if (!json) { sec.style.display = 'none'; return; }
        const parts = [];
        if (json.traffic?.length) parts.push('交通:' + json.traffic.map(x => x.title).join(','));
        if (json.events?.length) parts.push('事故:' + json.events.map(x => x.title).join(','));
        sec.style.display = 'block';
        box.textContent = parts.length ? parts.join(' / ') : '特になし';
      }
    } catch (_) {}
  }

  async function initMap(center) {
    if (appState.map) {
      appState.map.setCenter(center);
      return;
    }
    const mapEl = getEl('map');
    if (!mapEl) return;

    try {
      const { Map } = await google.maps.importLibrary("maps");
      const { AdvancedMarkerElement, PinElement } = await google.maps.importLibrary("marker");

      appState.map = new Map(mapEl, {
        center,
        zoom: 17,
        gestureHandling: 'greedy',
        clickableIcons: true,
        disableDefaultUI: true,
        mapId: MAP_ID
      });

      appState.map.addListener('click', (e) => {
        if (appState.pointSearchMode && e.latLng) setSearchPoint(e.latLng.lat(), e.latLng.lng());
      });

      changeMapMode(appState.mapMode);
      appState.mapInitialized = true;
      refreshSavedMarkers();
      console.log('[WalkNav] Map initialized v83');
    } catch (e) {
      console.warn('Map Init Failed', e);
    }
  }

  async function setUserMarker(lat, lng) {
    appState.currentPos = { lat, lng };
    if (!appState.map) return;

    const { AdvancedMarkerElement, PinElement } = await google.maps.importLibrary("marker");

    if (appState.userMarker) {
      appState.userMarker.position = { lat, lng };
    } else {
      const pin = new PinElement({
        glyph: '',
        background: '#3aa0ff',
        borderColor: '#ffffff',
        scale: 1.2
      });
      appState.userMarker = new AdvancedMarkerElement({
        map: appState.map,
        position: { lat, lng },
        content: pin.element
      });
    }
  }

  async function setSearchPoint(lat, lng) {
    appState.searchPoint = { lat, lng };
    if (!appState.map) return;

    const { AdvancedMarkerElement } = await google.maps.importLibrary("marker");

    if (appState.searchPointMarker) {
      appState.searchPointMarker.map = null;
    }

    appState.searchPointMarker = new AdvancedMarkerElement({
      map: appState.map,
      position: { lat, lng },
      zIndex: 999
    });

    setText('pointAddress', '取得中…');
    setDisplay('pointAddressBlock', 'flex');
    setText('pointCoords', `Lat: ${lat.toFixed(6)}, Lng: ${lng.toFixed(6)}`);
    geocode(lat, lng).then(d => {
      const addr = d.results?.[0]?.formatted_address ? d.results[0].formatted_address.replace(/^日本、\s*/, '') : '不明';
      setText('pointAddress', addr);
    });
  }

  function acquireLocation() {
    navigator.geolocation.getCurrentPosition(pos => {
      const { latitude, longitude } = pos.coords;
      getEl('loading')?.remove();
      if (!appState.mapInitialized) {
        initMap({ lat: latitude, lng: longitude });
      } else {
        appState.map.panTo({ lat: latitude, lng: longitude });
        appState.map.setZoom(19);
      }
      setUserMarker(latitude, longitude);
      const latStr = latitude.toFixed(5);
      const lngStr = longitude.toFixed(5);
      setText('locCoords', `📍 ${latStr}, ${lngStr}`);
      geocode(latitude, longitude).then(d => {
        const addr = d.results?.[0]?.formatted_address ? d.results[0].formatted_address.replace(/^日本、\s*/, '') : '';
        setText('locAddress', addr);
      });
      updateAllWeatherUI(latitude, longitude);
    }, () => {
      getEl('loading')?.remove();
      initMap({ lat: 35.0, lng: 135.0 });
    }, LOCATION_OPTIONS);
  }

  function startLocationWatcher() {
    if (appState.locationWatchId) navigator.geolocation.clearWatch(appState.locationWatchId);
    appState.locationWatchId = navigator.geolocation.watchPosition(pos => {
      setUserMarker(pos.coords.latitude, pos.coords.longitude);
      // v83 Fix: 自動追尾はナビ中のみ、かつユーザーがマップを動かしていない時のみ（簡易実装としてナビ中はパンする）
      if (appState.isNavigating && appState.map && !appState.pointSearchMode) {
        appState.map.panTo({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      }
    }, null, LOCATION_OPTIONS);
  }

  function renderRoute(route, destName) {
    if (!route?.legs?.[0]) return;
    const leg = route.legs[0];
    const title = appState.pointSearchMode ? `🚩 指定地点へ` : (destName || '目的地');

    setText('destinationName', title);
    setText('routeDistance', leg.distance?.text || '--');
    setText('routeTime', `徒歩 ${leg.duration?.text || '--'}`);

    const list = getEl('navPanelInstructions');
    if (list) {
      list.innerHTML = '';
      (leg.steps || []).forEach(s => {
        const d = document.createElement('div');
        d.className = 'nav-instruction-item';
        d.textContent = (s.html_instructions || '').replace(/<[^>]+>/g, '') + (s.distance?.text ? ` (${s.distance.text})` : '');
        list.appendChild(d);
      });
    }
    setDisplay('instructionsSection', 'block');
    if (appState.currentPolyline) appState.currentPolyline.setMap(null);
    if (google.maps.geometry && route.overview_polyline?.points) {
      appState.currentPolyline = new google.maps.Polyline({
        path: google.maps.geometry.encoding.decodePath(route.overview_polyline.points),
        map: appState.map,
        strokeColor: '#62b5ff',
        strokeWeight: 6
      });
    }
    
    // v83 Fix: Route rendering should strictly follow polyline bounds
    const b = new google.maps.LatLngBounds();
    // Start and End
    b.extend(leg.start_location);
    b.extend(leg.end_location);
    // Fit bounds to show route
    if (appState.map) appState.map.fitBounds(b, { padding: 50 });
    
    setDisplay('routeInfoSection', 'block');
  }

  async function startNavigation(dest) {
    if (!appState.currentPos) return alert("現在地が取得できていません");
    
    // v83: データ検証。lat/lngが無い場合は弾く
    if (!dest || typeof dest.lat !== 'number' || typeof dest.lng !== 'number') {
      return alert("エラー: 目的地の座標が不正です");
    }

    const finalDestName = dest.name || '選択した場所';
    
    let originLat, originLng;
    if (appState.pointSearchMode && appState.searchPoint) {
      originLat = appState.searchPoint.lat;
      originLng = appState.searchPoint.lng;
    } else {
      originLat = appState.currentPos.lat;
      originLng = appState.currentPos.lng;
    }
    
    appState.currentDestination = dest;
    appState.isNavigating = true;
    
    const panel = getEl('searchPanel');
    if (panel) { panel.classList.add('collapsed'); panel.classList.add('hidden-force'); }
    restoreFabLabels();
    updateFabVisibility();
    
    const fabNav = getEl('btnNavFab');
    const fabSearch = getEl('btnSearchFab');
    if (fabSearch) fabSearch.style.display = 'none';
    if (fabNav) fabNav.style.display = 'flex';
    
    setDisplay('routeControlSection', 'block');
    setDisplay('results', 'none');
    switchPanelTab('nav');

    try {
      const resp = await fetchWithRetry(`${WORKER_ORIGIN}/directions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin: `${originLat},${originLng}`,
          destination: `${dest.lat},${dest.lng}`,
          mode: 'walking',
          language: 'ja'
        })
      });
      const json = await resp.json();
      if(!json.routes || json.routes.length === 0) throw new Error("ルートが見つかりません");

      let chosen = { route: json.routes[0], index: 0 };
      if (window.RouteEvaluator?.pickBestRoute) chosen = window.RouteEvaluator.pickBestRoute(json.routes, appState.userProfile, appState.aiMode);
      
      appState.currentRouteData = { routes: json.routes, selectedIndex: chosen.index };
      renderRoute(chosen.route, finalDestName);
      startLocationWatcher();
    } catch (e) {
      alertOnce('route_err', 'ルート取得失敗: ' + e.message);
      stopNavigation();
    }
  }

  function stopNavigation() {
    // v83 Fix: Stop watching but don't clear map center immediately
    if (appState.locationWatchId) navigator.geolocation.clearWatch(appState.locationWatchId);
    appState.locationWatchId = null;
    appState.isNavigating = false;
    
    if (appState.currentPolyline) appState.currentPolyline.setMap(null);
    
    const panel = getEl('searchPanel');
    if (panel) panel.classList.remove('hidden-force');
    restoreFabLabels();
    updateFabVisibility();
    
    if(getEl('btnSearchFab')) getEl('btnSearchFab').style.display = 'flex';
    setDisplay('routeControlSection', 'none');
    setDisplay('instructionsSection', 'none');
    setDisplay('routeInfoSection', 'none');
    switchPanelTab('search');
    openPanel();
    
    // v83 Fix: 終了時に現在地へ戻り、ズームレベルを歩行用にリセット(16)
    if (appState.currentPos && appState.map) {
      appState.map.panTo(appState.currentPos);
      appState.map.setZoom(16);
    }
  }

  function setSearchRadius(km) {
    appState.searchRadiusMeters = km * 1000;
    ['r5', 'r10', 'r20'].forEach(id => {
      const el = getEl(id);
      if(el) el.classList.toggle('active', id === 'r' + km);
    });
    setText('radiusLabel', km + 'km');
  }

  function bindUI() {
    const btnSearchFab = getEl('btnSearchFab');
    const btnLocateFab = getEl('btnLocateFab');
    const btnNavFab = getEl('btnNavFab');
    const btnSettingsFab = getEl('btnSettingsFab');
    const btnStopFab = getEl('btnStopFab');

    if (btnSearchFab) btnSearchFab.onclick = () => togglePanelFromFab('search', 'btnSearchFab');
    if (btnSettingsFab) btnSettingsFab.onclick = () => togglePanelFromFab('settings', 'btnSettingsFab');
    if (btnNavFab) btnNavFab.onclick = () => togglePanelFromFab('nav', 'btnNavFab');
    if (btnLocateFab) btnLocateFab.onclick = acquireLocation;
    if (btnStopFab) btnStopFab.onclick = stopNavigation;

    const btnCamera = getEl('btnCamera');
    const cameraInput = getEl('cameraInput');
    if (btnCamera && cameraInput) {
      btnCamera.onclick = () => cameraInput.click();
      cameraInput.onchange = handleCameraInput;
    }

    if(getEl('btnSearchStation')) getEl('btnSearchStation').onclick = () => quickSearch('駅');
    if(getEl('btnSearchBus')) getEl('btnSearchBus').onclick = () => quickSearch('バス停');
    if(getEl('btnSearchTaxi')) getEl('btnSearchTaxi').onclick = () => quickSearch('タクシー乗り場');
    if(getEl('btnSearchToilet')) getEl('btnSearchToilet').onclick = () => quickSearch('公衆トイレ コンビニ');
    if(getEl('btnSearchConv')) getEl('btnSearchConv').onclick = () => quickSearch('コンビニ');
    if(getEl('btnSearchWifi')) getEl('btnSearchWifi').onclick = () => quickSearch('Free Wi-Fi');

    if(getEl('r5')) getEl('r5').onclick = () => setSearchRadius(5);
    if(getEl('r10')) getEl('r10').onclick = () => setSearchRadius(10);
    if(getEl('r20')) getEl('r20').onclick = () => setSearchRadius(20);

    if (getEl('btnOpenEditModal')) getEl('btnOpenEditModal').onclick = openEditModal;
    const ph = document.querySelector('.panel-handle-area');
    if (ph) ph.onclick = togglePanel;

    if (getEl('btnSearchIcon')) getEl('btnSearchIcon').onclick = () => {
        const q = getEl('q');
        if(!q) return;
        let lat = appState.currentPos ? appState.currentPos.lat : 0;
        let lng = appState.currentPos ? appState.currentPos.lng : 0;
        placesTextSearch(q.value, lat, lng).then(d => displayResults(d.places || []));
    };

    if (getEl('btnSaveCurrent')) getEl('btnSaveCurrent').onclick = handleSaveCurrentLocation;
    if (getEl('btnSaveEdits')) getEl('btnSaveEdits').onclick = saveEditModalChanges;
    if (getEl('btnCancelEdit')) getEl('btnCancelEdit').onclick = closeEditModal;
    
    bindPanelHeaderTabs();
    updateFabVisibility();
    restoreFabLabels();
  }

  function changeMapMode(mode) {
    localStorage.setItem(MAP_MODE_KEY, mode);
    appState.mapMode = mode;
    if (appState.map) {
      appState.map.setMapTypeId(
        mode === 'photo' ? google.maps.MapTypeId.SATELLITE :
        mode === '3d' ? google.maps.MapTypeId.HYBRID :
        google.maps.MapTypeId.ROADMAP
      );
      appState.map.setTilt(mode === '3d' ? 45 : 0);
    }
    ['btnMapPhoto', 'btnMapRoadmap', 'btnMap3D'].forEach(id => {
      const el = getEl(id);
      if(el) el.classList.toggle('active', el.dataset.mode === mode);
    });
  }

  async function placesTextSearch(query, lat, lng) {
    const payload = {
      textQuery: query,
      locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: appState.searchRadiusMeters } },
      languageCode: 'ja'
    };
    try {
      const resp = await fetchWithRetry(`${WORKER_ORIGIN}/places:searchText`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-FieldMask': DEFAULT_MASK },
        body: JSON.stringify(payload)
      });
      if (!resp.ok) throw new Error('Worker Error');
      return await resp.json();
    } catch (e) { return {}; }
  }

  /* === v83 Fix: Display Results with Auto-Zoom Bounds === */
  async function displayResults(places) {
    const div = getEl('results');
    if (!div) return;
    div.innerHTML = '';
    setDisplay('results', 'block');
    
    appState.searchMarkers.forEach(m => m.map = null);
    appState.searchMarkers = [];
    appState.searchInfoWindows.forEach(w => w.close());
    appState.searchInfoWindows = [];

    const { AdvancedMarkerElement } = await google.maps.importLibrary("marker");
    // v83 Fix: Create bounds to fit all markers
    const bounds = new google.maps.LatLngBounds();
    // Add current position to bounds so the user knows where they are relative to results
    if (appState.currentPos) bounds.extend(appState.currentPos);

    places.slice(0, 5).forEach((p, i) => {
      // 1. List Item
      const item = document.createElement('div');
      item.className = 'result-item';
      item.innerHTML = `<div>${i + 1}. ${p.displayName?.text}</div><div style="font-size:0.8em;opacity:0.7">${p.formattedAddress || ''}</div>`;
      
      // Explicit data passing for navigation
      const destData = {
        name: p.displayName?.text || '名称不明',
        lat: p.location.latitude,
        lng: p.location.longitude
      };

      item.onclick = () => {
        startNavigation(destData);
      };
      div.appendChild(item);

      // 2. Marker
      const markerContent = document.createElement('div');
      markerContent.className = 'marker-container';
      markerContent.innerHTML = `
        <div class="marker-pin">${i + 1}</div>
        <div class="marker-label">${p.displayName?.text || '名称不明'}</div>
      `;

      const m = new AdvancedMarkerElement({
        map: appState.map,
        position: { lat: p.location.latitude, lng: p.location.longitude },
        content: markerContent,
        title: p.displayName?.text
      });

      // Extend bounds to include this marker
      bounds.extend({ lat: p.location.latitude, lng: p.location.longitude });

      m.addListener('click', () => {
        startNavigation(destData);
      });

      appState.searchMarkers.push(m);
    });

    // v83 Fix: Auto zoom to show all results + current pos
    if (appState.map && !bounds.isEmpty()) {
      appState.map.fitBounds(bounds, { padding: 50 });
    }

    const panelBody = getEl('panelScrollContainer');
    if(panelBody && div) {
      setTimeout(() => {
        openPanel();
        div.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
  }

  function startApp() {
    console.log('[WalkNav] Starting v83 (Fix: Destination Bug & Zoom)...');
    loadUserProfile();
    loadSavedLocations();
    bindUI();
    renderSavedLocations();
    appState.mapMode = localStorage.getItem(MAP_MODE_KEY) || 'roadmap';
    switchPanelTab('search');
    acquireLocation();
  }

  function initializeWhenReady() {
    if (typeof google !== 'undefined' && google.maps && google.maps.Map) {
      startApp();
    } else {
      setTimeout(initializeWhenReady, 200);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeWhenReady);
  else initializeWhenReady();
}
