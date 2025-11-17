/* L001 */ 'use strict';
/* L002 */ const ISSUE_ID = 'idx202511050540';
/* L003 */ const WORKER_ORIGIN = 'https://ors-proxy.miyata-connect-jp.workers.dev'; // L003 API_KEY 削除
/* L004 */ const DEFAULT_MASK = 'places.displayName,places.formattedAddress,places.location,places.id,places.types';
/* L005 */ const MAX_RETRY = 3;
/* L006 */ const RETRY_DELAY = 1000;
/* L007 */ 
/* L008 */ const LOCATION_OPTIONS = {
/* L009 */   enableHighAccuracy: true,
/* L010 */   timeout: 30000,
/* L011 */   maximumAge: 0
/* L012 */ };
/* L013 */ 
/* L014 */ const appState = {
/* L015 */   map: null,
/* L016 */   userMarker: null,
/* L017 */   currentPos: null,
/* L018 */   pointSearchMode: false,
/* L019 */   searchPoint: null,
/* L020 */   searchPointMarker: null,
/* L021 */   mapInitialized: false,
/* L022 */   searchMarkers: [],
/* L023 */   currentDestination: null,
/* L024 */   currentPolyline: null,
/* L025 */   recognition: null,
/* L026 */   isPaused: false,
/* L027 */   isNavigating: false,
/* L028 */   locationWatchId: null,
/* L029 */   compassWatchId: null,
/* L030 */   currentHeading: 0,
/* L031 */   isSimulation: false,
/* L032 */   currentRouteData: null
/* L033 */ };
/* L034 */ 
/* L035 */ function switchPanelTab(mode) {
/* L036 */   const isNav = mode === 'nav';
/* L037 */   const isSettings = mode === 'settings';
/* L038 */   const paneSearch = document.getElementById('tabPaneSearch');
/* L039 */   const paneNav = document.getElementById('tabPaneNav');
/* L040 */   const paneSettings = document.getElementById('tabPaneSettings');
/* L041 */   if (paneSearch && paneNav && paneSettings) {
/* L042 */     paneSearch.classList.toggle('active', !isNav && !isSettings);
/* L043 */     paneNav.classList.toggle('active', isNav);
/* L044 */     paneSettings.classList.toggle('active', isSettings);
/* L045 */   }
/* L046 */   const target = isSettings ? 'settings' : (isNav ? 'nav' : 'search');
/* L047 */   document.querySelectorAll('[data-panel-tab]').forEach(btn => {
/* L048 */     const active = btn.dataset.panelTab === target;
/* L049 */     btn.classList.toggle('active', active);
/* L050 */   });
/* L051 */ }
/* L052 */ 
/* L053 */ function updateNavigationUI(isNavigating) {
/* L054 */   const routeInfoSection = document.getElementById('routeInfoSection');
/* L055 */   const incidentSection = document.getElementById('incidentSection');
/* L056 */   const instructionsSection = document.getElementById('instructionsSection');
/* L057 */   const routeControlSection = document.getElementById('routeControlSection');
/* L058 */   if (routeInfoSection) routeInfoSection.style.display = isNavigating ? 'block' : 'none';
/* L059 */   if (instructionsSection) instructionsSection.style.display = isNavigating ? 'block' : 'none';
/* L060 */   if (routeControlSection) routeControlSection.style.display = isNavigating ? 'block' : 'none';
/* L061 */ }
/* L062 */ 
/* L063 */ async function fetchWithRetry(url, options = {}, retries = MAX_RETRY) {
/* L064 */   for (let i = 0; i < retries; i++) {
/* L065 */     try {
/* L066 */       const response = await fetch(url, options);
/* L067 */       if (!response.ok && i < retries - 1) {
/* L068 */         await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (i + 1)));
/* L069 */         continue;
/* L070 */       }
/* L071 */       return response;
/* L072 */     } catch (error) {
/* L073 */       if (i === retries - 1) throw error;
/* L074 */       await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (i + 1)));
/* L075 */     }
/* L076 */   }
/* L077 */ }
/* L078 */ 
/* L079 */ async function placesTextSearch(payload, fieldMask) {
/* L080 */   try {
/* L081 */     const resp = await fetchWithRetry(`${WORKER_ORIGIN}/places:searchText`, {
/* L082 */       method: 'POST',
/* L083 */       headers: {
/* L084 */         'Content-Type': 'application/json',
/* L085 */         ...(fieldMask ? { 'X-Goog-FieldMask': fieldMask } : {})
/* L086 */       },
/* L087 */       body: JSON.stringify(payload)
/* L088 */     });
/* L089 */     if (!resp.ok) {
/* L090 */       const text = await resp.text();
/* L091 */       throw new Error(`TextSearch ${resp.status}: ${text}`);
/* L092 */     }
/* L093 */     return await resp.json();
/* L094 */   } catch (error) {
/* L095 */     throw error;
/* L096 */   }
/* L097 */ }
/* L098 */ 
/* L099 */ async function placesNearby(payload, fieldMask) {
/* L100 */   try {
/* L101 */     const resp = await fetchWithRetry(`${WORKER_ORIGIN}/places:searchNearby`, {
/* L102 */       method: 'POST',
/* L103 */       headers: {
/* L104 */         'Content-Type': 'application/json',
/* L105 */         ...(fieldMask ? { 'X-Goog-FieldMask': fieldMask } : {})
/* L106 */       },
/* L107 */       body: JSON.stringify(payload)
/* L108 */     });
/* L109 */     if (!resp.ok) {
/* L110 */       const text = await resp.text();
/* L111 */       throw new Error(`Nearby ${resp.status}: ${text}`);
/* L112 */     }
/* L113 */     return await resp.json();
/* L114 */   } catch (error) {
/* L115 */     throw error;
/* L116 */   }
/* L117 */ }
/* L118 */ 
/* L119 */ function initMap(center) {
/* L120 */   if (!appState.map) {
/* L121 */     appState.map = new google.maps.Map(document.getElementById('map'), {
/* L122 */       center,
/* L123 */       zoom: 17,
/* L124 */       mapId: '9110fb2763169e9d8f2b317e',
/* L125 */       gestureHandling: 'greedy',
/* L126 */       clickableIcons: true,
/* L127 */       disableDefaultUI: true
/* L128 */     });
/* L129 */     appState.map.addListener('click', (e) => {
/* L130 */       if (!appState.pointSearchMode) return;
/* L131 */       if (e.latLng) {
/* L132 */         setSearchPoint(e.latLng.lat(), e.latLng.lng());
/* L133 */       }
/* L134 */     });
/* L135 */   } else {
/* L136 */     appState.map.setCenter(center);
/* L137 */   }
/* L138 */   appState.mapInitialized = true;
/* L139 */ }
/* L140 */ 
/* L141 */ function setUserMarker(lat, lng) {
/* L142 */   appState.currentPos = { lat, lng };
/* L143 */   if (!appState.userMarker) {
/* L144 */     const pin = document.createElement('div');
/* L145 */     pin.style.width = '32px';
/* L146 */     pin.style.height = '32px';
/* L147 */     pin.innerHTML = `
/* L148 */       <svg id="user-marker-icon" viewBox="0 0 24 24" 
/* L149 */             style="width:100%;height:100%;transform:rotate(${appState.currentHeading}deg);transition:transform 0.2s ease-out;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.4));">
/* L150 */         <path d="M12 2L4.5 20.5L12 16.5L19.5 20.5L12 2Z"
/* L151 */               fill="#3aa0ff" stroke="#ffffff" stroke-width="2" stroke-linejoin="round" />
/* L152 */       </svg>
/* L153 */     `;
/* L154 */     appState.userMarker = new google.maps.marker.AdvancedMarkerElement({
/* L155 */       map: appState.map,
/* L156 */       position: { lat, lng },
/* L157 */       content: pin,
/* L158 */       zIndex: 1000
/* L159 */     });
/* L160 */   } else {
/* L161 */     appState.userMarker.position = { lat, lng };
/* L162 */   }
/* L163 */ }
/* L164 */ 
/* L165 */ function setSearchPoint(lat, lng) {
/* L166 */   appState.searchPoint = { lat, lng };
/* L167 */   if (appState.searchPointMarker) appState.searchPointMarker.map = null;
/* L168 */   const pin = document.createElement('div');
/* L169 */   pin.style.width = '30px';
/* L170 */   pin.style.height = '30px';
/* L171 */   pin.style.borderRadius = '50% 50% 50% 0';
/* L172 */   pin.style.background = '#ff6565';
/* L173 */   pin.style.border = '3px solid #fff';
/* L174 */   pin.style.transform = 'rotate(-45deg)';
/* L175 */   pin.style.boxShadow = '0 4px 8px rgba(0,0,0,.3)';
/* L176 */   pin.style.transition = 'all 0.3s ease-out';
/* L177 */   appState.searchPointMarker = new google.maps.marker.AdvancedMarkerElement({
/* L178 */     map: appState.map,
/* L179 */     position: { lat, lng },
/* L180 */     content: pin,
/* L181 */     zIndex: 999
/* L182 */   });
/* L183 */   fetchPointAddress(lat, lng);
/* L184 */ }
/* L185 */ 
/* L186 */ function calculateDistance(lat1, lon1, lat2, lon2) {
/* L187 */   const R = 6371000;
/* L188 */   const dLat = (lat2 - lat1) * Math.PI / 180;
/* L189 */   const dLon = (lon2 - lon1) * Math.PI / 180;
/* L190 */   const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
/* L191 */     Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
/* L192 */     Math.sin(dLon / 2) * Math.sin(dLon / 2);
/* L193 */   const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
/* L194 */   return R * c;
/* L195 */ }
/* L196 */ 
/* L197 */ function readLegDistanceText(leg) {
/* L198 */   if (leg && leg.distance && leg.distance.text) return leg.distance.text;
/* L199 */   if (leg && typeof leg.distanceMeters === 'number') {
/* L200 */     const km = (leg.distanceMeters / 1000).toFixed(1);
/* L201 */     return `${km} km`;
/* L202 */   }
/* L203 */   if (leg && leg.localizedValues && leg.localizedValues.distance && leg.localizedValues.distance.text) {
/* L204 */     return leg.localizedValues.distance.text;
/* L205 */   }
/* L206 */   return '--';
/* L207 */ }
/* L208 */ 
/* L209 */ function readLegDurationText(leg) {
/* L210 */   if (leg && leg.duration && leg.duration.text) return leg.duration.text;
/* L211 */   if (leg && typeof leg.duration === 'string' && leg.duration.endsWith('s')) {
/* L212 */     const sec = parseInt(leg.duration.replace('s', ''), 10) || 0;
/* L213 */     const min = Math.max(1, Math.round(sec / 60));
/* L214 */     return `${min} 分`;
/* L215 */   }
/* L216 */   if (leg && leg.localizedValues && leg.localizedValues.duration && leg.localizedValues.duration.text) {
/* L217 */     return leg.localizedValues.duration.text;
/* L218 */   }
/* L219 */   return '--';
/* L220 */ }
/* L221 */ 
/* L222 */ function getEncodedPolylineFromRoute(route) {
/* L223 */   if (route && route.overview_polyline && route.overview_polyline.points) return route.overview_polyline.points;
/* L224 */   if (route && route.polyline && route.polyline.encodedPolyline) return route.polyline.encodedPolyline;
/* L225 */   if (route && route.overviewPolyline && route.overviewPolyline.encodedPolyline) return route.overviewPolyline.encodedPolyline;
/* L226 */   return null;
/* L227 */ }
/* L228 */ 
/* L229 */ function drawRoutePolyline(route) {
/* L230 */   if (appState.currentPolyline) {
/* L231 */     appState.currentPolyline.setMap(null);
/* L232 */     appState.currentPolyline = null;
/* L233 */   }
/* L234 */   const encoded = getEncodedPolylineFromRoute(route);
/* L235 */   if (!encoded || !google.maps.geometry || !google.maps.geometry.encoding) return;
/* L236 */   const path = google.maps.geometry.encoding.decodePath(encoded);
/* L237 */   appState.currentPolyline = new google.maps.Polyline({
/* L238 */     path,
/* L239 */     geodesic: true,
/* L240 */     strokeColor: '#62b5ff',
/* L241 */     strokeOpacity: 0.8,
/* L242 */     strokeWeight: 6,
/* L243 */     map: appState.map
/* L244 */   });
/* L245 */ }
/* L246 */ 
/* L247 */ const compassHandler = (event) => {
/* L248 */   if (appState.isNavigating) return;
/* L249 */   let heading = null;
/* L250 */   if (event.webkitCompassHeading) {
/* L251 */     heading = event.webkitCompassHeading;
/* L252 */   } else if (event.absolute === true && event.alpha !== null) {
/* L253 */     heading = event.alpha;
/* L254 */   }
/* L255 */   if (heading !== null) {
/* L256 */     appState.currentHeading = heading;
/* L257 */     updateMarkerRotation();
/* L258 */   }
/* L259 */ };
/* L260 */ 
/* L261 */ function startCompassListener() {
/* L262 */   if (appState.compassWatchId || !window.DeviceOrientationEvent) return;
/* L263 */   if (typeof DeviceOrientationEvent.requestPermission === 'function') {
/* L264 */     DeviceOrientationEvent.requestPermission().then(permissionState => {
/* L265 */       if (permissionState === 'granted') {
/* L266 */         window.addEventListener('deviceorientation', compassHandler, true); // absoluteを削除
/* L267 */         appState.compassWatchId = 1;
/* L268 */       }
/* L269 */     }).catch(() => {});
/* L270 */   } else {
/* L271 */     window.addEventListener('deviceorientation', compassHandler, true); // absoluteを削除
/* L272 */     appState.compassWatchId = 1;
/* L273 */   }
/* L274 */ }
/* L275 */ 
/* L276 */ function stopCompassListener() {
/* L277 */   if (appState.compassWatchId) {
/* L278 */     window.removeEventListener('deviceorientation', compassHandler, true); // absoluteを削除
/* L279 */     appState.compassWatchId = null;
/* L280 */   }
/* L281 */ }
/* L282 */ 
/* L283 */ function updateMarkerRotation() {
/* L284 */   const icon = document.getElementById('user-marker-icon');
/* L285 */   if (icon) icon.style.transform = `rotate(${appState.currentHeading}deg)`;
/* L286 */ }
/* L287 */ 
/* L288 */ function startLocationWatcher() {
/* L289 */   if (appState.locationWatchId) {
/* L290 */     navigator.geolocation.clearWatch(appState.locationWatchId);
/* L291 */     appState.locationWatchId = null;
/* L292 */   }
/* L293 */   const onWatchSuccess = (pos) => {
/* L294 */     const { latitude, longitude } = pos.coords;
/* L295 */     setUserMarker(latitude, longitude);
/* L296 */     fetchLocationNameGoogle(latitude, longitude);
/* L297 */     if (appState.isNavigating && !appState.isPaused) {
/* L298 */       appState.map.panTo({ lat: latitude, lng: longitude });
/* L299 */       if (appState.currentDestination && google.maps.geometry && google.maps.geometry.spherical) {
/* L300 */         const currentLatLng = new google.maps.LatLng(latitude, longitude);
/* L301 */         const destLatLng = new google.maps.LatLng(appState.currentDestination.lat, appState.currentDestination.lng);
/* L302 */         let headingDeg = google.maps.geometry.spherical.computeHeading(currentLatLng, destLatLng);
/* L303 */         if (headingDeg < 0) headingDeg += 360;
/* L304 */         appState.currentHeading = headingDeg;
/* L305 */         updateMarkerRotation();
/* L306 */       }
/* L307 */     }
/* L308 */   };
/* L309 */   const onWatchError = () => {
/* L310 */     stopLocationWatcher();
/* L311 */   };
/* L312 */   appState.locationWatchId = navigator.geolocation.watchPosition(
/* L313 */     onWatchSuccess,
/* L314 */     onWatchError,
/* L315 */     LOCATION_OPTIONS
/* L316 */   );
/* L317 */ }
/* L318 */ 
/* L319 */ function stopLocationWatcher() {
/* L320 */   if (appState.locationWatchId) {
/* L321 */     navigator.geolocation.clearWatch(appState.locationWatchId);
/* L322 */     appState.locationWatchId = null;
/* L323 */   }
/* L324 */ }
/* L325 */ 
/* L326 */ async function startNavigation(destination) {
/* L327 */   let originLat;
/* L328 */   let originLng;
/* L329 */   if (appState.pointSearchMode && appState.searchPoint) {
/* L330 */     originLat = appState.searchPoint.lat;
/* L331 */     originLng = appState.searchPoint.lng;
/* L332 */     appState.isSimulation = true;
/* L333 */   } else if (appState.currentPos) {
/* L334 */     originLat = appState.currentPos.lat;
/* L335 */     originLng = appState.currentPos.lng;
/* L336 */     appState.isSimulation = false;
/* L337 */   } else {
/* L338 */     // 現在地情報なし
/* L339 */     return;
/* L340 */   }
/* L341 */   appState.currentDestination = destination;
/* L342 */   appState.isNavigating = true;
/* L343 */   appState.isPaused = false;
/* L344 */   const searchPanelEl = document.getElementById('searchPanel');
/* L345 */   const fabStackEl = document.getElementById('fabStack');
/* L346 */   const appBodyEl = document.getElementById('appBody');
/* L347 */   const btnSearchEl = document.getElementById('btnSearch'); // ★ 追加
/* L348 */   if (searchPanelEl) searchPanelEl.style.display = 'block';
/* L349 */   if (fabStackEl) fabStackEl.style.display = 'flex';
/* L350 */   if (appBodyEl) appBodyEl.classList.add('panel-open');
/* L351 */   if (btnSearchEl) btnSearchEl.style.display = 'none'; // ★ 追加
/* L352 */   switchPanelTab('nav');
/* L353 */   updateNavigationUI(true);
/* L354 */   stopCompassListener();
/* L355 */   try {
/* L356 */     const response = await fetchWithRetry(`${WORKER_ORIGIN}/directions`, {
/* L357 */       method: 'POST',
/* L358 */       headers: { 'Content-Type': 'application/json' },
/* L359 */       body: JSON.stringify({
/* L360 */         origin: `${originLat},${originLng}`,
/* L361 */         destination: `${destination.lat},${destination.lng}`,
/* L362 */         mode: 'walking',
/* L363 */         language: 'ja'
/* L364 */       })
/* L365 */     });
/* L366 */     if (!response.ok) {
/* L367 */       const errorText = await response.text();
/* L368 */       throw new Error(`Directions API Error: ${response.status} - ${errorText}`);
/* L369 */     }
/* L370 */     const result = await response.json();
/* L371 */     if (result.routes && result.routes.length > 0) {
/* L372 */       const r0 = result.routes[0];
/* L373 */       const l0 = (r0.legs && r0.legs[0]) ? r0.legs[0] : null;
/* L374 */       const distanceText = l0 ? readLegDistanceText(l0) : '--';
/* L375 */       const durationText = l0 ? readLegDurationText(l0) : '--';
/* L376 */       const destNameEl = document.getElementById('destinationName');
/* L377 */       const routeDistEl = document.getElementById('routeDistance');
/* L378 */       const routeTimeEl = document.getElementById('routeTime');
/* L379 */       const resultsEl = document.getElementById('results');
/* L380 */       const btnDestEl = document.getElementById('btnDestination');
/* L381 */       if (destNameEl) destNameEl.textContent = destination.name;
/* L382 */       if (routeDistEl) routeDistEl.textContent = distanceText;
/* L383 */       if (routeTimeEl) routeTimeEl.textContent = `徒歩 ${durationText}`;
/* L384 */       if (searchPanelEl) searchPanelEl.style.display = 'block';
/* L385 */       if (resultsEl) resultsEl.style.display = 'none';
/* L386 */       if (btnDestEl) btnDestEl.style.display = 'flex';
/* L387 */       const instructionsList = document.getElementById('navPanelInstructions');
/* L388 */       if (instructionsList) {
/* L389 */         instructionsList.innerHTML = '';
/* L390 */         if (l0 && l0.steps && l0.steps.length > 0) {
/* L391 */           l0.steps.forEach(step => {
/* L392 */             const item = document.createElement('div');
/* L393 */             item.className = 'nav-instruction-item';
/* L394 */             const cleanInstruction = (step.html_instructions || '').replace(/<[^>]+>/g, ' ');
/* L395 */             item.textContent = `${cleanInstruction} (${step.distance.text})`;
/* L396 */             instructionsList.appendChild(item);
/* L397 */           });
/* L398 */         }
/* L399 */       }
/* L400 */       appState.currentRouteData = {
/* L401 */         steps: l0 ? l0.steps : null,
/* L402 */         summary: r0.summary,
/* L403 */         distance: distanceText,
/* L404 */         duration: durationText,
/* L405 */         destinationName: destination.name,
/* L406 */         warnings: r0.warnings || []
/* L407 */       };
/* L408 */       const incidentSection = document.getElementById('incidentSection');
/* L409 */       const incidentText = document.getElementById('incidentText');
/* L410 */       if (r0.warnings && r0.warnings.length > 0 && incidentSection && incidentText) {
/* L411 */         incidentText.innerHTML = r0.warnings.map(w => w.replace(/<[^>]+>/g, ' ')).join('<br>');
/* L412 */         incidentSection.style.display = 'block';
/* L413 */       } else if (incidentSection) {
/* L414 */         incidentSection.style.display = 'none';
/* L415 */       }
/* L416 */       await fetchWeather(originLat, originLng);
/* L417 */       if (appState.isSimulation) {
/* L418 */         setUserMarker(originLat, originLng);
/* L419 */         fetchLocationNameGoogle(originLat, originLng);
/* L420 */         if (appState.currentDestination && google.maps.geometry && google.maps.geometry.spherical) {
/* L421 */           const currentLatLng = new google.maps.LatLng(originLat, originLng);
/* L422 */           const destLatLng = new google.maps.LatLng(appState.currentDestination.lat, appState.currentDestination.lng);
/* L423 */           let headingDeg = google.maps.geometry.spherical.computeHeading(currentLatLng, destLatLng);
/* L424 */           if (headingDeg < 0) headingDeg += 360;
/* L425 */           appState.currentHeading = headingDeg;
/* L426 */           updateMarkerRotation();
/* L427 */         }
/* L428 */       } else {
/* L429 */         startLocationWatcher();
/* L430 */       }
/* L431 */       drawRoutePolyline(r0);
/* L432 */       const bounds = new google.maps.LatLngBounds();
/* L433 */       bounds.extend(new google.maps.LatLng(originLat, originLng));
/* L434 */       bounds.extend(new google.maps.LatLng(destination.lat, destination.lng));
/* L435 */       appState.map.fitBounds(bounds, { top: 100, right: 150, bottom: 300, left: 50 });
/* L436 */       setTimeout(() => {
/* L437 */         appState.map.panTo({ lat: destination.lat, lng: destination.lng });
/* L438 */         appState.map.setZoom(18);
/* L439 */         setTimeout(() => {
/* L440 */           appState.map.panTo({ lat: originLat, lng: originLng });
/* L441 */           appState.map.setZoom(18);
/* L442 */         }, 2000);
/* L443 */       }, 2000);
/* L444 */     } else {
/* L445 */       throw new Error('ルートが取得できませんでした');
/* L446 */     }
/* L447 */   } catch (error) {
/* L448 */     appState.isNavigating = false;
/* L449 */     appState.isSimulation = false;
/* L450 */     updateNavigationUI(false);
/* L451 */     if (fabStackEl) fabStackEl.style.display = 'none';
/* L452 */     startCompassListener();
/* L453 */   }
/* L454 */ }
/* L455 */ 
/* L456 */ function stopNavigation() {
/* L457 */   stopLocationWatcher();
/* L458 */   startCompassListener();
/* L459 */   appState.isSimulation = false;
/* L460 */   appState.currentRouteData = null;
/* L461 */   if (appState.currentPolyline) {
/* L462 */     appState.currentPolyline.setMap(null);
/* L463 */     appState.currentPolyline = null;
/* L464 */   }
/* L465 */   appState.currentDestination = null;
/* L466 */   appState.isNavigating = false;
/* L467 */   appState.isPaused = false;
/* L468 */   updateNavigationUI(false);
/* L469 */   const instructionsList = document.getElementById('navPanelInstructions');
/* L470 */   if (instructionsList) instructionsList.innerHTML = '';
/* L471 */   const incidentSection = document.getElementById('incidentSection');
/* L472 */   if (incidentSection) incidentSection.style.display = 'none';
/* L473 */   const searchPanel = document.getElementById('searchPanel');
/* L474 */   const btnDestination = document.getElementById('btnDestination');
/* L475 */   const qInput = document.getElementById('q');
/* L476 */   const results = document.getElementById('results');
/* L477 */   if (searchPanel) searchPanel.style.display = 'block';
/* L478 */   if (btnDestination) btnDestination.style.display = 'none';
/* L479 */   if (qInput) qInput.value = '';
/* L480 */   if (results) {
/* L481 */     results.style.display = 'none';
/* L482 */     results.innerHTML = '';
/* L483 */   }
/* L484 */   const weather3h = document.getElementById('weather3h');
/* L485 */   const weather6h = document.getElementById('weather6h');
/* L486 */   const weather9h = document.getElementById('weather9h');
/* L487 */   if (weather3h) weather3h.textContent = '--';
/* L488 */   if (weather6h) weather6h.textContent = '--';
/* L489 */   if (weather9h) weather9h.textContent = '--';
/* L490 */   const fabStack = document.getElementById('fabStack');
/* L491 */   const btnSearch = document.getElementById('btnSearch');
/* L492 */   if (fabStack) fabStack.style.display = 'none';
/* L493 */   if (btnSearch) btnSearch.style.display = 'flex';
/* L494 */   const btnPauseSettings = document.getElementById('btnPauseSettings');
/* L495 */   if (btnPauseSettings) {
/* L496 */     btnPauseSettings.textContent = '⏸️ 一時停止';
/* L497 */     btnPauseSettings.classList.remove('paused');
/* L498 */   }
/* L499 */   appState.searchMarkers.forEach(marker => marker.map = null);
/* L500 */   appState.searchMarkers = [];
/* L501 */   if (appState.currentPos && appState.map) {
/* L502 */     appState.map.panTo(appState.currentPos);
/* L503 */     appState.map.setZoom(17);
/* L504 */   }
/* L505 */   updateMarkerRotation();
/* L506 */   const appBody = document.getElementById('appBody');
/* L507 */   if (appBody) appBody.classList.add('panel-open');
/* L508 */   switchPanelTab('search');
/* L509 */ }
/* L510 */ 
/* L511 */ function togglePause() {
/* L512 */   if (appState.isSimulation) return;
/* L513 */   if (!appState.isNavigating) return;
/* L514 */   appState.isPaused = !appState.isPaused;
/* L515 */   const btnPauseSettings = document.getElementById('btnPauseSettings');
/* L516 */   if (appState.isPaused) {
/* L517 */     if (btnPauseSettings) {
/* L518 */       btnPauseSettings.textContent = '▶️ 再開';
/* L519 */       btnPauseSettings.classList.add('paused');
/* L520 */     }
/* L521 */   } else {
/* L522 */     if (btnPauseSettings) {
/* L523 */       btnPauseSettings.textContent = '⏸️ 一時停止';
/* L524 */       btnPauseSettings.classList.remove('paused');
/* L525 */     }
/* L526 */     if (appState.currentPos) {
/* L527 */       appState.map.panTo(appState.currentPos);
/* L528 */       appState.map.setZoom(18);
/* L529 */     }
/* L530 */   }
/* L531 */ }
/* L532 */ 
/* L533 */ const TYPE_MAP = {
/* L534 */   "コンビニ": "convenience_store",
/* L535 */   "スーパー": "supermarket",
/* L536 */   "レストラン": "restaurant",
/* L537 */   "カフェ": "cafe",
/* L538 */   "ホテル": "lodging",
/* L539 */   "病院": "hospital",
/* L540 */   "薬局": "pharmacy",
/* L541 */   "ガソリンスタンド": "gas_station",
/* L542 */   "駐車場": "parking",
/* L543 */   "銀行": "bank"
/* L544 */ };
/* L545 */ 
/* L546 */ async function performSearch(query) {
/* L547 */   if (!query || !query.trim()) return;
/* L548 */   let centerLat;
/* L549 */   let centerLng;
/* L550 */   if (appState.pointSearchMode && appState.searchPoint) {
/* L551 */     centerLat = appState.searchPoint.lat;
/* L552 */     centerLng = appState.searchPoint.lng;
/* L553 */   } else if (appState.currentPos) {
/* L554 */     centerLat = appState.currentPos.lat;
/* L555 */     centerLng = appState.currentPos.lng;
/* L556 */   } else {
/* L557 */     return;
/* L558 */   }
/* L559 */   const radiusLabel = document.getElementById('radiusLabel');
/* L560 */   const radiusKm = radiusLabel ? parseInt(radiusLabel.textContent) : 10;
/* L561 */   const radiusMeters = radiusKm * 1000;
/* L562 */   try {
/* L563 */     const data = await placesTextSearch({
/* L564 */       textQuery: query.trim(),
/* L565 */       locationBias: {
/* L566 */         circle: { center: { latitude: centerLat, longitude: centerLng }, radius: radiusMeters }
/* L567 */       },
/* L568 */       maxResultCount: 20,
/* L569 */       languageCode: 'ja'
/* L570 */     }, DEFAULT_MASK);
/* L571 */     if (data.places && data.places.length) {
/* L572 */       displayResults(data.places, centerLat, centerLng);
/* L573 */       return;
/* L574 */     }
/* L575 */   } catch (e) {}
/* L576 */   const typeKey = TYPE_MAP[query.trim()] || TYPE_MAP[query.trim().replace(/\s/g, '')];
/* L577 */   if (typeKey) {
/* L578 */     try {
/* L579 */       const data = await placesNearby({
/* L580 */         includedTypes: [typeKey],
/* L581 */         maxResultCount: 20,
/* L582 */         locationRestriction: {
/* L583 */           circle: { center: { latitude: centerLat, longitude: centerLng }, radius: radiusMeters }
/* L584 */         },
/* L585 */         languageCode: 'ja'
/* L586 */       }, DEFAULT_MASK);
/* L587 */       if (data.places && data.places.length) {
/* L588 */         displayResults(data.places, centerLat, centerLng);
/* L589 */         return;
/* L590 */       }
/* L591 */     } catch (e) {}
/* L592 */   }
/* L593 */   const results = document.getElementById('results');
/* L594 */   if (results) results.style.display = 'none';
/* L595 */ }
/* L596 */ 
/* L597 */ function displayResults(places, centerLat, centerLng) {
/* L598 */   appState.searchMarkers.forEach(marker => marker.map = null);
/* L599 */   appState.searchMarkers = [];
/* L600 */   const placesWithDistance = places.map(place => {
/* L601 */     const lat = place.location.latitude;
/* L602 */     const lng = place.location.longitude;
/* L603 */     const distance = calculateDistance(centerLat, centerLng, lat, lng);
/* L604 */     return { ...place, distance };
/* L605 */   });
/* L606 */   placesWithDistance.sort((a, b) => a.distance - b.distance);
/* L607 */   const limitedResults = placesWithDistance.slice(0, 5);
/* L608 */   const resultsDiv = document.getElementById('results');
/* L609 */   if (!resultsDiv) return;
/* L610 */   resultsDiv.innerHTML = '';
/* L611 */   resultsDiv.style.display = 'block';
/* L612 */   limitedResults.forEach((place, index) => {
/* L613 */     const name = place.displayName && place.displayName.text ? place.displayName.text : (place.displayName || '名称不明');
/* L614 */     const address = place.formattedAddress || '住所不明';
/* L615 */     const lat = place.location.latitude;
/* L616 */     const lng = place.location.longitude;
/* L617 */     const distanceKm = (place.distance / 1000).toFixed(2);
/* L618 */     const item = document.createElement('div');
/* L619 */     item.className = 'result-item';
/* L620 */     item.innerHTML = `
/* L621 */       <div class="result-name">${index + 1}. ${name}</div>
/* L622 */       <div class="result-address">${address}</div>
/* L623 */       <div style="font-size:11px;color:#62b5ff;margin-top:4px">📍 ${distanceKm}km</div>
/* L624 */     `;
/* L625 */     item.onclick = () => {
/* L626 */       startNavigation({ name, lat, lng });
/* L627 */     };
/* L628 */     resultsDiv.appendChild(item);
/* L629 */     const markerPin = document.createElement('div');
/* L630 */     markerPin.style.width = '24px';
/* L631 */     markerPin.style.height = '24px';
/* L632 */     markerPin.style.borderRadius = '50%';
/* L633 */     markerPin.style.background = '#25d07a';
/* L634 */     markerPin.style.border = '2px solid #fff';
/* L635 */     markerPin.style.boxShadow = '0 2px 6px rgba(0,0,0,.3)';
/* L636 */     markerPin.style.display = 'flex';
/* L637 */     markerPin.style.alignItems = 'center';
/* L638 */     markerPin.style.justifyContent = 'center';
/* L639 */     markerPin.style.color = '#fff';
/* L640 */     markerPin.style.fontSize = '12px';
/* L641 */     markerPin.style.fontWeight = 'bold';
/* L642 */     markerPin.textContent = index + 1;
/* L643 */     const marker = new google.maps.marker.AdvancedMarkerElement({
/* L644 */       map: appState.map,
/* L645 */       position: { lat, lng },
/* L646 */       content: markerPin,
/* L647 */       zIndex: 500 + index,
/* L648 */       title: name
/* L649 */     });
/* L650 */     appState.searchMarkers.push(marker);
/* L651 */   });
/* L652 */ }
/* L653 */ 
/* L654 */ function initSpeechRecognition() {
/* L655 */   if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) return false;
/* L656 */   const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
/* L657 */   appState.recognition = new SpeechRecognition();
/* L658 */   appState.recognition.lang = 'ja-JP';
/* L659 */   appState.recognition.continuous = false;
/* L660 */   appState.recognition.interimResults = false;
/* L661 */   const btnVoiceIcon = document.getElementById('btnVoiceIcon');
/* L662 */   appState.recognition.onstart = () => {
/* L663 */     if (btnVoiceIcon) btnVoiceIcon.classList.add('recording');
/* L664 */   };
/* L665 */   appState.recognition.onresult = (event) => {
/* L666 */     const transcript = event.results[0][0].transcript;
/* L667 */     const qInput = document.getElementById('q');
/* L668 */     if (qInput) qInput.value = transcript;
/* L669 */     performSearch(transcript);
/* L670 */   };
/* L671 */   appState.recognition.onerror = () => {
/* L672 */     if (btnVoiceIcon) btnVoiceIcon.classList.remove('recording');
/* L673 */   };
/* L674 */   appState.recognition.onend = () => {
/* L675 */     if (btnVoiceIcon) btnVoiceIcon.classList.remove('recording');
/* L676 */   };
/* L677 */   return true;
/* L678 */ }
/* L679 */ 
/* L680 */ function startVoiceSearch() {
/* L681 */   if (!appState.recognition) {
/* L682 */     if (!initSpeechRecognition()) return;
/* L683 */   }
/* L684 */   try {
/* L685 */     appState.recognition.start();
/* L686 */   } catch (e) {
/* L687 */     appState.recognition.stop();
/* L688 */     setTimeout(() => {
/* L689 */       try {
/* L690 */         appState.recognition.start();
/* L691 */       } catch (e2) {}
/* L692 */     }, 100);
/* L693 */   }
/* L694 */ }
/* L695 */ 
/* L696 */ function pickBestGeocodeResult(results) {
/* L697 */   if (!Array.isArray(results) || results.length === 0) return null;
/* L698 */   const priorityTypes = ['street_address', 'premise', 'subpremise', 'route', 'plus_code'];
/* L699 */   for (const t of priorityTypes) {
/* L700 */     const candidate = results.find(r => Array.isArray(r.types) && r.types.includes(t));
/* L701 */     if (candidate && candidate.formatted_address) return candidate;
/* L702 */   }
/* L703 */   return results[0];
/* L704 */ }
/* L705 */ 
/* L706 */ function acquireLocation() {
/* L707 */   const onSuccess = (pos) => {
/* L708 */     const { latitude, longitude } = pos.coords;
/* L709 */     const loadingEl = document.getElementById('loading');
/* L710 */     if (loadingEl) loadingEl.remove();
/* L711 */     if (!appState.mapInitialized) {
/* L712 */       initMap({ lat: latitude, lng: longitude });
/* L713 */     } else {
/* L714 */       appState.map.setCenter({ lat: latitude, lng: longitude });
/* L715 */     }
/* L716 */     setUserMarker(latitude, longitude);
/* L717 */     fetchLocationNameGoogle(latitude, longitude);
/* L718 */     fetchWeather(latitude, longitude);
/* L719 */   };
/* L720 */   const onError = () => {
/* L721 */     const loadingEl = document.getElementById('loading');
/* L722 */     if (loadingEl) loadingEl.remove();
/* L723 */     if (!appState.mapInitialized) {
/* L724 */       initMap({ lat: 35.6895, lng: 139.6917 }); // ★ 失敗時、東京駅付近を初期位置に設定
/* L725 */     }
/* L726 */     const addressElement = document.getElementById('locAddress');
/* L727 */     const coordsElement = document.getElementById('locCoords');
/* L728 */     if (addressElement) addressElement.textContent = '現在地取得に失敗しました'; // ★ エラーメッセージを具体的に
/* L729 */     if (coordsElement) coordsElement.textContent = '現在地：地図の中心へ移動';
/* L730 */     startCompassListener(); // ★ 位置情報失敗時もコンパスを再開
/* L731 */   };
/* L732 */   try {
/* L733 */     navigator.geolocation.getCurrentPosition(onSuccess, onError, LOCATION_OPTIONS);
/* L734 */   } catch (e) {}
/* L735 */ }
/* L736 */ 
/* L737 */ async function fetchLocationNameGoogle(lat, lng) {
/* L738 */   const addressElement = document.getElementById('locAddress');
/* L739 */   const coordsElement = document.getElementById('locCoords');
/* L740 */   if (!addressElement || !coordsElement) return;
/* L741 */   const coordsText = `緯度 ${lat.toFixed(6)} / 経度 ${lng.toFixed(6)}`;
/* L742 */   coordsElement.textContent = coordsText;
/* L743 */   try {
/* L744 */     const response = await fetchWithRetry(`${WORKER_ORIGIN}/geocode`, {
/* L745 */       method: 'POST',
/* L746 */       headers: { 'Content-Type': 'application/json' },
/* L747 */       body: JSON.stringify({
/* L748 */         latlng: { lat, lng },
/* L749 */         language: 'ja'
/* L750 */       })
/* L751 */     });
/* L752 */     if (!response.ok) {
/* L753 */       const errorText = await response.text();
/* L754 */       throw new Error(`Geocode Worker Error ${response.status}: ${errorText}`);
/* L755 */     }
/* L756 */     const data = await response.json();
/* L757 */     if (data.status === 'OK' && Array.isArray(data.results) && data.results.length > 0) {
/* L758 */       const best = pickBestGeocodeResult(data.results);
/* L759 */       if (best && best.formatted_address) {
/* L760 */         const address = best.formatted_address;
/* L761 */         const cleanAddress = address.replace(/^日本、\s*/, '');
/* L762 */         const formattedAddress = `${cleanAddress} 付近`;
/* L763 */         addressElement.textContent = formattedAddress;
/* L764 */       } else {
/* L765 */         addressElement.textContent = '住所情報なし';
/* L766 */       }
/* L767 */     } else {
/* L768 */       addressElement.textContent = '住所情報なし';
/* L769 */     }
/* L770 */   } catch (error) {
/* L771 */     addressElement.textContent = '住所取得エラー';
/* L772 */   }
/* L773 */ }
/* L774 */ 
/* L775 */ async function fetchPointAddress(lat, lng) {
/* L776 */   const addressBlock = document.getElementById('pointAddressBlock');
/* L777 */   const addressElement = document.getElementById('pointAddress');
/* L778 */   const coordsElement = document.getElementById('pointCoords');
/* L779 */   if (!addressElement || !coordsElement || !addressBlock) return;
/* L780 */   addressElement.textContent = 'ポイント：住所取得中...';
/* L781 */   coordsElement.textContent = `緯度 ${lat.toFixed(6)} / 経度 ${lng.toFixed(6)}`;
/* L782 */   addressBlock.style.display = 'flex';
/* L783 */   try {
/* L784 */     const response = await fetchWithRetry(`${WORKER_ORIGIN}/geocode`, {
/* L785 */       method: 'POST',
/* L786 */       headers: { 'Content-Type': 'application/json' },
/* L787 */       body: JSON.stringify({
/* L788 */         latlng: { lat, lng },
/* L789 */         language: 'ja'
/* L790 */       })
/* L791 */     });
/* L792 */     if (!response.ok) {
/* L793 */       const errorText = await response.text();
/* L794 */       throw new Error(`Geocode Worker Error ${response.status}: ${errorText}`);
/* L795 */     }
/* L796 */     const data = await response.json();
/* L797 */     if (data.status === 'OK' && Array.isArray(data.results) && data.results.length > 0) {
/* L798 */       const best = pickBestGeocodeResult(data.results);
/* L799 */       if (best && best.formatted_address) {
/* L800 */         const address = best.formatted_address;
/* L801 */         const cleanAddress = address.replace(/^日本、\s*/, '');
/* L802 */         const formattedAddress = `ポイント：${cleanAddress} 付近`;
/* L803 */         addressElement.textContent = formattedAddress;
/* L804 */       } else {
/* L805 */         addressElement.textContent = 'ポイント：住所情報なし';
/* L806 */       }
/* L807 */     } else {
/* L808 */       addressElement.textContent = 'ポイント：住所情報なし';
/* L809 */     }
/* L810 */   } catch (error) {
/* L811 */     addressElement.textContent = 'ポイント：住所取得エラー';
/* L812 */   }
/* L813 */ }
/* L814 */ 
/* L815 */ function iconFromWeatherType(type) {
/* L816 */   const t = (type || '').toUpperCase();
/* L817 */   if (t.includes('THUNDER')) return '⛈️';
/* L818 */   if (t.includes('RAIN') || t.includes('DRIZZLE')) return '🌧️';
/* L819 */   if (t.includes('SNOW') || t.includes('SLEET')) return '❄️';
/* L820 */   if (t.includes('FOG') || t.includes('MIST') || t.includes('HAZE')) return '🌫️';
/* L821 */   if (t.includes('CLOUDS')) return '☁️';
/* L822 */   if (t.includes('CLEAR')) return '☀️';
/* L823 */   return '☀️';
/* L824 */ }
/* L825 */ 
/* L826 */ async function fetchWeather(lat, lng) {
/* L827 */   try {
/* L828 */     const payload = { lat, lon: lng, units: 'metric' };
/* L829 */     const response = await fetchWithRetry(`${WORKER_ORIGIN}/weather`, {
/* L830 */       method: 'POST',
/* L831 */       headers: { 'Content-Type': 'application/json' },
/* L832 */       body: JSON.stringify(payload)
/* L833 */     });
/* L834 */     if (!response.ok) {
/* L835 */       const errText = await response.text();
/* L836 */       throw new Error(`Weather fetch failed (${response.status}): ${errText}`);
/* L837 */     }
/* L838 */     const data = await response.json();
/* L839 */     const fh = Array.isArray(data.hourly) ? data.hourly : [];
/* L840 */     const icon1 = (fh[0] && fh[0].weather && fh[0].weather[0]) ? iconFromWeatherType(fh[0].weather[0].main) : null;
/* L841 */     const icon2 = (fh[1] && fh[1].weather && fh[1].weather[0]) ? iconFromWeatherType(fh[1].weather[0].main) : null;
/* L842 */     const icon3 = (fh[2] && fh[2].weather && fh[2].weather[0]) ? iconFromWeatherType(fh[2].weather[0].main) : null;
/* L843 */     const weather3h = document.getElementById('weather3h');
/* L844 */     const weather6h = document.getElementById('weather6h');
/* L845 */     const weather9h = document.getElementById('weather9h');
/* L846 */     if (weather3h) weather3h.textContent = icon1 || '—';
/* L847 */     if (weather6h) weather6h.textContent = icon2 || '—';
/* L848 */     if (weather9h) weather9h.textContent = icon3 || '—';
/* L849 */   } catch (error) {
/* L850 */     const weather3h = document.getElementById('weather3h');
/* L851 */     const weather6h = document.getElementById('weather6h');
/* L852 */     const weather9h = document.getElementById('weather9h');
/* L853 */     if (weather3h) weather3h.textContent = 'X';
/* L854 */     if (weather6h) weather6h.textContent = 'X';
/* L855 */     if (weather9h) weather9h.textContent = 'X';
/* L856 */   }
/* L857 */ }
/* L858 */ 
/* L859 */ function createDialog(config) {
/* L860 */   const overlay = document.createElement('div');
/* L861 */   overlay.className = `dialog-overlay ${config.scroll ? 'scroll' : ''}`;
/* L862 */   overlay.id = config.id || 'dialog';
/* L863 */   const box = document.createElement('div');
/* L864 */   box.className = `dialog-box ${config.wide ? 'wide' : ''}`;
/* L865 */   box.innerHTML = config.content;
/* L866 */   overlay.appendChild(box);
/* L867 */   document.body.appendChild(overlay);
/* L868 */   return overlay;
/* L869 */ }
/* L870 */ 
/* L871 */ function showSaveLocationDialog() {
/* L872 */   if (!appState.currentPos) return;
/* L873 */   const dialog = createDialog({
/* L874 */     id: 'saveLocationDialog',
/* L875 */     content: `<h3 class="dialog-title">現在地点登録画面</h3><p class="dialog-text">登録する地点名を入力してください:</p><input type="text" id="locationNameInput" class="dialog-input" placeholder="地点名を入力" /><div class="dialog-actions"><button id="btnCancelSave" class="dialog-btn cancel">キャンセル</button><button id="btnConfirmSave" class="dialog-btn confirm">OK</button></div>`
/* L876 */   });
/* L877 */   const input = document.getElementById('locationNameInput');
/* L878 */   const btnCancel = document.getElementById('btnCancelSave');
/* L879 */   const btnConfirm = document.getElementById('btnConfirmSave');
/* L880 */   setTimeout(() => input.focus(), 100);
/* L881 */   btnCancel.onclick = () => dialog.remove();
/* L882 */   btnConfirm.onclick = () => {
/* L883 */     const locationName = input.value.trim();
/* L884 */     if (!locationName) {
/* L885 */       input.style.borderColor = 'var(--danger)';
/* L886 */       setTimeout(() => { input.style.borderColor = 'var(--stroke)'; }, 2000);
/* L887 */       return;
/* L888 */     }
/* L889 */     const locations = JSON.parse(localStorage.getItem('savedLocations') || '[]');
/* L890 */     const savedLocation = {
/* L891 */       name: locationName,
/* L892 */       lat: appState.currentPos.lat,
/* L893 */       lng: appState.currentPos.lng,
/* L894 */       timestamp: Date.now()
/* L895 */     };
/* L896 */     locations.push(savedLocation);
/* L897 */     localStorage.setItem('savedLocations', JSON.stringify(locations));
/* L898 */     dialog.remove();
/* L899 */   };
/* L900 */   input.addEventListener('keypress', (e) => {
/* L901 */     if (e.key === 'Enter') btnConfirm.click();
/* L902 */   });
/* L903 */ }
/* L904 */ 
/* L905 */ function showEditLocationDialog() {
/* L906 */   const locations = JSON.parse(localStorage.getItem('savedLocations') || '[]');
/* L907 */   if (locations.length === 0) {
/* L908 */     const dialog = createDialog({
/* L909 */       id: 'editDialog',
/* L910 */       content: `<h3 class="dialog-title">登録地点修正</h3><p class="dialog-muted">登録された地点がありません</p><button id="btnCloseEmpty" class="dialog-btn confirm full">閉じる</button>`
/* L911 */     });
/* L912 */     document.getElementById('btnCloseEmpty').onclick = () => dialog.remove();
/* L913 */     return;
/* L914 */   }
/* L915 */   let listHTML = '';
/* L916 */   locations.forEach((loc, index) => {
/* L917 */     listHTML += `<div class="location-item"><div class="location-item-name">${loc.name}</div><div class="location-item-coords">緯度: ${loc.lat.toFixed(6)} / 経度: ${loc.lng.toFixed(6)}</div><div class="location-item-actions"><button class="location-item-btn nav" data-index="${index}">ナビ開始</button><button class="location-item-btn edit" data-index="${index}">名前変更</button><button class="location-item-btn delete" data-index="${index}">削除</button></div></div>`;
/* L918 */   });
/* L919 */   const dialog = createDialog({
/* L920 */     id: 'editDialog',
/* L921 */     wide: true,
/* L922 */     scroll: true,
/* L923 */     content: `<h3 class="dialog-title">登録地点修正</h3>${listHTML}<button id="btnCloseEdit" class="dialog-btn cancel full" style="margin-top:16px">閉じる</button>`
/* L924 */   });
/* L925 */   document.getElementById('btnCloseEdit').onclick = () => dialog.remove();
/* L926 */   document.querySelectorAll('.location-item-btn.nav').forEach(btn => {
/* L927 */     btn.onclick = () => {
/* L928 */       const index = parseInt(btn.dataset.index);
/* L929 */       const loc = locations[index];
/* L930 */       dialog.remove();
/* L931 */       startNavigation({ name: loc.name, lat: loc.lat, lng: loc.lng });
/* L932 */     };
/* L933 */   });
/* L934 */   document.querySelectorAll('.location-item-btn.edit').forEach(btn => {
/* L935 */     btn.onclick = () => {
/* L936 */       const index = parseInt(btn.dataset.index);
/* L937 */       const loc = locations[index];
/* L938 */       const renameDialog = createDialog({
/* L939 */         id: 'renameDialog',
/* L940 */         content: `<h3 class="dialog-title">地点名変更</h3><input type="text" id="renameInput" value="${loc.name}" class="dialog-input" /><div class="dialog-actions"><button id="btnCancelRename" class="dialog-btn cancel">キャンセル</button><button id="btnConfirmRename" class="dialog-btn confirm">OK</button></div>`
/* L941 */       });
/* L942 */       const renameInput = document.getElementById('renameInput');
/* L943 */       setTimeout(() => {
/* L944 */         renameInput.focus();
/* L945 */         renameInput.select();
/* L946 */       }, 100);
/* L947 */       document.getElementById('btnCancelRename').onclick = () => renameDialog.remove();
/* L948 */       document.getElementById('btnConfirmRename').onclick = () => {
/* L949 */         const newName = renameInput.value.trim();
/* L950 */         if (!newName) {
/* L951 */           renameInput.style.borderColor = 'var(--danger)';
/* L952 */           setTimeout(() => { renameInput.style.borderColor = 'var(--stroke)'; }, 2000);
/* L953 */           return;
/* L954 */         }
/* L955 */         locations[index].name = newName;
/* L956 */         localStorage.setItem('savedLocations', JSON.stringify(locations));
/* L957 */         renameDialog.remove();
/* L958 */         dialog.remove(); // ★ 変更: 親ダイアログを閉じる
/* L959 */         showEditLocationDialog(); // ★ 変更: 再表示してリストを更新
/* L960 */       };
/* L961 */       renameInput.addEventListener('keypress', (e) => {
/* L962 */         if (e.key === 'Enter') document.getElementById('btnConfirmRename').click();
/* L963 */       });
/* L964 */     };
/* L965 */   });
/* L966 */   document.querySelectorAll('.location-item-btn.delete').forEach(btn => {
/* L967 */     btn.onclick = () => {
/* L968 */       const index = parseInt(btn.dataset.index);
/* L969 */       const loc = locations[index];
/* L970 */       const confirmDialog = createDialog({
/* L971 */         id: 'confirmDeleteDialog',
/* L972 */         content: `<h3 class="dialog-title">削除確認</h3><p class="dialog-text">「${loc.name}」を削除しますか？</p><div class="dialog-actions"><button id="btnCancelDelete" class="dialog-btn cancel">キャンセル</button><button id="btnConfirmDelete" class="dialog-btn delete">削除</button></div>`
/* L973 */       });
/* L974 */       document.getElementById('btnCancelDelete').onclick = () => confirmDialog.remove();
/* L975 */       document.getElementById('btnConfirmDelete').onclick = () => {
/* L976 */         locations.splice(index, 1);
/* L977 */         localStorage.setItem('savedLocations', JSON.stringify(locations));
/* L978 */         confirmDialog.remove();
/* L979 */         dialog.remove(); // ★ 変更: 親ダイアログを閉じる
/* L980 */         showEditLocationDialog(); // ★ 変更: 再表示してリストを更新
/* L981 */       };
/* L982 */     };
/* L983 */   });
/* L984 */ }
/* L985 */ 
/* L986 */ function exportRouteToClipboard() {
/* L987 */   if (!appState.currentRouteData) return;
/* L988 */   const data = appState.currentRouteData;
/* L989 */   let textOutput = `■ 目的地: ${data.destinationName}\n`;
/* L990 */   textOutput += `■ 概要: ${data.summary} (約 ${data.distance}, 徒歩 ${data.duration})\n\n`;
/* L991 */   if (data.warnings.length > 0) {
/* L992 */     textOutput += '■ 警告:\n';
/* L993 */     data.warnings.forEach(w => {
/* L994 */       textOutput += `・ ${w.replace(/<[^>]+>/g, ' ')}\n`;
/* L995 */     });
/* L996 */     textOutput += '\n';
/* L997 */   }
/* L998 */   textOutput += '■ 道順:\n';
/* L999 */   if (data.steps && data.steps.length > 0) {
/*L1000*/     data.steps.forEach((step, index) => {
/*L1001*/       const instruction = (step.html_instructions || '').replace(/<[^>]+>/g, ' ');
/*L1002*/       textOutput += `${index + 1}. ${instruction} (${step.distance.text})\n`;
/*L1003*/     });
/*L1004*/   } else {
/*L1005*/     textOutput += '詳細な道順はありません。\n';
/*L1006*/   }
/*L1007*/   if (navigator.clipboard) {
/*L1008*/     navigator.clipboard.writeText(textOutput).catch(() => {});
/*L1009*/   }
/*L1010*/ }
/*L1011*/ 
/*L1012*/ let lastLocateTime = 0;
/*L1013*/ 
/*L1014*/ function locateUser() {
/*L1015*/   if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
/*L1016*/     DeviceOrientationEvent.requestPermission().then(permissionState => {
/*L1017*/       if (permissionState === 'granted') {
/*L1018*/         stopCompassListener();
/*L1019*/         appState.compassWatchId = null;
/*L1020*/         startCompassListener();
/*L1021*/       }
/*L1022*/     }).catch(() => {});
/*L1023*/   }
/*L1024*/   const now = Date.now();
/*L1025*/   if (now - lastLocateTime < 1000) return;
/*L1026*/   lastLocateTime = now;
/*L1027*/   if (appState.currentPos && appState.map) {
/*L1028*/     appState.map.panTo(appState.currentPos);
/*L1029*/     appState.map.setZoom(18);
/*L1030*/   } else {
/*L1031*/     acquireLocation();
/*L1032*/   }
/*L1033*/ }
/*L1034*/ 
/*L1035*/ function bindKeyboardWatch() {
/*L1036*/   const searchInput = document.getElementById('q');
/*L1037*/   const searchPanel = document.getElementById('searchPanel');
/*L1038*/   const appBody = document.getElementById('appBody');
/*L1039*/   if (!searchInput || !searchPanel || !appBody) return;
/*L1040*/   searchInput.addEventListener('focus', () => {
/*L1041*/     appBody.classList.add('keyboard-open');
/*L1042*/     setTimeout(() => {
/*L1043*/       const inputTopInPanel = searchInput.offsetTop;
/*L1044*/       searchPanel.scrollTop = inputTopInPanel - 20;
/*L1045*/     }, 350);
/*L1046*/   });
/*L1047*/   searchInput.addEventListener('blur', () => {
/*L1048*/     appBody.classList.remove('keyboard-open');
/*L1049*/     searchPanel.scrollTop = 0;
/*L1050*/   });
/*L1051*/ }
/*L1052*/ 
/*L1053*/ function bindSearchPanelEvents() {
/*L1054*/   const radiusLabel = document.getElementById('radiusLabel');
/*L1055*/   const r10 = document.getElementById('r10');
/*L1056*/   const r20 = document.getElementById('r20');
/*L1057*/   const r30 = document.getElementById('r30');
/*L1058*/   const btnPointSearch = document.getElementById('btnPointSearch');
/*L1059*/   if (!radiusLabel || !r10 || !r20 || !r30 || !btnPointSearch) return;
/*L1060*/   r10.onclick = () => {
/*L1061*/     r10.classList.add('active');
/*L1062*/     r20.classList.remove('active');
/*L1063*/     r30.classList.remove('active');
/*L1064*/     radiusLabel.textContent = '10km';
/*L1065*/   };
/*L1066*/   r20.onclick = () => {
/*L1067*/     r20.classList.add('active');
/*L1068*/     r10.classList.remove('active');
/*L1069*/     r30.classList.remove('active');
/*L1070*/     radiusLabel.textContent = '20km';
/*L1071*/   };
/*L1072*/   r30.onclick = () => {
/*L1073*/     r30.classList.add('active');
/*L1074*/     r10.classList.remove('active');
/*L1075*/     r20.classList.remove('active');
/*L1076*/     radiusLabel.textContent = '30km';
/*L1077*/   };
/*L1078*/   btnPointSearch.onclick = () => {
/*L1079*/     appState.pointSearchMode = !appState.pointSearchMode;
/*L1080*/     if (appState.pointSearchMode) {
/*L1081*/       btnPointSearch.textContent = '📍 ポイント選択中...';
/*L1082*/       btnPointSearch.style.background = '#25d07a';
/*L1083*/       btnPointSearch.style.color = '#0a2818';
/*L1084*/       btnPointSearch.style.borderColor = 'transparent';
/*L1085*/     } else {
/*L1086*/       btnPointSearch.textContent = '📍 ポイント選択';
/*L1087*/       btnPointSearch.style.background = 'rgba(255,255,255,.08)';
/*L1088*/       btnPointSearch.style.color = 'var(--text)';
/*L1089*/       btnPointSearch.style.borderColor = 'var(--stroke)';
/*L1090*/     }
/*L1091*/   };
/*L1092*/ }
/*L1093*/ 
/*L1094*/ function bindLocationEvents() {
/*L1095*/   const btnSave = document.getElementById('btnSaveLocation');
/*L1096*/   const btnEdit = document.getElementById('btnEditLocation');
/*L1097*/   if (btnSave) btnSave.onclick = showSaveLocationDialog;
/*L1098*/   if (btnEdit) btnEdit.onclick = showEditLocationDialog;
/*L1099*/ }
/*L1100*/ 
/*L1101*/ function bindSearchEvents() {
/*L1102*/   const btnSearchIcon = document.getElementById('btnSearchIcon');
/*L1103*/   const qInput = document.getElementById('q');
/*L1104*/   const btnVoiceIcon = document.getElementById('btnVoiceIcon');
/*L1105*/   const btnReset = document.getElementById('btnReset');
/*L1106*/   const btnLocatePanel = document.getElementById('btnLocatePanel');
/*L1107*/   if (btnSearchIcon) {
/*L1108*/     btnSearchIcon.onclick = () => {
/*L1109*/       const q = document.getElementById('q');
/*L1110*/       if (q) {
/*L1111*/         const query = q.value.trim();
/*L1112*/         if (query) performSearch(query);
/*L1113*/       }
/*L1114*/     };
/*L1115*/   }
/*L1116*/   if (qInput) {
/*L1117*/     qInput.addEventListener('keypress', (e) => {
/*L1118*/       if (e.key === 'Enter') {
/*L1119*/         const query = qInput.value.trim();
/*L1120*/         if (query) performSearch(query);
/*L1121*/       }
/*L1122*/     });
/*L1123*/   }
/*L1124*/   if (btnVoiceIcon) btnVoiceIcon.onclick = startVoiceSearch;
/*L1125*/   if (btnReset) {
/*L1126*/     btnReset.onclick = () => {
/*L1127*/       const q = document.getElementById('q');
/*L1128*/       const results = document.getElementById('results');
/*L1129*/       if (q) q.value = '';
/*L1130*/       if (results) {
/*L1131*/         results.style.display = 'none';
/*L1132*/         results.innerHTML = '';
/*L1133*/       }
/*L1134*/       appState.searchMarkers.forEach(marker => marker.map = null);
/*L1135*/       appState.searchMarkers = [];
/*L1136*/       appState.searchPoint = null;
/*L1137*/       if (appState.searchPointMarker) {
/*L1138*/         appState.searchPointMarker.map = null;
/*L1139*/         appState.searchPointMarker = null;
/*L1140*/       }
/*L1141*/       const addressBlock = document.getElementById('pointAddressBlock');
/*L1142*/       const addressElement = document.getElementById('pointAddress');
/*L1143*/       const coordsElement = document.getElementById('pointCoords');
/*L1144*/       if (addressBlock) addressBlock.style.display = 'none';
/*L1145*/       if (addressElement) addressElement.textContent = '';
/*L1146*/       if (coordsElement) coordsElement.textContent = '';
/*L1147*/       appState.pointSearchMode = false;
/*L1148*/       const btnPointSearch = document.getElementById('btnPointSearch');
/*L1149*/       if (btnPointSearch) {
/*L1150*/         btnPointSearch.textContent = '📍 ポイント選択';
/*L1151*/         btnPointSearch.style.background = 'rgba(255,255,255,.08)';
/*L1152*/         btnPointSearch.style.color = 'var(--text)';
/*L1153*/         btnPointSearch.style.borderColor = 'var(--stroke)';
/*L1154*/       }
/*L1155*/       const r10 = document.getElementById('r10');
/*L1156*/       const r20 = document.getElementById('r20');
/*L1157*/       const r30 = document.getElementById('r30');
/*L1158*/       const radiusLabel = document.getElementById('radiusLabel');
/*L1159*/       if (r10) r10.classList.add('active');
/*L1160*/       if (r20) r20.classList.remove('active');
/*L1161*/       if (r30) r30.classList.remove('active');
/*L1162*/       if (radiusLabel) radiusLabel.textContent = '10km';
/*L1163*/     };
/*L1164*/   }
/*L1165*/   if (btnLocatePanel) btnLocatePanel.onclick = locateUser;
/*L1166*/ }
/*L1167*/ 
/*L1168*/ function bindFABEvents() {
/*L1169*/   const btnSearch = document.getElementById('btnSearch');
/*L1170*/   const btnClosePanel = document.getElementById('btnClosePanel');
/*L1171*/   const btnLocate = document.getElementById('btnLocate');
/*L1172*/   const btnDestination = document.getElementById('btnDestination');
/*L1173*/   if (btnSearch) {
/*L1174*/     btnSearch.onclick = () => {
/*L1175*/       const searchPanel = document.getElementById('searchPanel');
/*L1176*/       const fabStack = document.getElementById('fabStack');
/*L1177*/       const appBody = document.getElementById('appBody');
/*L1178*/       const instructionsList = document.getElementById('navPanelInstructions');
/*L1179*/       const incidentSection = document.getElementById('incidentSection');
/*L1180*/       if (searchPanel) searchPanel.style.display = 'block';
/*L1181*/       if (fabStack) fabStack.style.display = 'none';
/*L1182*/       if (appBody) appBody.classList.add('panel-open');
/*L1183*/       if (instructionsList) instructionsList.innerHTML = '';
/*L1184*/       if (incidentSection) incidentSection.style.display = 'none';
/*L1185*/       switchPanelTab('search');
/*L1186*/     };
/*L1187*/   }
/*L1188*/   if (btnClosePanel) {
/*L1189*/     btnClosePanel.onclick = () => {
/*L1190*/       const searchPanel = document.getElementById('searchPanel');
/*L1191*/       const fabStack = document.getElementById('fabStack');
/*L1192*/       const appBody = document.getElementById('appBody');
/*L1193*/       if (searchPanel) searchPanel.style.display = 'none';
/*L1194*/       if (!appState.isNavigating) {
/*L1195*/         if (fabStack) fabStack.style.display = 'none';
/*L1196*/       } else {
/*L1197*/         if (fabStack) fabStack.style.display = 'flex';
/*L1198*/       }
/*L1199*/       if (appBody) appBody.classList.remove('panel-open');
/*L1200*/     };
/*L1201*/   }
/*L1202*/   if (btnLocate) btnLocate.onclick = locateUser;
/*L1203*/   if (btnDestination) {
/*L1204*/     btnDestination.onclick = () => {
/*L1205*/       if (appState.currentDestination && appState.map) {
/*L1206*/         appState.map.panTo({ lat: appState.currentDestination.lat, lng: appState.currentDestination.lng });
/*L1207*/         appState.map.setZoom(18);
/*L1208*/       }
/*L1209*/     };
/*L1210*/   }
/*L1211*/ }
/*L1212*/ 
/*L1213*/ function bindRoutePanelEvents() {
/*L1214*/   const btnStopRoute = document.getElementById('btnStopRoute');
/*L1215*/   if (btnStopRoute) btnStopRoute.onclick = stopNavigation;
/*L1216*/   const btnExportText = document.getElementById('btnExportText');
/*L1217*/   if (btnExportText) btnExportText.onclick = exportRouteToClipboard;
/*L1218*/   const btnPauseSettings = document.getElementById('btnPauseSettings');
/*L1219*/   if (btnPauseSettings) btnPauseSettings.onclick = togglePause;
/*L1220*/   const btnRerouteSettings = document.getElementById('btnRerouteSettings');
/*L1221*/   if (btnRerouteSettings) {
/*L1222*/     btnRerouteSettings.onclick = () => {
/*L1223*/       if (appState.currentDestination) {
/*L1224*/         startNavigation(appState.currentDestination);
/*L1225*/       }
/*L1226*/     };
/*L1227*/   }
/*L1228 */ }
/*L1229*/ 
/*L1230*/ function bindTabEvents() {
/*L1231*/   const tabButtons = document.querySelectorAll('[data-panel-tab]');
/*L1232*/   if (!tabButtons || tabButtons.length === 0) return;
/*L1233*/   tabButtons.forEach(btn => {
/*L1234*/     const mode = btn.dataset.panelTab;
/*L1235*/     btn.addEventListener('click', () => {
/*L1236*/       switchPanelTab(mode);
/*L1237*/     });
/*L1238*/     btn.addEventListener('keydown', (e) => {
/*L1239*/       if (e.key === 'Enter' || e.key === ' ') {
/*L1240*/         e.preventDefault();
/*L1241*/         switchPanelTab(mode);
/*L1242*/       }
/*L1243*/     });
/*L1244*/   });
/*L1245*/   switchPanelTab('search');
/*L1246*/ }
/*L1247*/ 
/*L1248*/ function bindUI() {
/*L1249*/   bindSearchPanelEvents();
/*L1250*/   bindLocationEvents();
/*L1251*/   bindSearchEvents();
/*L1252*/   bindFABEvents();
/*L1253*/   bindRoutePanelEvents();
/*L1254*/   bindKeyboardWatch();
/*L1255*/   bindTabEvents();
/*L1256*/ }
/*L1257*/ 
/*L1258*/ function startApp() {
/*L1259*/   document.documentElement.lang = 'ja';
/*L1260*/   const searchPanel = document.getElementById('searchPanel');
/*L1261*/   const fabStack = document.getElementById('fabStack');
/*L1262*/   const btnSearch = document.getElementById('btnSearch');
/* L1263 */   const appBody = document.getElementById('appBody');
/*L1264*/   if (searchPanel) searchPanel.style.display = 'block';
/*L1265*/   if (fabStack) fabStack.style.display = 'none';
/*L1266*/   if (btnSearch) btnSearch.style.display = 'flex';
/*L1267*/   if (appBody) appBody.classList.add('panel-open');
/*L1268*/   switchPanelTab('search');
/*L1269*/   bindUI();
/*L1270*/   acquireLocation();
/*L1271*/   initSpeechRecognition();
/*L1272*/   startCompassListener();
/*L1273*/ }
/*L1274*/ 
/*L1275*/ function initializeWhenReady(attempt = 0) { // ★ 修正: タイムアウト処理を追加
/*L1276*/   if (typeof google !== 'undefined' && google.maps && google.maps.Map) {
/*L1277*/     startApp();
/*L1278*/   } else if (attempt < 100) {
/*L1279*/     setTimeout(() => initializeWhenReady(attempt + 1), 100);
/*L1280*/   } else {
/*L1281*/     console.error("Maps API failed to load after 10 seconds.");
/*L1282*/     const loadingEl = document.getElementById('loading');
/*L1283*/     if (loadingEl) loadingEl.remove();
/*L1284*/     const addressEl = document.getElementById('locAddress');
/*L1285*/     if (addressEl) addressEl.textContent = '地図機能のロードに失敗しました。';
/*L1286*/   }
/*L1287*/ }
/*L1288*/ 
/*L1289*/ window.addEventListener('DOMContentLoaded', initializeWhenReady);
