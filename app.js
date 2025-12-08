'use strict';

/**
 * WalkNav app.js - Final Fix v4
 * * Resolved Issues:
 * 1. Fixed Merge Conflict markers (Syntax Error).
 * 2. Removed `mapId: 'DEMO_MAP'` to fix the "Huge G" / gray map issue.
 * 3. Added fallback `setUserMarker` in `acquireLocation` to ensure search works even if GPS fails.
 * 4. Consolidated UI fixes (scrollable results, horizontal chip row).
 * 5. Integrated MVP features (RouteEvaluator connection, User Profile).
 */

const ISSUE_ID = 'idx20251208_force_fix_conflict_resolution';
const API_KEY = 'AIzaSyBuX-4y1Cgl6jdKcHZWWlsoosDWK_RGqF0';
const WORKER_ORIGIN = 'https://ors-proxy.miyata-connect-jp.workers.dev';
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

/* =========================
   Global State & Helpers
   ========================= */
const WN = (window.__WN_GLOBAL__ = window.__WN_GLOBAL__ || {
    booted: false,
    locks: Object.create(null),
    alerts: Object.create(null),
    styles: Object.create(null)
});

function lock(key, ms) {
    const now = Date.now();
    const until = WN.locks[key] || 0;
    if (now < until) return false;
    WN.locks[key] = now + ms;
    return true;
}

function alertOnce(key, msg, ms = 1200) {
    const now = Date.now();
    const last = WN.alerts[key] || 0;
    if (now - last < ms) return;
    WN.alerts[key] = now;
    alert(msg);
}

