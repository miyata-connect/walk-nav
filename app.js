'use strict';

/**
 * WalkNav app.js - v7 Emergency Logic Only
 * [方針]
 * - レイアウトは app.css に完全委譲（JSからのCSS強制注入は廃止）
 * - 検索／ナビ／マップモード切替などロジックのみ保持
 */

const ISSUE_ID = 'idx20251209_emergency_fix_v7_logic_only';
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
        isNavigating: false,
        locationWatchId: null,
        compassWatchId: null,
        currentHeading: 0,
        isSimulation: false,
        currentRouteData: null,
        userProfile: { luggage: 'None', condition: 'Normal', companion: 'None' },
        savedLocations: [],
        editingLocationIndex: null,
        isEditDialogOpen: false,
        mapMode: 'roadmap',
        searchInFlight: false,
        searchRadiusMeters: 10000 
    };

    function getEl(id) { return document.getElementById(id); }
    function setDisplay(id, displayVal) { const el = getEl(id); if (el) el.style.display = displayVal; }
    function setText(id, text) { const el = getEl(id); if (el) el.textContent = text; }
    function safeRemove(el) { try { if (el && el.parentNode) el.parentNode.removeChild(el); } catch (_) { } }

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
            console.warn('Fallback to Direct:', e);
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

    function setUserMarker(lat, lng) {
        appState.currentPos = { lat, lng };
        if (!appState.map) return;

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

    function setSearchPoint(lat, lng) {
        appState.searchPoint = { lat, lng };
        if (appState.searchPointMarker) appState.searchPointMarker.setMap(null);
        
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
            if (data.results?.[0]) setText('pointAddress', data.results[0].formatted_address.replace(/^日本、\s*/, ''));
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
                if (data.results?.[0]) setText('locAddress', data.results[0].formatted_address.replace(/^日本、\s*/, ''));
            });
        };

        const onError = (error) => {
            console.warn('[WalkNav] Geolocation error:', error);
            getEl('loading')?.remove();
            
            const defaultPos = { lat: 34.0344, lng: 134.0577 }; // つるぎ町
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
                if (appState.userMarker) {
                    const icon = appState.userMarker.getIcon();
                    if (icon && typeof icon === 'object') {
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

    function startLocationWatcher() {
        if (appState.locationWatchId) navigator.geolocation.clearWatch(appState.locationWatchId);
        appState.locationWatchId = navigator.geolocation.watchPosition(
            (pos) => {
                const { latitude, longitude } = pos.coords;
                setUserMarker(latitude, longitude);
                if (appState.isNavigating && appState.map) {
                    appState.map.panTo({ lat: latitude, lng: longitude });
                }
            },
            () => {},
            LOCATION_OPTIONS
        );
    }

    function stopLocationWatcher() {
        if (appState.locationWatchId) {
            navigator.geolocation.clearWatch(appState.locationWatchId);
            appState.locationWatchId = null;
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
        
        appState.searchMarkers.forEach(m => m.setMap(null));
        appState.searchMarkers = [];

        places.slice(0, 5).forEach((p, i) => {
            const lat = p.location.latitude;
            const lng = p.location.longitude;
            const name = p.displayName?.text || '名称不明';
            
            const item = document.createElement('div');
            item.className = 'result-item';
            item.innerHTML = `<div>${i + 1}. ${name}</div><div style="font-size:0.8em;opacity:0.7">${p.formattedAddress}</div>`;
            item.onclick = () => startNavigation({ name, lat, lng });
            div.appendChild(item);

            appState.searchMarkers.push(new google.maps.Marker({
                map: appState.map,
                position: { lat, lng },
                label: String(i + 1),
                title: name
            }));
        });
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
            if (list) {
                list.innerHTML = '';
                leg.steps.forEach(s => {
                    const d = document.createElement('div');
                    d.className = 'nav-instruction-item';
                    d.style.padding = '8px 0';
                    d.style.borderBottom = '1px solid #eee';
                    d.textContent = s.html_instructions.replace(/<[^>]+>/g, '') + ` (${s.distance?.text})`;
                    list.appendChild(d);
                });
            }
            setDisplay('instructionsSection', 'block');
            
            if (appState.currentPolyline) appState.currentPolyline.setMap(null);
            const path = google.maps.geometry.encoding.decodePath(r.overview_polyline.points);
            appState.currentPolyline = new google.maps.Polyline({
                path,
                map: appState.map,
                strokeColor: '#62b5ff',
                strokeWeight: 6
            });
            
            const b = new google.maps.LatLngBounds();
            b.extend(appState.currentPos);
            b.extend(dest);
            appState.map.fitBounds(b, { padding: 50 });
            
            startLocationWatcher();

        } catch (e) {
            console.error(e);
            alertOnce('route_err', 'ルートが見つかりませんでした');
            stopNavigation();
        }
    }

    function stopNavigation() {
        stopLocationWatcher();
        appState.isNavigating = false;
        if (appState.currentPolyline) appState.currentPolyline.setMap(null);
        setDisplay('routeControlSection', 'none');
        setDisplay('instructionsSection', 'none');
        setDisplay('routeInfoSection', 'none');
        setDisplay('btnDestination', 'none');
        setDisplay('fabStack', 'none');
        setDisplay('btnSearch', 'flex');
        switchPanelTab('search');
        if (appState.currentPos && appState.map) {
            appState.map.panTo(appState.currentPos);
            appState.map.setZoom(17);
        }
    }

    /* =========================
       UI Binding & Init
       ========================= */
    function switchPanelTab(mode) {
        const isNav = mode === 'nav';
        const isSettings = mode === 'settings';
        const s = getEl('tabPaneSearch');
        const n = getEl('tabPaneNav');
        const st = getEl('tabPaneSettings');
        if (s) s.classList.toggle('active', !isNav && !isSettings);
        if (n) n.classList.toggle('active', isNav);
        if (st) st.classList.toggle('active', isSettings);
        
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle(
                'active',
                btn.dataset.panelTab === (isSettings ? 'settings' : (isNav ? 'nav' : 'search'))
            );
        });
    }

    function changeMapMode(mode) {
        if (!appState.map) return;
        localStorage.setItem(MAP_MODE_KEY, mode);
        appState.mapMode = mode;
        const type = mode === 'photo' ? google.maps.MapTypeId.SATELLITE :
                     mode === '3d' ? google.maps.MapTypeId.HYBRID : google.maps.MapTypeId.ROADMAP;
        appState.map.setMapTypeId(type);
        appState.map.setTilt(mode === '3d' ? 45 : 0);
        ['btnMapPhoto', 'btnMapRoadmap', 'btnMap3D'].forEach(id => {
            const el = getEl(id);
            if (el) el.classList.toggle('active', el.dataset.mode === mode);
        });
    }

    function bindUI() {
        const q = getEl('q');
        const btnSearchIcon = getEl('btnSearchIcon');
        if (btnSearchIcon) btnSearchIcon.onclick = () => performSearch(q ? q.value : '');
        if (q) q.onkeypress = (e) => { if (e.key === 'Enter') performSearch(q.value); };
        
        const btnReset = getEl('btnReset');
        if (btnReset) {
            btnReset.onclick = () => {
                if (q) q.value = '';
                setDisplay('results', 'none');
                appState.pointSearchMode = false;
                const btnPInner = getEl('btnPointSearch');
                if (btnPInner) {
                    btnPInner.textContent = '📍 ポイント選択';
                    btnPInner.style.background = '';
                    btnPInner.style.color = '';
                }
            };
        }

        const btnLocate = getEl('btnLocate');
        if (btnLocate) btnLocate.onclick = () => acquireLocation();
        const btnLocatePanel = getEl('btnLocatePanel');
        if (btnLocatePanel) btnLocatePanel.onclick = () => acquireLocation();

        const btnClosePanel = getEl('btnClosePanel');
        if (btnClosePanel) {
            btnClosePanel.onclick = () => {
                const panel = getEl('searchPanel');
                if (panel) panel.classList.add('collapsed');
            };
        }

        const btnSearch = getEl('btnSearch');
        if (btnSearch) {
            btnSearch.onclick = () => {
                const panel = getEl('searchPanel');
                if (panel) panel.classList.remove('collapsed');
            };
        }

        const btnStopRoute = getEl('btnStopRoute');
        if (btnStopRoute) btnStopRoute.onclick = () => stopNavigation();
        
        const chips = [getEl('r10'), getEl('r20'), getEl('r30')];
        chips.forEach((el, idx) => {
            if (!el) return;
            el.onclick = () => {
                chips.forEach(c => { if (c) c.classList.remove('active'); });
                el.classList.add('active');
                appState.searchRadiusMeters = (idx + 1) * 10000;
                setText('radiusLabel', `${(idx + 1) * 10}km`);
            };
        });

        const btnP = getEl('btnPointSearch');
        if (btnP) {
            btnP.onclick = () => {
                appState.pointSearchMode = !appState.pointSearchMode;
                btnP.textContent = appState.pointSearchMode ? '📍 選択中...' : '📍 ポイント選択';
                btnP.style.background = appState.pointSearchMode ? '#25d07a' : '';
                btnP.style.color = appState.pointSearchMode ? '#fff' : '';
            };
        }

        const btnMapPhoto = getEl('btnMapPhoto');
        if (btnMapPhoto) btnMapPhoto.onclick = () => changeMapMode('photo');
        const btnMapRoadmap = getEl('btnMapRoadmap');
        if (btnMapRoadmap) btnMapRoadmap.onclick = () => changeMapMode('roadmap');
        const btnMap3D = getEl('btnMap3D');
        if (btnMap3D) btnMap3D.onclick = () => changeMapMode('3d');
    }

    function startApp() {
        console.log('[WalkNav] Starting Logic-Only v7...');
        bindUI();
        appState.mapMode = localStorage.getItem(MAP_MODE_KEY) || 'roadmap';
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
