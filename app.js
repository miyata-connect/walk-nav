'use strict';

const ISSUE_ID = 'idx20251119_fix_loc_tsurugi_v5';
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
    keyboardAdjusted: false,
    unifiedHeight: null,
    savedLocations: [],
    editingLocationIndex: null,
    isEditDialogOpen: false,
    mapMode: 'roadmap'
};

function getEl(id) {
    return document.getElementById(id);
}

function setDisplay(id, displayVal) {
    const el = document.getElementById(id);
    if (el) el.style.display = displayVal;
}

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function loadSavedLocations() {
    try {
        const saved = localStorage.getItem(SAVED_LOCATIONS_KEY);
        appState.savedLocations = saved ? JSON.parse(saved) : [];
    } catch (e) {
        console.error('登録地の読み込みエラー:', e);
        appState.savedLocations = [];
    }
}

function saveSavedLocations() {
    try {
        localStorage.setItem(SAVED_LOCATIONS_KEY, JSON.stringify(appState.savedLocations));
        console.log('[SavedLocations] 保存完了:', appState.savedLocations.length, '件');
    } catch (e) {
        console.error('登録地の保存エラー:', e);
    }
}

function loadMapMode() {
    try {
        const saved = localStorage.getItem(MAP_MODE_KEY);
        appState.mapMode = saved || 'roadmap';
    } catch (e) {
        appState.mapMode = 'roadmap';
    }
}

function saveMapMode(mode) {
    try {
        localStorage.setItem(MAP_MODE_KEY, mode);
        appState.mapMode = mode;
        console.log('[MapMode] 保存:', mode);
    } catch (e) {
        console.error('地図モード保存エラー:', e);
    }
}

function changeMapMode(mode) {
    if (!appState.map) return;

    saveMapMode(mode);

    if (mode === 'photo') {
        appState.map.setMapTypeId(google.maps.MapTypeId.SATELLITE);
    } else if (mode === '3d') {
        appState.map.setMapTypeId(google.maps.MapTypeId.HYBRID);
        appState.map.setTilt(45);
    } else {
        appState.map.setMapTypeId(google.maps.MapTypeId.ROADMAP);
        appState.map.setTilt(0);
    }

    updateMapModeButtons(mode);
}

function updateMapModeButtons(activeMode) {
    ['btnMapPhoto', 'btnMapRoadmap', 'btnMap3D'].forEach(btnId => {
        const btn = getEl(btnId);
        if (btn) {
            const mode = btn.dataset.mode;
            if (mode === activeMode) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        }
    });
}

function showSaveLocationDialog() {
    if (!appState.currentPos) {
        alert('現在地が取得できていません');
        return;
    }

    const address = getEl('locAddress')?.textContent || '現在地';
    const lat = appState.currentPos.lat;
    const lng = appState.currentPos.lng;

    const name = prompt('登録地名を入力してください:', address);
    if (!name) return;

    appState.savedLocations.push({
        name: name,
        address: address,
        lat: lat,
        lng: lng,
        timestamp: Date.now()
    });

    saveSavedLocations();
    alert(`「${name}」を登録しました`);
}