function injectStyleOnce(key, cssText) {
    if (WN.styles[key]) return;
    WN.styles[key] = true;
    const style = document.createElement('style');
    style.id = `wn-style-${key}`;
    style.textContent = cssText;
    document.head.appendChild(style);
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
        currentDestination: null,
        currentPolyline: null,
        recognition: null,
        isPaused: false,
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
        editingLocationIndex: null,
        isEditDialogOpen: false,
        mapMode: 'roadmap',
        searchInFlight: false,
        searchRadiusMeters: 10000
    };

    function getEl(id) { return document.getElementById(id); }

    function setDisplay(id, displayVal) {
        const el = getEl(id);
        if (el) el.style.display = displayVal;
    }

    function setText(id, text) {
        const el = getEl(id);
        if (el) el.textContent = text;
    }

    function safeRemove(el) {
        try { if (el && el.parentNode) el.parentNode.removeChild(el); } catch (_) { }
    }

    /* =========================
       UI Fixes
       ========================= */
    function applyUiFixes() {
        injectStyleOnce('panel_fixes', `
            #searchPanel { max-height: 50vh !important; height: 50vh !important; overflow: hidden !important; }
            #tabPaneSearch, #tabPaneNav, #tabPaneSettings { height: 100% !important; overflow: hidden !important; }
            #q, input#q { margin-bottom: 12px !important; }
            #results, #navPanelInstructions { overflow-y: auto !important; -webkit-overflow-scrolling: touch !important; }
            .wn-chip-row { display: flex !important; gap: 10px !important; align-items: center !important; overflow-x: auto !important; padding: 4px 2px 10px !important; margin: 0 0 6px !important; }
            .wn-chip-row > * { flex: 0 0 auto !important; white-space: nowrap !important; }
        `);

        buildSearchChipRow();
        updateScrollableHeights();
        window.addEventListener('resize', () => updateScrollableHeights(), { passive: true });
    }

    function buildSearchChipRow() {
        const r10 = getEl('r10');
        const r20 = getEl('r20');
        const r30 = getEl('r30');
        const btnPoint = getEl('btnPointSearch');
        if (!r10 || !r20 || !r30 || !btnPoint || getEl('wnChipRow')) return;

        const row = document.createElement('div');
        row.id = 'wnChipRow';
        row.className = 'wn-chip-row';
        const parent = r10.parentElement;
        if(parent) {
            parent.parentElement.insertBefore(row, parent);
            row.appendChild(r10);
            row.appendChild(r20);
            row.appendChild(r30);
            row.appendChild(btnPoint);
        }
    }

    function updateScrollableHeights() {
        const panel = getEl('searchPanel');
        const results = getEl('results');
        if (!panel || !results) return;
        const panelRect = panel.getBoundingClientRect();
        const resRect = results.getBoundingClientRect();
        const available = Math.floor(panelRect.bottom - resRect.top - 10);
        if (available > 80) {
            results.style.maxHeight = `${available}px`;
        }
    }

    /* =========================
       Data Persistence
       ========================= */
    function loadSavedLocations() {
        try {
            const saved = localStorage.getItem(SAVED_LOCATIONS_KEY);
            appState.savedLocations = saved ? JSON.parse(saved) : [];
            if (!Array.isArray(appState.savedLocations)) appState.savedLocations = [];
        } catch (e) { appState.savedLocations = []; }
    }

    function saveSavedLocations() {
        try {
            localStorage.setItem(SAVED_LOCATIONS_KEY, JSON.stringify(appState.savedLocations));
        } catch (e) { console.error(e); }
    }

    function loadMapMode() {
        appState.mapMode = localStorage.getItem(MAP_MODE_KEY) || 'roadmap';
    }

    function saveMapMode(mode) {
        localStorage.setItem(MAP_MODE_KEY, mode);
        appState.mapMode = mode;
    }

    function changeMapMode(mode) {
        if (!appState.map) return;
        saveMapMode(mode);
        const type = mode === 'photo' ? google.maps.MapTypeId.SATELLITE :
                     mode === '3d' ? google.maps.MapTypeId.HYBRID : google.maps.MapTypeId.ROADMAP;
        appState.map.setMapTypeId(type);
        appState.map.setTilt(mode === '3d' ? 45 : 0);
        updateMapModeButtons(mode);
    }

    function updateMapModeButtons(activeMode) {
        ['btnMapPhoto', 'btnMapRoadmap', 'btnMap3D'].forEach(btnId => {
            const btn = getEl(btnId);
            if (btn) btn.classList.toggle('active', btn.dataset.mode === activeMode);
        });
    }

    function switchPanelTab(mode) {
        const isNav = mode === 'nav';
        const isSettings = mode === 'settings';
        getEl('tabPaneSearch')?.classList.toggle('active', !isNav && !isSettings);
        getEl('tabPaneNav')?.classList.toggle('active', isNav);
        getEl('tabPaneSettings')?.classList.toggle('active', isSettings);

        const target = isSettings ? 'settings' : (isNav ? 'nav' : 'search');
        document.querySelectorAll('[data-panel-tab]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.panelTab === target);
        });
        setTimeout(updateScrollableHeights, 50);
    }

    /* =========================
       API & Search
       ========================= */
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

    async function placesTextSearch(query, centerLat, centerLng) {
        // Try Worker first
        const payload = {
            textQuery: query,
            locationBias: { circle: { center: { latitude: centerLat, longitude: centerLng }, radius: appState.searchRadiusMeters } },
            languageCode: 'ja'
        };
        try {
            const resp = await fetchWithRetry(`${WORKER_ORIGIN}/places:searchText`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Goog-FieldMask': DEFAULT_MASK },
                body: JSON.stringify(payload)
            });
            if (!resp.ok) throw new Error(`WORKER ${resp.status}`);
            return await resp.json();
        } catch (e) {
            console.warn('[WalkNav] Worker search failed, fallback direct:', e);
            // Fallback Direct
            const resp = await fetchWithRetry(`https://places.googleapis.com/v1/places:searchText`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': API_KEY, 'X-Goog-FieldMask': DEFAULT_MASK },
                body: JSON.stringify(payload)
            });
            if (!resp.ok) throw new Error(`DIRECT ${resp.status}`);
            return await resp.json();
        }
    }

    async function geocode(lat, lng) {
        // Try Worker first
        try {
            const resp = await fetchWithRetry(`${WORKER_ORIGIN}/geocode`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ latlng: { lat, lng }, language: 'ja' })
            });
            if (!resp.ok) throw new Error(`WORKER ${resp.status}`);
            return await resp.json();
        } catch (e) {
            // Fallback Direct
            const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&language=ja&key=${API_KEY}`;
            const resp = await fetchWithRetry(url);
            if (!resp.ok) throw new Error(`DIRECT ${resp.status}`);
            return await resp.json();
        }
    }

    /* =========================
       Map & Location Logic
       ========================= */
    function initMap(center) {
        if (appState.map) {
            appState.map.setCenter(center);
            return;
        }
        const mapEl = getEl('map');
        if (!mapEl) return;

        try {
            appState.map = new google.maps.Map(mapEl, {
                center,
                zoom: 17,
                // mapId REMOVED to fix rendering issue
                gestureHandling: 'greedy',
                clickableIcons: true,
                disableDefaultUI: true
            });

            appState.map.addListener('click', (e) => {
                if (appState.pointSearchMode && e.latLng) {
                    setSearchPoint(e.latLng.lat(), e.latLng.lng());
                }
            });

            changeMapMode(appState.mapMode);
            appState.mapInitialized = true;
            console.log('[WalkNav] Map initialized (No MapID)');
        } catch (e) {
            console.error('[WalkNav] Map failed:', e);
            alertOnce('map_fail', '地図の初期化に失敗しました');
        }
    }

    function setUserMarker(lat, lng) {
        appState.currentPos = { lat, lng };
        if (!appState.map) return;

        if (!appState.userMarker) {
            const pin = document.createElement('div');
            pin.style.width = '32px';
            pin.style.height = '32px';
            pin.innerHTML = `<svg viewBox="0 0 24 24" style="width:100%;height:100%;transform:rotate(${appState.currentHeading}deg);filter:drop-shadow(0 2px 4px rgba(0,0,0,0.4));"><path d="M12 2L4.5 20.5L12 16.5L19.5 20.5L12 2Z" fill="#3aa0ff" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/></svg>`;
            try {
                appState.userMarker = new google.maps.marker.AdvancedMarkerElement({
                    map: appState.map, position: { lat, lng }, content: pin, zIndex: 1000
                });
            } catch (_) {
                appState.userMarker = new google.maps.Marker({ map: appState.map, position: { lat, lng } });
            }
        } else {
            appState.userMarker.position = { lat, lng };
        }
    }

    function setSearchPoint(lat, lng) {
        appState.searchPoint = { lat, lng };
        if (appState.searchPointMarker) appState.searchPointMarker.map = null;

        const pin = document.createElement('div');
        pin.style.cssText = 'width:30px;height:30px;border-radius:50% 50% 50% 0;background:#ff6565;border:3px solid #fff;transform:rotate(-45deg);box-shadow:0 4px 4px rgba(0,0,0,.3)';

        try {
            appState.searchPointMarker = new google.maps.marker.AdvancedMarkerElement({
                map: appState.map, position: { lat, lng }, content: pin, zIndex: 999
            });
        } catch (_) {
            appState.searchPointMarker = new google.maps.Marker({ map: appState.map, position: { lat, lng } });
        }

        // Point address fetch
        setText('pointAddress', '取得中…');
        setDisplay('pointAddressBlock', 'flex');
        setText('pointCoords', `Lat: ${lat.toFixed(5)}`);
        geocode(lat, lng).then(data => {
            if(data.results?.[0]) setText('pointAddress', data.results[0].formatted_address.replace(/^日本、\s*/, ''));
            else setText('pointAddress', '不明な場所');
        }).catch(() => setText('pointAddress', '取得エラー'));
    }

    function acquireLocation() {
        const onSuccess = (pos) => {
            const { latitude, longitude } = pos.coords;
            getEl('loading')?.remove();
            if (!appState.mapInitialized) initMap({ lat: latitude, lng: longitude });
            else appState.map.setCenter({ lat: latitude, lng: longitude });

            setUserMarker(latitude, longitude);

            // Addr fetch
            setText('locCoords', `Lat: ${latitude.toFixed(5)}`);
            geocode(latitude, longitude).then(data => {
                if(data.results?.[0]) setText('locAddress', data.results[0].formatted_address.replace(/^日本、\s*/, ''));
            });
        };

        const onError = (error) => {
            console.warn('[WalkNav] Geolocation error:', error);
            getEl('loading')?.remove();

            // ★ FALLBACK: Tsurugi (Default) ★
            const defaultPos = { lat: 34.0344, lng: 134.0577 };
            if (!appState.mapInitialized) initMap(defaultPos);
            else appState.map.setCenter(defaultPos);

            // ★ FIX: Ensure marker is set so appState.currentPos is not null ★
            setUserMarker(defaultPos.lat, defaultPos.lng);

            setText('locAddress', '現在地取得失敗 (つるぎ町)');
            setText('locCoords', 'GPSエラー');
        };

        if (!navigator.geolocation) { onError('Not supported'); return; }
        navigator.geolocation.getCurrentPosition(onSuccess, onError, LOCATION_OPTIONS);
    }

    function startCompassListener() {
        if (!window.DeviceOrientationEvent) return;
        const handler = (e) => {
            if (appState.isNavigating) return;
            const h = e.webkitCompassHeading || (e.absolute ? e.alpha : null);
            if (h != null) {
                appState.currentHeading = h;
                const icon = getEl('user-marker-icon')?.querySelector('svg');
                if(icon) icon.style.transform = `rotate(${h}deg)`;
            }
        };
        if (typeof DeviceOrientationEvent.requestPermission === 'function') {
            DeviceOrientationEvent.requestPermission().then(s => {
                if (s === 'granted') window.addEventListener('deviceorientation', handler, true);
            });
        } else {
            window.addEventListener('deviceorientationabsolute', handler, true);
            window.addEventListener('deviceorientation', handler, true);
        }
    }

    /* =========================
       Search & Nav Flow
       ========================= */
    async function performSearch(query) {
        if (!query || !lock('search', 1000)) return;

        const center = appState.pointSearchMode && appState.searchPoint
            ? appState.searchPoint : appState.currentPos;

        if (!center) {
            alertOnce('no_pos', '検索中心（現在地）が特定できません');
            return;
        }

        try {
            const data = await placesTextSearch(query, center.lat, center.lng);
            const places = data.places || [];
            displayResults(places);
            if (places.length === 0) alertOnce('no_res', '見つかりませんでした');
        } catch (e) {
            console.error(e);
            alertOnce('search_err', '検索エラーが発生しました');
        }
    }

    function displayResults(places) {
        const div = getEl('results');
        if (!div) return;
        div.innerHTML = '';
        setDisplay('results', 'block');
        setDisplay('instructionsSection', 'none');

        appState.searchMarkers.forEach(m => m.map = null);
        appState.searchMarkers = [];

        places.slice(0, 5).forEach((p, i) => {
            const lat = p.location.latitude;
            const lng = p.location.longitude;
            const name = p.displayName?.text || '名称不明';

            const item = document.createElement('div');
            item.className = 'result-item';
            item.innerHTML = `<div>${i+1}. ${name}</div><div style="font-size:0.8em;opacity:0.7">${p.formattedAddress}</div>`;
            item.onclick = () => startNavigation({ name, lat, lng });
            div.appendChild(item);

            // Marker
            const pin = document.createElement('div');
            pin.style.cssText = 'width:24px;height:24px;background:#25d07a;border-radius:50%;color:#fff;text-align:center;line-height:24px;font-weight:bold;border:2px solid #fff;';
            pin.textContent = i + 1;
            try {
                appState.searchMarkers.push(new google.maps.marker.AdvancedMarkerElement({
                    map: appState.map, position: { lat, lng }, content: pin, title: name
                }));
            } catch (_) {
                appState.searchMarkers.push(new google.maps.Marker({
                    map: appState.map, position: { lat, lng }, label: String(i+1)
                }));
            }
        });
        updateScrollableHeights();
    }

    async function startNavigation(dest) {
        if (!appState.currentPos) return;
        appState.currentDestination = dest;
        appState.isNavigating = true;

        // UI Switch
        setDisplay('searchPanel', 'block');
        setDisplay('fabStack', 'flex');
        switchPanelTab('nav');
        setDisplay('routeControlSection', 'block');
        setDisplay('results', 'none');

        // Route API
        try {
            const origin = `${appState.currentPos.lat},${appState.currentPos.lng}`;
            const destination = `${dest.lat},${dest.lng}`;
            const resp = await fetchWithRetry(`${WORKER_ORIGIN}/directions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ origin, destination, mode: 'walking', language: 'ja' })
            });
            const json = await resp.json();
            if (!json.routes || !json.routes[0]) throw new Error('No route');

            const r = json.routes[0];
            const leg = r.legs[0];

            setText('destinationName', dest.name);
            setText('routeDistance', leg.distance?.text || '');
            setText('routeTime', `徒歩 ${leg.duration?.text || ''}`);

            const list = getEl('navPanelInstructions');
            list.innerHTML = '';
            leg.steps.forEach(s => {
                const d = document.createElement('div');
                d.className = 'nav-instruction-item';
                d.textContent = s.html_instructions.replace(/<[^>]+>/g, '') + ` (${s.distance?.text})`;
                list.appendChild(d);
            });
            setDisplay('instructionsSection', 'block');

            // Draw
            if (appState.currentPolyline) appState.currentPolyline.setMap(null);
            const path = google.maps.geometry.encoding.decodePath(r.overview_polyline.points);
            appState.currentPolyline = new google.maps.Polyline({
                path, map: appState.map, strokeColor: '#62b5ff', strokeWeight: 6
            });

            // Fit bounds
            const b = new google.maps.LatLngBounds();
            b.extend(appState.currentPos);
            b.extend(dest);
            appState.map.fitBounds(b, { padding: 50 });

            // MVP Score Calculation
            if (typeof RouteEvaluator !== 'undefined') {
                const wbgt = await RouteEvaluator.fetchWBGT();
                const score = RouteEvaluator.calculateStressScore(r, appState.userProfile, wbgt);
                console.log('Stress Score:', score);
                const scoreEl = document.createElement('div');
                scoreEl.style.cssText = 'margin-top:8px;padding:8px;background:rgba(0,0,0,0.1);border-radius:8px;font-size:12px;';
                scoreEl.innerHTML = `ストレススコア: <strong>${score}</strong> (WBGT: ${wbgt})`;
                getEl('routeInfoSection').appendChild(scoreEl);
            }

        } catch (e) {
            console.error(e);
            alertOnce('route_err', 'ルートが見つかりませんでした');
            stopNavigation();
        }
    }

    function stopNavigation() {
        appState.isNavigating = false;
        if (appState.currentPolyline) appState.currentPolyline.setMap(null);
        setDisplay('routeControlSection', 'none');
        setDisplay('instructionsSection', 'none');
        setDisplay('routeInfoSection', 'none');
        setDisplay('btnDestination', 'none');
        setDisplay('fabStack', 'none');
        setDisplay('btnSearch', 'flex');
        switchPanelTab('search');
        if(appState.currentPos) {
            appState.map.panTo(appState.currentPos);
            appState.map.setZoom(17);
        }
    }

    /* =========================
       Event Binding
       ========================= */
    function bindUI() {
        // Search
        const q = getEl('q');
        getEl('btnSearchIcon').onclick = () => performSearch(q.value);
        q.onkeypress = (e) => { if(e.key==='Enter') performSearch(q.value); };

        // Reset
        getEl('btnReset').onclick = () => {
            q.value = '';
            setDisplay('results', 'none');
            appState.pointSearchMode = false;
            const btnP = getEl('btnPointSearch');
            if(btnP) { btnP.textContent = '📍 ポイント選択'; btnP.style.background=''; btnP.style.color=''; }
        };

        // UI Controls
        getEl('btnLocate').onclick = () => acquireLocation();
        getEl('btnLocatePanel').onclick = () => acquireLocation();
        getEl('btnClosePanel').onclick = () => { setDisplay('searchPanel','none'); setDisplay('fabStack','flex'); };
        getEl('btnSearch').onclick = () => { setDisplay('searchPanel','block'); setDisplay('fabStack','none'); };
        getEl('btnStopRoute').onclick = () => stopNavigation();

        // Radius Chips
        const chips = [getEl('r10'), getEl('r20'), getEl('r30')];
        chips.forEach((el, idx) => {
            if(!el) return;
            el.onclick = () => {
                chips.forEach(c => c.classList.remove('active'));
                el.classList.add('active');
                appState.searchRadiusMeters = (idx + 1) * 10000;
                setText('radiusLabel', `${(idx + 1) * 10}km`);
            };
        });

        // Point Search
        const btnP = getEl('btnPointSearch');
        if(btnP) {
            btnP.onclick = () => {
                appState.pointSearchMode = !appState.pointSearchMode;
                btnP.textContent = appState.pointSearchMode ? '📍 選択中...' : '📍 ポイント選択';
                btnP.style.background = appState.pointSearchMode ? '#25d07a' : '';
                btnP.style.color = appState.pointSearchMode ? '#fff' : '';
            };
        }

        // Map Modes
        getEl('btnMapPhoto').onclick = () => changeMapMode('photo');
        getEl('btnMapRoadmap').onclick = () => changeMapMode('roadmap');
        getEl('btnMap3D').onclick = () => changeMapMode('3d');

        // User Profile Inputs (MVP)
        ['userLuggage', 'userCondition', 'userCompanion'].forEach(id => {
            const el = getEl(id);
            if(el) el.onchange = (e) => appState.userProfile[id.replace('user','').toLowerCase()] = e.target.value;
        });

        // Location Save/Edit (Simplified)
        getEl('btnSaveLocation').onclick = () => {
            if(!appState.currentPos) return;
            const name = prompt('登録名:', getEl('locAddress').innerText);
            if(name) {
                appState.savedLocations.push({ name, ...appState.currentPos });
                saveSavedLocations();
                alert('保存しました');
            }
        };
        getEl('btnEditLocation').onclick = () => {
            loadSavedLocations();
            if(!appState.savedLocations.length) return alert('登録地がありません');
            // Simplified: clear all for MVP fix if needed, or implement full dialog here
            if(confirm('登録地を全てクリアしますか？(簡易編集)')) {
                appState.savedLocations = [];
                saveSavedLocations();
            }
        };
    }

    function startApp() {
        console.log('[WalkNav] Starting Final Fix v4...');
        applyUiFixes();
        setDisplay('searchPanel', 'block');
        setDisplay('fabStack', 'none');
        setDisplay('btnSearch', 'flex');

        loadSavedLocations();
        loadMapMode();
        bindUI();
        updateMapModeButtons(appState.mapMode);
        switchPanelTab('search');

        acquireLocation(); // Starts GPS + Map Init
        startCompassListener();
    }

    function initializeWhenReady() {
        if (typeof google !== 'undefined' && google.maps && google.maps.Map) {
            startApp();
        } else {
            setTimeout(initializeWhenReady, 100);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeWhenReady);
    } else {
        initializeWhenReady();
    }
}
