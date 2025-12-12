'use strict';

// WalkNav app.js - v74: Unified panel control + FAB "Close" hint + Map ID enforced

const ISSUE_ID = 'idx20251213_v74_unified_panel_close_hint';

const API_KEY = 'AIzaSyBuX-4y1Cgl6jdKcHZWWlsoosDWK_RGqF0';
const WORKER_ORIGIN = 'https://ors-proxy.miyata-connect-jp.workers.dev';

/**
 * Map ID must be used.
 * 優先順位: window.WALKNAV_MAP_ID -> localStorage('walknav_map_id') -> fallback文字列
 * ※fallbackは「未設定」であることが明確な値（削除禁止のため常に指定は維持）
 */
const MAP_ID_KEY = 'walknav_map_id';
const MAP_ID = (window.WALKNAV_MAP_ID || localStorage.getItem(MAP_ID_KEY) || 'REPLACE_WITH_YOUR_MAP_ID');

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
    userMarkerElement: null,
    currentPos: null,
    pointSearchMode: false,
    searchPoint: null,
    searchPointMarker: null,
    mapInitialized: false,
    searchMarkers: [],
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

  function getEl(id) {
    return document.getElementById(id);
  }

  function setDisplay(id, displayVal) {
    const el = getEl(id);
    if (el) el.style.display = displayVal;
  }

  function setText(id, text) {
    const el = getEl(id);
    if (el) el.textContent = text;
  }

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

  /* === FAB Label Control === */
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

  /* === FAB Visibility Control (Always Show) === */
  function updateFabVisibility() {
    const fab = getEl('fabStack');
    if (fab) {
      fab.classList.remove('initial-hidden');
      fab.style.display = 'flex';
      fab.style.visibility = 'visible';
      fab.style.opacity = '1';
    }
  }

  /* === Panel Logic === */
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

  /**
   * v74: 統一されたFAB->パネル制御
   * - 1回目: 開く + 指定タブへ + 押したボタンだけ「閉じる」
   * - 2回目（同じボタンで同じタブ & パネル開状態）: 閉じる + ラベル復帰
   */
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
  }

  function saveLocations() {
    try {
      localStorage.setItem(SAVED_LOCATIONS_KEY, JSON.stringify(appState.savedLocations));
    } catch (_) {}
    renderSavedLocations();
  }

  function addSavedLocation(name, lat, lng, address) {
    appState.savedLocations.push({ name, lat, lng, address });
    saveLocations();
    alert('保存しました: ' + name);
  }

  function renderSavedLocations() {
    let listContainer = getEl('savedSectionContainer');
    if (!listContainer) return;
    listContainer.innerHTML = '';
    const section = document.createElement('div');
    section.className = 'saved-section';
    section.innerHTML = `<div class="nav-section-title">📂 保存した場所</div><div id="savedLocationsList"></div>`;
    listContainer.appendChild(section);
    const listEl = section.querySelector('#savedLocationsList');
    if (appState.savedLocations.length === 0) {
      listEl.innerHTML = '<div style="font-size:12px; color:#888; text-align:center;">保存された場所はありません</div>';
      return;
    }
    appState.savedLocations.forEach((loc) => {
      const item = document.createElement('div');
      item.className = 'saved-item';
      item.innerHTML = `
        <div class="saved-info">
          <div class="saved-name">${loc.name}</div>
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

  /* === Edit Modal Logic === */
  function openEditModal() {
    const modal = getEl('editSavedModal');
    const list = getEl('editModalList');
    if (!modal || !list) return;
    list.innerHTML = '';
    if (appState.savedLocations.length === 0) {
      list.innerHTML = '<div style="text-align:center; color:#888; margin-top:20px;">保存された場所はありません</div>';
    } else {
      appState.savedLocations.forEach((loc, idx) => {
        const latVal = Number(loc.lat || 0);
        const lngVal = Number(loc.lng || 0);
        const latStr = latVal.toFixed(6);
        const lngStr = lngVal.toFixed(6);
        const item = document.createElement('div');
        item.className = 'edit-list-item';
        item.innerHTML = `
          <div class="edit-item-inputs">
            <input type="text" class="edit-input-name" value="${loc.name}" data-idx="${idx}">
            <div class="edit-text-addr">${loc.address || '住所不明'}</div>
            <div class="edit-text-coords">📍 ${latStr}, ${lngStr}</div>
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
          newLocations.push({
            name: newName,
            lat: original.lat,
            lng: original.lng,
            address: original.address
          });
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

  /* === Cloudflare Proxy Calls === */
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
      if (!resp.ok) throw new Error(`Proxy Error: ${resp.status}`);
      return await resp.json();
    } catch (e) {
      console.error('Weather Proxy failed', e);
      return null;
    }
  }
  async function fetchCurrentWeather(lat, lng) { return fetchWeatherProxy('weather', lat, lng); }
  async function fetchForecast(lat, lng) { return fetchWeatherProxy('forecast', lat, lng); }

  async function fetchAddressNominatim(lat, lng) {
    try {
      const resp = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`);
      if (!resp.ok) return '住所不明';
      const data = await resp.json();
      return data.display_name || '現在地';
    } catch (e) {
      return '現在地';
    }
  }

  function buildWeatherHtml(current, forecast) {
    if (!current) return '<div style="font-size:12px;color:#888;padding:8px;">☁️ 天気情報取得中...</div>';
    const curIcon = `https://openweathermap.org/img/wn/${current.weather[0].icon}@2x.png`;
    const curTemp = Math.round(current.main.temp);
    const curDesc = current.weather[0].description;
    let curPop = 0;
    if (forecast && forecast.list && forecast.list[0]) curPop = Math.round(forecast.list[0].pop * 100);

    let forecastItemsHtml = '';
    if (forecast && forecast.list) {
      for (let i = 1; i <= 3; i++) {
        const item = forecast.list[i];
        if (item) {
          const fTime = `${i * 3}時間後`;
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
    const [current, forecast] = await Promise.all([fetchCurrentWeather(lat, lng), fetchForecast(lat, lng)]);
    appState.cachedWeatherData = { current, forecast };
    const html = buildWeatherHtml(current, forecast);

    const searchPane = getEl('tabPaneSearch');
    if (searchPane) {
      let wEl = getEl('weatherDisplaySearch');
      if (!wEl) {
        wEl = document.createElement('div');
        wEl.id = 'weatherDisplaySearch';
        const savedContainer = getEl('savedSectionContainer');
        if (savedContainer && savedContainer.parentNode === searchPane) {
          searchPane.insertBefore(wEl, savedContainer.nextSibling);
        } else {
          searchPane.appendChild(wEl);
        }
      }
      wEl.innerHTML = html;
      wEl.style.display = 'block';
    }

    const navPane = getEl('tabPaneNav');
    if (navPane) {
      let wEl = getEl('weatherDisplayNav');
      if (!wEl) {
        wEl = document.createElement('div');
        wEl.id = 'weatherDisplayNav';
        const locInfo = navPane.querySelector('.location-info');
        if (locInfo && locInfo.parentNode) {
          locInfo.parentNode.insertBefore(wEl, locInfo.nextSibling);
        }
      }
      wEl.innerHTML = html;
      wEl.style.display = 'block';
    }

    return current ? { desc: current.weather[0].description, temp: Math.round(current.main.temp) } : { desc: null, temp: null };
  }

  function handleVoiceInput() {
    if (!('webkitSpeechRecognition' in window)) {
      alert('このブラウザは音声入力に対応していません');
      return;
    }
    const recognition = new webkitSpeechRecognition();
    recognition.lang = 'ja-JP';
    recognition.start();
    recognition.onstart = function() {
      const q = getEl('q');
      if (q) q.placeholder = '聞いています...';
    };
    recognition.onend = function() {
      const q = getEl('q');
      if (q) q.placeholder = '店舗名・電話番号・住所・座標など';
    };
    recognition.onresult = function(event) {
      const transcript = event.results[0][0].transcript;
      const q = getEl('q');
      if (q) {
        q.value = transcript;
        const iconBtn = getEl('btnSearchIcon');
        if (iconBtn) iconBtn.click();
      }
    };
  }

  function handleShareLocation() {
    let textBody, url;

    if (appState.isNavigating && appState.currentRouteData && appState.currentDestination) {
      const dest = appState.currentDestination;
      const route = appState.currentRouteData.routes?.[appState.currentRouteData.selectedIndex || 0];
      const leg = route?.legs?.[0];

      if (!leg) {
        alertOnce('share_err', 'ルート情報がありません');
        return;
      }

      const startAddr = leg.start_address ? leg.start_address.replace(/^日本、\s*/, '') : '指定地点';
      textBody = `🏁 ルート共有 (WalkNav)\n出発: ${startAddr}\n到着: ${dest.name}\n🚶 徒歩: ${leg.duration.text} (${leg.distance.text})`;

      const startLoc = leg.start_location;
      const endLoc = leg.end_location;
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
      alertOnce('share_err', '位置情報がありません');
      return;
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
    const payload = {
      textQuery: query,
      locationBias: {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius: appState.searchRadiusMeters
        }
      },
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
    } catch (e) {
      console.warn('Search failed', e);
      return {};
    }
  }

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
        if (!json) {
          sec.style.display = 'none';
          return;
        }
        const parts = [];
        if (json.traffic?.length) parts.push('交通:' + json.traffic.map(x => x.title).join(','));
        if (json.events?.length) parts.push('事故:' + json.events.map(x => x.title).join(','));
        if (json.weather?.length) parts.push('気象:' + json.weather.map(x => x.title).join(','));
        sec.style.display = 'block';
        box.textContent = parts.length ? parts.join(' / ') : '周辺の特筆すべきインシデントはありません';
      }
    } catch (_) {}
  }

  function initMap(center) {
    if (appState.map) {
      appState.map.setCenter(center);
      return;
    }
    const mapEl = getEl('map');
    if (!mapEl) return;

    try {
      if (!MAP_ID || MAP_ID === 'REPLACE_WITH_YOUR_MAP_ID') {
        console.warn('[WalkNav] MAP_ID is not configured. Map ID is still applied as required:', MAP_ID);
      }

      appState.map = new google.maps.Map(mapEl, {
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
      console.log('[WalkNav] Map initialized v74 (Map ID enforced)');
    } catch (e) {
      console.warn('Map Init Failed', e);
    }
  }

  function setUserMarker(lat, lng) {
    appState.currentPos = { lat, lng };
    if (!appState.map) return;

    if (!appState.userMarker) {
      appState.userMarker = new google.maps.Marker({
        map: appState.map,
        position: { lat, lng },
        zIndex: 1000,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 10,
          fillColor: "#3aa0ff",
          fillOpacity: 1,
          strokeWeight: 2,
          strokeColor: "white"
        }
      });
    } else {
      appState.userMarker.setPosition({ lat, lng });
    }
  }

  function setSearchPoint(lat, lng) {
    appState.searchPoint = { lat, lng };
    if (!appState.map) return;

    if (appState.searchPointMarker) {
      appState.searchPointMarker.setMap(null);
      appState.searchPointMarker = null;
    }

    appState.searchPointMarker = new google.maps.Marker({
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
    fetchIncidentsAround(lat, lng);

    const actionRow = document.querySelector('#pointAddressBlock + .action-buttons-row');
    if (actionRow && !getEl('btnSavePoint')) {
      const btn = document.createElement('button');
      btn.id = 'btnSavePoint';
      btn.className = 'btn btn-outline';
      btn.style.borderColor = '#d97706';
      btn.style.color = '#d97706';
      btn.textContent = '⭐ 保存';
      btn.type = 'button';
      btn.onclick = handleSavePointLocation;
      actionRow.appendChild(btn);
    }
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
      fetchIncidentsAround(latitude, longitude);
    }, () => {
      getEl('loading')?.remove();
      const def = { lat: 35.0, lng: 135.0 };
      if (!appState.mapInitialized) initMap(def);
      setUserMarker(def.lat, def.lng);
      setText('locAddress', '取得失敗');
      updateAllWeatherUI(def.lat, def.lng);
    }, LOCATION_OPTIONS);
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
    const title = appState.pointSearchMode ? `🚩 出発: ${startName}\n🏁 到着: ${destName}` : (destName || '目的地');

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

    const b = new google.maps.LatLngBounds();
    if (appState.currentPos) b.extend(appState.currentPos);
    if (leg.end_location) b.extend(leg.end_location);
    if (leg.start_location) b.extend(leg.start_location);

    if (appState.map) appState.map.fitBounds(b, { padding: 50 });

    setDisplay('routeInfoSection', 'block');
    if (appState.cachedWeatherData?.current && appState.currentPos) {
      updateAllWeatherUI(appState.currentPos.lat, appState.currentPos.lng);
    }
  }

  async function startNavigation(dest) {
    if (!appState.currentPos) return;

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
    if (panel) {
      panel.classList.add('collapsed');
      panel.classList.add('hidden-force');
    }
    restoreFabLabels();
    updateFabVisibility();

    const fabSearch = getEl('btnSearchFab');
    const fabLocate = getEl('btnLocateFab');
    const fabSettings = getEl('btnSettingsFab');
    const fabNav = getEl('btnNavFab');
    const fabShare = getEl('btnShareFab');
    const fabDest = getEl('btnDestFab');
    const fabStop = getEl('btnStopFab');

    if (fabSearch) fabSearch.style.display = 'none';
    if (fabLocate) fabLocate.style.display = 'none';
    if (fabSettings) fabSettings.style.display = 'none';
    if (fabNav) fabNav.style.display = 'flex';
    if (fabShare) fabShare.style.display = 'flex';
    if (fabDest) fabDest.style.display = 'flex';
    if (fabStop) fabStop.style.display = 'flex';

    setDisplay('routeControlSection', 'block');
    setDisplay('results', 'none');

    switchPanelTab('nav');

    if (appState.map) {
      appState.map.panTo({ lat: dest.lat, lng: dest.lng });
      appState.map.setZoom(18);
    }

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
      let chosen = { route: json.routes[0], index: 0 };
      if (window.RouteEvaluator?.pickBestRoute) chosen = window.RouteEvaluator.pickBestRoute(json.routes, appState.userProfile, appState.aiMode);

      appState.currentRouteData = { routes: json.routes, selectedIndex: chosen.index };
      renderRoute(chosen.route, dest.name);

      startLocationWatcher();
      fetchIncidentsAround(dest.lat, dest.lng);
    } catch (e) {
      alertOnce('route_err', 'ルート取得失敗');
      stopNavigation();
    }
  }

  function stopNavigation() {
    if (appState.locationWatchId) navigator.geolocation.clearWatch(appState.locationWatchId);
    appState.isNavigating = false;

    if (appState.currentPolyline) appState.currentPolyline.setMap(null);

    const panel = getEl('searchPanel');
    if (panel) {
      panel.classList.remove('hidden-force');
    }

    restoreFabLabels();
    updateFabVisibility();

    const fabSearch = getEl('btnSearchFab');
    const fabLocate = getEl('btnLocateFab');
    const fabSettings = getEl('btnSettingsFab');
    const fabNav = getEl('btnNavFab');
    const fabShare = getEl('btnShareFab');
    const fabDest = getEl('btnDestFab');
    const fabStop = getEl('btnStopFab');

    if (fabSearch) fabSearch.style.display = 'flex';
    if (fabLocate) fabLocate.style.display = 'flex';
    if (fabSettings) fabSettings.style.display = 'flex';
    if (fabNav) fabNav.style.display = 'flex';
    if (fabShare) fabShare.style.display = 'flex';
    if (fabDest) fabDest.style.display = 'none';
    if (fabStop) fabStop.style.display = 'none';

    setDisplay('routeControlSection', 'none');
    setDisplay('instructionsSection', 'none');
    setDisplay('routeInfoSection', 'none');

    switchPanelTab('search');
    openPanel();

    if (appState.currentPos && appState.map) {
      appState.map.panTo(appState.currentPos);
      appState.map.setZoom(17);
    }
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
      if (!el) return;
      el.classList.toggle('active', el.dataset.mode === mode);
    });
  }

  function bindPanelHeaderTabs() {
    document.querySelectorAll('.tab-btn[data-panel-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-panel-tab') || 'search';
        if (isPanelHiddenForce()) return;

        const open = isPanelOpen();
        const active = getActiveTabNameFromDOM();

        if (open && active === tab) {
          collapsePanel();
          return;
        }

        switchPanelTab(tab);
        openPanel();
        restoreFabLabels();
      });
    });
  }

  function bindUI() {
    const btnSearchFab = getEl('btnSearchFab');
    const btnLocateFab = getEl('btnLocateFab');
    const btnDestFab = getEl('btnDestFab');
    const btnSettingsFab = getEl('btnSettingsFab');
    const btnNavFab = getEl('btnNavFab');
    const btnShareFab = getEl('btnShareFab');
    const btnStopFab = getEl('btnStopFab');

    if (btnSearchFab) btnSearchFab.onclick = () => togglePanelFromFab('search', 'btnSearchFab');
    if (btnSettingsFab) btnSettingsFab.onclick = () => togglePanelFromFab('settings', 'btnSettingsFab');
    if (btnNavFab) btnNavFab.onclick = () => togglePanelFromFab('nav', 'btnNavFab');

    if (btnLocateFab) btnLocateFab.onclick = acquireLocation;

    if (btnDestFab) {
      btnDestFab.onclick = () => {
        if (appState.currentDestination && appState.map) {
          appState.map.panTo({ lat: appState.currentDestination.lat, lng: appState.currentDestination.lng });
          appState.map.setZoom(19);
        }
      };
    }

    if (btnShareFab) btnShareFab.onclick = handleShareLocation;
    if (btnStopFab) btnStopFab.onclick = stopNavigation;

    const btnNew = getEl('btnOpenEditModal');
    if (btnNew) btnNew.onclick = openEditModal;

    const ph = document.querySelector('.panel-handle-area');
    if (ph) ph.onclick = togglePanel;

    const addrBlock = getEl('pointAddressBlock');
    let pressTimer;
    if (addrBlock) {
      addrBlock.addEventListener('touchstart', function() {
        pressTimer = setTimeout(function() {
          const coords = getEl('pointCoords')?.textContent || '';
          if (coords && navigator.clipboard) {
            navigator.clipboard.writeText(coords.replace(/^Lat:\s*/, '').replace(/,\s*Lng:\s*/, ',')).then(() => {
              alert('座標をコピーしました');
            });
          }
        }, 800);
      });
      addrBlock.addEventListener('touchend', function() {
        clearTimeout(pressTimer);
      });
    }

    if (getEl('btnVoiceInput')) getEl('btnVoiceInput').onclick = handleVoiceInput;

    const q = getEl('q');
    if (getEl('btnSearchIcon')) getEl('btnSearchIcon').onclick = () => {
      if (!q) return;

      let lat, lng;
      if (appState.pointSearchMode && appState.searchPoint) {
        lat = appState.searchPoint.lat;
        lng = appState.searchPoint.lng;
      } else if (appState.currentPos) {
        lat = appState.currentPos.lat;
        lng = appState.currentPos.lng;
      } else {
        alertOnce('no_pos_search', '現在地がありません');
        return;
      }

      placesTextSearch(q.value, lat, lng).then(d => displayResults(d.places || []));
    };

    if (q) q.onkeypress = (e) => {
      if (e.key === 'Enter') getEl('btnSearchIcon')?.click();
    };

    if (getEl('btnReset')) getEl('btnReset').onclick = () => {
      if (q) q.value = '';
      setDisplay('results', 'none');

      appState.pointSearchMode = false;
      const ps = getEl('btnPointSearch');
      if (ps) {
        ps.textContent = '📍 ポイント選択';
        ps.classList.remove('active');
      }

      appState.searchPoint = null;
      if (appState.searchPointMarker) {
        appState.searchPointMarker.setMap(null);
        appState.searchPointMarker = null;
      }
      setText('pointAddress', '');
      setText('pointCoords', '');
      setDisplay('pointAddressBlock', 'none');

      openPanel();
      restoreFabLabels();
    };

    if (getEl('btnLocatePanel')) getEl('btnLocatePanel').onclick = acquireLocation;
    if (getEl('btnClosePanel')) getEl('btnClosePanel').onclick = collapsePanel;
    if (getEl('btnStopRoute')) getEl('btnStopRoute').onclick = stopNavigation;

    if (getEl('btnSaveCurrent')) getEl('btnSaveCurrent').onclick = handleSaveCurrentLocation;

    [10, 20, 30].forEach(d => {
      const el = getEl(`r${d}`);
      if (!el) return;
      el.onclick = () => {
        appState.searchRadiusMeters = d * 1000;
        setText('radiusLabel', `${d}km`);
        document.querySelectorAll('.distance-chips-row .chip').forEach(c => c.classList.remove('active'));
        el.classList.add('active');
      };
    });

    if (getEl('btnPointSearch')) getEl('btnPointSearch').onclick = () => {
      appState.pointSearchMode = !appState.pointSearchMode;
      const b = getEl('btnPointSearch');
      if (b) {
        b.textContent = appState.pointSearchMode ? '📍 選択中...' : '📍 ポイント選択';
        b.classList.toggle('active', appState.pointSearchMode);
      }

      if (!appState.pointSearchMode) {
        appState.searchPoint = null;
        if (appState.searchPointMarker) {
          appState.searchPointMarker.setMap(null);
          appState.searchPointMarker = null;
        }
        setText('pointAddress', '');
        setText('pointCoords', '');
        setDisplay('pointAddressBlock', 'none');
      }
    };

    ['btnMapPhoto', 'btnMapRoadmap', 'btnMap3D'].forEach(id => {
      const el = getEl(id);
      if (!el) return;
      el.onclick = () => changeMapMode(el.dataset.mode);
    });

    if (getEl('btnCancelEdit')) getEl('btnCancelEdit').onclick = closeEditModal;
    if (getEl('btnSaveEdits')) getEl('btnSaveEdits').onclick = saveEditModalChanges;

    bindPanelHeaderTabs();
    updateFabVisibility();
    restoreFabLabels();
  }

  function displayResults(places) {
    const div = getEl('results');
    if (!div) return;

    div.innerHTML = '';
    setDisplay('results', 'block');
    setDisplay('instructionsSection', 'none');

    appState.searchMarkers.forEach(m => {
      if (m.setMap) m.setMap(null);
    });
    appState.searchMarkers = [];

    places.slice(0, 5).forEach((p, i) => {
      const item = document.createElement('div');
      item.className = 'result-item';
      item.innerHTML = `<div>${i + 1}. ${p.displayName?.text || '名称不明'}</div><div style="font-size:0.8em;opacity:0.7">${p.formattedAddress || ''}</div>`;
      item.onclick = () => startNavigation({
        name: p.displayName?.text,
        lat: p.location.latitude,
        lng: p.location.longitude
      });
      div.appendChild(item);

      const m = new google.maps.Marker({
        map: appState.map,
        position: { lat: p.location.latitude, lng: p.location.longitude },
        label: String(i + 1),
        title: p.displayName?.text
      });
      appState.searchMarkers.push(m);
    });
  }

  function startApp() {
    console.log('[WalkNav] Starting v74 (Unified Panel + Close Hint + Map ID enforced)...');
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