function showEditLocationDialog() {
    loadSavedLocations();

    if (appState.savedLocations.length === 0) {
        alert('登録地がありません');
        return;
    }

    if (appState.isEditDialogOpen) return;
    appState.isEditDialogOpen = true;

    const overlay = document.createElement('div');
    overlay.className = 'edit-dialog-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'edit-dialog';

    const title = document.createElement('h3');
    title.textContent = '編集する登録地を選択してください';
    dialog.appendChild(title);

    const list = document.createElement('div');
    list.className = 'edit-dialog-list';

    appState.savedLocations.forEach((loc, index) => {
        const item = document.createElement('div');
        item.className = 'edit-dialog-item';

        const itemTitle = document.createElement('div');
        itemTitle.className = 'edit-dialog-item-title';
        itemTitle.textContent = loc.name;

        const itemSubtitle = document.createElement('div');
        itemSubtitle.className = 'edit-dialog-item-subtitle';
        itemSubtitle.textContent = loc.address;

        item.appendChild(itemTitle);
        item.appendChild(itemSubtitle);

        item.onclick = () => {
            document.body.removeChild(overlay);
            appState.isEditDialogOpen = false;
            showLocationEditMenu(index);
        };

        list.appendChild(item);
    });

    dialog.appendChild(list);

    const btnClose = document.createElement('button');
    btnClose.className = 'edit-dialog-btn edit-dialog-btn-secondary';
    btnClose.textContent = 'キャンセル';
    btnClose.onclick = () => {
        document.body.removeChild(overlay);
        appState.isEditDialogOpen = false;
    };

    dialog.appendChild(btnClose);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
}

function showLocationEditMenu(index) {
    const location = appState.savedLocations[index];

    const overlay = document.createElement('div');
    overlay.className = 'edit-dialog-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'edit-dialog';

    const title = document.createElement('h3');
    title.textContent = `「${location.name}」を編集`;
    dialog.appendChild(title);

    const btnEdit = document.createElement('button');
    btnEdit.className = 'edit-dialog-btn edit-dialog-btn-primary';
    btnEdit.textContent = '修正';
    btnEdit.onclick = () => {
        document.body.removeChild(overlay);
        showLocationEditForm(index);
    };

    const btnDelete = document.createElement('button');
    btnDelete.className = 'edit-dialog-btn edit-dialog-btn-danger';
    btnDelete.textContent = '削除';
    btnDelete.onclick = () => {
        document.body.removeChild(overlay);
        showLocationDeleteConfirm(index);
    };

    const btnCancel = document.createElement('button');
    btnCancel.className = 'edit-dialog-btn edit-dialog-btn-secondary';
    btnCancel.textContent = 'キャンセル';
    btnCancel.onclick = () => {
        document.body.removeChild(overlay);
        appState.isEditDialogOpen = false;
    };

    dialog.appendChild(btnEdit);
    dialog.appendChild(btnDelete);
    dialog.appendChild(btnCancel);

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
}

function showLocationDeleteConfirm(index) {
    const location = appState.savedLocations[index];

    const overlay = document.createElement('div');
    overlay.className = 'edit-dialog-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'edit-dialog';

    const title = document.createElement('h3');
    title.textContent = 'この登録ポイントを削除しますか?';
    dialog.appendChild(title);

    const message = document.createElement('div');
    message.style.cssText = 'margin-bottom: 16px; opacity: 0.8;';
    message.textContent = `「${location.name}」`;
    dialog.appendChild(message);

    const btnGroup = document.createElement('div');
    btnGroup.className = 'edit-dialog-btn-group';

    const btnNo = document.createElement('button');
    btnNo.className = 'edit-dialog-btn edit-dialog-btn-secondary';
    btnNo.textContent = 'いいえ';
    btnNo.onclick = () => {
        document.body.removeChild(overlay);
        appState.isEditDialogOpen = false;
    };

    const btnYes = document.createElement('button');
    btnYes.className = 'edit-dialog-btn edit-dialog-btn-danger';
    btnYes.textContent = 'はい';
    btnYes.onclick = () => {
        appState.savedLocations.splice(index, 1);
        saveSavedLocations();
        document.body.removeChild(overlay);
        appState.isEditDialogOpen = false;
        alert('削除しました');
    };

    btnGroup.appendChild(btnNo);
    btnGroup.appendChild(btnYes);

    dialog.appendChild(btnGroup);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
}

