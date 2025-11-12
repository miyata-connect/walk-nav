// L001 'use strict';
// L002 
// L003 // ==========================================
// L004 // 定数定義
// L005 // ==========================================
/* L006 */ const ISSUE_ID = 'idx202511050540'; // 更新：パネル表示ロジック、ボタン配置
/* L007 */ const API_KEY = 'AIzaSyBuX-4y1Cgl6jdKcHZWWlsoosDWK_RGqF0'; // Maps表示用のみ
/* L008 */ const WORKER_ORIGIN = 'https://ors-proxy.miyata-connect-jp.workers.dev';
/* L009 */ const DEFAULT_MASK = 'places.displayName,places.formattedAddress,places.location,places.id,places.types';
/* L010 */ const MAX_RETRY = 3;
/* L011 */ const RETRY_DELAY = 1000;
/* L012 */ const LOCATION_OPTIONS = {
/* L013 */   enableHighAccuracy: true,
/* L014 */   timeout: 30000,
/* L015 */   maximumAge: 0
/* L016 */ };
// L017 
// L018 // ==========================================
// L019 // 状態管理オブジェクト
// L020 // ==========================================
/* L021 */ const appState = {
/* L022 */   map: null,
/* L023 */   userMarker: null,
/* L024 */   currentPos: null,
/* L025 */   pointSearchMode: false,
/* L026 */   searchPoint: null,
/* L027 */   searchPointMarker: null,
/* L028 */   mapInitialized: false,
/* L029 */   searchMarkers: [],
/* L030 */   currentDestination: null,
/* L031 */   currentPolyline: null,
/* L032 */   recognition: null,
/* L033 */   isPaused: false,
/* L034 */   isNavigating: false,
/* L035 */   locationWatchId: null,
/* L036 */   compassWatchId: null,
/* L037 */   currentHeading: 0,
/* L038 */   isSimulation: false,
/* L039 */   currentRouteData: null
/* L040 */ };
// L041 
// L042 // ==========================================
// L043 // リトライ機能付きfetch
// L044 // ==========================================
/* L045 */ async function fetchWithRetry(url, options = {}, retries = MAX_RETRY) {
/* L046 */   for (let i = 0; i < retries; i++) {
/* L047 */     try {
/* L048 */       const response = await fetch(url, options);
/* L049 */       if (!response.ok && i < retries - 1) {
/* L050 */         console.log(`[Retry] ${i + 1}/${retries}: ${url}`);
/* L051 */         await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (i + 1)));
/* L052 */         continue;
/* L053 */       }
/* L054 */       return response;
/* L055 */     } catch (error) {
/* L056 */       if (i === retries - 1) throw error;
/* L057 */       console.log(`[Retry] ${i + 1}/${retries}: ${error.message}`);
/* L058 */       await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (i + 1)));
/* L059 */     }
/* L060 */   }
/* L061 */ }
// L062 
// L063 // ==========================================
// L064 // API (Worker経由)
// L065 // ==========================================
/* L066 */ async function placesTextSearch(payload, fieldMask) {
/* L067 */   try {
/* L068 */     const resp = await fetchWithRetry(`${WORKER_ORIGIN}/places:searchText`, {
/* L069 */       method: 'POST',
/* L070 */       headers: {
/* L071 */         'Content-Type': 'application/json',
/* L072 */         ...(fieldMask ? { 'X-Goog-FieldMask': fieldMask } : {})
/* L073 */       },
/* L074 */       body: JSON.stringify(payload)
/* L075 */     });
/* L076 */ 
/* L077 */     if (!resp.ok) {
/* L078 */       const text = await resp.text();
/* L079 */       throw new Error(`TextSearch ${resp.status}: ${text}`);
/* L080 */     }
/* L081 */     return await resp.json();
/* L082 */   } catch (error) {
/* L083 */     console.error(`検索エラー: ${error.message}`);
/* L084 */     throw error;
/* L085 */   }
/* L086 */ }
/* L087 */ 
/* L088 */ async function placesNearby(payload, fieldMask) {
/* L089 */   try {
/* L090 */     const resp = await fetchWithRetry(`${WORKER_ORIGIN}/places:searchNearby`, {
/* L091 */       method: 'POST',
/* L092 */       headers: {
/* L093 */         'Content-Type': 'application/json',
/* L094 */         ...(fieldMask ? { 'X-Goog-FieldMask': fieldMask } : {})
/* L095 */       },
/* L096 */       body: JSON.stringify(payload)
/* L097 */     });
/* L098 */ 
/* L099 */     if (!resp.ok) {
/* L100 */       const text = await resp.text();
/* L101 */       throw new Error(`Nearby ${resp.status}: ${text}`);
/* L102 */     }
/* L103 */     return await resp.json();
/* L104 */   } catch (error) {
/* L105 */     console.error(`検索エラー: ${error.message}`);
/* L106 */     throw error;
/* L107 */   }
/* L108 */ }
// L109 
// L110 // ==========================================
// L111 // 地図初期化
// L112 // ==========================================
/* L113 */ function initMap(center) {
/* L114 */   if (!appState.map) {
/* L115 */     appState.map = new google.maps.Map(document.getElementById('map'), {
/* L116 */       center,
/* L117 */       zoom: 17,
/* L118 */       mapId: 'DEMO_MAP',
/* L119 */       gestureHandling: 'greedy',
/* L120 */       clickableIcons: true,
/* L121 */       disableDefaultUI: true
/* L122 */     });
/* L123 */ 
/* L124 */     appState.map.addListener('click', (e) => {
/* L125 */       if (!appState.pointSearchMode) return;
/* L126 */       if (e.latLng) {
/* L127 */         setSearchPoint(e.latLng.lat(), e.latLng.lng());
/* L128 */       }
/* L129 */     });
/* L130 */     console.log('[WalkNav] Map initialized');
/* L131 */   } else {
/* L132 */     appState.map.setCenter(center);
/* L133 */     console.log('[WalkNav] Map center updated');
/* L134 */   }
/* L135 */   appState.mapInitialized = true;
/* L136 */ }
// L137 
// L138 // ==========================================
// L139 // ユーザー位置マーカー設定 (SVG矢印)
// L140 // ==========================================
/* L141 */ function setUserMarker(lat, lng) {
/* L142 */   appState.currentPos = { lat, lng };
/* L143 */ 
/* L144 */   if (!appState.userMarker) {
/* L145 */     const pin = document.createElement('div');
/* L146 */     pin.style.width = '32px';
/* L147 */     pin.style.height = '32px';
/* L148 */ 
/* L149 */     pin.innerHTML = `
/* L150 */       <svg id="user-marker-icon" viewBox="0 0 24 24" 
/* L151 */             style="width: 100%; height: 100%;
/* L152 */                    transform: rotate(${appState.currentHeading}deg);
/* L153 */                    transition: transform 0.2s ease-out;
/* L154 */                    filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4));">
/* L155 */         <path d="M12 2L4.5 20.5L12 16.5L19.5 20.5L12 2Z"
/* L156 */               fill="#3aa0ff"
/* L157 */               stroke="#ffffff"
/* L158 */               stroke-width="2"
/* L159 */               stroke-linejoin="round" />
/* L160 */       </svg>
/* L161 */     `;
/* L162 */ 
/* L163 */     appState.userMarker = new google.maps.marker.AdvancedMarkerElement({
/* L164 */       map: appState.map,
/* L165 */       position: { lat, lng },
/* L166 */       content: pin,
/* L167 */       zIndex: 1000
/* L168 */     });
/* L169 */ 
/* L170 */   } else {
/* L171 */     appState.userMarker.position = { lat, lng };
/* L172 */   }
/* L173 */ }
// L174 
// L175 // ==========================================
// L176 // 検索地点設定
// L177 // ==========================================
/* L178 */ function setSearchPoint(lat, lng) {
/* L179 */   appState.searchPoint = { lat, lng };
/* L180 */ 
/* L181 */   if (appState.searchPointMarker) {
/* L182 */     appState.searchPointMarker.map = null;
/* L183 */   }
/* L184 */ 
/* L185 */   const pin = document.createElement('div');
/* L186 */   pin.style.width = '30px';
/* L187 */   pin.style.height = '30px';
/* L188 */   pin.style.borderRadius = '50% 50% 50% 0';
/* L189 */   pin.style.background = '#ff6565';
/* L190 */   pin.style.border = '3px solid #fff';
/* L191 */   pin.style.transform = 'rotate(-45deg)';
/* L192 */   pin.style.boxShadow = '0 4px 8px rgba(0,0,0,.3)';
/* L193 */   pin.style.transition = 'all 0.3s ease-out';
/* L194 */ 
/* L195 */   appState.searchPointMarker = new google.maps.marker.AdvancedMarkerElement({
/* L196 */     map: appState.map,
/* L197 */     position: { lat, lng },
/* L198 */     content: pin,
/* L199 */     zIndex: 999
/* L200 */   });
/* L201 */ 
/* L202 */   console.log(`[WalkNav] 検索地点設定: ${lat.toFixed(6)}, ${lng.toFixed(6)}`);
/* L203 */   console.log('検索地点を設定しました');
/* L204 */ 
/* L205 */   fetchPointAddress(lat, lng);
/* L206 */ }
// L207 
// L208 // ==========================================
// L209 // 距離計算
// L210 // ==========================================
/* L211 */ function calculateDistance(lat1, lon1, lat2, lon2) {
/* L212 */   const R = 6371000;
/* L213 */   const dLat = (lat2 - lat1) * Math.PI / 180;
/* L214 */   const dLon = (lon2 - lon1) * Math.PI / 180;
/* L215 */   const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
/* L216 */             Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
/* L217 */             Math.sin(dLon / 2) * Math.sin(dLon / 2);
/* L218 */   const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
/* L219 */   return R * c;
/* L220 */ }
// L221 
// L222 // ==========================================
// L223 // レスポンスから距離/時間を取得
// L224 // ==========================================
/* L225 */ function readLegDistanceText(leg) {
/* L226 */   if (leg?.distance?.text) return leg.distance.text;
/* L227 */   if (typeof leg?.distanceMeters === 'number') {
/* L228 */     const km = (leg.distanceMeters / 1000).toFixed(1);
/* L229 */     return `${km} km`;
/* L230 */   }
/* L231 */   return leg?.localizedValues?.distance?.text || '--';
/* L232 */ }
/* L233 */ 
/* L234 */ function readLegDurationText(leg) {
/* L235 */   if (leg?.duration?.text) return leg.duration.text;
/* L236 */   if (typeof leg?.duration === 'string' && leg.duration.endsWith('s')) {
/* L237 */     const sec = parseInt(leg.duration.replace('s', ''), 10) || 0;
/* L238 */     const min = Math.max(1, Math.round(sec / 60));
/* L239 */     return `${min} 分`;
/* L240 */   }
/* L241 */   return leg?.localizedValues?.duration?.text || '--';
/* L242 */ }
// L243 
// L244 // ==========================================
// L245 // エンコードされたポリラインを取得
// L246 // ==========================================
/* L247 */ function getEncodedPolylineFromRoute(route) {
/* L248 */   if (route?.overview_polyline?.points) return route.overview_polyline.points;
/* L249 */   if (route?.polyline?.encodedPolyline) return route.polyline.encodedPolyline;
/* L250 */   if (route?.overviewPolyline?.encodedPolyline) return route.overviewPolyline.encodedPolyline;
/* L251 */   return null;
/* L252 */ }
// L253 
// L254 // ==========================================
// L255 // ルートポリライン描画
// L256 // ==========================================
/* L257 */ function drawRoutePolyline(route) {
/* L258 */   if (appState.currentPolyline) {
/* L259 */     appState.currentPolyline.setMap(null);
/* L260 */     appState.currentPolyline = null;
/* L261 */   }
/* L262 */ 
/* L263 */   const encoded = getEncodedPolylineFromRoute(route);
/* L264 */   if (!encoded) {
/* L265 */     console.error('[Navigation] No encoded polyline found');
/* L266 */     console.error('ルート線の取得に失敗しました');
/* L267 */     return;
/* L268 */   }
/* L269 */ 
/* L270 */   const path = google.maps.geometry.encoding.decodePath(encoded);
/* L271 */   appState.currentPolyline = new google.maps.Polyline({
/* L272 */     path: path,
/* L273 */     geodesic: true,
/* L274 */     strokeColor: '#62b5ff',
/* L275 */     strokeOpacity: 0.8,
/* L276 */     strokeWeight: 6,
/* L277 */     map: appState.map
/* L278 */   });
/* L279 */ 
/* L280 */   console.log('[Navigation] Polyline drawn');
/* L281 */ }
// L282 
// L283 // ==========================================
// L284 // コンパス（デバイスの向き）監視
// L285 // ==========================================
/* L286 */ const compassHandler = (event) => {
/* L287 */   if (appState.isNavigating) return;
/* L288 */   let heading = null;
/* L289 */   if (event.webkitCompassHeading) {
/* L290 */     heading = event.webkitCompassHeading;
/* L291 */   } else if (event.absolute === true && event.alpha !== null) {
/* L292 */     heading = event.alpha;
/* L293 */   }
/* L294 */   if (heading !== null) {
/* L295 */     appState.currentHeading = heading;
/* L296 */     updateMarkerRotation();
/* L297 */   }
/* L298 */ };
/* L299 */ 
/* L300 */ function startCompassListener() {
/* L301 */   if (appState.compassWatchId || !window.DeviceOrientationEvent) {
/* L302 */     if (!window.DeviceOrientationEvent) console.warn('[Compass] DeviceOrientationEvent is not supported.');
/* L303 */     return;
/* L304 */   }
/* L305 */   console.log('[Compass] Starting compass listener...');
/* L306 */   if (typeof DeviceOrientationEvent.requestPermission === 'function') {
/* L307 */     DeviceOrientationEvent.requestPermission()
/* L308 */       .then(permissionState => {
/* L309 */         if (permissionState === 'granted') {
/* L310 */           window.addEventListener('deviceorientationabsolute', compassHandler, true);
/* L311 */           window.addEventListener('deviceorientation', compassHandler, true);
/* L312 */           appState.compassWatchId = 1;
/* L313 */         }
/* L314 */       })
/* L315 */       .catch(console.error);
/* L316 */   } else {
/* L317 */     window.addEventListener('deviceorientationabsolute', compassHandler, true);
/* L318 */     window.addEventListener('deviceorientation', compassHandler, true);
/* L319 */     appState.compassWatchId = 1;
/* L320 */   }
/* L321 */ }
/* L322 */ 
/* L323 */ function stopCompassListener() {
/* L324 */   if (appState.compassWatchId) {
/* L325 */     console.log('[Compass] Stopping compass listener...');
/* L326 */     window.removeEventListener('deviceorientationabsolute', compassHandler, true);
/* L327 */     window.removeEventListener('deviceorientation', compassHandler, true);
/* L328 */     appState.compassWatchId = null;
/* L329 */   }
/* L330 */ }
/* L331 */ 
/* L332 */ function updateMarkerRotation() {
/* L333 */   const icon = document.getElementById('user-marker-icon');
/* L334 */   if (icon) {
/* L335 */     icon.style.transform = `rotate(${appState.currentHeading}deg)`;
/* L336 */   }
/* L337 */ }
// L338 
// L339 // ==========================================
// L340 // リアルタイム位置情報監視（ナビ中）
// L341 // ==========================================
/* L342 */ function startLocationWatcher() {
/* L343 */   if (appState.locationWatchId) {
/* L344 */     navigator.geolocation.clearWatch(appState.locationWatchId);
/* L345 */     appState.locationWatchId = null;
/* L346 */   }
/* L347 */   console.log('[Location] Starting watchPosition (Nav Mode)...');
/* L348 */ 
/* L349 */   const onWatchSuccess = (pos) => {
/* L350 */     const { latitude, longitude } = pos.coords;
/* L351 */     console.log(`[Location] Watch update: ${latitude}, ${longitude}`);
/* L352 */ 
/* L353 */     setUserMarker(latitude, longitude);
/* L354 */     fetchLocationNameGoogle(latitude, longitude);
/* L355 */ 
/* L356 */     if (appState.isNavigating && !appState.isPaused) {
/* L357 */       appState.map.panTo({ lat: latitude, lng: longitude });
/* L358 */       if (appState.currentDestination && google.maps.geometry) {
/* L359 */         const currentLatLng = new google.maps.LatLng(latitude, longitude);
/* L360 */         const destLatLng = new google.maps.LatLng(appState.currentDestination.lat, appState.currentDestination.lng);
/* L361 */         let headingDeg = google.maps.geometry.spherical.computeHeading(currentLatLng, destLatLng);
/* L362 */         if (headingDeg < 0) { headingDeg += 360; }
/* L363 */         appState.currentHeading = headingDeg;
/* L364 */         updateMarkerRotation();
/* L365 */       }
/* L366 */     }
/* L367 */   };
/* L368 */ 
/* L369 */   const onWatchError = (error) => {
/* L370 */     console.error('[Location] Watch error:', error.message);
/* L371 */     console.error('リアルタイム位置情報の取得に失敗');
/* L372 */     stopLocationWatcher();
/* L373 */   };
/* L374 */ 
/* L375 */   appState.locationWatchId = navigator.geolocation.watchPosition(
/* L376 */     onWatchSuccess,
/* L377 */     onWatchError,
/* L378 */     LOCATION_OPTIONS
/* L379 */   );
/* L380 */ }
/* L381 */ 
/* L382 */ function stopLocationWatcher() {
/* L383 */   if (appState.locationWatchId) {
/* L384 */     console.log('[Location] Stopping watchPosition (Nav Mode)...');
/* L385 */     navigator.geolocation.clearWatch(appState.locationWatchId);
/* L386 */     appState.locationWatchId = null;
/* L387 */   }
/* L388 */ }
// L389 
// L390 // ==========================================
// L391 // ナビゲーション開始 (シミュレーション対応)
// L392 // ==========================================
/* L393 */ async function startNavigation(destination) {
/* L394 */   let originLat, originLng;
/* L395 */   if (appState.pointSearchMode && appState.searchPoint) {
/* L396 */     originLat = appState.searchPoint.lat;
/* L397 */     originLng = appState.searchPoint.lng;
/* L398 */     appState.isSimulation = true;
/* L399 */     console.log('[Navigation] シミュレーションモードで開始');
/* L400 */   } else if (appState.currentPos) {
/* L401 */     originLat = appState.currentPos.lat;
/* L402 */     originLng = appState.currentPos.lng;
/* L403 */     appState.isSimulation = false;
/* L404 */     console.log('[Navigation] リアルタイムモードで開始');
/* L405 */   } else {
/* L406 */     console.error('起点が設定されていません');
/* L407 */     return;
/* L408 */   }
/* L409 */ 
/* L410 */   appState.currentDestination = destination;
/* L411 */   appState.isNavigating = true;
/* L412 */   appState.isPaused = false;
/* L413 */ 
/* L414 */   document.getElementById('searchPanel').style.display = 'none';
/* L415 */   document.getElementById('fabStack').style.display = 'flex';
/* L416 */   document.getElementById('appBody').classList.remove('panel-open');
/* L417 */   stopCompassListener();
/* L418 */ 
/* L419 */   try {
/* L420 */     console.log('ルートを取得中...');
/* L421 */ 
/* L422 */     const response = await fetchWithRetry(`${WORKER_ORIGIN}/directions`, {
/* L423 */       method: 'POST',
/* L424 */       headers: { 'Content-Type': 'application/json' },
/* L425 */       body: JSON.stringify({
/* L426 */         origin: `${originLat},${originLng}`,
/* L427 */         destination: `${destination.lat},${destination.lng}`,
/* L428 */         mode: 'walking',
/* L429 */         language: 'ja'
/* L430 */       })
/* L431 */     });
/* L432 */ 
/* L433 */     if (!response.ok) {
/* L434 */       const errorText = await response.text();
/* L435 */       throw new Error(`Directions API Error: ${response.status} - ${errorText}`);
/* L436 */     }
/* L437 */ 
/* L438 */     const result = await response.json();
/* L439 */     console.log('[Navigation] Directions Response:', result);
/* L440 */ 
/* L441 */     if (result.routes && result.routes.length > 0) {
/* L442 */       const r0 = result.routes[0];
/* L443 */       const l0 = (r0.legs && r0.legs[0]) ? r0.legs[0] : null;
/* L444 */ 
/* L445 */       const distanceText = l0 ? readLegDistanceText(l0) : '--';
/* L446 */       const durationText = l0 ? readLegDurationText(l0) : '--';
/* L447 */ 
/* L448 */       document.getElementById('destinationName').textContent = destination.name;
/* L449 */       document.getElementById('routeDistance').textContent = distanceText;
/* L450 */       document.getElementById('routeTime').textContent = `徒歩 ${durationText}`;
\/* L451 */       document.getElementById('routePanel').style.display = 'block';
/* L452 */       document.getElementById('searchPanel').style.display = 'none';
/* L453 */       document.getElementById('results').style.display = 'none';
/* L454 */       document.getElementById('btnDestination').style.display = 'flex';
/* L455 */ 
/* L456 */       const instructionsList = document.getElementById('navPanelInstructions');
/* L457 */       instructionsList.innerHTML = '';
/* L458 */       if (l0 && l0.steps && l0.steps.length > 0) {
/* L459 */         l0.steps.forEach(step => {
/* L460 */           const item = document.createElement('div');
/* L461 */           item.className = 'nav-instruction-item';
/* L462 */           const cleanInstruction = (step.html_instructions || '').replace(/<[^>]+>/g, ' ');
/* L463 */           item.textContent = `${cleanInstruction} (${step.distance.text})`;
/* L464 */           instructionsList.appendChild(item);
/* L465 */         });
/* L466 */       }
/* L467 */       document.getElementById('navPanel').style.display = 'block';
/* L468 */ 
/* L469 */       appState.currentRouteData = {
/* L470 */         steps: l0?.steps,
/* L471 */         summary: r0.summary,
/* L472 */         distance: distanceText,
/* L473 */         duration: durationText,
/* L474 */         destinationName: destination.name,
/* L475 */         warnings: r0.warnings || []
/* L476 */       };
/* L477 */ 
/* L478 */       const incidentPanel = document.getElementById('incidentPanel');
/* L479 */       if (r0.warnings && r0.warnings.length > 0) {
/* L480 */         incidentPanel.innerHTML = '⚠️ ' + r0.warnings.map(w => w.replace(/<[^>]+>/g, ' ')).join('<br>⚠️ ');
/* L481 */         incidentPanel.style.display = 'block';
/* L482 */       } else {
/* L483 */         incidentPanel.style.display = 'none';
/* L484 */       }
/* L485 */ 
/* L486 */       await fetchWeather(originLat, originLng);
/* L487 */ 
/* L488 */       if (appState.isSimulation) {
/* L489 */         setUserMarker(originLat, originLng);
/* L490 */         fetchLocationNameGoogle(originLat, originLng);
/* L491 */         if (appState.currentDestination && google.maps.geometry) {
/* L492 */           const currentLatLng = new google.maps.LatLng(originLat, originLng);
/* L493 */           const destLatLng = new google.maps.LatLng(appState.currentDestination.lat, appState.currentDestination.lng);
/* L494 */           let headingDeg = google.maps.geometry.spherical.computeHeading(currentLatLng, destLatLng);
/* L495 */           if (headingDeg < 0) { headingDeg += 360; }
/* L496 */           appState.currentHeading = headingDeg;
/* L497 */           updateMarkerRotation();
/* L498 */         }
/* L499 */       } else {
/* L500 */         startLocationWatcher();
/* L501 */       }
/* L502 */ 
/* L503 */       drawRoutePolyline(r0);
/* L504 */ 
/* L505 */       const bounds = new google.maps.LatLngBounds();
/* L506 */       bounds.extend(new google.maps.LatLng(originLat, originLng));
/* L507 */       bounds.extend(new google.maps.LatLng(destination.lat, destination.lng));
/* L508 */       appState.map.fitBounds(bounds, { top: 100, right: 150, bottom: 300, left: 50 });
/* L509 */ 
/* L510 */       setTimeout(() => {
/* L511 */         appState.map.panTo({ lat: destination.lat, lng: destination.lng });
/* L512 */         appState.map.setZoom(18);
/* L513 */         setTimeout(() => {
/* L514 */           appState.map.panTo({ lat: originLat, lng: originLng });
/* L515 */           appState.map.setZoom(18);
/* L516 */         }, 2000);
/* L517 */       }, 2000);
/* L518 */ 
/* L519 */       console.log(`${destination.name} へのルート案内を開始`);
/* L520 */       console.log('[Navigation] ルート案内開始: ${destination.name}');
/* L521 */     } else {
/* L522 */       throw new Error('ルートが取得できませんでした');
/* L523 */     }
/* L524 */   } catch (error) {
/* L525 */     console.error('[Navigation] Error:', error);
/* L526 */    console.error(`ルートエラー: ${error.message}`);
/* L527 */     appState.isNavigating = false;
/* L528 */     appState.isSimulation = false;
/* L529 */     document.getElementById('fabStack').style.display = 'none';
/* L530 */     startCompassListener();
/* L531 */   }
/* L532 */ }
/* L533 */ 
/* L534 */ // ==========================================
/* L535 */ // ナビゲーション停止
/* L536 */ // ==========================================
/* L537 */ function stopNavigation() {
/* L538 */   stopLocationWatcher();
/* L539 */   startCompassListener();
/* L540 */ 
/* L541 */   appState.isSimulation = false;
/* L542 */   appState.currentRouteData = null;
/* L543 */ 
/* L544 */   if (appState.currentPolyline) {
/* L545 */     appState.currentPolyline.setMap(null);
/* L546 */     appState.currentPolyline = null;
/* L547 */   }
/* L548 */ 
/* L549 */   appState.currentDestination = null;
/* L550 */   appState.isNavigating = false;
/* L551 */   appState.isPaused = false;
/* L552 */ 
/* L553 */   document.getElementById('routePanel').style.display = 'none';
/* L554 */   document.getElementById('navPanel').style.display = 'block';
/* L555 */   document.getElementById('navPanelInstructions').innerHTML = '';
/* L556 */   document.getElementById('incidentPanel').style.display = 'none';
/* L557 */   document.getElementById('incidentPanel').innerHTML = '';
/* L558 */   document.getElementById('searchPanel').style.display = 'block';
/* L559 */   document.getElementById('btnDestination').style.display = 'none';
/* L560 */   document.getElementById('q').value = '';
/* L561 */   document.getElementById('results').style.display = 'none';
/* L562 */   document.getElementById('results').innerHTML = '';
/* L563 */ 
/* L564 */   document.getElementById('weather3h').textContent = '--';
/* L565 */   document.getElementById('weather6h').textContent = '--';
/* L566 */   document.getElementById('weather9h').textContent = '--';
/* L567 */ 
/* L568 */   document.getElementById('fabStack').style.display = 'none';
/* L569 */   document.getElementById('btnSearch').style.display = 'flex';
/* L570 */ 
/* L571 */   const btnPause = document.getElementById('btnPause');
/* L572 */   btnPause.textContent = '一時停止';
/* L573 */   btnPause.classList.remove('paused');
/* L574 */ 
/* L575 */   appState.searchMarkers.forEach(marker => marker.map = null);
/* L576 */   appState.searchMarkers = [];
/* L577 */ 
/* L578 */   if (appState.currentPos && appState.map) {
/* L579 */     appState.map.panTo(appState.currentPos);
/* L580 */     appState.map.setZoom(17);
/* L581 */   }
/* L582 */   updateMarkerRotation();
/* L583 */   document.getElementById('appBody').classList.add('panel-open');
/* L584 */   console.log('ルート案内を終了しました');
/* L585 */   console.log('[Navigation] ルート案内終了');
/* L586 */ }
/* L587 */ 
/* L588 */ // ==========================================
/* L589 */ // 一時停止/再開トグル
/* L590 */ // ==========================================
/* L591 */ function togglePause() {
/* L592 */   if (appState.isSimulation) {
/* L593 */     console.warn('シミュレーション中は一時停止できません');
/* L594 */     return;
/* L595 */   }
/* L596 */   if (!appState.isNavigating) {
/* L597 */     console.warn('ナビゲーション中ではありません');
/* L598 */     return;
/* L599 */   }
/* L600 */ 
/* L601 */   appState.isPaused = !appState.isPaused;
/* L602 */   const btnPause = document.getElementById('btnPause');
/* L603 */ 
/* L604 */   if (appState.isPaused) {
/* L605 */     btnPause.textContent = '再開';
/* L606 */     btnPause.classList.add('paused');
/* L607 */     console.warn('ナビゲーションを一時停止しました');
/* L608 */     console.log('[Navigation] 一時停止');
/* L609 */   } else {
/* L610 */     btnPause.textContent = '一時停止';
/* L611 */     btnPause.classList.remove('paused');
/* L612 */     console.log('ナビゲーションを再開しました');
/* L613 */     console.log('[Navigation] 再開');
/* L614 */     if (appState.currentPos) {
/* L615 */       appState.map.panTo(appState.currentPos);
/* L616 */       appState.map.setZoom(18);
/* L617 */     }
/* L618 */   }
/* L619 */ }
/* L620 */ 
/* L621 */ // ==========================================
/* L622 */ // 検索実行 (Worker経由)
/* L623 */ // ==========================================
/* L624 */ const TYPE_MAP = {
/* L625 */   "コンビニ": "convenience_store",
/* L626 */   "スーパー": "supermarket",
/* L627 */   "レストラン": "restaurant",
/* L628 */   "カフェ": "cafe",
/* L629 */   "ホテル": "lodging",
/* L630 */   "病院": "hospital",
/* L631 */   "薬局": "pharmacy",
/* L632 */   "ガソリンスタンド": "gas_station",
/* L633 */   "駐車場": "parking",
/* L634 */   "銀行": "bank"
/* L635 */ };
/* L636 */ 
/* L637 */ async function performSearch(query) {
/* L638 */   if (!query || !query.trim()) {
/* L639 */     console.warn('検索ワードを入力してください');
/* L640 */     return;
/* L641 */   }
/* L642 */ 
/* L643 */   let centerLat, centerLng;
/* L644 */   if (appState.pointSearchMode && appState.searchPoint) {
/* L645 */     centerLat = appState.searchPoint.lat;
/* L646 */     centerLng = appState.searchPoint.lng;
/* L647 */   } else if (appState.currentPos) {
/* L648 */     centerLat = appState.currentPos.lat;
/* L649 */     centerLng = appState.currentPos.lng;
/* L650 */   } else {
/* L651 */     console.error('検索の基準地点が不明です');
/* L652 */     return;
/* L653 */   }
/* L654 */ 
/* L655 */   const radiusKm = parseInt(document.getElementById('radiusLabel').textContent);
/* L656 */   const radiusMeters = radiusKm * 1000;
/* L657 */ 
/* L658 */   console.log('検索中...');
/* L659 */ 
/* L660 */   try {
/* L661 */     const data = await placesTextSearch({
/* L662 */       textQuery: query.trim(),
/* L663 */       locationBias: {
/* L664 */         circle: { center: { latitude: centerLat, longitude: centerLng }, radius: radiusMeters }
/* L665 */       },
/* L666 */       maxResultCount: 20,
/* L667 */       languageCode: 'ja'
/* L668 */     }, DEFAULT_MASK);
/* L669 */ 
/* L670 */     if (data.places?.length) {
/* L671 */       displayResults(data.places, centerLat, centerLng);
/* L672 */       return;
/* L673 */     }
/* L674 */   } catch (e) {
/* L675 */     console.error('[Search] Text Search Error:', e);
/* L676 */   }
/* L677 */ 
/* L678 */   const typeKey = TYPE_MAP[query.trim()] || TYPE_MAP[query.trim().replace(/\s/g, '')];
/* L679 */   if (typeKey) {
/* L680 */     try {
/* L681 */       const data = await placesNearby({
/* L682 */         includedTypes: [typeKey],
/* L683 */         maxResultCount: 20,
/* L684 */         locationRestriction: {
/* L685 */           circle: { center: { latitude: centerLat, longitude: centerLng }, radius: radiusMeters }
/* L686 */         },
/* L687 */         languageCode: 'ja'
/* L688 */       }, DEFAULT_MASK);
/* L689 */ 
/* L690 */       if (data.places?.length) {
/* L691 */         displayResults(data.places, centerLat, centerLng);
/* L692 */         return;
/* L693 */       }
/* L694 */     } catch (e) {
/* L695 */       console.error('[Search] Nearby Error:', e);
/* L696 */     }
/* L697 */   }
/* L698 */ 
/* L699 */   console.warn('検索結果が見つかりませんでした');
/* L700 */   document.getElementById('results').style.display = 'none';
/* L701 */   document.getElementById('navPanel').style.display = 'block';
/* L702 */ }
/* L703 */ 
/* L704 */ // ==========================================
/* L705 */ // 検索結果表示
/* L706 */ // ==========================================
/* L707 */ function displayResults(places, centerLat, centerLng) {
/* L708 */   document.getElementById('navPanel').style.display = 'none';
/* L709 */ 
/* L710 */   appState.searchMarkers.forEach(marker => marker.map = null);
/* L711 */   appState.searchMarkers = [];
/* L712 */ 
/* L713 */   const placesWithDistance = places.map(place => {
/* L714 */     const lat = place.location.latitude;
/* L715 */     const lng = place.location.longitude;
/* L716 */     const distance = calculateDistance(centerLat, centerLng, lat, lng);
/* L717 */     return { ...place, distance };
/* L718 */   });
/* L719 */ 
/* L720 */   placesWithDistance.sort((a, b) => a.distance - b.distance);
/* L721 */   const limitedResults = placesWithDistance.slice(0, 5);
/* L722 */ 
/* L723 */   const resultsDiv = document.getElementById('results');
/* L724 */   resultsDiv.innerHTML = '';
/* L725 */   resultsDiv.style.display = 'block';
/* L726 */ 
/* L727 */   limitedResults.forEach((place, index) => {
/* L728 */     const name = place.displayName?.text || place.displayName || '名称不明';
/* L729 */     const address = place.formattedAddress || '住所不明';
/* L730 */     const lat = place.location.latitude;
/* L731 */     const lng = place.location.longitude;
/* L732 */     const distanceKm = (place.distance / 1000).toFixed(2);
/* L733 */ 
/* L734 */     const item = document.createElement('div');
/* L735 */     item.className = 'result-item';
/* L736 */     item.innerHTML = `
/* L737 */       <div class="result-name">${index + 1}. ${name}</div>
/* L738 */       <div class="result-address">${address}</div>
/* L739 */       <div style="font-size:11px;color:#62b5ff;margin-top:4px">
/* L740 */         📍 ${distanceKm}km
/* L741 */       </div>
/* L742 */     `;
/* L743 */ 
/* L744 */     item.onclick = () => {
/* L745 */       startNavigation({
/* L746 */         name: name,
/* L747 */         lat: lat,
/* L748 */         lng: lng
/* L749 */       });
/* L750 */     };
/* L751 */ 
/* L752 */     resultsDiv.appendChild(item);
/* L753 */ 
/* L754 */     const markerPin = document.createElement('div');
/* L755 */     markerPin.style.width = '24px';
/* L756 */     markerPin.style.height = '24px';
/* L757 */     markerPin.style.borderRadius = '50%';
/* L758 */     markerPin.style.background = '#25d07a';
/* L759 */     markerPin.style.border = '2px solid #fff';
/* L760 */     markerPin.style.boxShadow = '0 2px 6px rgba(0,0,0,.3)';
/* L761 */     markerPin.style.display = 'flex';
/* L762 */     markerPin.style.alignItems = 'center';
/* L763 */     markerPin.style.justifyContent = 'center';
/* L764 */     markerPin.style.color = '#fff';
/* L765 */     markerPin.style.fontSize = '12px';
/* L766 */     markerPin.style.fontWeight = 'bold';
/* L767 */     markerPin.textContent = index + 1;
/* L768 */ 
/* L769 */     const marker = new google.maps.marker.AdvancedMarkerElement({
/* L770 */       map: appState.map,
/* L771 */       position: { lat, lng },
/* L772 */       content: markerPin,
/* L773 */       zIndex: 500 + index,
/* L774 */       title: name
/* L775 */     });
/* L776 */ 
/* L777 */     appState.searchMarkers.push(marker);
/* L778 */   });
/* L779 */ 
/* L780 */   console.log(`${limitedResults.length}件の検索結果`);
/* L781 */   console.log(`[Search] ${limitedResults.length}件の結果を表示しました`);
/* L782 */ }
// L783 
// L784 // ==========================================
/* L785 */ // 音声認識初期化
/* L786 */ // ==========================================
/* L787 */ function initSpeechRecognition() {
/* L788 */   if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
/* L789 */     console.log('[Voice] 音声認識は非対応です');
/* L790 */     return false;
/* L791 */   }
/* L792 */   const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
/* L793 */   appState.recognition = new SpeechRecognition();
/* L794 */   appState.recognition.lang = 'ja-JP';
/* L795 */   appState.recognition.continuous = false;
/* L796 */   appState.recognition.interimResults = false;
/* L797 */ 
/* L798 */   const btnVoiceIcon = document.getElementById('btnVoiceIcon');
/* L799 */ 
/* L800 */   appState.recognition.onstart = () => {
/* L801 */     console.log('[Voice] 音声認識開始');
/* L802 */     btnVoiceIcon.classList.add('recording');
/* L803 */   };
/* L804 */ 
/* L805 */   appState.recognition.onresult = (event) => {
/* L806 */     const transcript = event.results[0][0].transcript;
/* L807 */    console.log('[Voice] 認識結果:', transcript);
/* L808 */     document.getElementById('q').value = transcript;
/* L809 */     performSearch(transcript);
/* L810 */     console.log(`音声認識: ${transcript}`);
/* L811 */   };
/* L812 */ 
/* L813 */   appState.recognition.onerror = (event) => {
/* L814 */     console.error('[Voice] エラー:', event.error);
/* L815 */     btnVoiceIcon.classList.remove('recording');
/* L816 */     console.error('音声認識エラーが発生しました');
/* L817 */   };
/* L818 */ 
/* L819 */   appState.recognition.onend = () => {
/* L820 */     console.log('[Voice] 音声認識終了');
/* L821 */     btnVoiceIcon.classList.remove('recording');
/* L822 */   };
/* L823 */ 
/* L824 */   return true;
/* L825 */ }
// L826 
// L827 // ==========================================
/* L828 */ // 音声検索開始
/* L829 */ // ==========================================
/* L830 */ function startVoiceSearch() {
/* L831 */   if (!appState.recognition) {
/* L832 */     if (!initSpeechRecognition()) {
/* L833 */       console.error('お使いのブラウザは音声認識に対応していません');
/* L834 */       return;
/* L835 */     }
/* L836 */   }
/* L837 */   try {
/* L838 */     appState.recognition.start();
/* L839 */   } catch (e) {
/* L840 */     console.error('[Voice] 開始エラー:', e);
/* L841 */     appState.recognition.stop();
/* L842 */     setTimeout(() => {
/* L843 */       try {
/* L844 */         appState.recognition.start();
/* L845 */       } catch (e2) {
/* L846 */         console.error('[Voice] 再開エラー:', e2);
/* L847 */         console.error('音声認識の開始に失敗しました');
/* L848 */       }
/* L849 */     }, 100);
/* L850 */   }
/* L851 */ }
// L852 
// L853 // ==========================================
/* L854 */ // 現在地取得 (初回1回のみ)
/* L855 */ // ==========================================
/* L856 */ function acquireLocation() {
/* L857 */   const onSuccess = (pos) => {
/* L858 */     const { latitude, longitude } = pos.coords;
/* L859 */     document.getElementById('loading')?.remove();
/* L860 */ 
/* L861 */     if (!appState.mapInitialized) {
/* L862 */       initMap({ lat: latitude, lng: longitude });
/* L863 */     } else {
/* L864 */       appState.map.setCenter({ lat: latitude, lng: longitude });
/* L865 */     }
/* L866 */ 
/* L867 */     setUserMarker(latitude, longitude);
/* L868 */     fetchLocationNameGoogle(latitude, longitude);
/* L869 */     fetchWeather(latitude, longitude);
/* L870 */     console.log('現在地を取得しました');
/* L871 */   };
/* L872 */ 
/* L873 */   const onError = (error) => {
/* L874 */     console.log('[WalkNav] geolocation error', error?.message || error);
/* L875 */     document.getElementById('loading')?.remove();
/* L876 */ 
/* L877 */     if (!appState.mapInitialized) {
/* L878 */       initMap({ lat: 35.0, lng: 135.0 });
/* L879 */     }
/* L880 */ 
/* L881 */     const addressElement = document.getElementById('locAddress');
/* L882 */     const coordsElement = document.getElementById('locCoords');
/* L883 */     if (addressElement) addressElement.textContent = '位置情報を確認できません';
/* L884 */     if (coordsElement) coordsElement.textContent = '現在地：取得失敗';
/* L885 */     console.error('現在地の取得に失敗しました');
/* L886 */   };
/* L887 */ 
/* L888 */   try {
/* L889 */     navigator.geolocation.getCurrentPosition(onSuccess, onError, LOCATION_OPTIONS);
/* L890 */   } catch (e) {
/* L891 */     console.log('[WalkNav] geolocation exception', e);
/* L892 */     console.error('位置情報へのアクセスが拒否されました');
/* L893 */   }
/* L894 */ }
// L895 
// L896 // ==========================================
/* L897 */ // 地名取得(逆ジオコーディング)- Cloudflare経由
/* L898 */ // ==========================================
/* L899 */ async function fetchLocationNameGoogle(lat, lng) {
/* L900 */   const addressElement = document.getElementById('locAddress');
/* L901 */   const coordsElement = document.getElementById('locCoords');
/* L902 */ 
/* L903 */   if (!addressElement || !coordsElement) {
/* L904 */     console.error('[DEBUG] Elements not found!');
/* L905 */     return;
/* L906 */   }
/* L907 */   const coordsText = `現在地：緯度 ${lat.toFixed(6)} / 経度 ${lng.toFixed(6)}`;
\/* L908 */   coordsElement.textContent = coordsText;
/* L909 */ 
/* L910 */   try {
/* L911 */     console.log('[Geocode] Fetching address from Cloudflare...');
/* L912 */ 
/* L913 */     const response = await fetchWithRetry(`${WORKER_ORIGIN}/geocode`, {
/* L914 */       method: 'POST',
/* L915 */       headers: { 'Content-Type': 'application/json' },
/* L916 */       body: JSON.stringify({
/* L917 */         latlng: { lat: lat, lng: lng },
/* L918 */         language: 'ja'
/* L919 */       })
/* L920 */     });
/* L921 */ 
/* L922 */     if (!response.ok) {
/* L923 */       const errorText = await response.text();
/* L924 */       throw new Error(`Geocode Worker Error ${response.status}: ${errorText}`);
/* L925 */     }
/* L926 */     const data = await response.json();
/* L927 */     if (data.status === 'OK' && data.results[0]) {
/* L928 */       const address = data.results[0].formatted_address;
/* L929 */       const cleanAddress = address.replace(/^日本、\s*/, '');
/* L930 */       const formattedAddress = cleanAddress + ' 付近';
/* L931 */       addressElement.textContent = formattedAddress;
/* L932 */     } else {
/* L933 */       addressElement.textContent = '住所情報なし';
/* L934 */       if (data.status !== 'ZERO_RESULTS') {
/* L935 */         console.error(`住所取得エラー: ${data.status}`);
/* L936 */       }
/* L937 */     }
/* L938 */   } catch (error) {
/* L939 */     console.error('[Geocode] Fetch error:', error);
/* L940 */     addressElement.textContent = '住所取得エラー';
/* L941 */   }
/* L942 */ }
// L943 
// L944 // ==========================================
/* L945 */ // ポイント選択時の地名取得
/* L946 */ // ==========================================
/* L947 */ async function fetchPointAddress(lat, lng) {
/* L948 */   const addressBlock = document.getElementById('pointAddressBlock');
/* L949 */   const addressElement = document.getElementById('pointAddress');
/* L950 */   const coordsElement = document.getElementById('pointCoords');
/* L951 */ 
/* L952 */   if (!addressElement || !coordsElement || !addressBlock) {
/* L953 */     console.error('[DEBUG] Point Elements not found!');
/* L954 */     return;
/* L955 */   }
/* L956 */ 
/* L957 */   addressElement.textContent = 'ポイント：住所取得中...';
/* L958 */   coordsElement.textContent = `(緯度 ${lat.toFixed(6)} / 経度 ${lng.toFixed(6)})`;
/* L959 */   addressBlock.style.display = 'flex';
/* L960 */ 
/* L961 */   try {
/* L962 */     const response = await fetchWithRetry(`${WORKER_ORIGIN}/geocode`, {
/* L963 */       method: 'POST',
/* L964 */       headers: { 'Content-Type': 'application/json' },
/* L965 */       body: JSON.stringify({
/* L966 */         latlng: { lat: lat, lng: lng },
/* L967 */         language: 'ja'
/* L968 */       })
/* L969 */     });
/* L970 */ 
/* L971 */     if (!response.ok) {
/* L972 */       const errorText = await response.text();
/* L973 */       throw new Error(`Geocode Worker Error ${response.status}: ${errorText}`);
/* L974 */     }
/* L975 */     const data = await response.json();
/* L976 */     if (data.status === 'OK' && data.results[0]) {
/* L977 */       const address = data.results[0].formatted_address;
/* L978 */       const cleanAddress = address.replace(/^日本、\s*/, '');
/* L979 */       const formattedAddress = 'ポイント：' + cleanAddress + ' 付近';
/* L980 */       addressElement.textContent = formattedAddress;
/* L981 */     } else {
/* L982 */       addressElement.textContent = 'ポイント：住所情報なし';
/* L983 */     }
/* L984 */   } catch (error) {
/* L985 */     console.error('[Geocode] Fetch error for Point:', error);
/* L986 */     addressElement.textContent = 'ポイント：住所取得エラー';
/* L987 */   }
/* L988 */ }
// L989 
// L990 // ==========================================
/* L991 */ // 天気予報取得（OpenWeather API に修正）※既存仕様維持
/* L992 */ // ==========================================
/* L993 */ function iconFromWeatherType(type) {
/* L994 */   const t = (type || '').toUpperCase();
/* L995 */   if (t.includes('THUNDER')) return '⛈️';
/* L996 */   if (t.includes('RAIN') || t.includes('DRIZZLE')) return '🌧️';
/* L997 */   if (t.includes('SNOW') || t.includes('SLEET')) return '❄️';
/* L998 */   if (t.includes('FOG') || t.includes('MIST') || t.includes('HAZE')) return '🌫️';
/* L999 */   if (t.includes('CLOUDS')) return '☁️';
/* L1000 */   if (t.includes('CLEAR')) return '☀️';
/* L1001 */   return '☀️';
/* L1002 */ }
/* L1003 */ 
/* L1004 */ async function fetchWeather(lat, lng) {
/* L1005 */   console.log('[Weather] Fetching OpenWeather (via Worker)...');
/* L1006 */   try {
/* L1007 */     const payload = {
/* L1008 */       lat: lat,
/* L1009 */       lon: lng,
/* L1010 */       units: 'metric'
/* L1011 */     };
/* L1012 */ 
/* L1013 */     const response = await fetchWithRetry(`${WORKER_ORIGIN}/weather`, {
/* L1014 */       method: 'POST',
/* L1015 */       headers: { 'Content-Type': 'application/json' },
/* L1016 */       body: JSON.stringify(payload)
/* L1017 */     });
/* L1018 */ 
/* L1019 */     if (!response.ok) {
/* L1020 */       const errText = await response.text();
/* L1021 */       throw new Error(`Weather fetch failed (${response.status}): ${errText}`);
/* L1022 */     }
/* L1023 */     const data = await response.json();
/* L1024 */ 
/* L1025 */     const fh = Array.isArray(data.hourly) ? data.hourly : [];
/* L1026 */     const icon3 = (fh[2] && fh[2].weather[0]) ? iconFromWeatherType(fh[2].weather[0].main) : null;
/* L1027 */     const icon6 = (fh[5] && fh[5].weather[0]) ? iconFromWeatherType(fh[5].weather[0].main) : null;
/* L1028 */     const icon9 = (fh[8] && fh[8].weather[0]) ? iconFromWeatherType(fh[8].weather[0].main) : null;
/* L1029 */ 
/* L1030 */     document.getElementById('weather3h').textContent = icon3 || '—';
/* L1031 */     document.getElementById('weather6h').textContent = icon6 || '—';
/* L1032 */     document.getElementById('weather9h').textContent = icon9 || '—';
/* L1033 */ 
/* L1034 */   } catch (error) {
/* L1035 */     console.error('[Weather] Error:', error);
/* L1036 */     document.getElementById('weather3h').textContent = 'X';
/* L1037 */     document.getElementById('weather6h').textContent = 'X';
/* L1038 */     document.getElementById('weather9h').textContent = 'X';
/* L1039 */   }
/* L1040 */ }
// L1041 
// L1042 // ==========================================
/* L1043 */ // ダイアログユーティリティ
/* L1044 */ // ==========================================
/* L1045 */ function createDialog(config) {
/* L1046 */   const overlay = document.createElement('div');
/* L1047 */   overlay.className = `dialog-overlay ${config.scroll ? 'scroll' : ''}`;
\/* L1048 */   overlay.id = config.id || 'dialog';
/* L1049 */ 
/* L1050 */   const box = document.createElement('div');
/* L1051 */   box.className = `dialog-box ${config.wide ? 'wide' : ''}`;
\/* L1052 */   box.innerHTML = config.content;
/* L1053 */ 
/* L1054 */   overlay.appendChild(box);
/* L1055 */   document.body.appendChild(overlay);
/* L1056 */   return overlay;
/* L1057 */ }
// L1058 
// L1059 // ==========================================
/* L1060 */ // 現在地登録ダイアログ
/* L1061 */ // ==========================================
/* L1062 */ function showSaveLocationDialog() {
/* L1063 */   if (!appState.currentPos) {
/* L1064 */     console.error('現在地が取得できていません');
/* L1065 */     return;
/* L1066 */   }
/* L1067 */   const dialog = createDialog({
/* L1068 */     id: 'saveLocationDialog',
/* L1069 */     content: `
/* L1070 */       <h3 class="dialog-title">現在地点登録画面</h3>
/* L1071 */       <p class="dialog-text">登録する地点名を入力してください:</p>
/* L1072 */       <input type="text" id="locationNameInput" class="dialog-input" placeholder="地点名を入力" />
/* L1073 */       <div class="dialog-actions">
/* L1074 */         <button id="btnCancelSave" class="dialog-btn cancel">キャンセル</button>
/* L1075 */         <button id="btnConfirmSave" class="dialog-btn confirm">OK</button>
/* L1076 */       </div>
/* L1077 */     `
/* L1078 */   });
/* L1079 */   const input = document.getElementById('locationNameInput');
/* L1080 */   const btnCancel = document.getElementById('btnCancelSave');
/* L1081 */   const btnConfirm = document.getElementById('btnConfirmSave');
/* L1082 */   setTimeout(() => input.focus(), 100);
/* L1083 */   btnCancel.onclick = () => dialog.remove();
/* L1084 */   btnConfirm.onclick = () => {
/* L1085 */     const locationName = input.value.trim();
/* L1086 */     if (!locationName) {
/* L1087 */       input.style.borderColor = 'var(--danger)';
/* L1088 */       setTimeout(() => { input.style.borderColor = 'var(--stroke)'; }, 2000);
/* L1089 */       return;
/* L1090 */     }
/* L1091 */     const locations = JSON.parse(localStorage.getItem('savedLocations') || '[]');
/* L1092 */     const savedLocation = {
/* L1093 */       name: locationName,
/* L1094 */       lat: appState.currentPos.lat,
/* L1095 */       lng: appState.currentPos.lng,
/* L1096 */       timestamp: Date.now()
/* L1097 */     };
/* L1098 */     locations.push(savedLocation);
/* L1099 */     localStorage.setItem('savedLocations', JSON.stringify(locations));
/* L1100 */     console.log('[SaveLocation] 現在地を登録:', savedLocation);
/* L1101 */     dialog.remove();
/* L1102 */     console.log(`「${locationName}」を登録しました`);
/* L1103 */   };
/* L1104 */   input.addEventListener('keypress', (e) => {
/* L1105 */     if (e.key === 'Enter') btnConfirm.click();
/* L1106 */   });
/* L1107 */ }
// L1108 
// L1109 // ==========================================
/* L1110 */ // 登録地点修正ダイアログ
/* L1111 */ // ==========================================
/* L1112 */ function showEditLocationDialog() {
/* L1113 */   const locations = JSON.parse(localStorage.getItem('savedLocations') || '[]');
/* L1114 */   if (locations.length === 0) {
/* L1115 */     const dialog = createDialog({
/* L1116 */       id: 'editDialog',
/* L1117 */       content: `
/* L1118 */         <h3 class="dialog-title">登録地点修正</h3>
/* L1119 */         <p class="dialog-muted">登録された地点がありません</p>
/* L1120 */         <button id="btnCloseEmpty" class="dialog-btn confirm full">閉じる</button>
/* L1121 */       `
/* L1122 */     });
/* L1123 */     document.getElementById('btnCloseEmpty').onclick = () => dialog.remove();
/* L1124 */     return;
/* L1125 */   }
/* L1126 */   let listHTML = '<div class="location-list">';
/* L1127 */   locations.forEach((loc, index) => {
/* L1128 */     listHTML += `
/* L1129 */       <div class="location-item">
/* L1130 */         <div class="location-item-name">${loc.name}</div>
/* L1131 */         <div class="location-item-coords">緯度: ${loc.lat.toFixed(6)} / 経度: ${loc.lng.toFixed(6)}</div>
/* L1132 */         <div class="location-item-actions">
/* L1133 */           <button class="location-item-btn nav" data-index="${index}">ナビ開始</button>
/* L1134 */           <button class="location-item-btn edit" data-index="${index}">名前変更</button>
/* L1135 */           <button class="location-item-btn delete" data-index="${index}">削除</button>
/* L1136 */         </div>
/* L1137 */       </div>
/* L1138 */     `;
/* L1139 */   });
/* L1140 */   listHTML += '</div>';
/* L1141 */   const dialog = createDialog({
/* L1142 */     id: 'editDialog',
/* L1143 */     wide: true,
/* L1144 */     scroll: true,
/* L1145 */     content: `
/* L1146 */       <h3 class="dialog-title">登録地点修正</h3>
/* L1147 */       ${listHTML}
/* L1148 */       <button id="btnCloseEdit" class="dialog-btn cancel full" style="margin-top:16px">閉じる</button>
/* L1149 */     `
/* L1150 */   });
/* L1151 */   document.getElementById('btnCloseEdit').onclick = () => dialog.remove();
/* L1152 */   document.querySelectorAll('.location-item-btn.nav').forEach(btn => {
/* L1153 */     btn.onclick = () => {
/* L1154 */       const index = parseInt(btn.dataset.index);
/* L1155 */       const loc = locations[index];
/* L1156 */       dialog.remove();
/* L1157 */       startNavigation({ name: loc.name, lat: loc.lat, lng: loc.lng });
/* L1158 */     };
/* L1159 */   });
/* L1160 */   document.querySelectorAll('.location-item-btn.edit').forEach(btn => {
/* L1161 */     btn.onclick = () => {
/* L1162 */       const index = parseInt(btn.dataset.index);
/* L1163 */       const loc = locations[index];
/* L1164 */       const renameDialog = createDialog({
/* L1165 */         id: 'renameDialog',
/* L1166 */         content: `
/* L1167 */           <h3 class="dialog-title">地点名変更</h3>
/* L1168 */           <input type="text" id="renameInput" value="${loc.name}" class="dialog-input" />
/* L1169 */           <div class="dialog-actions">
/* L1170 */             <button id="btnCancelRename" class="dialog-btn cancel">キャンセル</button>
/* L1171 */             <button id="btnConfirmRename" class="dialog-btn confirm">OK</button>
/* L1172 */           </div>
/* L1173 */         `
/* L1174 */       });
/* L1175 */       const renameInput = document.getElementById('renameInput');
/* L1176 */       setTimeout(() => {
/* L1177 */         renameInput.focus();
/* L1178 */         renameInput.select();
/* L1179 */       }, 100);
/* L1180 */       document.getElementById('btnCancelRename').onclick = () => renameDialog.remove();
/* L1181 */       document.getElementById('btnConfirmRename').onclick = () => {
/* L1182 */         const newName = renameInput.value.trim();
/* L1183 */         if (!newName) {
/* L1184 */           renameInput.style.borderColor = 'var(--danger)';
/* L1185 */           setTimeout(() => { renameInput.style.borderColor = 'var(--stroke)'; }, 2000);
/* L1186 */           return;
/* L1187 */         }
/* L1188 */         locations[index].name = newName;
/* L1189 */         localStorage.setItem('savedLocations', JSON.stringify(locations));
/* L1190 */         renameDialog.remove();
/* L1191 */         dialog.remove();
/* L1192 */         console.log(`地点名を「${newName}」に変更しました`);
/* L1193 */       };
/* L1194 */       renameInput.addEventListener('keypress', (e) => {
/* L1195 */         if (e.key === 'Enter') document.getElementById('btnConfirmRename').click();
/* L1196 */       });
/* L1197 */     };
/* L1198 */   });
/* L1199 */   document.querySelectorAll('.location-item-btn.delete').forEach(btn => {
/* L1200 */     btn.onclick = () => {
/* L1201 */       const index = parseInt(btn.dataset.index);
/* L1202 */       const loc = locations[index];
/* L1203 */       const confirmDialog = createDialog({
/* L1204 */         id: 'confirmDeleteDialog',
/* L1205 */         content: `
/* L1206 */           <h3 class="dialog-title">削除確認</h3>
/* L1207 */           <p class="dialog-text">「${loc.name}」を削除しますか？</p>
/* L1208 */           <div class="dialog-actions">
/* L1209 */             <button id="btnCancelDelete" class="dialog-btn cancel">キャンセル</button>
/* L1210 */             <button id="btnConfirmDelete" class="dialog-btn delete">削除</button>
/* L1211 */           </div>
/* L1212 */         `
/* L1213 */       });
/* L1214 */       document.getElementById('btnCancelDelete').onclick = () => confirmDialog.remove();
/* L1215 */       document.getElementById('btnConfirmDelete').onclick = () => {
/* L1216 */         locations.splice(index, 1);
/* L1217 */         localStorage.setItem('savedLocations', JSON.stringify(locations));
/* L1218 */         confirmDialog.remove();
/* L1219 */         dialog.remove();
/* L1220 */         console.log(`「${loc.name}」を削除しました`);
/* L1221 */       };
/* L1222 */     };
/* L1223 */   });
/* L1224 */ }
// L1225 
// L1226 // ==========================================
/* L1227 */ // 道順をクリップボードにコピー
/* L1228 */ // ==========================================
/* L1229 */ function exportRouteToClipboard() {
/* L1230 */   if (!appState.currentRouteData) {
/* L1231 */     console.warn('コピーするルートデータがありません');
/* L1232 */     return;
/* L1233 */   }
/* L1234 */   const data = appState.currentRouteData;
/* L1235 */   let textOutput = `■ 目的地: ${data.destinationName}\n`;
/* L1236 */   textOutput += `■ 概要: ${data.summary} (約 ${data.distance}, 徒歩 ${data.duration})\n\n`;
/* L1237 */   if (data.warnings.length > 0) {
/* L1238 */     textOutput += "■ 警告:\n";
/* L1239 */     data.warnings.forEach(w => {
/* L1240 */       textOutput += `・ ${w.replace(/<[^>]+>/g, ' ')}\n`;
/* L1241 */     });
/* L1242 */     textOutput += "\n";
/* L1243 */   }
/* L1244 */   textOutput += "■ 道順:\n";
/* L1245 */   if (data.steps && data.steps.length > 0) {
/* L1246 */     data.steps.forEach((step, index) => {
/* L1247 */       const instruction = (step.html_instructions || '').replace(/<[^>]+>/g, ' ');
/* L1248 */       textOutput += `${index + 1}. ${instruction} (${step.distance.text})\n`;
/* L1249 */     });
/* L1250 */   } else {
/* L1251 */     textOutput += "詳細な道順はありません。\n";
/* L1252 */   }
/* L1253 */   if (navigator.clipboard) {
/* L1254 */     navigator.clipboard.writeText(textOutput)
/* L1255 */       .then(() => console.log('道順をクリップボードにコピーしました'))
/* L1256 */       .catch(err => {
/* L1257 */         console.error('Clipboard write error:', err);
/* L1258 */         console.error('コピーに失敗しました');
/* L1259 */       });
/* L1260 */   } else {
/* L1261 */     console.error('お使いのブラウザはコピー機能に非対応です');
/* L1262 */   }
/* L1263 */ }
// L1264 
// L1265 // ==========================================
/* L1266 */ // 現在地へ移動
/* L1267 */ // ==========================================
/* L1268 */ let lastLocateTime = 0;
/* L1269 */ function locateUser() {
/* L1270 */   if (typeof DeviceOrientationEvent.requestPermission === 'function') {
/* L1271 */     DeviceOrientationEvent.requestPermission()
/* L1272 */       .then(permissionState => {
/* L1273 */         if (permissionState === 'granted') {
/* L1274 */           console.log('[Compass] iOS permission granted.');
/* L1275 */           stopCompassListener();
/* L1276 */           appState.compassWatchId = null;
/* L1277 */           startCompassListener();
/* L1278 */         }
/* L1279 */       })
/* L1280 */       .catch(console.error);
/* L1281 */   }
/* L1282 */   const now = Date.now();
/* L1283 */   if (now - lastLocateTime < 1000) return;
/* L1284 */   lastLocateTime = now;
/* L1285 */   if (appState.currentPos && appState.map) {
/* L1286 */     appState.map.panTo(appState.currentPos);
/* L1287 */     appState.map.setZoom(18);
/* L1288 */     console.log('現在地に移動しました');
/* L1289 */   } else {
/* L1290 */     console.log('現在地を取得します…');
/* L1291 */     acquireLocation();
/* L1292 */   }
/* L1293 */ }
// L1294 
// L1295 // ==========================================
/* L1296 */ // キーボード表示ウォッチャー
/* L1297 */ // ==========================================
/* L1298 */ function bindKeyboardWatch() {
/* L1299 */   const searchInput = document.getElementById('q');
/* L1300 */   const searchPanel = document.getElementById('searchPanel');
/* L1301 */   const appBody = document.getElementById('appBody');
/* L1302 */   const navPanel = document.getElementById('navPanel');
/* L1303 */ 
/* L1304 */   searchInput.addEventListener('focus', () => {
/* L1305 */     console.log('[Keyboard] Input focused');
/* L1306 */     appBody.classList.add('keyboard-open');
/* L1307 */     navPanel.style.display = 'none';
/* L1308 */     setTimeout(() => {
/* L1309 */       const inputTopInPanel = searchInput.offsetTop;
/* L1310 */       searchPanel.scrollTop = inputTopInPanel - 20;
/* L1311 */       console.log(`[Keyboard] Scrolled panel to ${searchPanel.scrollTop}`);
/* L1312 */     }, 350);
/* L1313 */   });
/* L1314 */ 
/* L1315 */   searchInput.addEventListener('blur', () => {
/* L1316 */     console.log('[Keyboard] Input blurred');
/* L1317 */     appBody.classList.remove('keyboard-open');
/* L1318 */     searchPanel.scrollTop = 0;
/* L1319 */     const resultsVisible = document.getElementById('results').style.display === 'block';
/* L1320 */     if (!resultsVisible && !appState.pointSearchMode) {
/* L1321 */       navPanel.style.display = 'block';
/* L1322 */     }
/* L1323 */   });
/* L1324 */ }
// L1325 
// L1326 // ==========================================
/* L1327 */ // UI イベントバインディング
/* L1328 */ // ==========================================
/* L1329 */ function bindSearchPanelEvents() {
/* L1330 */   const radiusLabel = document.getElementById('radiusLabel');
/* L1331 */   const r10 = document.getElementById('r10');
/* L1332 */   const r20 = document.getElementById('r20');
/* L1333 */   const r30 = document.getElementById('r30');
/* L1334 */   const btnPointSearch = document.getElementById('btnPointSearch');
/* L1335 */   const navPanel = document.getElementById('navPanel');
/* L1336 */ 
/* L1337 */   r10.onclick = () => {
/* L1338 */     r10.classList.add('active');
/* L1339 */     r20.classList.remove('active');
/* L1340 */     r30.classList.remove('active');
/* L1341 */     radiusLabel.textContent = '10km';
/* L1342 */   };
/* L1343 */   r20.onclick = () => {
/* L1344 */     r20.classList.add('active');
/* L1345 */     r10.classList.remove('active');
/* L1346 */     r30.classList.remove('active');
/* L1347 */     radiusLabel.textContent = '20km';
/* L1348 */   };
/* L1349 */   r30.onclick = () => {
/* L1350 */     r30.classList.add('active');
/* L1351 */     r10.classList.remove('active');
/* L1352 */     r20.classList.remove('active');
/* L1353 */     radiusLabel.textContent = '30km';
/* L1354 */   };
/* L1355 */ 
/* L1356 */   btnPointSearch.onclick = () => {
/* L1357 */     appState.pointSearchMode = !appState.pointSearchMode;
/* L1358 */     if (appState.pointSearchMode) {
/* L1359 */       btnPointSearch.textContent = '📍 ポイント選択中...';
/* L1360 */       btnPointSearch.style.background = '#25d07a';
/* L1361 */       btnPointSearch.style.color = '#0a2818';
/* L1362 */       btnPointSearch.style.borderColor = 'transparent';
/* L1363 */       console.log('地図をタップして検索地点を選択');
/* L1364 */       navPanel.style.display = 'none';
/* L1365 */     } else {
/* L1366 */       btnPointSearch.textContent = '📍 ポイント選択';
/* L1367 */       btnPointSearch.style.background = 'rgba(255,255,255,.08)';
/* L1368 */       btnPointSearch.style.color = 'var(--text)';
/* L1369 */       btnPointSearch.style.borderColor = 'var(--stroke)';
/* L1370 */       if (document.getElementById('results').style.display === 'none') {
/* L1371 */         navPanel.style.display = 'block';
/* L1372 */       }
/* L1373 */     }
/* L1374 */   };
/* L1375 */ }
/* L1376 */ 
/* L1377 */ function bindLocationEvents() {
/* L1378 */   document.getElementById('btnSaveLocation').onclick = showSaveLocationDialog;
/* L1379 */   document.getElementById('btnEditLocation').onclick = showEditLocationDialog;
/* L1380 */ }
/* L1381 */ 
/* L1382 */ function bindSearchEvents() {
/* L1383 */   document.getElementById('btnSearchIcon').onclick = () => {
/* L1384 */     const q = document.getElementById('q').value.trim();
/* L1385 */     if (q) performSearch(q);
/* L1386 */   };
/* L1387 */   document.getElementById('q').addEventListener('keypress', (e) => {
/* L1388 */     if (e.key === 'Enter') {
/* L1389 */       const q = document.getElementById('q').value.trim();
/* L1390 */       if (q) performSearch(q);
/* L1391 */     }
/* L1392 */   });
/* L1393 */   document.getElementById('btnVoiceIcon').onclick = startVoiceSearch;
/* L1394 */   document.getElementById('btnReset').onclick = () => {
/* L1395 */     document.getElementById('q').value = '';
/* L1396 */     document.getElementById('results').style.display = 'none';
/* L1397 */     document.getElementById('results').innerHTML = '';
/* L1398 */     appState.searchMarkers.forEach(marker => marker.map = null);
/* L1399 */     appState.searchMarkers = [];
/* L1400 */     appState.searchPoint = null;
/* L1401 */     if (appState.searchPointMarker) {
/* L1402 */       appState.searchPointMarker.map = null;
/* L1403 */       appState.searchPointMarker = null;
/* L1404 */     }
/* L1405 */     const addressBlock = document.getElementById('pointAddressBlock');
/* L1406 */     const addressElement = document.getElementById('pointAddress');
/* L1407 */     const coordsElement = document.getElementById('pointCoords');
/* L1408 */     addressBlock.style.display = 'none';
/* L1409 */     addressElement.textContent = '';
/* L1410 */     coordsElement.textContent = '';
/* L1411 */     appState.pointSearchMode = false;
/* L1412 */     const btnPointSearch = document.getElementById('btnPointSearch');
/* L1413 */     btnPointSearch.textContent = '📍 ポイント選択';
/* L1414 */     btnPointSearch.style.background = 'rgba(255,255,255,.08)';
/* L1415 */     btnPointSearch.style.color = 'var(--text)';
/* L1416 */     btnPointSearch.style.borderColor = 'var(--stroke)';
/* L1417 */     document.getElementById('navPanel').style.display = 'block';
/* L1418 */     document.getElementById('r10').classList.add('active');
/* L1419 */     document.getElementById('r20').classList.remove('active');
/* L1420 */     document.getElementById('r30').classList.remove('active');
/* L1421 */     document.getElementById('radiusLabel').textContent = '10km';
/* L1422 */     console.log('リセットしました');
/* L1423 */     console.log('[WalkNav] リセット完了');
/* L1424 */   };
/* L1425 */   document.getElementById('btnLocatePanel').onclick = locateUser;
/* L1426 */ }
/* L1427 */ 
/* L1428 */ function bindFABEvents() {
/* L1429 */   document.getElementById('btnSearch').onclick = () => {
/* L1430 */     document.getElementById('searchPanel').style.display = 'block';
/* L1431 */     document.getElementById('fabStack').style.display = 'none';
/* L1432 */     document.getElementById('appBody').classList.add('panel-open');
/* L1433 */     if (document.getElementById('results').style.display === 'none' && !appState.pointSearchMode) {
/* L1434 */       document.getElementById('navPanel').style.display = 'block';
/* L1435 */     }
/* L1436 */     document.getElementById('navPanelInstructions').innerHTML = '';
/* L1437 */     document.getElementById('incidentPanel').style.display = 'none';
/* L1438 */   };
/* L1439 */   document.getElementById('btnClosePanel').onclick = () => {
/* L1440 */     document.getElementById('searchPanel').style.display = 'none';
/* L1441 */     if (!appState.isNavigating) {
/* L1442 */       document.getElementById('fabStack').style.display = 'none';
/* L1443 */       document.getElementById('navPanel').style.display = 'none';
/* L1444 */     } else {
/* L1445 */       document.getElementById('fabStack').style.display = 'flex';
/* L1446 */     }
/* L1447 */     document.getElementById('appBody').classList.remove('panel-open');
/* L1448 */   };
/* L1449 */   document.getElementById('btnLocate').onclick = locateUser;
/* L1450 */   document.getElementById('btnDestination').onclick = () => {
/* L1451 */     if (appState.currentDestination && appState.map) {
/* L1452 */       appState.map.panTo({ lat: appState.currentDestination.lat, lng: appState.currentDestination.lng });
/* L1453 */       appState.map.setZoom(18);
/* L1454 */       console.log('目的地に移動しました');
/* L1455 */     }
/* L1456 */   };
/* L1457 */   document.getElementById('btnPause').onclick = togglePause;
/* L1458 */   document.getElementById('btnReroute').onclick = () => {
/* L1459 */     if (appState.currentDestination) {
/* L1460 */       startNavigation(appState.currentDestination);
/* L1461 */     } else {
/* L1462 */       console.warn('目的地が設定されていません');
/* L1463 */     }
/* L1464 */   };
/* L1465 */ }
/* L1466 */ 
/* L1467 */ function bindRoutePanelEvents() {
/* L1468 */   document.getElementById('btnStopRoute').onclick = stopNavigation;
/* L1469 */   document.getElementById('btnExportText').onclick = exportRouteToClipboard;
/* L1470 */ }
/* L1471 */ 
/* L1472 */ function bindUI() {
/* L1473 */   console.log('[WalkNav] Binding UI...');
/* L1474 */   bindSearchPanelEvents();
/* L1475 */   bindLocationEvents();
/* L1476 */   bindSearchEvents();
/* L1477 */   bindFABEvents();
/* L1478 */   bindRoutePanelEvents();
/* L1479 */   bindKeyboardWatch();
/* L1480 */   console.log('[WalkNav] UI binding complete');
/* L1481 */ }
// L1482 
// L1483 // ==========================================
/* L1484 */ // アプリケーション起動
/* L1485 */ // ==========================================
/* L1486 */ function startApp() {
/* L1487 */   console.log('[WalkNav] Starting app...');
/* L1488 */   document.documentElement.lang = 'ja';
/* L1489 */   document.getElementById('searchPanel').style.display = 'block';
/* L1490 */   document.getElementById('fabStack').style.display = 'none';
/* L1491 */   document.getElementById('btnSearch').style.display = 'flex';
/* L1492 */   document.getElementById('appBody').classList.add('panel-open');
/* L1493 */   document.getElementById('navPanel').style.display = 'block';
/* L1494 */   bindUI();
/* L1495 */   acquireLocation();
/* L1496 */   initSpeechRecognition();
/* L1497 */   startCompassListener();
/* L1498 */   console.log('[WalkNav] ISSUE', ISSUE_ID, 'boot');
/* L1499 */ }
// L1500 
// L1501 // [修正] DOMContentLoaded を待って起動する（既存方式維持）
/* L1502 */ function initializeWhenReady() {
/* L1503 */   if (typeof google !== 'undefined' && google.maps && google.maps.Map && google.maps.geometry) {
/* L1504 */     startApp();
/* L1505 */   } else {
/* L1506 */     setTimeout(initializeWhenReady, 100);
/* L1507 */   }
/* L1508 */ }
/* L1509 */ 
/* L1510 */ // [修正] DOMContentLoaded リスナーを復活（既存設計準拠）
/* L1511 */ window.addEventListener('DOMContentLoaded', initializeWhenReady);
/* L1512 */ 
/* L1513 */ // [注記] window.initMap は embed.html からは呼ばれないため未定義（元仕様踏襲）
