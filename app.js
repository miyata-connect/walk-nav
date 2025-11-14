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
/* L039 */   const paneSearch = document.getElementById('tabPaneSearch');
/* L040 */   const paneNav = document.getElementById('tabPaneNav');
/* L041 */   const paneSettings = document.getElementById('tabPaneSettings');
/* L042 */   if (paneSearch && paneNav && paneSettings) {
/* L043 */     paneSearch.classList.toggle('active', !isNav && !isSettings);
/* L044 */     paneNav.classList.toggle('active', isNav);
/* L045 */     paneSettings.classList.toggle('active', isSettings);
/* L046 */   }
/* L047 */   const target = isSettings ? 'settings' : (isNav ? 'nav' : 'search');
/* L048 */   document.querySelectorAll('[data-panel-tab]').forEach(btn => {
/* L049 */     const active = btn.dataset.panelTab === target;
/* L050 */     btn.classList.toggle('active', active);
/* L051 */   });
/* L052 */ }
/* L053 */ 
/* L054 */ function updateNavigationUI(isNavigating) {
/* L055 */   const routeInfoSection = document.getElementById('routeInfoSection');
/* L056 */   const incidentSection = document.getElementById('incidentSection');
/* L057 */   const instructionsSection = document.getElementById('instructionsSection');
/* L058 */   const routeControlSection = document.getElementById('routeControlSection');
/* L059 */   if (routeInfoSection) routeInfoSection.style.display = isNavigating ? 'block' : 'none';
/* L060 */   if (instructionsSection) instructionsSection.style.display = isNavigating ? 'block' : 'none';
/* L061 */   if (routeControlSection) routeControlSection.style.display = isNavigating ? 'block' : 'none';
/* L062 */ }
/* L063 */ 
/* L064 */ async function fetchWithRetry(url, options = {}, retries = MAX_RETRY) {
/* L065 */   for (let i = 0; i < retries; i++) {
/* L066 */     try {
/* L067 */       const response = await fetch(url, options);
/* L068 */       if (!response.ok && i < retries - 1) {
/* L069 */         await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (i + 1)));
/* L070 */         continue;
/* L071 */       }
/* L072 */       return response;
/* L073 */     } catch (error) {
/* L074 */       if (i === retries - 1) throw error;
/* L075 */       await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (i + 1)));
/* L076 */     }
/* L077 */   }
/* L078 */ }
/* L079 */ 
/* L080 */ async function placesTextSearch(payload, fieldMask) {
/* L081 */   try {
/* L082 */     const resp = await fetchWithRetry(`${WORKER_ORIGIN}/places:searchText`, {
/* L083 */       method: 'POST',
/* L084 */       headers: {
/* L085 */         'Content-Type': 'application/json',
/* L086 */         ...(fieldMask ? { 'X-Goog-FieldMask': fieldMask } : {})
/* L087 */       },
/* L088 */       body: JSON.stringify(payload)
/* L089 */     });
/* L090 */     if (!resp.ok) {
/* L091 */       const text = await resp.text();
/* L092 */       throw new Error(`TextSearch ${resp.status}: ${text}`);
/* L093 */     }
/* L094 */     return await resp.json();
/* L095 */   } catch (error) {
/* L096 */     throw error;
/* L097 */   }
/* L098 */ }
/* L099 */ 
/* L100 */ async function placesNearby(payload, fieldMask) {
/* L101 */   try {
/* L102 */     const resp = await fetchWithRetry(`${WORKER_ORIGIN}/places:searchNearby`, {
/* L103 */       method: 'POST',
/* L104 */       headers: {
/* L105 */         'Content-Type': 'application/json',
/* L106 */         ...(fieldMask ? { 'X-Goog-FieldMask': fieldMask } : {})
/* L107 */       },
/* L108 */       body: JSON.stringify(payload)
/* L109 */     });
/* L110 */     if (!resp.ok) {
/* L111 */       const text = await resp.text();
/* L112 */       throw new Error(`Nearby ${resp.status}: ${text}`);
/* L113 */     }
/* L114 */     return await resp.json();
/* L115 */   } catch (error) {
/* L116 */     throw error;
/* L117 */   }
/* L118 */ }
/* L119 */ 
/* L120 */ function initMap(center) {
/* L121 */   if (!appState.map) {
/* L122 */     appState.map = new google.maps.Map(document.getElementById('map'), {
/* L123 */       center,
/* L124 */       zoom: 17,
/* L125 */       mapId: '9110fb2763169e9d8f2b317e',
/* L126 */       gestureHandling: 'greedy',
/* L127 */       clickableIcons: true,
/* L128 */       disableDefaultUI: true
/* L129 */     });
/* L130 */     appState.map.addListener('click', (e) => {
/* L131 */       if (!appState.pointSearchMode) return;
/* L132 */       if (e.latLng) {
/* L133 */         setSearchPoint(e.latLng.lat(), e.latLng.lng());
/* L134 */       }
/* L135 */     });
/* L136 */   } else {
/* L137 */     appState.map.setCenter(center);
/* L138 */   }
/* L139 */   appState.mapInitialized = true;
/* L140 */ }
/* L141 */ 
/* L142 */ function setUserMarker(lat, lng) {
/* L143 */   appState.currentPos = { lat, lng };
/* L144 */   if (!appState.userMarker) {
/* L145 */     const pin = document.createElement('div');
/* L146 */     pin.style.width = '32px';
/* L147 */     pin.style.height = '32px';
/* L148 */     pin.innerHTML = `
/* L149 */       <svg id="user-marker-icon" viewBox="0 0 24 24" 
/* L150 */             style="width:100%;height:100%;transform:rotate(${appState.currentHeading}deg);transition:transform 0.2s ease-out;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.4));">
/* L151 */         <path d="M12 2L4.5 20.5L12 16.5L19.5 20.5L12 2Z"
/* L152 */               fill="#3aa0ff" stroke="#ffffff" stroke-width="2" stroke-linejoin="round" />
/* L153 */       </svg>
/* L154 */     `;
/* L155 */     appState.userMarker = new google.maps.marker.AdvancedMarkerElement({
/* L156 */       map: appState.map,
/* L157 */       position: { lat, lng },
/* L158 */       content: pin,
/* L159 */       zIndex: 1000
/* L160 */     });
/* L161 */   } else {
/* L162 */     appState.userMarker.position = { lat, lng };
/* L163 */   }
/* L164 */ }
/* L165 */ 
/* L166 */ function setSearchPoint(lat, lng) {
/* L167 */   appState.searchPoint = { lat, lng };
/* L168 */   if (appState.searchPointMarker) appState.searchPointMarker.map = null;
/* L169 */   const pin = document.createElement('div');
/* L170 */   pin.style.width = '30px';
/* L171 */   pin.style.height = '30px';
/* L172 */   pin.style.borderRadius = '50% 50% 50% 0';
/* L173 */   pin.style.background = '#ff6565';
/* L174 */   pin.style.border = '3px solid #fff';
/* L175 */   pin.style.transform = 'rotate(-45deg)';
/* L176 */   pin.style.boxShadow = '0 4px 8px rgba(0,0,0,.3)';
/* L177 */   pin.style.transition = 'all 0.3s ease-out';
/* L178 */   appState.searchPointMarker = new google.maps.marker.AdvancedMarkerElement({
/* L179 */     map: appState.map,
/* L180 */     position: { lat, lng },
/* L181 */     content: pin,
/* L182 */     zIndex: 999
/* L183 */   });
/* L184 */   fetchPointAddress(lat, lng);
/* L185 */ }
/* L186 */ 
/* L187 */ function calculateDistance(lat1, lon1, lat2, lon2) {
/* L188 */   const R = 6371000;
/* L189 */   const dLat = (lat2 - lat1) * Math.PI / 180;
/* L190 */   const dLon = (lon2 - lon1) * Math.PI / 180;
/* L191 */   const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
/* L192 */     Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
/* L193 */     Math.sin(dLon / 2) * Math.sin(dLon / 2);
/* L194 */   const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
/* L195 */   return R * c;
/* L196 */ }
/* L197 */ 
/* L198 */ function readLegDistanceText(leg) {
/* L199 */   if (leg && leg.distance && leg.distance.text) return leg.distance.text;
/* L200 */   if (leg && typeof leg.distanceMeters === 'number') {
/* L201 */     const km = (leg.distanceMeters / 1000).toFixed(1);
/* L202 */     return `${km} km`;
/* L203 */   }
/* L204 */   if (leg && leg.localizedValues && leg.localizedValues.distance && leg.localizedValues.distance.text) {
/* L205 */     return leg.localizedValues.distance.text;
/* L206 */   }
/* L207 */   return '--';
/* L208 */ }
/* L209 */ 
/* L210 */ function readLegDurationText(leg) {
/* L211 */   if (leg && leg.duration && leg.duration.text) return leg.duration.text;
/* L212 */   if (leg && typeof leg.duration === 'string' && leg.duration.endsWith('s')) {
/* L213 */     const sec = parseInt(leg.duration.replace('s', ''), 10) || 0;
/* L214 */     const min = Math.max(1, Math.round(sec / 60));
/* L215 */     return `${min} 分`;
/* L216 */   }
/* L217 */   if (leg && leg.localizedValues && leg.localizedValues.duration && leg.localizedValues.duration.text) {
/* L218 */     return leg.localizedValues.duration.text;
/* L219 */   }
/* L220 */   return '--';
/* L221 */ }
/* L222 */ 
/* L223 */ function getEncodedPolylineFromRoute(route) {
/* L224 */   if (route && route.overview_polyline && route.overview_polyline.points) return route.overview_polyline.points;
/* L225 */   if (route && route.polyline && route.polyline.encodedPolyline) return route.polyline.encodedPolyline;
/* L226 */   if (route && route.overviewPolyline && route.overviewPolyline.encodedPolyline) return route.overviewPolyline.encodedPolyline;
/* L227 */   return null;
/* L228 */ }
/* L229 */ 
/* L230 */ function drawRoutePolyline(route) {
/* L231 */   if (appState.currentPolyline) {
/* L232 */     appState.currentPolyline.setMap(null);
/* L233 */     appState.currentPolyline = null;
/* L234 */   }
/* L235 */   const encoded = getEncodedPolylineFromRoute(route);
/* L236 */   if (!encoded || !google.maps.geometry || !google.maps.geometry.encoding) return;
/* L237 */   const path = google.maps.geometry.encoding.decodePath(encoded);
/* L238 */   appState.currentPolyline = new google.maps.Polyline({
/* L239 */     path,
/* L240 */     geodesic: true,
/* L241 */     strokeColor: '#62b5ff',
/* L242 */     strokeOpacity: 0.8,
/* L243 */     strokeWeight: 6,
/* L244 */     map: appState.map
/* L245 */   });
/* L246 */ }
/* L247 */ 
/* L248 */ const compassHandler = (event) => {
/* L249 */   if (appState.isNavigating) return;
/* L250 */   let heading = null;
/* L251 */   if (event.webkitCompassHeading) {
/* L252 */     heading = event.webkitCompassHeading;
/* L253 */   } else if (event.absolute === true && event.alpha !== null) {
/* L254 */     heading = event.alpha;
/* L255 */   }
/* L256 */   if (heading !== null) {
/* L257 */     appState.currentHeading = heading;
/* L258 */     updateMarkerRotation();
/* L259 */   }
/* L260 */ };
/* L261 */ 
/* L262 */ function startCompassListener() {
/* L263 */   if (appState.compassWatchId || !window.DeviceOrientationEvent) return;
/* L264 */   if (typeof DeviceOrientationEvent.requestPermission === 'function') {
/* L265 */     DeviceOrientationEvent.requestPermission().then(permissionState => {
/* L266 */       if (permissionState === 'granted') {
/* L267 */         window.addEventListener('deviceorientationabsolute', compassHandler, true);
/* L268 */         window.addEventListener('deviceorientation', compassHandler, true);
/* L269 */         appState.compassWatchId = 1;
/* L270 */       }
/* L271 */     }).catch(() => {});
/* L272 */   } else {
/* L273 */     window.addEventListener('deviceorientationabsolute', compassHandler, true);
/* L274 */     window.addEventListener('deviceorientation', compassHandler, true);
/* L275 */     appState.compassWatchId = 1;
/* L276 */   }
/* L277 */ }
/* L278 */ 
/* L279 */ function stopCompassListener() {
/* L280 */   if (appState.compassWatchId) {
/* L281 */     window.removeEventListener('deviceorientationabsolute', compassHandler, true);
/* L282 */     window.removeEventListener('deviceorientation', compassHandler, true);
/* L283 */     appState.compassWatchId = null;
/* L284 */   }
/* L285 */ }
/* L286 */ 
/* L287 */ function updateMarkerRotation() {
/* L288 */   const icon = document.getElementById('user-marker-icon');
/* L289 */   if (icon) icon.style.transform = `rotate(${appState.currentHeading}deg)`;
/* L290 */ }
/* L291 */ 
/* L292 */ function startLocationWatcher() {
/* L293 */   if (appState.locationWatchId) {
/* L294 */     navigator.geolocation.clearWatch(appState.locationWatchId);
/* L295 */     appState.locationWatchId = null;
/* L296 */   }
/* L297 */   const onWatchSuccess = (pos) => {
/* L298 */     const { latitude, longitude } = pos.coords;
/* L299 */     setUserMarker(latitude, longitude);
/* L300 */     fetchLocationNameGoogle(latitude, longitude);
/* L301 */     if (appState.isNavigating && !appState.isPaused) {
/* L302 */       appState.map.panTo({ lat: latitude, lng: longitude });
/* L303 */       if (appState.currentDestination && google.maps.geometry && google.maps.geometry.spherical) {
/* L304 */         const currentLatLng = new google.maps.LatLng(latitude, longitude);
/* L305 */         const destLatLng = new google.maps.LatLng(appState.currentDestination.lat, appState.currentDestination.lng);
/* L306 */         let headingDeg = google.maps.geometry.spherical.computeHeading(currentLatLng, destLatLng);
/* L307 */         if (headingDeg < 0) headingDeg += 360;
/* L308 */         appState.currentHeading = headingDeg;
/* L309 */         updateMarkerRotation();
/* L310 */       }
/* L311 */     }
/* L312 */   };
/* L313 */   const onWatchError = () => {
/* L314 */     stopLocationWatcher();
/* L315 */   };
/* L316 */   appState.locationWatchId = navigator.geolocation.watchPosition(
/* L317 */     onWatchSuccess,
/* L318 */     onWatchError,
/* L319 */     LOCATION_OPTIONS
/* L320 */   );
/* L321 */ }
/* L322 */ 
/* L323 */ function stopLocationWatcher() {
/* L324 */   if (appState.locationWatchId) {
/* L325 */     navigator.geolocation.clearWatch(appState.locationWatchId);
/* L326 */     appState.locationWatchId = null;
/* L327 */   }
/* L328 */ }
/* L329 */ 
/* L330 */ async function startNavigation(destination) {
/* L331 */   let originLat;
/* L332 */   let originLng;
/* L333 */   if (appState.pointSearchMode && appState.searchPoint) {
/* L334 */     originLat = appState.searchPoint.lat;
/* L335 */     originLng = appState.searchPoint.lng;
/* L336 */     appState.isSimulation = true;
/* L337 */   } else if (appState.currentPos) {
/* L338 */     originLat = appState.currentPos.lat;
/* L339 */     originLng = appState.currentPos.lng;
/* L340 */     appState.isSimulation = false;
/* L341 */   } else {
/* L342 */     return;
/* L343 */   }
/* L344 */   appState.currentDestination = destination;
/* L345 */   appState.isNavigating = true;
/* L346 */   appState.isPaused = false;
/* L347 */   const searchPanelEl = document.getElementById('searchPanel');
/* L348 */   const fabStackEl = document.getElementById('fabStack');
/* L349 */   const appBodyEl = document.getElementById('appBody');
/* L350 */   if (searchPanelEl) searchPanelEl.style.display = 'block';
/* L351 */   if (fabStackEl) fabStackEl.style.display = 'flex';
/* L352 */   if (appBodyEl) appBodyEl.classList.add('panel-open');
/* L353 */   switchPanelTab('nav');
/* L354 */   updateNavigationUI(true);
/* L355 */   stopCompassListener();
/* L356 */   try {
/* L357 */     const response = await fetchWithRetry(`${WORKER_ORIGIN}/directions`, {
/* L358 */       method: 'POST',
/* L359 */       headers: { 'Content-Type': 'application/json' },
/* L360 */       body: JSON.stringify({
/* L361 */         origin: `${originLat},${originLng}`,
/* L362 */         destination: `${destination.lat},${destination.lng}`,
/* L363 */         mode: 'walking',
/* L364 */         language: 'ja'
/* L365 */       })
/* L366 */     });
/* L367 */     if (!response.ok) {
/* L368 */       const errorText = await response.text();
/* L369 */       throw new Error(`Directions API Error: ${response.status} - ${errorText}`);
/* L370 */     }
/* L371 */     const result = await response.json();
/* L372 */     if (result.routes && result.routes.length > 0) {
/* L373 */       const r0 = result.routes[0];
/* L374 */       const l0 = (r0.legs && r0.legs[0]) ? r0.legs[0] : null;
/* L375 */       const distanceText = l0 ? readLegDistanceText(l0) : '--';
/* L376 */       const durationText = l0 ? readLegDurationText(l0) : '--';
/* L377 */       const destNameEl = document.getElementById('destinationName');
/* L378 */       const routeDistEl = document.getElementById('routeDistance');
/* L379 */       const routeTimeEl = document.getElementById('routeTime');
/* L380 */       const resultsEl = document.getElementById('results');
/* L381 */       const btnDestEl = document.getElementById('btnDestination');
/* L382 */       if (destNameEl) destNameEl.textContent = destination.name;
/* L383 */       if (routeDistEl) routeDistEl.textContent = distanceText;
/* L384 */       if (routeTimeEl) routeTimeEl.textContent = `徒歩 ${durationText}`;


```javascript
/* L385 */       if (searchPanelEl) searchPanelEl.style.display = 'block';
/* L386 */       if (resultsEl) resultsEl.style.display = 'none';
/* L387 */       if (btnDestEl) btnDestEl.style.display = 'flex';
/* L388 */       const instructionsList = document.getElementById('navPanelInstructions');
/* L389 */       if (instructionsList) {
/* L390 */         instructionsList.innerHTML = '';
/* L391 */         if (l0 && l0.steps && l0.steps.length > 0) {
/* L392 */           l0.steps.forEach(step => {
/* L393 */             const item = document.createElement('div');
/* L394 */             item.className = 'nav-instruction-item';
/* L395 */             const cleanInstruction = (step.html_instructions || '').replace(/<[^>]+>/g, ' ');
/* L396 */             item.textContent = `${cleanInstruction} (${step.distance.text})`;
/* L397 */             instructionsList.appendChild(item);
/* L398 */           });
/* L399 */         }
/* L400 */       }
/* L401 */       appState.currentRouteData = {
/* L402 */         steps: l0 ? l0.steps : null,
/* L403 */         summary: r0.summary,
/* L404 */         distance: distanceText,
/* L405 */         duration: durationText,
/* L406 */         destinationName: destination.name,
/* L407 */         warnings: r0.warnings || []
/* L408 */       };
/* L409 */       const incidentSection = document.getElementById('incidentSection');
/* L410 */       const incidentText = document.getElementById('incidentText');
/* L411 */       if (r0.warnings && r0.warnings.length > 0 && incidentSection && incidentText) {
/* L412 */         incidentText.innerHTML = r0.warnings.map(w => w.replace(/<[^>]+>/g, ' ')).join('<br>');
/* L413 */         incidentSection.style.display = 'block';
/* L414 */       } else if (incidentSection) {
/* L415 */         incidentSection.style.display = 'none';
/* L416 */       }
/* L417 */       await fetchWeather(originLat, originLng);
/* L418 */       if (appState.isSimulation) {
/* L419 */         setUserMarker(originLat, originLng);
/* L420 */         fetchLocationNameGoogle(originLat, originLng);
/* L421 */         if (appState.currentDestination && google.maps.geometry && google.maps.geometry.spherical) {
/* L422 */           const currentLatLng = new google.maps.LatLng(originLat, originLng);
/* L423 */           const destLatLng = new google.maps.LatLng(appState.currentDestination.lat, appState.currentDestination.lng);
/* L424 */           let headingDeg = google.maps.geometry.spherical.computeHeading(currentLatLng, destLatLng);
/* L425 */           if (headingDeg < 0) headingDeg += 360;
/* L426 */           appState.currentHeading = headingDeg;
/* L427 */           updateMarkerRotation();
/* L428 */         }
/* L429 */       } else {
/* L430 */         startLocationWatcher();
/* L431 */       }
/* L432 */       drawRoutePolyline(r0);
/* L433 */       const bounds = new google.maps.LatLngBounds();
/* L434 */       bounds.extend(new google.maps.LatLng(originLat, originLng));
/* L435 */       bounds.extend(new google.maps.LatLng(destination.lat, destination.lng));
/* L436 */       appState.map.fitBounds(bounds, { top: 100, right: 150, bottom: 300, left: 50 });
/* L437 */       setTimeout(() => {
/* L438 */         appState.map.panTo({ lat: destination.lat, lng: destination.lng });
/* L439 */         appState.map.setZoom(18);
/* L440 */         setTimeout(() => {
/* L441 */           appState.map.panTo({ lat: originLat, lng: originLng });
/* L442 */           appState.map.setZoom(18);
/* L443 */         }, 2000);
/* L444 */       }, 2000);
/* L445 */     } else {
/* L446 */       throw new Error('ルートが取得できませんでした');
/* L447 */     }
/* L448 */   } catch (error) {
/* L449 */     appState.isNavigating = false;
/* L450 */     appState.isSimulation = false;
/* L451 */     updateNavigationUI(false);
/* L452 */     if (fabStackEl) fabStackEl.style.display = 'none';
/* L453 */     startCompassListener();
/* L454 */   }
/* L455 */ }
/* L456 */ 
/* L457 */ function stopNavigation() {
/* L458 */   stopLocationWatcher();
/* L459 */   startCompassListener();
/* L460 */   appState.isSimulation = false;
/* L461 */   appState.currentRouteData = null;
/* L462 */   if (appState.currentPolyline) {
/* L463 */     appState.currentPolyline.setMap(null);
/* L464 */     appState.currentPolyline = null;
/* L465 */   }
/* L466 */   appState.currentDestination = null;
/* L467 */   appState.isNavigating = false;
/* L468 */   appState.isPaused = false;
/* L469 */   updateNavigationUI(false);
/* L470 */   const instructionsList = document.getElementById('navPanelInstructions');
/* L471 */   if (instructionsList) instructionsList.innerHTML = '';
/* L472 */   const incidentSection = document.getElementById('incidentSection');
/* L473 */   if (incidentSection) incidentSection.style.display = 'none';
/* L474 */   const searchPanel = document.getElementById('searchPanel');
/* L475 */   const btnDestination = document.getElementById('btnDestination');
/* L476 */   const qInput = document.getElementById('q');
/* L477 */   const results = document.getElementById('results');
/* L478 */   if (searchPanel) searchPanel.style.display = 'block';
/* L479 */   if (btnDestination) btnDestination.style.display = 'none';
/* L480 */   if (qInput) qInput.value = '';
/* L481 */   if (results) {
/* L482 */     results.style.display = 'none';
/* L483 */     results.innerHTML = '';
/* L484 */   }
/* L485 */   const weather3h = document.getElementById('weather3h');
/* L486 */   const weather6h = document.getElementById('weather6h');
/* L487 */   const weather9h = document.getElementById('weather9h');
/* L488 */   if (weather3h) weather3h.textContent = '--';
/* L489 */   if (weather6h) weather6h.textContent = '--';
/* L490 */   if (weather9h) weather9h.textContent = '--';
/* L491 */   const fabStack = document.getElementById('fabStack');
/* L492 */   const btnSearch = document.getElementById('btnSearch');
/* L493 */   if (fabStack) fabStack.style.display = 'none';
/* L494 */   if (btnSearch) btnSearch.style.display = 'flex';
/* L495 */   const btnPauseSettings = document.getElementById('btnPauseSettings');
/* L496 */   if (btnPauseSettings) {
/* L497 */     btnPauseSettings.textContent = '⏸️ 一時停止';
/* L498 */     btnPauseSettings.classList.remove('paused');
/* L499 */   }
/* L500 */   appState.searchMarkers.forEach(marker => marker.map = null);
/* L501 */   appState.searchMarkers = [];
/* L502 */   if (appState.currentPos && appState.map) {
/* L503 */     appState.map.panTo(appState.currentPos);
/* L504 */     appState.map.setZoom(17);
/* L505 */   }
/* L506 */   updateMarkerRotation();
/* L507 */   const appBody = document.getElementById('appBody');
/* L508 */   if (appBody) appBody.classList.add('panel-open');
/* L509 */   switchPanelTab('search');
/* L510 */ }
/* L511 */ 
/* L512 */ function togglePause() {
/* L513 */   if (appState.isSimulation) return;
/* L514 */   if (!appState.isNavigating) return;
/* L515 */   appState.isPaused = !appState.isPaused;
/* L516 */   const btnPauseSettings = document.getElementById('btnPauseSettings');
/* L517 */   if (appState.isPaused) {
/* L518 */     if (btnPauseSettings) {
/* L519 */       btnPauseSettings.textContent = '▶️ 再開';
/* L520 */       btnPauseSettings.classList.add('paused');
/* L521 */     }
/* L522 */   } else {
/* L523 */     if (btnPauseSettings) {
/* L524 */       btnPauseSettings.textContent = '⏸️ 一時停止';
/* L525 */       btnPauseSettings.classList.remove('paused');
/* L526 */     }
/* L527 */     if (appState.currentPos) {
/* L528 */       appState.map.panTo(appState.currentPos);
/* L529 */       appState.map.setZoom(18);
/* L530 */     }
/* L531 */   }
/* L532 */ }
/* L533 */ 
/* L534 */ const TYPE_MAP = {
/* L535 */   "コンビニ": "convenience_store",
/* L536 */   "スーパー": "supermarket",
/* L537 */   "レストラン": "restaurant",
/* L538 */   "カフェ": "cafe",
/* L539 */   "ホテル": "lodging",
/* L540 */   "病院": "hospital",
/* L541 */   "薬局": "pharmacy",
/* L542 */   "ガソリンスタンド": "gas_station",
/* L543 */   "駐車場": "parking",
/* L544 */   "銀行": "bank"
/* L545 */ };
/* L546 */ 
/* L547 */ async function performSearch(query) {
/* L548 */   if (!query || !query.trim()) return;
/* L549 */   let centerLat;
/* L550 */   let centerLng;
/* L551 */   if (appState.pointSearchMode && appState.searchPoint) {
/* L552 */     centerLat = appState.searchPoint.lat;
/* L553 */     centerLng = appState.searchPoint.lng;
/* L554 */   } else if (appState.currentPos) {
/* L555 */     centerLat = appState.currentPos.lat;
/* L556 */     centerLng = appState.currentPos.lng;
/* L557 */   } else {
/* L558 */     return;
/* L559 */   }
/* L560 */   const radiusLabel = document.getElementById('radiusLabel');
/* L561 */   const radiusKm = radiusLabel ? parseInt(radiusLabel.textContent) : 10;
/* L562 */   const radiusMeters = radiusKm * 1000;
/* L563 */   try {
/* L564 */     const data = await placesTextSearch({
/* L565 */       textQuery: query.trim(),
/* L566 */       locationBias: {
/* L567 */         circle: { center: { latitude: centerLat, longitude: centerLng }, radius: radiusMeters }
/* L568 */       },
/* L569 */       maxResultCount: 20,
/* L570 */       languageCode: 'ja'
/* L571 */     }, DEFAULT_MASK);
/* L572 */     if (data.places && data.places.length) {
/* L573 */       displayResults(data.places, centerLat, centerLng);
/* L574 */       return;
/* L575 */     }
/* L576 */   } catch (e) {}
/* L577 */   const typeKey = TYPE_MAP[query.trim()] || TYPE_MAP[query.trim().replace(/\s/g, '')];
/* L578 */   if (typeKey) {
/* L579 */     try {
/* L580 */       const data = await placesNearby({
/* L581 */         includedTypes: [typeKey],
/* L582 */         maxResultCount: 20,
/* L583 */         locationRestriction: {
/* L584 */           circle: { center: { latitude: centerLat, longitude: centerLng }, radius: radiusMeters }
/* L585 */         },
/* L586 */         languageCode: 'ja'
/* L587 */       }, DEFAULT_MASK);
/* L588 */       if (data.places && data.places.length) {
/* L589 */         displayResults(data.places, centerLat, centerLng);
/* L590 */         return;
/* L591 */       }
/* L592 */     } catch (e) {}
/* L593 */   }
/* L594 */   const results = document.getElementById('results');
/* L595 */   if (results) results.style.display = 'none';
/* L596 */ }
/* L597 */ 
/* L598 */ function displayResults(places, centerLat, centerLng) {
/* L599 */   appState.searchMarkers.forEach(marker => marker.map = null);
/* L600 */   appState.searchMarkers = [];
/* L601 */   const placesWithDistance = places.map(place => {
/* L602 */     const lat = place.location.latitude;
/* L603 */     const lng = place.location.longitude;
/* L604 */     const distance = calculateDistance(centerLat, centerLng, lat, lng);
/* L605 */     return { ...place, distance };
/* L606 */   });
/* L607 */   placesWithDistance.sort((a, b) => a.distance - b.distance);
/* L608 */   const limitedResults = placesWithDistance.slice(0, 5);
/* L609 */   const resultsDiv = document.getElementById('results');
/* L610 */   if (!resultsDiv) return;
/* L611 */   resultsDiv.innerHTML = '';
/* L612 */   resultsDiv.style.display = 'block';
/* L613 */   limitedResults.forEach((place, index) => {
/* L614 */     const name = place.displayName && place.displayName.text ? place.displayName.text : (place.displayName || '名称不明');
/* L615 */     const address = place.formattedAddress || '住所不明';
/* L616 */     const lat = place.location.latitude;
/* L617 */     const lng = place.location.longitude;
/* L618 */     const distanceKm = (place.distance / 1000).toFixed(2);
/* L619 */     const item = document.createElement('div');
/* L620 */     item.className = 'result-item';
/* L621 */     item.innerHTML = `
/* L622 */       <div class="result-name">${index + 1}. ${name}</div>
/* L623 */       <div class="result-address">${address}</div>
/* L624 */       <div style="font-size:11px;color:#62b5ff;margin-top:4px">📍 ${distanceKm}km</div>
/* L625 */     `;
/* L626 */     item.onclick = () => {
/* L627 */       startNavigation({ name, lat, lng });
/* L628 */     };
/* L629 */     resultsDiv.appendChild(item);
/* L630 */     const markerPin = document.createElement('div');
/* L631 */     markerPin.style.width = '24px';
/* L632 */     markerPin.style.height = '24px';
/* L633 */     markerPin.style.borderRadius = '50%';
/* L634 */     markerPin.style.background = '#25d07a';
/* L635 */     markerPin.style.border = '2px solid #fff';
/* L636 */     markerPin.style.boxShadow = '0 2px 6px rgba(0,0,0,.3)';
/* L637 */     markerPin.style.display = 'flex';
/* L638 */     markerPin.style.alignItems = 'center';
/* L639 */     markerPin.style.justifyContent = 'center';
/* L640 */     markerPin.style.color = '#fff';
/* L641 */     markerPin.style.fontSize = '12px';
/* L642 */     markerPin.style.fontWeight = 'bold';
/* L643 */     markerPin.textContent = index + 1;
/* L644 */     const marker = new google.maps.marker.AdvancedMarkerElement({
/* L645 */       map: appState.map,
/* L646 */       position: { lat, lng },
/* L647 */       content: markerPin,
/* L648 */       zIndex: 500 + index,
/* L649 */       title: name
/* L650 */     });
/* L651 */     appState.searchMarkers.push(marker);
/* L652 */   });
/* L653 */ }
/* L654 */ 
/* L655 */ function initSpeechRecognition() {
/* L656 */   if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) return false;
/* L657 */   const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
/* L658 */   appState.recognition = new SpeechRecognition();
/* L659 */   appState.recognition.lang = 'ja-JP';
/* L660 */   appState.recognition.continuous = false;
/* L661 */   appState.recognition.interimResults = false;
/* L662 */   const btnVoiceIcon = document.getElementById('btnVoiceIcon');
/* L663 */   appState.recognition.onstart = () => {
/* L664 */     if (btnVoiceIcon) btnVoiceIcon.classList.add('recording');
/* L665 */   };
/* L666 */   appState.recognition.onresult = (event) => {
/* L667 */     const transcript = event.results[0][0].transcript;
/* L668 */     const qInput = document.getElementById('q');
/* L669 */     if (qInput) qInput.value = transcript;
/* L670 */     performSearch(transcript);
/* L671 */   };
/* L672 */   appState.recognition.onerror = () => {
/* L673 */     if (btnVoiceIcon) btnVoiceIcon.classList.remove('recording');
/* L674 */   };
/* L675 */   appState.recognition.onend = () => {
/* L676 */     if (btnVoiceIcon) btnVoiceIcon.classList.remove('recording');
/* L677 */   };
/* L678 */   return true;
/* L679 */ }
/* L680 */ 
/* L681 */ function startVoiceSearch() {
/* L682 */   if (!appState.recognition) {
/* L683 */     if (!initSpeechRecognition()) return;
/* L684 */   }
/* L685 */   try {
/* L686 */     appState.recognition.start();
/* L687 */   } catch (e) {
/* L688 */     appState.recognition.stop();
/* L689 */     setTimeout(() => {
/* L690 */       try {
/* L691 */         appState.recognition.start();
/* L692 */       } catch (e2) {}
/* L693 */     }, 100);
/* L694 */   }
/* L695 */ }
/* L696 */ 
/* L697 */ function pickBestGeocodeResult(results) {
/* L698 */   if (!Array.isArray(results) || results.length === 0) return null;
/* L699 */   const priorityTypes = ['street_address', 'premise', 'subpremise', 'route', 'plus_code'];
/* L700 */   for (const t of priorityTypes) {
/* L701 */     const candidate = results.find(r => Array.isArray(r.types) && r.types.includes(t));
/* L702 */     if (candidate && candidate.formatted_address) return candidate;
/* L703 */   }
/* L704 */   return results[0];
/* L705 */ }
/* L706 */ 
/* L707 */ function acquireLocation() {
/* L708 */   const onSuccess = (pos) => {
/* L709 */     const { latitude, longitude } = pos.coords;
/* L710 */     const loadingEl = document.getElementById('loading');
/* L711 */     if (loadingEl) loadingEl.remove();
/* L712 */     if (!appState.mapInitialized) {
/* L713 */       initMap({ lat: latitude, lng: longitude });
/* L714 */     } else {
/* L715 */       appState.map.setCenter({ lat: latitude, lng: longitude });
/* L716 */     }
/* L717 */     setUserMarker(latitude, longitude);
/* L718 */     fetchLocationNameGoogle(latitude, longitude);
/* L719 */     fetchWeather(latitude, longitude);
/* L720 */   };
/* L721 */   const onError = () => {
/* L722 */     const loadingEl = document.getElementById('loading');
/* L723 */     if (loadingEl) loadingEl.remove();
/* L724 */     if (!appState.mapInitialized) {
/* L725 */       initMap({ lat: 35.0, lng: 135.0 });
/* L726 */     }
/* L727 */     const addressElement = document.getElementById('locAddress');
/* L728 */     const coordsElement = document.getElementById('locCoords');
/* L729 */     if (addressElement) addressElement.textContent = '位置情報を確認できません';
/* L730 */     if (coordsElement) coordsElement.textContent = '現在地：取得失敗';
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
/* L958 */         dialog.remove();
/* L959 */       };
/* L960 */       renameInput.addEventListener('keypress', (e) => {
/* L961 */         if (e.key === 'Enter') document.getElementById('btnConfirmRename').click();
/* L962 */       });
/* L963 */     };
/* L964 */   });
/* L965 */   document.querySelectorAll('.location-item-btn.delete').forEach(btn => {
/* L966 */     btn.onclick = () => {
/* L967 */       const index = parseInt(btn.dataset.index);
/* L968 */       const loc = locations[index];
/* L969 */       const confirmDialog = createDialog({
/* L970 */         id: 'confirmDeleteDialog',
/* L971 */         content: `<h3 class="dialog-title">削除確認</h3><p class="dialog-text">「${loc.name}」を削除しますか？</p><div class="dialog-actions"><button id="btnCancelDelete" class="dialog-btn cancel">キャンセル</button><button id="btnConfirmDelete" class="dialog-btn delete">削除</button></div>`
/* L972 */       });
/* L973 */       document.getElementById('btnCancelDelete').onclick = () => confirmDialog.remove();
/* L974 */       document.getElementById('btnConfirmDelete').onclick = () => {
/* L975 */         locations.splice(index, 1);
/* L976 */         localStorage.setItem('savedLocations', JSON.stringify(locations));
/* L977 */         confirmDialog.remove();
/* L978 */         dialog.remove();
/* L979 */       };
/* L980 */     };
/* L981 */   });
/* L982 */ }
/* L983 */ 
/* L984 */ function exportRouteToClipboard() {
/* L985 */   if (!appState.currentRouteData) return;
/* L986 */   const data = appState.currentRouteData;
/* L987 */   let textOutput = `■ 目的地: ${data.destinationName}\n`;
/* L988 */   textOutput += `■ 概要: ${data.summary} (約 ${data.distance}, 徒歩 ${data.duration})\n\n`;
/* L989 */   if (data.warnings.length > 0) {
/* L990 */     textOutput += '■ 警告:\n';
/* L991 */     data.warnings.forEach(w => {
/* L992 */       textOutput += `・ ${w.replace(/<[^>]+>/g, ' ')}\n`;
/* L993 */     });
/* L994 */     textOutput += '\n';
/* L995 */   }
/* L996 */   textOutput += '■ 道順:\n';
/* L997 */   if (data.steps && data.steps.length > 0) {
/* L998 */     data.steps.forEach((step, index) => {
/* L999 */       const instruction = (step.html_instructions || '').replace(/<[^>]+>/g, ' ');
/*L1000*/       textOutput += `${index + 1}. ${instruction} (${step.distance.text})\n`;
/*L1001*/     });
/*L1002*/   } else {
/*L1003*/     textOutput += '詳細な道順はありません。\n';
/*L1004*/   }
/*L1005*/   if (navigator.clipboard) {
/*L1006*/     navigator.clipboard.writeText(textOutput).catch(() => {});
/*L1007*/   }
/*L1008*/ }
/*L1009*/ 
/*L1010*/ let lastLocateTime = 0;
/*L1011*/ 
/*L1012*/ function locateUser() {
/*L1013*/   if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
/*L1014*/     DeviceOrientationEvent.requestPermission().then(permissionState => {
/*L1015*/       if (permissionState === 'granted') {
/*L1016*/         stopCompassListener();
/*L1017*/         appState.compassWatchId = null;
/*L1018*/         startCompassListener();
/*L1019*/       }
/*L1020*/     }).catch(() => {});
/*L1021*/   }
/*L1022*/   const now = Date.now();
/*L1023*/   if (now - lastLocateTime < 1000) return;
/*L1024*/   lastLocateTime = now;
/*L1025*/   if (appState.currentPos && appState.map) {
/*L1026*/     appState.map.panTo(appState.currentPos);
/*L1027*/     appState.map.setZoom(18);
/*L1028*/   } else {
/*L1029*/     acquireLocation();
/*L1030*/   }
/*L1031*/ }
/*L1032*/ 
/*L1033*/ function bindKeyboardWatch() {
/*L1034*/   const searchInput = document.getElementById('q');
/*L1035*/   const searchPanel = document.getElementById('searchPanel');
/*L1036*/   const appBody = document.getElementById('appBody');
/*L1037*/   if (!searchInput || !searchPanel || !appBody) return;
/*L1038*/   searchInput.addEventListener('focus', () => {
/*L1039*/     appBody.classList.add('keyboard-open');
/*L1040*/     setTimeout(() => {
/*L1041*/       const inputTopInPanel = searchInput.offsetTop;
/*L1042*/       searchPanel.scrollTop = inputTopInPanel - 20;
/*L1043*/     }, 350);
/*L1044*/   });
/*L1045*/   searchInput.addEventListener('blur', () => {
/*L1046*/     appBody.classList.remove('keyboard-open');
/*L1047*/     searchPanel.scrollTop = 0;
/*L1048*/   });
/*L1049*/ }
/*L1050*/ 
/*L1051*/ function bindSearchPanelEvents() {
/*L1052*/   const radiusLabel = document.getElementById('radiusLabel');
/*L1053*/   const r10 = document.getElementById('r10');
/*L1054*/   const r20 = document.getElementById('r20');
/*L1055*/   const r30 = document.getElementById('r30');
/*L1056*/   const btnPointSearch = document.getElementById('btnPointSearch');
/*L1057*/   if (!radiusLabel || !r10 || !r20 || !r30 || !btnPointSearch) return;
/*L1058*/   r10.onclick = () => {
/*L1059*/     r10.classList.add('active');
/*L1060*/     r20.classList.remove('active');
/*L1061*/     r30.classList.remove('active');
/*L1062*/     radiusLabel.textContent = '10km';
/*L1063*/   };
/*L1064*/   r20.onclick = () => {
/*L1065*/     r20.classList.add('active');
/*L1066*/     r10.classList.remove('active');
/*L1067*/     r30.classList.remove('active');
/*L1068*/     radiusLabel.textContent = '20km';
/*L1069*/   };
/*L1070*/   r30.onclick = () => {
/*L1071*/     r30.classList.add('active');
/*L1072*/     r10.classList.remove('active');
/*L1073*/     r20.classList.remove('active');
/*L1074*/     radiusLabel.textContent = '30km';
/*L1075*/   };
/*L1076*/   btnPointSearch.onclick = () => {
/*L1077*/     appState.pointSearchMode = !appState.pointSearchMode;
/*L1078*/     if (appState.pointSearchMode) {
/*L1079*/       btnPointSearch.textContent = '📍 ポイント選択中...';
/*L1080*/       btnPointSearch.style.background = '#25d07a';
/*L1081*/       btnPointSearch.style.color = '#0a2818';
/*L1082*/       btnPointSearch.style.borderColor = 'transparent';
/*L1083*/     } else {
/*L1084*/       btnPointSearch.textContent = '📍 ポイント選択';
/*L1085*/       btnPointSearch.style.background = 'rgba(255,255,255,.08)';
/*L1086*/       btnPointSearch.style.color = 'var(--text)';
/*L1087*/       btnPointSearch.style.borderColor = 'var(--stroke)';
/*L1088*/     }
/*L1089*/   };
/*L1090*/ }
/*L1091*/ 
/*L1092*/ function bindLocationEvents() {
/*L1093*/   const btnSave = document.getElementById('btnSaveLocation');
/*L1094*/   const btnEdit = document.getElementById('btnEditLocation');
/*L1095*/   if (btnSave) btnSave.onclick = showSaveLocationDialog;
/*L1096*/   if (btnEdit) btnEdit.onclick = showEditLocationDialog;
/*L1097*/ }
/*L1098*/ 
/*L1099*/ function bindSearchEvents() {
/*L1100*/   const btnSearchIcon = document.getElementById('btnSearchIcon');
/*L1101*/   const qInput = document.getElementById('q');
/*L1102*/   const btnVoiceIcon = document.getElementById('btnVoiceIcon');
/*L1103*/   const btnReset = document.getElementById('btnReset');
/*L1104*/   const btnLocatePanel = document.getElementById('btnLocatePanel');
/*L1105*/   if (btnSearchIcon) {
/*L1106*/     btnSearchIcon.onclick = () => {
/*L1107*/       const q = document.getElementById('q');
/*L1108*/       if (q) {
/*L1109*/         const query = q.value.trim();
/*L1110*/         if (query) performSearch(query);
/*L1111*/       }
/*L1112*/     };
/*L1113*/   }
/*L1114*/   if (qInput) {
/*L1115*/     qInput.addEventListener('keypress', (e) => {
/*L1116*/       if (e.key === 'Enter') {
/*L1117*/         const query = qInput.value.trim();
/*L1118*/         if (query) performSearch(query);
/*L1119*/       }
/*L1120*/     });
/*L1121*/   }
/*L1122*/   if (btnVoiceIcon) btnVoiceIcon.onclick = startVoiceSearch;
/*L1123*/   if (btnReset) {
/*L1124*/     btnReset.onclick = () => {
/*L1125*/       const q = document.getElementById('q');
/*L1126*/       const results = document.getElementById('results');
/*L1127*/       if (q) q.value = '';
/*L1128*/       if (results) {
/*L1129*/         results.style.display = 'none';
/*L1130*/         results.innerHTML = '';
/*L1131*/       }
/*L1132*/       appState.searchMarkers.forEach(marker => marker.map = null);
/*L1133*/       appState.searchMarkers = [];
/*L1134*/       appState.searchPoint = null;
/*L1135*/       if (appState.searchPointMarker) {
/*L1136*/         appState.searchPointMarker.map = null;
/*L1137*/         appState.searchPointMarker = null;
/*L1138*/       }
/*L1139*/       const addressBlock = document.getElementById('pointAddressBlock');
/*L1140*/       const addressElement = document.getElementById('pointAddress');
/*L1141*/       const coordsElement = document.getElementById('pointCoords');
/*L1142*/       if (addressBlock) addressBlock.style.display = 'none';
/*L1143*/       if (addressElement) addressElement.textContent = '';
/*L1144*/       if (coordsElement) coordsElement.textContent = '';
/*L1145*/       appState.pointSearchMode = false;
/*L1146*/       const btnPointSearch = document.getElementById('btnPointSearch');
/*L1147*/       if (btnPointSearch) {
/*L1148*/         btnPointSearch.textContent = '📍 ポイント選択';
/*L1149*/         btnPointSearch.style.background = 'rgba(255,255,255,.08)';
/*L1150*/         btnPointSearch.style.color = 'var(--text)';
/*L1151*/         btnPointSearch.style.borderColor = 'var(--stroke)';
/*L1152*/       }
/*L1153*/       const r10 = document.getElementById('r10');
/*L1154*/       const r20 = document.getElementById('r20');
/*L1155*/       const r30 = document.getElementById('r30');
/*L1156*/       const radiusLabel = document.getElementById('radiusLabel');
/*L1157*/       if (r10) r10.classList.add('active');
/*L1158*/       if (r20) r20.classList.remove('active');
/*L1159*/       if (r30) r30.classList.remove('active');
/*L1160*/       if (radiusLabel) radiusLabel.textContent = '10km';
/*L1161*/     };
/*L1162*/   }
/*L1163*/   if (btnLocatePanel) btnLocatePanel.onclick = locateUser;
/*L1164*/ }
/*L1165*/ 
/*L1166*/ function bindFABEvents() {
/*L1167*/   const btnSearch = document.getElementById('btnSearch');
/*L1168*/   const btnClosePanel = document.getElementById('btnClosePanel');
/*L1169*/   const btnLocate = document.getElementById('btnLocate');
/*L1170*/   const btnDestination = document.getElementById('btnDestination');
/*L1171*/   if (btnSearch) {
/*L1172*/     btnSearch.onclick = () => {
/*L1173*/       const searchPanel = document.getElementById('searchPanel');
/*L1174*/       const fabStack = document.getElementById('fabStack');
/*L1175*/       const appBody = document.getElementById('appBody');
/*L1176*/       const instructionsList = document.getElementById('navPanelInstructions');
/*L1177*/       const incidentSection = document.getElementById('incidentSection');
/*L1178*/       if (searchPanel) searchPanel.style.display = 'block';
/*L1179*/       if (fabStack) fabStack.style.display = 'none';
/*L1180*/       if (appBody) appBody.classList.add('panel-open');
/*L1181*/       if (instructionsList) instructionsList.innerHTML = '';
/*L1182*/       if (incidentSection) incidentSection.style.display = 'none';
/*L1183*/       switchPanelTab('search');
/*L1184*/     };
/*L1185*/   }
/*L1186*/   if (btnClosePanel) {
/*L1187*/     btnClosePanel.onclick = () => {
/*L1188*/       const searchPanel = document.getElementById('searchPanel');
/*L1189*/       const fabStack = document.getElementById('fabStack');
/*L1190*/       const appBody = document.getElementById('appBody');
/*L1191*/       if (searchPanel) searchPanel.style.display = 'none';
/*L1192*/       if (!appState.isNavigating) {
/*L1193*/         if (fabStack) fabStack.style.display = 'none';
/*L1194*/       } else {
/*L1195*/         if (fabStack) fabStack.style.display = 'flex';
/*L1196*/       }
/*L1197*/       if (appBody) appBody.classList.remove('panel-open');
/*L1198*/     };
/*L1199*/   }
/*L1200*/   if (btnLocate) btnLocate.onclick = locateUser;
/*L1201*/   if (btnDestination) {
/*L1202*/     btnDestination.onclick = () => {
/*L1203*/       if (appState.currentDestination && appState.map) {
/*L1204*/         appState.map.panTo({ lat: appState.currentDestination.lat, lng: appState.currentDestination.lng });
/*L1205*/         appState.map.setZoom(18);
/*L1206*/       }
/*L1207*/     };
/*L1208*/   }
/*L1209*/ }
/*L1210*/ 
/*L1211*/ function bindRoutePanelEvents() {
/*L1212*/   const btnStopRoute = document.getElementById('btnStopRoute');
/*L1213*/   if (btnStopRoute) btnStopRoute.onclick = stopNavigation;
/*L1214*/   const btnExportText = document.getElementById('btnExportText');
/*L1215*/   if (btnExportText) btnExportText.onclick = exportRouteToClipboard;
/*L1216*/   const btnPauseSettings = document.getElementById('btnPauseSettings');
/*L1217*/   if (btnPauseSettings) btnPauseSettings.onclick = togglePause;
/*L1218*/   const btnRerouteSettings = document.getElementById('btnRerouteSettings');
/*L1219*/   if (btnRerouteSettings) {
/*L1220*/     btnRerouteSettings.onclick = () => {
/*L1221*/       if (appState.currentDestination) {
/*L1222*/         startNavigation(appState.currentDestination);
/*L1223*/       }
/*L1224*/     };
/*L1225*/   }
/*L1226*/ }
/*L1227*/ 
/*L1228*/ function bindTabEvents() {
/*L1229*/   const tabButtons = document.querySelectorAll('[data-panel-tab]');
/*L1230*/   if (!tabButtons || tabButtons.length === 0) return;
/*L1231*/   tabButtons.forEach(btn => {
/*L1232*/     const mode = btn.dataset.panelTab;
/*L1233*/     btn.addEventListener('click', () => {
/*L1234*/       switchPanelTab(mode);
/*L1235*/     });
/*L1236*/     btn.addEventListener('keydown', (e) => {
/*L1237*/       if (e.key === 'Enter' || e.key === ' ') {
/*L1238*/         e.preventDefault();
/*L1239*/         switchPanelTab(mode);
/*L1240*/       }
/*L1241*/     });
/*L1242*/   });
/*L1243*/   switchPanelTab('search');
/*L1244*/ }
/*L1245*/ 
/*L1246*/ function bindUI() {
/*L1247*/   bindSearchPanelEvents();
/*L1248*/   bindLocationEvents();
/*L1249*/   bindSearchEvents();
/*L1250*/   bindFABEvents();
/*L1251*/   bindRoutePanelEvents();
/*L1252*/   bindKeyboardWatch();
/*L1253*/   bindTabEvents();
/*L1254*/ }
/*L1255*/ 
/*L1256*/ function startApp() {
/*L1257*/   document.documentElement.lang = 'ja';
/*L1258*/   const searchPanel = document.getElementById('searchPanel');
/*L1259*/   const fabStack = document.getElementById('fabStack');
/*L1260*/   const btnSearch = document.getElementById('btnSearch');
/*L1261*/   const appBody = document.getElementById('appBody');
/*L1262*/   if (searchPanel) searchPanel.style.display = 'block';
/*L1263*/   if (fabStack) fabStack.style.display = 'none';
/*L1264*/   if (btnSearch) btnSearch.style.display = 'flex';
/*L1265*/   if (appBody) appBody.classList.add('panel-open');
/*L1266*/   switchPanelTab('search');
/*L1267*/   bindUI();
/*L1268*/   acquireLocation();
/*L1269*/   initSpeechRecognition();
/*L1270*/   startCompassListener();
/*L1271*/ }
/*L1272*/ 
/*L1273*/ function initializeWhenReady() {
/*L1274*/   if (typeof google !== 'undefined' && google.maps && google.maps.Map) {
/*L1275*/     startApp();
/*L1276*/   } else {
/*L1277*/     setTimeout(initializeWhenReady, 100);
/*L1278*/   }
/*L1279*/ }
/*L1280*/ 
/*L1281*/ window.addEventListener('DOMContentLoaded', initializeWhenReady);