function showLocationEditForm(index) {
    const location = appState.savedLocations[index];

    const overlay = document.createElement('div');
    overlay.className = 'edit-dialog-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'edit-dialog';

    const title = document.createElement('h3');
    title.textContent = '登録地名を修正';
    dialog.appendChild(title);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'edit-dialog-input';
    input.value = location.name;
    input.placeholder = '登録地名を入力';
    dialog.appendChild(input);

    const btnComplete = document.createElement('button');
    btnComplete.className = 'edit-dialog-btn edit-dialog-btn-primary';
    btnComplete.textContent = '完了';
    btnComplete.onclick = () => {
        const newName = input.value.trim();
        if (!newName) {
            alert('登録地名を入力してください');
            return;
        }
        location.name = newName;
        saveSavedLocations();
        document.body.removeChild(overlay);
        appState.isEditDialogOpen = false;
        alert('更新しました');
    };

    const btnCancel = document.createElement('button');
    btnCancel.className = 'edit-dialog-btn edit-dialog-btn-secondary';
    btnCancel.textContent = 'キャンセル';
    btnCancel.onclick = () => {
        document.body.removeChild(overlay);
        appState.isEditDialogOpen = false;
    };

    dialog.appendChild(btnComplete);
    dialog.appendChild(btnCancel);

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    setTimeout(() => input.focus(), 100);
}

function unifyTabPaneHeights() {
    const panes = document.querySelectorAll('.tab-pane');
    if (panes.length === 0) return;

    if (appState.unifiedHeight !== null) {
        panes.forEach(pane => {
            pane.style.minHeight = `${appState.unifiedHeight}px`;
            pane.style.height = `${appState.unifiedHeight}px`;
        });
        return;
    }

    let maxHeight = 0;
    const originalStates = [];

    panes.forEach(pane => {
        originalStates.push({
            element: pane,
            display: pane.style.display
        });
        pane.style.display = 'block';
        pane.style.minHeight = 'auto';
        pane.style.height = 'auto';
    });

    setTimeout(() => {
        panes.forEach(pane => {
            const height = pane.scrollHeight;
            if (height > maxHeight) maxHeight = height;
        });

        appState.unifiedHeight = maxHeight;

        panes.forEach(pane => {
            pane.style.minHeight = `${maxHeight}px`;
            pane.style.height = `${maxHeight}px`;
        });

        originalStates.forEach(state => {
            state.element.style.display = state.display;
        });

        console.log(`[TabHeight] Fixed at ${maxHeight}px`);

    }, 50);
}

function switchPanelTab(mode) {
    const isNav = mode === 'nav';
    const isSettings = mode === 'settings';

    const paneSearch = getEl('tabPaneSearch');
    const paneNav = getEl('tabPaneNav');
    const paneSettings = getEl('tabPaneSettings');

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

async function fetchWithRetry(url, options = {}, retries = MAX_RETRY) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);
            if (!response.ok && i < retries - 1) {
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (i + 1)));
                continue;
            }
            return response;
        } catch (error) {
            if (i === retries - 1) throw error;
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (i + 1)));
        }
    }
}

async function placesTextSearch(payload, fieldMask) {
    try {
        payload.languageCode = 'ja';
        const resp = await fetchWithRetry(`${WORKER_ORIGIN}/places:searchText`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(fieldMask ? {
                    'X-Goog-FieldMask': fieldMask
                } : {})
            },
            body: JSON.stringify(payload)
        });
        if (!resp.ok) throw new Error(`TextSearch ${resp.status}`);
        return await resp.json();
    } catch (error) {
        console.error(`検索エラー: ${error.message}`);
        throw error;
    }
}

