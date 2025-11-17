/* L001 */ 'use strict';
/* L002 */ const ISSUE_ID = 'idx202511050540';
/* L003 */ const API_KEY = 'AIzaSyBuX-4y1Cgl6jdKcHZWWlsoosDWK_RGqF0';
/* L004 */ const WORKER_ORIGIN = 'https://ors-proxy.miyata-connect-jp.workers.dev';
/* L005 */ const DEFAULT_MASK = 'places.displayName,places.formattedAddress,places.location,places.id,places.types';
/* L006 */ const MAX_RETRY = 3;
/* L007 */ const RETRY_DELAY = 1000;
/* L008 */ 
/* L009 */ const LOCATION_OPTIONS = {
/* L010 */   enableHighAccuracy: true,
/* L011 */   timeout: 30000,
/* L012 */   maximumAge: 0
/* L013 */ };
/* L014 */ 
/* L015 */ const appState = {
/* L016 */   map: null,
/* L017 */   userMarker: null,
/* L018 */   currentPos: null,
/* L019 */   pointSearchMode: false,
/* L020 */   searchPoint: null,
/* L021 */   searchPointMarker: null,
/* L022 */   mapInitialized: false,
/* L023 */   searchMarkers: [],
/* L024 */   currentDestination: null,
/* L025 */   currentPolyline: null,
/* L026 */   recognition: null,
/* L027 */   isPaused: false,
/* L028 */   isNavigating: false,
/* L029 */   locationWatchId: null,
/* L030 */   compassWatchId: null,
/* L031 */   currentHeading: 0,
/* L032 */   isSimulation: false,
/* L033 */   currentRouteData: null
/* L034 */ };
/* L035 */ 
/* L036 */ function switchPanelTab(mode) {
/* L037 */   const isNav = mode === 'nav';
/* L038 */   const isSettings = mode === 'settings';
/* L039 */ 
/* L040 */   const paneSearch = document.getElementById('tabPaneSearch');
/* L041 */   const paneNav = document.getElementById('tabPaneNav');
/* L042 */   const paneSettings = document.getElementById('tabPaneSettings');
/* L043 */ 
/* L044 */   if (paneSearch && paneNav && paneSettings) {
/* L045 */     paneSearch.classList.toggle('active', !isNav && !isSettings);
/* L046 */     paneNav.classList.toggle('active', isNav);
/* L047 */     paneSettings.classList.toggle('active', isSettings);
/* L048 */   }
/* L049 */ 
/* L050 */   const target = isSettings ? 'settings' : (isNav ? 'nav' : 'search');
/* L051 */   document.querySelectorAll('[data-panel-tab]').forEach(btn => {
/* L052 */     const active = btn.dataset.panelTab === target;
/* L053 */     btn.classList.toggle('active', active);
/* L054 */   });
/* L055 */ }
/* L056 */ 
/* L057 */ function updateNavigationUI(isNavigating) {
/* L058 */   const routeInfoSection = document.getElementById('routeInfoSection');
/* L059 */   const incidentSection = document.getElementById('incidentSection');
/* L060 */   const instructionsSection = document.getElementById('instructionsSection');
/* L061 */   const routeControlSection = document.getElementById('routeControlSection');
/* L062 */ 
/* L063 */   if (routeInfoSection) {
/* L064 */     routeInfoSection.style.display = isNavigating ? 'block' : 'none';
/* L065 */   }
/* L066 */   if (instructionsSection) {
/* L067 */     instructionsSection.style.display = isNavigating ? 'block' : 'none';
/* L068 */   }
/* L069 */   if (routeControlSection) {
/* L070 */     routeControlSection.style.display = isNavigating ? 'block' : 'none';
/* L071 */   }
/* L072 */ }
/* L073 */ 
/* L074 */ async function fetchWithRetry(url, options = {}, retries = MAX_RETRY) {
/* L075 */   for (let i = 0; i < retries; i++) {
/* L076 */     try {
/* L077 */       const response = await fetch(url, options);
/* L078 */       if (!response.ok && i < retries - 1) {
/* L079 */         console.log(`[Retry] ${i + 1}/${retries}: ${url}`);
/* L080 */         await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (i + 1)));
/* L081 */         continue;
/* L082 */       }
/* L083 */       return response;
/* L084 */     } catch (error) {
/* L085 */       if (i === retries - 1) throw error;
/* L086 */       console.log(`[Retry] ${i + 1}/${retries}: ${error.message}`);
/* L087 */       await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (i + 1)));
/* L088 */     }
/* L089 */   }
/* L090 */ }
/* L091 */ 
/* L092 */ async function placesTextSearch(payload, fieldMask) {
/* L093 */   try {
/* L094 */     const resp = await fetchWithRetry(`${WORKER_ORIGIN}/places:searchText`, {
/* L095 */       method: 'POST',
/* L096 */       headers: {
/* L097 */         'Content-Type': 'application/json',
/* L098 */         ...(fieldMask ? { 'X-Goog-FieldMask': fieldMask } : {})
/* L099 */       },
/* L100 */       body: JSON.stringify(payload)
/* L101 */     });
/* L102 */ 
/* L103 */     if (!resp.ok) {
/* L104 */       const text = await resp.text();
/* L105 */       throw new Error(`TextSearch ${resp.status}: ${text}`);
/* L106 */     }
/* L107 */     return await resp.json();
/* L108 */   } catch (error) {
/* L109 */     console.error(`検索エラー: ${error.message}`);
/* L110 */     throw error;
/* L111 */   }
/* L112 */ }
/* L113 */ 
/* L114 */ async function placesNearby(payload, fieldMask) {
/* L115 */   try {
/* L116 */     const resp = await fetchWithRetry(`${WORKER_ORIGIN}/places:searchNearby`, {
/* L117 */       method: 'POST',
/* L118 */       headers: {
/* L119 */         'Content-Type': 'application/json',
/* L120 */         ...(fieldMask ? { 'X-Goog-FieldMask': fieldMask } : {})
/* L121 */       },
/* L122 */       body: JSON.stringify(payload)
/* L123 */     });
/* L124 */ 
/* L125 */     if (!resp.ok) {
/* L126 */       const text = await resp.text();
/* L127 */       throw new Error(`Nearby ${resp.status}: ${text}`);
/* L128 */     }
/* L129 */     return await resp.json();
/* L130 */   } catch (error) {
/* L131 */     console.error(`検索エラー: ${error.message}`);
/* L132 */     throw error;
/* L133 */   }
/* L134 */ }
/* L135 */ 
/* L136 */ function initMap(center) {
/* L137 */   if (!appState.map) {
/* L138 */     appState.map = new google.maps.Map(document.getElementById('map'), {
/* L139 */       center,
/* L140 */       zoom: 17,
/* L141 */       mapId: 'DEMO_MAP',
/* L142 */       gestureHandling: 'greedy',
/* L143 */       clickableIcons: true,
/* L144 */       disableDefaultUI: true
/* L145 */     });
/* L146 */ 
/* L147 */     appState.map.addListener('click', (e) => {
/* L148 */       if (!appState.pointSearchMode) return;
/* L149 */       if (e.latLng) {
/* L150 */         setSearchPoint(e.latLng.lat(), e.latLng.lng());
/* L151 */       }
/* L152 */     });
/* L153 */ 
/* L154 */     console.log('[WalkNav] Map initialized');
/* L155 */   } else {
/* L156 */     appState.map.setCenter(center);
/* L157 */     console.log('[WalkNav] Map center updated');
/* L158 */   }
/* L159 */ 
/* L160 */   appState.mapInitialized = true;
/* L161 */ }
/* L162 */ 
/* L163 */ function setUserMarker(lat, lng) {
/* L164 */   appState.currentPos = { lat, lng };
/* L165 */ 
/* L166 */   if (!appState.userMarker) {
/* L167 */     const pin = document.createElement('div');
/* L168 */     pin.style.width = '32px';
/* L169 */     pin.style.height = '32px';
/* L170 */     pin.innerHTML = `
/* L171 */       <svg id="user-marker-icon" viewBox="0 0 24 24" 
/* L172 */             style="width: 100%; height: 100%;
/* L173 */                    transform: rotate(${appState.currentHeading}deg);
/* L174 */                    transition: transform 0.2s ease-out;
/* L175 */                    filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4));">
/* L176 */         <path d="M12 2L4.5 20.5L12 16.5L19.5 20.5L12 2Z"
/* L177 */               fill="#3aa0ff"
/* L178 */               stroke="#ffffff"
/* L179 */               stroke-width="2"
/* L180 */               stroke-linejoin="round" />
/* L181 */       </svg>
/* L182 */     `;
/* L183 */ 
/* L184 */     appState.userMarker = new google.maps.marker.AdvancedMarkerElement({
/* L185 */       map: appState.map,
/* L186 */       position: { lat, lng },
/* L187 */       content: pin,
/* L188 */       zIndex: 1000
/* L189 */     });
/* L190 */   } else {
/* L191 */     appState.userMarker.position = { lat, lng };
/* L192 */   }
/* L193 */ }
/* L194 */ 
/* L195 */ function setSearchPoint(lat, lng) {
/* L196 */   appState.searchPoint = { lat, lng };
/* L197 */ 
/* L198 */   if (appState.searchPointMarker) {
/* L199 */     appState.searchPointMarker.map = null;
/* L200 */   }
/* L201 */ 
/* L202 */   const pin = document.createElement('div');
/* L203 */   pin.style.width = '30px';
/* L204 */   pin.style.height = '30px';
/* L205 */   pin.style.borderRadius = '50% 50% 50% 0';
/* L206 */   pin.style.background = '#ff6565';
/* L207 */   pin.style.border = '3px solid #fff';
/* L208 */   pin.style.transform = 'rotate(-45deg)';
/* L209 */   pin.style.boxShadow = '0 4px 8px rgba(0,0,0,.3)';
/* L210 */   pin.style.transition = 'all 0.3s ease-out';
/* L211 */ 
/* L212 */   appState.searchPointMarker = new google.maps.marker.AdvancedMarkerElement({
/* L213 */     map: appState.map,
/* L214 */     position: { lat, lng },
/* L215 */     content: pin,
/* L216 */     zIndex: 999
/* L217 */   });
/* L218 */ 
/* L219 */   console.log(`[WalkNav] 検索地点設定: ${lat.toFixed(6)}, ${lng.toFixed(6)}`);
/* L220 */   console.log('検索地点を設定しました');
/* L221 */ 
/* L222 */   fetchPointAddress(lat, lng);
/* L223 */ }
/* L224 */ 
/* L225 */ function calculateDistance(lat1, lon1, lat2, lon2) {
/* L226 */   const R = 6371000;
/* L227 */   const dLat = (lat2 - lat1) * Math.PI / 180;
/* L228 */   const dLon = (lon2 - lon1) * Math.PI / 180;
/* L229 */ 
/* L230 */   const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
/* L231 */     Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
/* L232 */     Math.sin(dLon / 2) * Math.sin(dLon / 2);
/* L233 */ 
/* L234 */   const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
/* L235 */   return R * c;
/* L236 */ }
/* L237 */ 
/* L238 */ function readLegDistanceText(leg) {
/* L239 */   if (leg?.distance?.text) return leg.distance.text;
/* L240 */   if (typeof leg?.distanceMeters === 'number') {
/* L241 */     const km = (leg.distanceMeters / 1000).toFixed(1);
/* L242 */     return `${km} km`;
/* L243 */   }
/* L244 */   return leg?.localizedValues?.distance?.text || '--';
/* L245 */ }
/* L246 */ 
/* L247 */ function readLegDurationText(leg) {
/* L248 */   if (leg?.duration?.text) return leg.duration.text;
/* L249 */ 
/* L250 */   if (typeof leg?.duration === 'string' && leg.duration.endsWith('s')) {
/* L251 */     const sec = parseInt(leg.duration.replace('s', ''), 10) || 0;
/* L252 */     const min = Math.max(1, Math.round(sec / 60));
/* L253 */     return `${min} 分`;
/* L254 */   }
/* L255 */   return leg?.localizedValues?.duration?.text || '--';
/* L256 */ }
/* L257 */ 
/* L258 */ function getEncodedPolylineFromRoute(route) {
/* L259 */   if (route?.overview_polyline?.points) return route.overview_polyline.points;
/* L260 */   if (route?.polyline?.encodedPolyline) return route.polyline.encodedPolyline;
/* L261 */   if (route?.overviewPolyline?.encodedPolyline) return route.overviewPolyline.encodedPolyline;
/* L262 */   return null;
/* L263 */ }
/* L264 */ 
/* L265 */ function drawRoutePolyline(route) {
/* L266 */   if (appState.currentPolyline) {
/* L267 */     appState.currentPolyline.setMap(null);
/* L268 */     appState.currentPolyline = null;
/* L269 */   }
/* L270 */ 
/* L271 */   const encoded = getEncodedPolylineFromRoute(route);
/* L272 */   if (!encoded) {
/* L273 */     console.error('[Navigation] No encoded polyline found');
/* L274 */     console.error('ルート線の取得に失敗しました');
/* L275 */     return;
/* L276 */   }
/* L277 */ 
/* L278 */   const path = google.maps.geometry.encoding.decodePath(encoded);
/* L279 */   appState.currentPolyline = new google.maps.Polyline({
/* L280 */     path: path,
/* L281 */     geodesic: true,
/* L282 */     strokeColor: '#62b5ff',
/* L283 */     strokeOpacity: 0.8,
/* L284 */     strokeWeight: 6,
/* L285 */     map: appState.map
/* L286 */   });
/* L287 */ 
/* L288 */   console.log('[Navigation] Polyline drawn');
/* L289 */ }
/* L290 */ 
/* L291 */ const compassHandler = (event) => {
/* L292 */   if (appState.isNavigating) return;
/* L293 */ 
/* L294 */   let heading = null;
/* L295 */   if (event.webkitCompassHeading) {
/* L296 */     heading = event.webkitCompassHeading;
/* L297 */   } else if (event.absolute === true && event.alpha !== null) {
/* L298 */     heading = event.alpha;
/* L299 */   }
/* L300 */ 
/* L301 */   if (heading !== null) {
/* L302 */     appState.currentHeading = heading;
/* L303 */     updateMarkerRotation();
/* L304 */   }
/* L305 */ };
/* L306 */ 
/* L307 */ function startCompassListener() {
/* L308 */   if (appState.compassWatchId || !window.DeviceOrientationEvent) {
/* L309 */     if (!window.DeviceOrientationEvent) console.warn('[Compass] DeviceOrientationEvent is not supported.');
/* L310 */     return;
/* L311 */   }
/* L312 */ 
/* L313 */   console.log('[Compass] Starting compass listener...');
/* L314 */ 
/* L315 */   if (typeof DeviceOrientationEvent.requestPermission === 'function') {
/* L316 */     DeviceOrientationEvent.requestPermission()
/* L317 */       .then(permissionState => {
/* L318 */         if (permissionState === 'granted') {
/* L319 */           window.addEventListener('deviceorientationabsolute', compassHandler, true);
/* L320 */           window.addEventListener('deviceorientation', compassHandler, true);
/* L321 */           appState.compassWatchId = 1;
/* L322 */         }
/* L323 */       })
/* L324 */       .catch(console.error);
/* L325 */   } else {
/* L326 */     window.addEventListener('deviceorientationabsolute', compassHandler, true);
/* L327 */     window.addEventListener('deviceorientation', compassHandler, true);
/* L328 */     appState.compassWatchId = 1;
/* L329 */   }
/* L330 */ }
/* L331 */ 
/* L332 */ function stopCompassListener() {
/* L333 */   if (appState.compassWatchId) {
/* L334 */     console.log('[Compass] Stopping compass listener...');
/* L335 */     window.removeEventListener('deviceorientationabsolute', compassHandler, true);
/* L336 */     window.removeEventListener('deviceorientation', compassHandler, true);
/* L337 */     appState.compassWatchId = null;
/* L338 */   }
/* L339 */ }
/* L340 */ 
/* L341 */ function updateMarkerRotation() {
/* L342 */   const icon = document.getElementById('user-marker-icon');
/* L343 */   if (icon) {
/* L344 */     icon.style.transform = `rotate(${appState.currentHeading}deg)`;
/* L345 */   }
/* L346 */ }
/* L347 */ 
/* L348 */ function startLocationWatcher() {
/* L349 */   if (appState.locationWatchId) {
/* L350 */     navigator.geolocation.clearWatch(appState.locationWatchId);
/* L351 */     appState.locationWatchId = null;
/* L352 */   }
/* L353 */ 
/* L354 */   console.log('[Location] Starting watchPosition (Nav Mode)...');
/* L355 */ 
/* L356 */   const onWatchSuccess = (pos) => {
/* L357 */     const { latitude, longitude } = pos.coords;
/* L358 */     console.log(`[Location] Watch update: ${latitude}, ${longitude}`);
/* L359 */ 
/* L360 */     setUserMarker(latitude, longitude);
/* L361 */     fetchLocationNameGoogle(latitude, longitude);
/* L362 */ 
/* L363 */     if (appState.isNavigating && !appState.isPaused) {
/* L364 */       appState.map.panTo({ lat: latitude, lng: longitude });
/* L365 */ 
/* L366 */       if (appState.currentDestination && google.maps.geometry) {
/* L367 */         const currentLatLng = new google.maps.LatLng(latitude, longitude);
/* L368 */         const destLatLng = new google.maps.LatLng(appState.currentDestination.lat, appState.currentDestination.lng);
/* L369 */         let headingDeg = google.maps.geometry.spherical.computeHeading(currentLatLng, destLatLng);
/* L370 */         if (headingDeg < 0) { headingDeg += 360; }
/* L371 */         appState.currentHeading = headingDeg;
/* L372 */         updateMarkerRotation();
/* L373 */       }
/* L374 */     }
/* L375 */   };
/* L376 */ 
/* L377 */   const onWatchError = (error) => {
/* L378 */     console.error('[Location] Watch error:', error.message);
/* L379 */     console.error('リアルタイム位置情報の取得に失敗');
/* L380 */     stopLocationWatcher();
/* L381 */   };
/* L382 */ 
/* L383 */   appState.locationWatchId = navigator.geolocation.watchPosition(
/* L384 */     onWatchSuccess,
/* L385 */     onWatchError,
/* L386 */     LOCATION_OPTIONS
/* L387 */   );
/* L388 */ }
/* L389 */ 
/* L390 */ function stopLocationWatcher() {
/* L391 */   if (appState.locationWatchId) {
/* L392 */     console.log('[Location] Stopping watchPosition (Nav Mode)...');
/* L393 */     navigator.geolocation.clearWatch(appState.locationWatchId);
/* L394 */     appState.locationWatchId = null;
/* L395 */   }
/* L396 */ }
/* L397 */ 
/* L398 */ async function startNavigation(destination) {
/* L399 */   let originLat, originLng;
/* L400 */ 
/* L401 */   if (appState.pointSearchMode && appState.searchPoint) {
/* L402 */     originLat = appState.searchPoint.lat;
/* L403 */     originLng = appState.searchPoint.lng;
/* L404 */     appState.isSimulation = true;
/* L405 */     console.log('[Navigation] シミュレーションモードで開始');
/* L406 */   } else if (appState.currentPos) {
/* L407 */     originLat = appState.currentPos.lat;
/* L408 */     originLng = appState.currentPos.lng;
/* L409 */     appState.isSimulation = false;
/* L410 */     console.log('[Navigation] リアルタイムモードで開始');
/* L411 */   } else {
/* L412 */     console.error('起点が設定されていません');
/* L413 */     return;
/* L414 */   }
/* L415 */ 
/* L416 */   appState.currentDestination = destination;
/* L417 */   appState.isNavigating = true;
/* L418 */   appState.isPaused = false;
/* L419 */ 
/* L420 */   const searchPanelEl = document.getElementById('searchPanel');
/* L421 */   const fabStackEl = document.getElementById('fabStack');
/* L422 */   const appBodyEl = document.getElementById('appBody');
/* L423 */ 
/* L424 */   if (searchPanelEl) searchPanelEl.style.display = 'block';
/* L425 */   if (fabStackEl) fabStackEl.style.display = 'flex';
/* L426 */   if (appBodyEl) appBodyEl.classList.add('panel-open');
/* L427 */ 
/* L428 */   switchPanelTab('nav');
/* L429 */   updateNavigationUI(true);
/* L430 */   stopCompassListener();
/* L431 */ 
/* L432 */   try {
/* L433 */     console.log('ルートを取得中...');
/* L434 */     const response = await fetchWithRetry(`${WORKER_ORIGIN}/directions`, {
/* L435 */       method: 'POST',
/* L436 */       headers: { 'Content-Type': 'application/json' },
/* L437 */       body: JSON.stringify({
/* L438 */         origin: `${originLat},${originLng}`,
/* L439 */         destination: `${destination.lat},${destination.lng}`,
/* L440 */         mode: 'walking',
/* L441 */         language: 'ja'
/* L442 */       })
/* L443 */     });
/* L444 */ 
/* L445 */     if (!response.ok) {
/* L446 */       const errorText = await response.text();
/* L447 */       throw new Error(`Directions API Error: ${response.status} - ${errorText}`);
/* L448 */     }
/* L449 */ 
/* L450 */     const result = await response.json();
/* L451 */     console.log('[Navigation] Directions Response:', result);
/* L452 */ 
/* L453 */     if (result.routes && result.routes.length > 0) {
/* L454 */       const r0 = result.routes[0];
/* L455 */       const l0 = (r0.legs && r0.legs[0]) ? r0.legs[0] : null;
/* L456 */ 
/* L457 */       const distanceText = l0 ? readLegDistanceText(l0) : '--';
/* L458 */       const durationText = l0 ? readLegDurationText(l0) : '--';
/* L459 */ 
/* L460 */       const destNameEl = document.getElementById('destinationName');
/* L461 */       const routeDistEl = document.getElementById('routeDistance');
/* L462 */       const routeTimeEl = document.getElementById('routeTime');
/* L463 */       const resultsEl = document.getElementById('results');
/* L464 */       const btnDestEl = document.getElementById('btnDestination');
/* L465 */ 
/* L466 */       if (destNameEl) destNameEl.textContent = destination.name;
/* L467 */       if (routeDistEl) routeDistEl.textContent = distanceText;
/* L468 */       if (routeTimeEl) routeTimeEl.textContent = `徒歩 ${durationText}`;
/* L469 */       if (searchPanelEl) searchPanelEl.style.display = 'block';
/* L470 */       if (resultsEl) resultsEl.style.display = 'none';
/* L471 */       if (btnDestEl) btnDestEl.style.display = 'flex';
/* L472 */ 
/* L473 */       const instructionsList = document.getElementById('navPanelInstructions');
/* L474 */       if (instructionsList) {
/* L475 */         instructionsList.innerHTML = '';
/* L476 */         if (l0 && l0.steps && l0.steps.length > 0) {
/* L477 */           l0.steps.forEach(step => {
/* L478 */             const item = document.createElement('div');
/* L479 */             item.className = 'nav-instruction-item';
/* L480 */             const cleanInstruction = (step.html_instructions || '').replace(/<[^>]+>/g, ' ');
/* L481 */             item.textContent = `${cleanInstruction} (${step.distance.text})`;
/* L482 */             instructionsList.appendChild(item);
/* L483 */           });
/* L484 */         }
/* L485 */       }
/* L486 */ 
/* L487 */       appState.currentRouteData = {
/* L488 */         steps: l0?.steps,
/* L489 */         summary: r0.summary,
/* L490 */         distance: distanceText,
/* L491 */         duration: durationText,
/* L492 */         destinationName: destination.name,
/* L493 */         warnings: r0.warnings || []
/* L494 */       };
/* L495 */ 
/* L496 */       const incidentSection = document.getElementById('incidentSection');
/* L497 */       const incidentText = document.getElementById('incidentText');
/* L498 */       if (r0.warnings && r0.warnings.length > 0 && incidentSection && incidentText) {
/* L499 */         incidentText.innerHTML = r0.warnings.map(w => w.replace(/<[^>]+>/g, ' ')).join('<br>');
/* L500 */         incidentSection.style.display = 'block';
/* L501 */       } else if (incidentSection) {
/* L502 */         incidentSection.style.display = 'none';
/* L503 */       }
/* L504 */ 
/* L505 */       await fetchWeather(originLat, originLng);
/* L506 */ 
/* L507 */       if (appState.isSimulation) {
/* L508 */         setUserMarker(originLat, originLng);
/* L509 */         fetchLocationNameGoogle(originLat, originLng);
/* L510 */ 
/* L511 */         if (appState.currentDestination && google.maps.geometry) {
/* L512 */           const currentLatLng = new google.maps.LatLng(originLat, originLng);
/* L513 */           const destLatLng = new google.maps.LatLng(appState.currentDestination.lat, appState.currentDestination.lng);
/* L514 */           let headingDeg = google.maps.geometry.spherical.computeHeading(currentLatLng, destLatLng);
/* L515 */           if (headingDeg < 0) { headingDeg += 360; }
/* L516 */           appState.currentHeading = headingDeg;
/* L517 */           updateMarkerRotation();
/* L518 */         }
/* L519 */       } else {
/* L520 */         startLocationWatcher();
/* L521 */       }
/* L522 */ 
/* L523 */       drawRoutePolyline(r0);
/* L524 */ 
/* L525 */       const bounds = new google.maps.LatLngBounds();
/* L526 */       bounds.extend(new google.maps.LatLng(originLat, originLng));
/* L527 */       bounds.extend(new google.maps.LatLng(destination.lat, destination.lng));
/* L528 */       appState.map.fitBounds(bounds, { top: 100, right: 150, bottom: 300, left: 50 });
/* L529 */ 
/* L530 */       setTimeout(() => {
/* L531 */         appState.map.panTo({ lat: destination.lat, lng: destination.lng });
/* L532 */         appState.map.setZoom(18);
/* L533 */         setTimeout(() => {
/* L534 */           appState.map.panTo({ lat: originLat, lng: originLng });
/* L535 */           appState.map.setZoom(18);
/* L536 */         }, 2000);
/* L537 */       }, 2000);
/* L538 */ 
/* L539 */       console.log(`${destination.name} へのルート案内を開始`);
/* L540 */       console.log(`[Navigation] ルート案内開始: ${destination.name}`);
/* L541 */     } else {
/* L542 */       throw new Error('ルートが取得できませんでした');
/* L543 */     }
/* L544 */   } catch (error) {
/* L545 */     console.error('[Navigation] Error:', error);
/* L546 */     console.error(`ルートエラー: ${error.message}`);
/* L547 */     appState.isNavigating = false;
/* L548 */     appState.isSimulation = false;
/* L549 */     updateNavigationUI(false);
/* L550 */     if (fabStackEl) fabStackEl.style.display = 'none';
/* L551 */     startCompassListener();
/* L552 */   }
/* L553 */ }
/* L554 */ 
/* L555 */ function stopNavigation() {
/* L556 */   stopLocationWatcher();
/* L557 */   startCompassListener();
/* L558 */ 
/* L559 */   appState.isSimulation = false;
/* L560 */   appState.currentRouteData = null;
/* L561 */ 
/* L562 */   if (appState.currentPolyline) {
/* L563 */     appState.currentPolyline.setMap(null);
/* L564 */     appState.currentPolyline = null;
/* L565 */   }
/* L566 */ 
/* L567 */   appState.currentDestination = null;
/* L568 */   appState.isNavigating = false;
/* L569 */   appState.isPaused = false;
/* L570 */ 
/* L571 */   updateNavigationUI(false);
/* L572 */ 
/* L573 */   const instructionsList = document.getElementById('navPanelInstructions');
/* L574 */   if (instructionsList) instructionsList.innerHTML = '';
/* L575 */ 
/* L576 */   const incidentSection = document.getElementById('incidentSection');
/* L577 */   if (incidentSection) incidentSection.style.display = 'none';
/* L578 */ 
/* L579 */   const searchPanel = document.getElementById('searchPanel');
/* L580 */   const btnDestination = document.getElementById('btnDestination');
/* L581 */   const qInput = document.getElementById('q');
/* L582 */   const results = document.getElementById('results');
/* L583 */ 
/* L584 */   if (searchPanel) searchPanel.style.display = 'block';
/* L585 */   if (btnDestination) btnDestination.style.display = 'none';
/* L586 */   if (qInput) qInput.value = '';
/* L587 */   if (results) {
/* L588 */     results.style.display = 'none';
/* L589 */     results.innerHTML = '';
/* L590 */   }
/* L591 */ 
/* L592 */   const weather3h = document.getElementById('weather3h');
/* L593 */   const weather6h = document.getElementById('weather6h');
/* L594 */   const weather9h = document.getElementById('weather9h');
/* L595 */   if (weather3h) weather3h.textContent = '--';
/* L596 */   if (weather6h) weather6h.textContent = '--';
/* L597 */   if (weather9h) weather9h.textContent = '--';
/* L598 */ 
/* L599 */   const fabStack = document.getElementById('fabStack');
/* L600 */   const btnSearch = document.getElementById('btnSearch');
/* L601 */   if (fabStack) fabStack.style.display = 'none';
/* L602 */   if (btnSearch) btnSearch.style.display = 'flex';
/* L603 */ 
/* L604 */   const btnPauseSettings = document.getElementById('btnPauseSettings');
/* L605 */   if (btnPauseSettings) {
/* L606 */     btnPauseSettings.textContent = '⏸️ 一時停止';
/* L607 */     btnPauseSettings.classList.remove('paused');
/* L608 */   }
/* L609 */ 
/* L610 */   appState.searchMarkers.forEach(marker => marker.map = null);
/* L611 */   appState.searchMarkers = [];
/* L612 */ 
/* L613 */   if (appState.currentPos && appState.map) {
/* L614 */     appState.map.panTo(appState.currentPos);
/* L615 */     appState.map.setZoom(17);
/* L616 */   }
/* L617 */ 
/* L618 */   updateMarkerRotation();
/* L619 */ 
/* L620 */   const appBody = document.getElementById('appBody');
/* L621 */   if (appBody) appBody.classList.add('panel-open');
/* L622 */ 
/* L623 */   switchPanelTab('search');
/* L624 */   console.log('ルート案内を終了しました');
/* L625 */   console.log('[Navigation] ルート案内終了');
/* L626 */ }
/* L627 */ 
/* L628 */ function togglePause() {
/* L629 */   if (appState.isSimulation) {
/* L630 */     console.warn('シミュレーション中は一時停止できません');
/* L631 */     return;
/* L632 */   }
/* L633 */   if (!appState.isNavigating) {
/* L634 */     console.warn('ナビゲーション中ではありません');
/* L635 */     return;
/* L636 */   }
/* L637 */ 
/* L638 */   appState.isPaused = !appState.isPaused;
/* L639 */   const btnPauseSettings = document.getElementById('btnPauseSettings');
/* L640 */ 
/* L641 */   if (appState.isPaused) {
/* L642 */     if (btnPauseSettings) {
/* L643 */       btnPauseSettings.textContent = '▶️ 再開';
/* L644 */       btnPauseSettings.classList.add('paused');
/* L645 */     }
/* L646 */     console.warn('ナビゲーションを一時停止しました');
/* L647 */     console.log('[Navigation] 一時停止');
/* L648 */   } else {
/* L649 */     if (btnPauseSettings) {
/* L650 */       btnPauseSettings.textContent = '⏸️ 一時停止';
/* L651 */       btnPauseSettings.classList.remove('paused');
/* L652 */     }
/* L653 */     console.log('ナビゲーションを再開しました');
/* L654 */     console.log('[Navigation] 再開');
/* L655 */     if (appState.currentPos) {
/* L656 */       appState.map.panTo(appState.currentPos);
/* L657 */       appState.map.setZoom(18);
/* L658 */     }
/* L659 */   }
/* L660 */ }
/* L661 */ 
/* L662 */ const TYPE_MAP = {
/* L663 */   "コンビニ": "convenience_store",
/* L664 */   "スーパー": "supermarket",
/* L665 */   "レストラン": "restaurant",
/* L666 */   "カフェ": "cafe",
/* L667 */   "ホテル": "lodging",
/* L668 */   "病院": "hospital",
/* L669 */   "薬局": "pharmacy",
/* L670 */   "ガソリンスタンド": "gas_station",
/* L671 */   "駐車場": "parking",
/* L672 */   "銀行": "bank"
/* L673 */ };
/* L674 */ 
/* L675 */ async function performSearch(query) {
/* L676 */   if (!query || !query.trim()) {
/* L677 */     console.warn('検索ワードを入力してください');
/* L678 */     return;
/* L679 */   }
/* L680 */ 
/* L681 */   let centerLat, centerLng;
/* L682 */   if (appState.pointSearchMode && appState.searchPoint) {
/* L683 */     centerLat = appState.searchPoint.lat;
/* L684 */     centerLng = appState.searchPoint.lng;
/* L685 */   } else if (appState.currentPos) {
/* L686 */     centerLat = appState.currentPos.lat;
/* L687 */     centerLng = appState.currentPos.lng;
/* L688 */   } else {
/* L689 */     console.error('検索の基準地点が不明です');
/* L690 */     return;
/* L691 */   }
/* L692 */ 
/* L693 */   const radiusLabel = document.getElementById('radiusLabel');
/* L694 */   const radiusKm = radiusLabel ? parseInt(radiusLabel.textContent) : 10;
/* L695 */   const radiusMeters = radiusKm * 1000;
/* L696 */ 
/* L697 */   console.log('検索中...');
/* L698 */ 
/* L699 */   try {
/* L700 */     const data = await placesTextSearch({
/* L701 */       textQuery: query.trim(),
/* L702 */       locationBias: {
/* L703 */         circle: { center: { latitude: centerLat, longitude: centerLng }, radius: radiusMeters }
/* L704 */       },
/* L705 */       maxResultCount: 20,
/* L706 */       languageCode: 'ja'
/* L707 */     }, DEFAULT_MASK);
/* L708 */ 
/* L709 */     if (data.places?.length) {
/* L710 */       displayResults(data.places, centerLat, centerLng);
/* L711 */       return;
/* L712 */     }
/* L713 */   } catch (e) {
/* L714 */     console.error('[Search] Text Search Error:', e);
/* L715 */   }
/* L716 */ 
/* L717 */   const typeKey = TYPE_MAP[query.trim()] || TYPE_MAP[query.trim().replace(/\s/g, '')];
/* L718 */   if (typeKey) {
/* L719 */     try {
/* L720 */       const data = await placesNearby({
/* L721 */         includedTypes: [typeKey],
/* L722 */         maxResultCount: 20,
/* L723 */         locationRestriction: {
/* L724 */           circle: { center: { latitude: centerLat, longitude: centerLng }, radius: radiusMeters }
/* L725 */         },
/* L726 */         languageCode: 'ja'
/* L727 */       }, DEFAULT_MASK);
/* L728 */ 
/* L729 */       if (data.places?.length) {
/* L730 */         displayResults(data.places, centerLat, centerLng);
/* L731 */         return;
/* L732 */       }
/* L733 */     } catch (e) {
/* L734 */       console.error('[Search] Nearby Error:', e);
/* L735 */     }
/* L736 */   }
/* L737 */ 
/* L738 */   console.warn('検索結果が見つかりませんでした');
/* L739 */   const results = document.getElementById('results');
/* L740 */   if (results) results.style.display = 'none';
/* L741 */ }
/* L742 */ 
/* L743 */ function displayResults(places, centerLat, centerLng) {
/* L744 */   appState.searchMarkers.forEach(marker => marker.map = null);
/* L745 */   appState.searchMarkers = [];
/* L746 */ 
/* L747 */   const placesWithDistance = places.map(place => {
/* L748 */     const lat = place.location.latitude;
/* L749 */     const lng = place.location.longitude;
/* L750 */     const distance = calculateDistance(centerLat, centerLng, lat, lng);
/* L751 */     return { ...place, distance };
/* L752 */   });
/* L753 */ 
/* L754 */   placesWithDistance.sort((a, b) => a.distance - b.distance);
/* L755 */   const limitedResults = placesWithDistance.slice(0, 5);
/* L756 */ 
/* L757 */   const resultsDiv = document.getElementById('results');
/* L758 */   if (!resultsDiv) return;
/* L759 */ 
/* L760 */   resultsDiv.innerHTML = '';
/* L761 */   resultsDiv.style.display = 'block';
/* L762 */ 
/* L763 */   limitedResults.forEach((place, index) => {
/* L764 */     const name = place.displayName?.text || place.displayName || '名称不明';
/* L765 */     const address = place.formattedAddress || '住所不明';
/* L766 */     const lat = place.location.latitude;
/* L767 */     const lng = place.location.longitude;
/* L768 */     const distanceKm = (place.distance / 1000).toFixed(2);
/* L769 */ 
/* L770 */     const item = document.createElement('div');
/* L771 */     item.className = 'result-item';
/* L772 */     item.innerHTML = `
/* L773 */       <div class="result-name">${index + 1}. ${name}</div>
/* L774 */       <div class="result-address">${address}</div>
/* L775 */       <div style="font-size:11px;color:#62b5ff;margin-top:4px">
/* L776 */         📍 ${distanceKm}km
/* L777 */       </div>
/* L778 */     `;
/* L779 */ 
/* L780 */     item.onclick = () => {
/* L781 */       startNavigation({
/* L782 */         name: name,
/* L783 */         lat: lat,
/* L784 */         lng: lng
/* L785 */       });
/* L786 */     };
/* L787 */ 
/* L788 */     resultsDiv.appendChild(item);
/* L789 */ 
/* L790 */     const markerPin = document.createElement('div');
/* L791 */     markerPin.style.width = '24px';
/* L792 */     markerPin.style.height = '24px';
/* L793 */     markerPin.style.borderRadius = '50%';
/* L794 */     markerPin.style.background = '#25d07a';
/* L795 */     markerPin.style.border = '2px solid #fff';
/* L796 */     markerPin.style.boxShadow = '0 2px 6px rgba(0,0,0,.3)';
/* L797 */     markerPin.style.display = 'flex';
/* L798 */     markerPin.style.alignItems = 'center';
/* L799 */     markerPin.style.justifyContent = 'center';
/* L800 */     markerPin.style.color = '#fff';
/* L801 */     markerPin.style.fontSize = '12px';
/* L802 */     markerPin.style.fontWeight = 'bold';
/* L803 */     markerPin.textContent = index + 1;
/* L804 */ 
/* L805 */     const marker = new google.maps.marker.AdvancedMarkerElement({
/* L806 */       map: appState.map,
/* L807 */       position: { lat, lng },
/* L808 */       content: markerPin,
/* L809 */       zIndex: 500 + index,
/* L810 */       title: name
/* L811 */     });
/* L812 */ 
/* L813 */     appState.searchMarkers.push(marker);
/* L814 */   });
/* L815 */ 
/* L816 */   console.log(`${limitedResults.length}件の検索結果`);
/* L817 */   console.log(`[Search] ${limitedResults.length}件の結果を表示しました`);
/* L818 */ }
/* L819 */ 
/* L820 */ function initSpeechRecognition() {
/* L821 */   if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
/* L822 */     console.log('[Voice] 音声認識は非対応です');
/* L823 */     return false;
/* L824 */   }
/* L825 */ 
/* L826 */   const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
/* L827 */   appState.recognition = new SpeechRecognition();
/* L828 */   appState.recognition.lang = 'ja-JP';
/* L829 */   appState.recognition.continuous = false;
/* L830 */   appState.recognition.interimResults = false;
/* L831 */ 
/* L832 */   const btnVoiceIcon = document.getElementById('btnVoiceIcon');
/* L833 */ 
/* L834 */   appState.recognition.onstart = () => {
/* L835 */     console.log('[Voice] 音声認識開始');
/* L836 */     if (btnVoiceIcon) btnVoiceIcon.classList.add('recording');
/* L837 */   };
/* L838 */ 
/* L839 */   appState.recognition.onresult = (event) => {
/* L840 */     const transcript = event.results[0][0].transcript;
/* L841 */     console.log('[Voice] 認識結果:', transcript);
/* L842 */     const qInput = document.getElementById('q');
/* L843 */     if (qInput) qInput.value = transcript;
/* L844 */     performSearch(transcript);
/* L845 */     console.log(`音声認識: ${transcript}`);
/* L846 */   };
/* L847 */ 
/* L848 */   appState.recognition.onerror = (event) => {
/* L849 */     console.error('[Voice] エラー:', event.error);
/* L850 */     if (btnVoiceIcon) btnVoiceIcon.classList.remove('recording');
/* L851 */     console.error('音声認識エラーが発生しました');
/* L852 */   };
/* L853 */ 
/* L854 */   appState.recognition.onend = () => {
/* L855 */     console.log('[Voice] 音声認識終了');
/* L856 */     if (btnVoiceIcon) btnVoiceIcon.classList.remove('recording');
/* L857 */   };
/* L858 */ 
/* L859 */   return true;
/* L860 */ }
/* L861 */ 
/* L862 */ function startVoiceSearch() {
/* L863 */   if (!appState.recognition) {
/* L864 */     if (!initSpeechRecognition()) {
/* L865 */       console.error('お使いのブラウザは音声認識に対応していません');
/* L866 */       return;
/* L867 */     }
/* L868 */   }
/* L869 */ 
/* L870 */   try {
/* L871 */     appState.recognition.start();
/* L872 */   } catch (e) {
/* L873 */     console.error('[Voice] 開始エラー:', e);
/* L874 */     appState.recognition.stop();
/* L875 */     setTimeout(() => {
/* L876 */       try {
/* L877 */         appState.recognition.start();
/* L878 */       } catch (e2) {
/* L879 */         console.error('[Voice] 再開エラー:', e2);
/* L880 */         console.error('音声認識の開始に失敗しました');
/* L881 */       }
/* L882 */     }, 100);
/* L883 */   }
/* L884 */ }
/* L885 */ 
/* L886 */ function pickBestGeocodeResult(results) {
/* L887 */   if (!Array.isArray(results) || results.length === 0) return null;
/* L888 */ 
/* L889 */   const priorityTypes = [
/* L890 */     'street_address',
/* L891 */     'premise',
/* L892 */     'subpremise',
/* L893 */     'route',
/* L894 */     'plus_code'
/* L895 */   ];
/* L896 */ 
/* L897 */   for (const t of priorityTypes) {
/* L898 */     const candidate = results.find(r => Array.isArray(r.types) && r.types.includes(t));
/* L899 */     if (candidate && candidate.formatted_address) {
/* L900 */       return candidate;
/* L901 */     }
/* L902 */   }
/* L903 */ 
/* L904 */   return results[0];
/* L905 */ }
/* L906 */ 
/* L907 */ function acquireLocation() {
/* L908 */   const onSuccess = (pos) => {
/* L909 */     const { latitude, longitude } = pos.coords;
/* L910 */     const loadingEl = document.getElementById('loading');
/* L911 */     if (loadingEl) loadingEl.remove();
/* L912 */ 
/* L913 */     if (!appState.mapInitialized) {
/* L914 */       initMap({ lat: latitude, lng: longitude });
/* L915 */     } else {
/* L916 */       appState.map.setCenter({ lat: latitude, lng: longitude });
/* L917 */     }
/* L918 */ 
/* L919 */     setUserMarker(latitude, longitude);
/* L920 */     fetchLocationNameGoogle(latitude, longitude);
/* L921 */     fetchWeather(latitude, longitude);
/* L922 */     console.log('現在地を取得しました');
/* L923 */   };
/* L924 */ 
/* L925 */   const onError = (error) => {
/* L926 */     console.log('[WalkNav] geolocation error', error?.message || error);
/* L927 */     const loadingEl = document.getElementById('loading');
/* L928 */     if (loadingEl) loadingEl.remove();
/* L929 */ 
/* L930 */     if (!appState.mapInitialized) {
/* L931 */       initMap({ lat: 35.0, lng: 135.0 });
/* L932 */     }
/* L933 */ 
/* L934 */     const addressElement = document.getElementById('locAddress');
/* L935 */     const coordsElement = document.getElementById('locCoords');
/* L936 */     if (addressElement) addressElement.textContent = '位置情報を確認できません';
/* L937 */     if (coordsElement) coordsElement.textContent = '現在地：取得失敗';
/* L938 */     console.error('現在地の取得に失敗しました');
/* L939 */   };
/* L940 */ 
/* L941 */   try {
/* L942 */     navigator.geolocation.getCurrentPosition(onSuccess, onError, LOCATION_OPTIONS);
/* L943 */   } catch (e) {
/* L944 */     console.log('[WalkNav] geolocation exception', e);
/* L945 */     console.error('位置情報へのアクセスが拒否されました');
/* L946 */   }
/* L947 */ }
/* L948 */ 
/* L949 */ async function fetchLocationNameGoogle(lat, lng) {
/* L950 */   const addressElement = document.getElementById('locAddress');
/* L951 */   const coordsElement = document.getElementById('locCoords');
/* L952 */   if (!addressElement || !coordsElement) {
/* L953 */     console.error('[DEBUG] Elements not found!');
/* L954 */     return;
/* L955 */   }
/* L956 */ 
/* L957 */   const coordsText = `緯度 ${lat.toFixed(6)} / 経度 ${lng.toFixed(6)}`;
*
