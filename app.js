'use strict';

/**
 * WalkNav app.js - Final Fix v6 (Standard Markers)
 * * Status:
 * - Map Initialization: OK (Fixed in v5)
 * - Huge G: Gone (Fixed in v5)
 * * Changes in v6:
 * - Replaced `AdvancedMarkerElement` with standard `google.maps.Marker`.
 * - This resolves the "Map ID required" warning and ensures pins appear on the standard map.
 * - Restored compass rotation using standard marker SVG icons.
 */

const ISSUE_ID = 'idx20251209_standard_marker_fix_v6';
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
        try {
            const resp = await fetchWithRetry(`${WORKER_ORIGIN}/geocode`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ latlng: { lat, lng }, language: 'ja' })
            });
            if (!resp.ok) throw new Error(`WORKER ${resp.status}`);
            return await resp.json();
        } catch (e) {
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
            console.log('[WalkNav] Map initialized');
        } catch (e) {
            console.error('[WalkNav] Map failed:', e);
            alertOnce('map_fail', '地図の初期化に失敗しました');
        }
    }

    // FIX: Use Standard Marker for User Pin
    function setUserMarker(lat, lng) {
        appState.currentPos = { lat, lng };
        if (!appState.map) return;

        // SVG Path for Arrow
        const arrowIcon = {
            path: "M12 2L4.5 20.5L12 16.5L19.5 20.5L12 2Z",
            fillColor: "#3aa0ff",
            fillOpacity: 1,
            strokeWeight: 2,
            strokeColor: "#ffffff",
            rotation: appState.currentHeading,
            scale: 1.2,
            anchor: new google.maps.Point(12, 12)
        };

        if (!appState.userMarker) {
            appState.userMarker = new google.maps.Marker({
                map: appState.map,
                position: { lat, lng },
                icon: arrowIcon,
                zIndex: 1000
            });
        } else {
            appState.userMarker.setPosition({ lat, lng });
            appState.userMarker.setIcon(arrowIcon);
        }
    }

    // FIX: Use Standard Marker for Search Point
    function setSearchPoint(lat, lng) {
        appState.searchPoint = { lat, lng };
        if (appState.searchPointMarker) appState.searchPointMarker.setMap(null);
        
        // Simple red pin via symbol or icon
        const pinIcon = {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 10,
            fillColor: "#ff6565",
            fillOpacity: 1,
            strokeWeight: 2,
            strokeColor: "white"
        };

        appState.searchPointMarker = new google.maps.Marker({
            map: appState.map,
            position: { lat, lng },
            icon: pinIcon,
            zIndex: 999
        });
        
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
            
            setText('locCoords', `Lat: ${latitude.toFixed(5)}`);
            geocode(latitude, longitude).then(data => {
                if(data.results?.[0]) setText('locAddress', data.results[0].formatted_address.replace(/^日本、\s*/, ''));
            });
        };

        const onError = (error) => {
            console.warn('[WalkNav] Geolocation error:', error);
            getEl('loading')?.remove();
            
            const defaultPos = { lat: 34.0344, lng: 134.0577 };
            if (!appState.mapInitialized) initMap(defaultPos);
            else appState.map.setCenter(defaultPos);
            
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
                // Update marker rotation if marker exists
                if(appState.userMarker) {
                    const icon = appState.userMarker.getIcon();
                    if(icon && typeof icon === 'object') {
                        icon.rotation = h;
                        appState.userMarker.setIcon(icon);
                    }
                }
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

    // FIX: Use Standard Markers for results
    function displayResults(places) {
        const div = getEl('results');
        if (!div) return;
        div.innerHTML = '';
        setDisplay('results', 'block');
        setDisplay('instructionsSection', 'none');
        
        appState.searchMarkers.forEach(m => m.setMap(null));
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

            // Standard Marker with Label
            appState.searchMarkers.push(new google.maps.Marker({
                map: appState.map,
                position: { lat, lng },
                label: String(i + 1),
                title: name
            }));
        });
        updateScrollableHeights();
    }

    async function startNavigation(dest) {
        if (!appState.currentPos) return;
        appState.currentDestination = dest;
        appState.isNavigating = true;
        
        setDisplay('searchPanel', 'block');
        setDisplay('fabStack', 'flex');
        switchPanelTab('nav');
        setDisplay('routeControlSection', 'block');
        setDisplay('results', 'none');

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
            if(list) {
                list.innerHTML = '';
                leg.steps.forEach(s => {
                    const d = document.createElement('div');
                    d.className = 'nav-instruction-item';
                    d.textContent = s.html_instructions.replace(/<[^>]+>/g, '') + ` (${s.distance?.text})`;
                    list.appendChild(d);
                });
            }
            setDisplay('instructionsSection', 'block');
            
            if (appState.currentPolyline) appState.currentPolyline.setMap(null);
            const path = google.maps.geometry.encoding.decodePath(r.overview_polyline.points);
            appState.currentPolyline = new google.maps.Polyline({
                path, map: appState.map, strokeColor: '#62b5ff', strokeWeight: 6
            });
            
            const b = new google.maps.LatLngBounds();
            b.extend(appState.currentPos);
            b.extend(dest);
            appState.map.fitBounds(b, { padding: 50 });
            
            if (typeof RouteEvaluator !== 'undefined') {
                const wbgt = await RouteEvaluator.fetchWBGT();
                const score = RouteEvaluator.calculateStressScore(r, appState.userProfile, wbgt);
                const scoreEl = document.createElement('div');
                scoreEl.style.cssText = 'margin-top:8px;padding:8px;background:rgba(0,0,0,0.1);border-radius:8px;font-size:12px;';
                scoreEl.innerHTML = `ストレススコア: <strong>${score}</strong> (WBGT: ${wbgt})`;
                const infoSec = getEl('routeInfoSection');
                if(infoSec) infoSec.appendChild(scoreEl);
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
        const q = getEl('q');
        const btnSearchIcon = getEl('btnSearchIcon');
        if(btnSearchIcon) btnSearchIcon.onclick = () => performSearch(q ? q.value : '');
        if(q) q.onkeypress = (e) => { if(e.key==='Enter') performSearch(q.value); };
        
        const btnReset = getEl('btnReset');
        if(btnReset) btnReset.onclick = () => {
            if(q) q.value = '';
            setDisplay('results', 'none');
            appState.pointSearchMode = false;
            const btnP = getEl('btnPointSearch');
            if(btnP) { btnP.textContent = '📍 ポイント選択'; btnP.style.background=''; btnP.style.color=''; }
        };

        getEl('btnLocate').onclick = () => acquireLocation();
        getEl('btnLocatePanel').onclick = () => acquireLocation();
        getEl('btnClosePanel').onclick = () => { setDisplay('searchPanel','none'); setDisplay('fabStack','flex'); };
        getEl('btnSearch').onclick = () => { setDisplay('searchPanel','block'); setDisplay('fabStack','none'); };
        getEl('btnStopRoute').onclick = () => stopNavigation();
        
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

        const btnP = getEl('btnPointSearch');
        if(btnP) {
            btnP.onclick = () => {
                appState.pointSearchMode = !appState.pointSearchMode;
                btnP.textContent = appState.pointSearchMode ? '📍 選択中...' : '📍 ポイント選択';
                btnP.style.background = appState.pointSearchMode ? '#25d07a' : '';
                btnP.style.color = appState.pointSearchMode ? '#fff' : '';
            };
        }

        const btnMapPhoto = getEl('btnMapPhoto');
        if(btnMapPhoto) btnMapPhoto.onclick = () => changeMapMode('photo');
        
        const btnMapRoadmap = getEl('btnMapRoadmap');
        if(btnMapRoadmap) btnMapRoadmap.onclick = () => changeMapMode('roadmap');
        
        const btnMap3D = getEl('btnMap3D');
        if(btnMap3D) btnMap3D.onclick = () => changeMapMode('3d');

        ['userLuggage', 'userCondition', 'userCompanion'].forEach(id => {
            const el = getEl(id);
            if(el) el.onchange = (e) => appState.userProfile[id.replace('user','').toLowerCase()] = e.target.value;
        });
        
        const btnSaveLocation = getEl('btnSaveLocation');
        if(btnSaveLocation) btnSaveLocation.onclick = () => {
            if(!appState.currentPos) return;
            const addr = getEl('locAddress') ? getEl('locAddress').innerText : '現在地';
            const name = prompt('登録名:', addr);
            if(name) {
                appState.savedLocations.push({ name, ...appState.currentPos });
                saveSavedLocations();
                alert('保存しました');
            }
        };
        
        const btnEditLocation = getEl('btnEditLocation');
        if(btnEditLocation) btnEditLocation.onclick = () => {
            loadSavedLocations();
            if(!appState.savedLocations.length) return alert('登録地がありません');
            if(confirm('登録地を全てクリアしますか？(簡易編集)')) {
                appState.savedLocations = [];
                saveSavedLocations();
            }
        };
    }

    function startApp() {
        console.log('[WalkNav] Starting Final Fix v6 (Standard Markers)...');
        applyUiFixes();
        setDisplay('searchPanel', 'block');
        setDisplay('fabStack', 'none');
        setDisplay('btnSearch', 'flex');
        
        loadSavedLocations();
        loadMapMode();
        bindUI();
        updateMapModeButtons(appState.mapMode);
        switchPanelTab('search');
        
        acquireLocation();
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