async function placesNearby(payload, fieldMask) {
    try {
        payload.languageCode = 'ja';
        const resp = await fetchWithRetry(`${WORKER_ORIGIN}/places:searchNearby`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        if (!resp.ok) throw new Error(`Nearby ${resp.status}`);
        return await resp.json();
    } catch (error) {
        console.error(`検索エラー: ${error.message}`);
        throw error;
    }
}

function initMap(center) {
    if (appState.map) {
        appState.map.setCenter(center);
        console.log('[WalkNav] Map center updated');
        return;
    }
    const mapEl = getEl('map');
    if (!mapEl) return;

    try {
        appState.map = new google.maps.Map(mapEl, {
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

        changeMapMode(appState.mapMode);

        appState.mapInitialized = true;
        console.log('[WalkNav] Map initialized');

    } catch (e) {
        console.error('[WalkNav] Map initialization failed:', e);
        alert('地図の読み込みに失敗しました。APIキーの設定を確認してください。');
    }
}

function setUserMarker(lat, lng) {
    appState.currentPos = {
        lat,
        lng
    };
    if (!appState.map) return;

    if (!appState.userMarker) {
        const pin = document.createElement('div');
        pin.style.width = '32px';
        pin.style.height = '32px';
        pin.innerHTML = ` <svg id="user-marker-icon" viewBox="0 0 24 24"  style="width: 100%; height: 100%; transform: rotate(${appState.currentHeading}deg); transition: transform 0.2s ease-out; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4));"> <path d="M12 2L4.5 20.5L12 16.5L19.5 20.5L12 2Z" fill="#3aa0ff" stroke="#ffffff" stroke-width="2" stroke-linejoin="round" /> </svg>`;

        try {
            appState.userMarker = new google.maps.marker.AdvancedMarkerElement({
                map: appState.map,
                position: {
                    lat,
                    lng
                },
                content: pin,
                zIndex: 1000
            });
        } catch (e) {
            appState.userMarker = new google.maps.Marker({
                map: appState.map,
                position: {
                    lat,
                    lng
                }
            });
        }

    } else {
        appState.userMarker.position = {
            lat,
            lng
        };
    }
}

function setSearchPoint(lat, lng) {
    appState.searchPoint = {
        lat,
        lng
    };
    if (appState.searchPointMarker) appState.searchPointMarker.map = null;

    const pin = document.createElement('div');
    pin.style.width = '30px';
    pin.style.height = '30px';
    pin.style.borderRadius = '50% 50% 50% 0';
    pin.style.background = '#ff6565';
    pin.style.border = '3px solid #fff';
    pin.style.transform = 'rotate(-45deg)';
    pin.style.boxShadow = '0 4px 4px rgba(0,0,0,.3)';

    try {
        appState.searchPointMarker = new google.maps.marker.AdvancedMarkerElement({
            map: appState.map,
            position: {
                lat,
                lng
            },
            content: pin,
            zIndex: 999
        });
    } catch (e) {
        appState.searchPointMarker = new google.maps.Marker({
            map: appState.map,
            position: {
                lat,
                lng
            },
            label: 'Target'
        });
    }
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
    return leg?.localizedValues?.distance?.text || '–';
}

function readLegDurationText(leg) {
    if (leg?.duration?.text) return leg.duration.text;
    if (typeof leg?.duration === 'string' && leg.duration.endsWith('s')) {
        const min = Math.max(1, Math.round(parseInt(leg.duration) / 60));
        return `${min} 分`;
    }
    return leg?.localizedValues?.duration?.text || '–';
}

function drawRoutePolyline(route) {
    if (appState.currentPolyline) {
        appState.currentPolyline.setMap(null);
        appState.currentPolyline = null;
    }
    let encoded = route?.overview_polyline?.points || route?.polyline?.encodedPolyline || route?.overviewPolyline?.encodedPolyline;
    if (!encoded) return;

    const path = google.maps.geometry.encoding.decodePath(encoded);
    appState.currentPolyline = new google.maps.Polyline({
        path: path,
        geodesic: true,
        strokeColor: '#62b5ff',
        strokeOpacity: 0.8,
        strokeWeight: 6,
        map: appState.map
    });
}

function startCompassListener() {
    if (!window.DeviceOrientationEvent) return;
    const handler = (event) => {
        if (appState.isNavigating) return;
        let heading = event.webkitCompassHeading || (event.absolute ? event.alpha : null);
        if (heading !== null) {
            appState.currentHeading = heading;
            const icon = getEl('user-marker-icon');
            if (icon) icon.style.transform = `rotate(${heading}deg)`;
        }
    };
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission().then(state => {
            if (state === 'granted') {
                window.addEventListener('deviceorientation', handler, true);
                appState.compassWatchId = 1;
            }
        }).catch(console.error);
    } else {
        window.addEventListener('deviceorientationabsolute', handler, true);
        window.addEventListener('deviceorientation', handler, true);
        appState.compassWatchId = 1;
    }
}

function stopCompassListener() {
    if (appState.compassWatchId) {
        appState.compassWatchId = null;
    }
}

function startLocationWatcher() {
    if (appState.locationWatchId) navigator.geolocation.clearWatch(appState.locationWatchId);
    appState.locationWatchId = navigator.geolocation.watchPosition(
        (pos) => {
            const {
                latitude,
                longitude
            } = pos.coords;
            setUserMarker(latitude, longitude);
            if (appState.isNavigating && !appState.isPaused && appState.map) {
                appState.map.panTo({
                    lat: latitude,
                    lng: longitude
                });
            }
        },
        (e) => console.error(e),
        LOCATION_OPTIONS
    );
}

function stopLocationWatcher() {
    if (appState.locationWatchId) {
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
    } else if (appState.currentPos) {
        originLat = appState.currentPos.lat;
        originLng = appState.currentPos.lng;
        appState.isSimulation = false;
    } else {
        alert('起点が取得できません');
        return;
    }

    appState.currentDestination = destination;
    appState.isNavigating = true;
    appState.isPaused = false;

    setDisplay('searchPanel', 'block');
    setDisplay('fabStack', 'flex');
    switchPanelTab('nav');
    setDisplay('routeControlSection', 'block');

    try {
        const response = await fetchWithRetry(`${WORKER_ORIGIN}/directions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                origin: `${originLat},${originLng}`,
                destination: `${destination.lat},${destination.lng}`,
                mode: 'walking',
                language: 'ja'
            })
        });
        if (!response.ok) throw new Error('Route API Error');
        const result = await response.json();


        if (result.routes && result.routes.length > 0) {
            const r0 = result.routes[0];
            const l0 = r0.legs ? r0.legs[0] : null;

            setText('destinationName', destination.name);
            setText('routeDistance', readLegDistanceText(l0));
            setText('routeTime', `徒歩 ${readLegDurationText(l0)}`);

            setDisplay('routeInfoSection', 'block');
            setDisplay('results', 'none');
            setDisplay('btnDestination', 'flex');

            const list = getEl('navPanelInstructions');
            if (list && l0.steps) {
                list.innerHTML = '';
                l0.steps.forEach(step => {
                    const d = document.createElement('div');
                    d.className = 'nav-instruction-item';
                    d.textContent = `${step.html_instructions.replace(/<[^>]+>/g,' ')} (${step.distance.text})`;
                    list.appendChild(d);
                });
            }
            setDisplay('instructionsSection', 'block');
            appState.currentRouteData = {
                destinationName: destination.name,
                summary: r0.summary
            };

            if (!appState.isSimulation) startLocationWatcher();
            drawRoutePolyline(r0);

            const bounds = new google.maps.LatLngBounds();
            bounds.extend({
                lat: originLat,
                lng: originLng
            });
            bounds.extend({
                lat: destination.lat,
                lng: destination.lng
            });
            appState.map.fitBounds(bounds, {
                padding: 50
            });

        } else {
            alert('ルートが見つかりませんでした');
            stopNavigation();
        }

    } catch (e) {
        console.error(e);
        alert('ルート検索エラー');
        stopNavigation();
    }
}

function stopNavigation() {
    stopLocationWatcher();
    appState.isNavigating = false;
    appState.currentPolyline?.setMap(null);

    setDisplay('routeInfoSection', 'none');
    setDisplay('instructionsSection', 'none');
    setDisplay('routeControlSection', 'none');
    setDisplay('btnDestination', 'none');
    setDisplay('fabStack', 'none');
    setDisplay('btnSearch', 'flex');

    getEl('q').value = '';
    getEl('results').innerHTML = '';
    setDisplay('results', 'none');

    switchPanelTab('search');
    if (appState.currentPos) {
        appState.map.panTo(appState.currentPos);
        appState.map.setZoom(17);
    }
}

function acquireLocation() {
    const onSuccess = (pos) => {
        const {
            latitude,
            longitude
        } = pos.coords;
        const loadingEl = getEl('loading');
        if (loadingEl) loadingEl.remove();

        if (!appState.mapInitialized) {
            initMap({
                lat: latitude,
                lng: longitude
            });
        } else {
            appState.map.setCenter({
                lat: latitude,
                lng: longitude
            });
        }
        setUserMarker(latitude, longitude);
        fetchLocationNameGoogle(latitude, longitude);

    };

    const onError = (error) => {
        console.warn('[WalkNav] Geolocation error:', error);
        const loadingEl = getEl('loading');
        if (loadingEl) loadingEl.remove();

        const defaultPos = {
            lat: 34.0344,
            lng: 134.0577
        };

        if (!appState.mapInitialized) {
            initMap(defaultPos);
        }
        setText('locAddress', '現在地取得失敗 (つるぎ町を表示)');
        setText('locCoords', 'GPSエラー');

    };

    if (!navigator.geolocation) {
        onError('Geolocation not supported');
        return;
    }
    try {
        navigator.geolocation.getCurrentPosition(onSuccess, onError, LOCATION_OPTIONS);
    } catch (e) {
        onError(e);
    }
}

async function fetchLocationNameGoogle(lat, lng) {
    setText('locCoords', `Lat: ${lat.toFixed(5)} / Lng: ${lng.toFixed(5)}`);
    try {
        const res = await fetchWithRetry(`${WORKER_ORIGIN}/geocode`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                latlng: {
                    lat,
                    lng
                },
                language: 'ja'
            })
        });
        const data = await res.json();
        if (data.results?.[0]) {
            setText('locAddress', data.results[0].formatted_address.replace(/^日本、\s*/, ''));
        }
    } catch (e) {
        console.error(e);
    }
}

async function fetchPointAddress(lat, lng) {
    setText('pointAddress', '取得中...');
    setDisplay('pointAddressBlock', 'flex');
    setText('pointCoords', `Lat: ${lat.toFixed(5)}`);
    try {
        const res = await fetchWithRetry(`${WORKER_ORIGIN}/geocode`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                latlng: {
                    lat,
                    lng
                },
                language: 'ja'
            })
        });
        const data = await res.json();
        if (data.results?.[0]) {
            setText('pointAddress', data.results[0].formatted_address.replace(/^日本、\s*/, ''));
        }
    } catch (e) {
        setText('pointAddress', '取得エラー');
    }
}

async function performSearch(query) {
    if (!query) return;
    console.log('Search:', query);
    const center = appState.pointSearchMode && appState.searchPoint ?
        appState.searchPoint :
        (appState.currentPos || appState.map.getCenter().toJSON());

    try {
        const data = await placesTextSearch({
            textQuery: query,
            locationBias: {
                circle: {
                    center: {
                        latitude: center.lat,
                        longitude: center.lng
                    },
                    radius: 5000
                }
            },
            languageCode: 'ja'
        }, DEFAULT_MASK);
        const results = data.places || [];
        displayResults(results, center.lat, center.lng);
    } catch (e) {
        console.error(e);
        alert('検索に失敗しました');
    }
}

function displayResults(places, centerLat, centerLng) {
    const resDiv = getEl('results');
    resDiv.innerHTML = '';
    setDisplay('results', 'block');
    setDisplay('instructionsSection', 'none');
    appState.searchMarkers.forEach(m => m.map = null);
    appState.searchMarkers = [];

    places.forEach((p, i) => {
        if (i >= 5) return;
        const lat = p.location.latitude;
        const lng = p.location.longitude;
        const item = document.createElement('div');
        item.className = 'result-item';
        item.innerHTML = `<div>${i+1}. ${p.displayName.text}</div><div style="font-size:0.8em;opacity:0.7">${p.formattedAddress}</div>`;
        item.onclick = () => startNavigation({
            name: p.displayName.text,
            lat,
            lng
        });
        resDiv.appendChild(item);

        const pin = document.createElement('div');
        pin.style.cssText = 'width:24px;height:24px;background:#25d07a;border-radius:50%;color:#fff;text-align:center;line-height:24px;font-size:12px;font-weight:bold;border:2px solid #fff;';
        pin.textContent = i + 1;
        try {
            const m = new google.maps.marker.AdvancedMarkerElement({
                map: appState.map,
                position: {
                    lat,
                    lng
                },
                content: pin,
                title: p.displayName.text
            });
            appState.searchMarkers.push(m);
        } catch (e) {
            const m = new google.maps.Marker({
                map: appState.map,
                position: {
                    lat,
                    lng
                },
                label: (i + 1).toString()
            });
            appState.searchMarkers.push(m);
        }

    });
}

function bindKeyboardWatch() {
    const searchInput = getEl('q');
    const searchPanel = getEl('searchPanel');

    if (!searchInput || !searchPanel) return;

    const adjustPanelPosition = () => {
        if (!window.visualViewport) return;

        const viewportHeight = window.visualViewport.height;
        const windowHeight = window.innerHeight;
        const keyboardHeight = windowHeight - viewportHeight;

        if (keyboardHeight > 150) {
            if (appState.keyboardAdjusted) return;

            searchPanel.style.transform = 'translateY(0)';
            const inputRect = searchInput.getBoundingClientRect();
            const inputBottom = inputRect.bottom;

            const targetY = viewportHeight * 0.4;
            let moveAmount = Math.max(0, inputBottom - targetY);

            const panelHeight = searchPanel.offsetHeight;
            const maxMove = Math.min(panelHeight * 0.3, 200);
            moveAmount = Math.min(moveAmount, maxMove);

            searchPanel.style.transition = 'transform 0.25s ease-out';
            searchPanel.style.transform = `translateY(-${moveAmount}px)`;

            appState.keyboardAdjusted = true;
            console.log(`[Keyboard] Show - keyboard:${keyboardHeight}px, move:${moveAmount}px`);

        } else {
            if (!appState.keyboardAdjusted) return;

            searchPanel.style.transition = 'transform 0.25s ease-out';
            searchPanel.style.transform = 'translateY(0)';

            appState.keyboardAdjusted = false;
            console.log('[Keyboard] Hide');
        }

    };

    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', adjustPanelPosition);
        window.visualViewport.addEventListener('scroll', adjustPanelPosition);
    }

    searchInput.addEventListener('focus', () => {
        setTimeout(adjustPanelPosition, 300);
    });

    searchInput.addEventListener('blur', () => {
        setTimeout(() => {
            if (document.activeElement !== searchInput) {
                searchPanel.style.transition = 'transform 0.25s ease-out';
                searchPanel.style.transform = 'translateY(0)';
                appState.keyboardAdjusted = false;
            }
        }, 100);
    });
}

function bindUI() {
    const btnSearch = getEl('btnSearchIcon');
    const inputQ = getEl('q');
    const btnReset = getEl('btnReset');
    const btnLocate = getEl('btnLocatePanel');
    const btnClose = getEl('btnClosePanel');
    const btnFabSearch = getEl('btnSearch');
    const btnStop = getEl('btnStopRoute');
    const btnSaveLocation = getEl('btnSaveLocation');
    const btnEditLocation = getEl('btnEditLocation');

    bindKeyboardWatch();

    if (btnSearch) btnSearch.onclick = () => performSearch(inputQ.value);
    if (inputQ) inputQ.onkeypress = (e) => {
        if (e.key === 'Enter') performSearch(inputQ.value);
    };

    if (btnReset) btnReset.onclick = () => {
        inputQ.value = '';
        setDisplay('results', 'none');
        appState.pointSearchMode = false;
        const btnP = getEl('btnPointSearch');
        if (btnP) {
            btnP.textContent = '📍 ポイント選択';
            btnP.style.background = '';
            btnP.style.color = '';
        }
    };

    if (btnLocate) btnLocate.onclick = () => acquireLocation();

    if (btnClose) btnClose.onclick = () => {
        setDisplay('searchPanel', 'none');
        setDisplay('fabStack', appState.isNavigating ? 'flex' : 'none');
    };

    if (btnFabSearch) btnFabSearch.onclick = () => {
        setDisplay('searchPanel', 'block');
        setDisplay('fabStack', 'none');
    };

    if (btnStop) btnStop.onclick = stopNavigation;

    if (btnSaveLocation) btnSaveLocation.onclick = showSaveLocationDialog;
    if (btnEditLocation) btnEditLocation.onclick = showEditLocationDialog;

    const btnPoint = getEl('btnPointSearch');
    if (btnPoint) btnPoint.onclick = () => {
        appState.pointSearchMode = !appState.pointSearchMode;
        btnPoint.textContent = appState.pointSearchMode ? '📍 選択中...' : '📍 ポイント選択';
        btnPoint.style.background = appState.pointSearchMode ? '#25d07a' : '';
        btnPoint.style.color = appState.pointSearchMode ? '#fff' : '';
    };

    const btnMapPhoto = getEl('btnMapPhoto');
    const btnMapRoadmap = getEl('btnMapRoadmap');
    const btnMap3D = getEl('btnMap3D');

    if (btnMapPhoto) btnMapPhoto.onclick = () => changeMapMode('photo');
    if (btnMapRoadmap) btnMapRoadmap.onclick = () => changeMapMode('roadmap');
    if (btnMap3D) btnMap3D.onclick = () => changeMapMode('3d');

    const r10 = getEl('r10');
    const r20 = getEl('r20');
    const r30 = getEl('r30');
    if (r10) r10.onclick = () => {
        r10.classList.add('active');
        r20.classList.remove('active');
        r30.classList.remove('active');
        setText('radiusLabel', '10km');
    };
    if (r20) r20.onclick = () => {
        r20.classList.add('active');
        r10.classList.remove('active');
        r30.classList.remove('active');
        setText('radiusLabel', '20km');
    };
    if (r30) r30.onclick = () => {
        r30.classList.add('active');
        r10.classList.remove('active');
        r20.classList.remove('active');
        setText('radiusLabel', '30km');
    };
    
    // [最終修正コードの注入]
    const searchPanel = getEl('searchPanel');
    if (searchPanel) {
        // パネルの横幅をビューポートに強制フィットさせ、はみ出しをゼロにする
        searchPanel.style.maxWidth = '100vw';
        searchPanel.style.paddingLeft = '10px'; // 僅かなパディングで調整
        searchPanel.style.paddingRight = '10px';
        searchPanel.style.boxSizing = 'border-box';
    }
}

function startApp() {
    console.log('[WalkNav] Starting app...');
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

    // setTimeout(unifyTabPaneHeights, 500);
}

function initializeWhenReady() {
    if (typeof google !== 'undefined' && google.maps && google.maps.Map) {
        startApp();
    } else {
        setTimeout(initializeWhenReady, 100);
    }
}

window.addEventListener('DOMContentLoaded', initializeWhenReady);

// END OF FILE
