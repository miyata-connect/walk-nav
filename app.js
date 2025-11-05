1.   'use strict';
2.   
3.   // ==========================================
4.   // 定数定義
5.   // ==========================================
6.   const ISSUE_ID = 'idx202511050540'; // 更新：パネル表示ロJック、ボタン配置
7.   const API_KEY = 'AIzaSyBXC6CB2yaUkrJ5UYj3mymAsruQe4MzGPk'; // Maps表示用のみ
8.   const WORKER_ORIGIN = 'https://ors-proxy.miyata-connect-jp.workers.dev';
9.   const DEFAULT_MASK = 'places.displayName,places.formattedAddress,places.location,places.id,places.types';
10.  const MAX_RETRY = 3;
11.  const RETRY_DELAY = 1000;
12.  const LOCATION_OPTIONS = {
13.    enableHighAccuracy: true,
14.    timeout: 30000,
15.    maximumAge: 0
16.  };
17.  
18.  // ==========================================
19.  // 状態管理オブジェクト
20.  // ==========================================
21.  const appState = {
22.    map: null,
23.    userMarker: null,
24.    currentPos: null,
25.    pointSearchMode: false,
26.    searchPoint: null,
27.    searchPointMarker: null,
28.    mapInitialized: false,
29.    searchMarkers: [],
30.    currentDestination: null,
31.    currentPolyline: null,
32.    recognition: null,
33.    isPaused: false,
34.    isNavigating: false,
35.    locationWatchId: null,  
36.    compassWatchId: null,
37.    currentHeading: 0,
38.    isSimulation: false,
39.    currentRouteData: null
40.  };
41.  
42.  // ==========================================
43.  // トースト通知システム (廃止)
44.  // ==========================================
45.  
46.  
47.  // ==========================================
48.  // リトライ機能付きfetch
49.  // ==========================================
50.  async function fetchWithRetry(url, options = {}, retries = MAX_RETRY) {
51.    for (let i = 0; i < retries; i++) {
52.      try {
53.        const response = await fetch(url, options);
54.        if (!response.ok && i < retries - 1) {
55.          console.log(`[Retry] ${i + 1}/${retries}: ${url}`);
56.          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (i + 1)));
57.          continue;
58.        }
59.        return response;
60.      } catch (error) {
61.        if (i === retries - 1) throw error;
62.        console.log(`[Retry] ${i + 1}/${retries}: ${error.message}`);
63.        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (i + 1)));
64.      }
65.    }
66.  }
67.  
68.  // ==========================================
69.  // API (Worker経由)
70.  // ==========================================
71.  async function placesTextSearch(payload, fieldMask) {
72.    try {
73.      const resp = await fetchWithRetry(`${WORKER_ORIGIN}/places:searchText`, {
74.        method: 'POST',
75.        headers: {
76.          'Content-Type': 'application/json',
77.          ...(fieldMask ? { 'X-Goog-FieldMask': fieldMask } : {})
78.        },
79.        body: JSON.stringify(payload)
80.      });
81.      
82.      if (!resp.ok) {
83.        const text = await resp.text();
84.        throw new Error(`TextSearch ${resp.status}: ${text}`);
85.      }
86.      return await resp.json();
87.    } catch (error) {
88.      console.error(`検索エラー: ${error.message}`); 
89.      throw error;
90.    }
91.  }
92.  
93.  async function placesNearby(payload, fieldMask) {
94.    try {
95.      const resp = await fetchWithRetry(`${WORKER_ORIGIN}/places:searchNearby`, {
96.        method: 'POST',
97.        headers: {
98.          'Content-Type': 'application/json',
99.          ...(fieldMask ? { 'X-Goog-FieldMask': fieldMask } : {})
100.       },
101.       body: JSON.stringify(payload)
102.     });
103.     
104.     if (!resp.ok) {
105.       const text = await resp.text();
106.       throw new Error(`Nearby ${resp.status}: ${text}`);
107.     }
108.     return await resp.json();
109.   } catch (error) {
110.     console.error(`検索エラー: ${error.message}`); 
111.     throw error;
112.   }
113. }
114. 
115. // ==========================================
116. // 地図初期化
117. // ==========================================
118. function initMap(center) {
119.   appState.map = new google.maps.Map(document.getElementById('map'), {
120.     center,
121.     zoom: 17,
122.     mapId: 'DEMO_MAP',
123.     gestureHandling: 'greedy',
124.     clickableIcons: true,
125.     disableDefaultUI: true
126.   });
127. 
128.   appState.map.addListener('click', (e) => {
129.     if (!appState.pointSearchMode) return;
130.     if (e.latLng) {
131.       setSearchPoint(e.latLng.lat(), e.latLng.lng());
132.     }
133.   });
134. 
135.   appState.mapInitialized = true;
136.   console.log('[WalkNav] Map initialized');
137. }
138. 
139. // ==========================================
140. // ユーザー位置マーカー設定 (SVG矢印)
141. // ==========================================
142. function setUserMarker(lat, lng) {
143.   appState.currentPos = { lat, lng };
144.   
145.   if (!appState.userMarker) {
146.     const pin = document.createElement('div');
147.     pin.style.width = '32px';
148.     pin.style.height = '32px';
149.     
150.     pin.innerHTML = `
151.       <svg id="user-marker-icon" viewBox="0 0 24 24"  
152.             style="width: 100%; height: 100%;  
153.                    transform: rotate(${appState.currentHeading}deg);  
154.                    transition: transform 0.2s ease-out;
155.                    filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4));">
156.         <path d="M12 2L4.5 20.5L12 16.5L19.5 20.5L12 2Z"  
157.               fill="#3aa0ff"  
158.               stroke="#ffffff"  
159.               stroke-width="2"  
160.               stroke-linejoin="round" />
161.       </svg>
162.     `;
163.     
164.     appState.userMarker = new google.maps.marker.AdvancedMarkerElement({
165.       map: appState.map,
166.       position: { lat, lng },
167.       content: pin,
168.       zIndex: 1000
169.     });
170.     
171.   } else {
172.     appState.userMarker.position = { lat, lng };
173.   }
174. }
175. 
176. // ==========================================
177. // 検索地点設定
178. // ==========================================
179. function setSearchPoint(lat, lng) {
180.   appState.searchPoint = { lat, lng };
181.   
182.   if (appState.searchPointMarker) {
183.     appState.searchPointMarker.map = null;
184.   }
185. 
186.   const pin = document.createElement('div');
187.   pin.style.width = '30px';
188.   pin.style.height = '30px';
189.   pin.style.borderRadius = '50% 50% 50% 0';
190.   pin.style.background = '#ff6565';
191.   pin.style.border = '3px solid #fff';
192.   pin.style.transform = 'rotate(-45deg)';
193.   pin.style.boxShadow = '0 4px 8px rgba(0,0,0,.3)';
194.   pin.style.transition = 'all 0.3s ease-out';
195. 
196.   appState.searchPointMarker = new google.maps.marker.AdvancedMarkerElement({
197.     map: appState.map,
198.     position: { lat, lng },
199.     content: pin,
200.     zIndex: 999
201.   });
202. 
203.   console.log(`[WalkNav] 検索地点設定: ${lat.toFixed(6)}, ${lng.toFixed(6)}`);
204.   console.log('検索地点を設定しました'); 
205.   
206.   fetchPointAddress(lat, lng);
207. }
208. 
209. // ==========================================
210. // 距離計算
211. // ==========================================
212. function calculateDistance(lat1, lon1, lat2, lon2) {
213.   const R = 6371000;  
214.   const dLat = (lat2 - lat1) * Math.PI / 180;
215.   const dLon = (lon2 - lon1) * Math.PI / 180;
216.   const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
217.             Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
218.             Math.sin(dLon / 2) * Math.sin(dLon / 2);
219.   const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
220.   return R * c;
221. }
222. 
223. // ==========================================
224. // レスポンスから距離/時間を取得
225. // ==========================================
226. function readLegDistanceText(leg) {
227.   if (leg?.distance?.text) return leg.distance.text;
228.   if (typeof leg?.distanceMeters === 'number') {
229.     const km = (leg.distanceMeters / 1000).toFixed(1);
230.     return `${km} km`;
231.   }
232.   return leg?.localizedValues?.distance?.text || '--';
233. }
234. 
235. function readLegDurationText(leg) {
236.   if (leg?.duration?.text) return leg.duration.text;
237.   if (typeof leg?.duration === 'string' && leg.duration.endsWith('s')) {
238.     const sec = parseInt(leg.duration.replace('s', ''), 10) || 0;
239.     const min = Math.max(1, Math.round(sec / 60));
240.     return `${min} 分`;
241.   }
242.   return leg?.localizedValues?.duration?.text || '--';
243. }
244. 
245. // ==========================================
246. // エンコードされたポリラインを取得
247. // ==========================================
248. function getEncodedPolylineFromRoute(route) {
249.   if (route?.overview_polyline?.points) return route.overview_polyline.points;
250.   if (route?.polyline?.encodedPolyline) return route.polyline.encodedPolyline;
251.   if (route?.overviewPolyline?.encodedPolyline) return route.overviewPolyline.encodedPolyline;
252.   return null;
253. }
254. 
255. // ==========================================
256. // ルートポリライン描画
257. // ==========================================
258. function drawRoutePolyline(route) {
259.   if (appState.currentPolyline) {
260.     appState.currentPolyline.setMap(null);
261.     appState.currentPolyline = null;
262.   }
263. 
264.   const encoded = getEncodedPolylineFromRoute(route);
265.   if (!encoded) {
266.     console.error('[Navigation] No encoded polyline found');
267.     console.error('ルート線の取得に失敗しました'); 
268.     return;
269.   }
270. 
271.   const path = google.maps.geometry.encoding.decodePath(encoded);
272.   appState.currentPolyline = new google.maps.Polyline({
273.     path: path,
274.     geodesic: true,
275.     strokeColor: '#62b5ff',
276.     strokeOpacity: 0.8,
277.     strokeWeight: 6,
278.     map: appState.map
279.   });
280. 
281.   console.log('[Navigation] Polyline drawn');
282. }
283. 
284. // ==========================================
285. // コンパス（デバイスの向き）監視
286. // ==========================================
287. const compassHandler = (event) => {
288.   // ナビ中はコンパスを無視 (目的地を指すため)
289.   if (appState.isNavigating) return;  
290.   
291.   let heading = null;
292.   if (event.webkitCompassHeading) { // iOS
293.     heading = event.webkitCompassHeading;
294.   } else if (event.absolute === true && event.alpha !== null) { // Android (北基準)
295.     heading = event.alpha;
296.   }
297. 
298.   if (heading !== null) {
299.     appState.currentHeading = heading;
300.     updateMarkerRotation();
301.   }
302. };
303. 
304. function startCompassListener() {
305.   if (appState.compassWatchId || !window.DeviceOrientationEvent) {
306.     if(!window.DeviceOrientationEvent) console.warn('[Compass] DeviceOrientationEvent is not supported.');
307.     return;
308.   }
309.   console.log('[Compass] Starting compass listener...');
310.   
311.   // iOS 13+ の許可リクエスト
312.   if (typeof DeviceOrientationEvent.requestPermission === 'function') {
313.      DeviceOrientationEvent.requestPermission()
314.       .then(permissionState => {
315.         if (permissionState === 'granted') {
316.           window.addEventListener('deviceorientationabsolute', compassHandler, true);
317.           window.addEventListener('deviceorientation', compassHandler, true);
318.           appState.compassWatchId = 1; // 監視中フラグ
319.         }
320.       })
321.       .catch(console.error);
322.   } else {
323.     // Androidなど許可が不要な場合
324.     window.addEventListener('deviceorientationabsolute', compassHandler, true);
325.     window.addEventListener('deviceorientation', compassHandler, true);
326.     appState.compassWatchId = 1; // 監視中フラグ
327.   }
328. }
329. 
330. function stopCompassListener() {
331.   if (appState.compassWatchId) {
332.     console.log('[Compass] Stopping compass listener...');
333.     window.removeEventListener('deviceorientationabsolute', compassHandler, true);
334.     window.removeEventListener('deviceorientation', compassHandler, true);
335.     appState.compassWatchId = null;
336.   }
337. }
338. 
339. function updateMarkerRotation() {
340.   const icon = document.getElementById('user-marker-icon');
341.   if (icon) {
342.     // マップは回転しない前提
343.     icon.style.transform = `rotate(${appState.currentHeading}deg)`;
344.   }
345. }
346. 
347. // ==========================================
348. // リアルタイム位置情報監視（ナビ中）
349. // ==========================================
350. function startLocationWatcher() {
351.   if (appState.locationWatchId) {
352.     navigator.geolocation.clearWatch(appState.locationWatchId);
353.     appState.locationWatchId = null;
354.   }
355.   console.log('[Location] Starting watchPosition (Nav Mode)...');
356. 
357.   const onWatchSuccess = (pos) => {
358.     const { latitude, longitude } = pos.coords;
359.     console.log(`[Location] Watch update: ${latitude}, ${longitude}`);
360.     
361.     setUserMarker(latitude, longitude);
362.     
363.     // 住所もリアルタイム更新
364.     fetchLocationNameGoogle(latitude, longitude);
365.     
366.     // ナビ中で一時停止中でなければ
367.     if (appState.isNavigating && !appState.isPaused) {
368.       appState.map.panTo({ lat: latitude, lng: longitude });
369. 
370.       // マーカーの向きを目的地に合わせる
371.       if (appState.currentDestination && google.maps.geometry) {
372.         const currentLatLng = new google.maps.LatLng(latitude, longitude);
373.         const destLatLng = new google.maps.LatLng(appState.currentDestination.lat, appState.currentDestination.lng);
374.         
375.         let headingDeg = google.maps.geometry.spherical.computeHeading(currentLatLng, destLatLng);
376.         if (headingDeg < 0) { headingDeg += 360; }  
377.         
378.         appState.currentHeading = headingDeg;
379.         updateMarkerRotation();
380.       }
381.     }
382.   };
383. 
384.   const onWatchError = (error) => {
385.     console.error('[Location] Watch error:', error.message);
386.     console.error('リアルタイム位置情報の取得に失敗'); 
387.     stopLocationWatcher();
388.   };
389. 
390.   appState.locationWatchId = navigator.geolocation.watchPosition(
391.     onWatchSuccess,
392.     onWatchError,
393.     LOCATION_OPTIONS
394.   );
395. }
396. 
397. function stopLocationWatcher() {
398.    if (appState.locationWatchId) {
399.     console.log('[Location] Stopping watchPosition (Nav Mode)...');
400.     navigator.geolocation.clearWatch(appState.locationWatchId);
401.     appState.locationWatchId = null;
402.   }
403. }
404. 
405. 
406. // ==========================================
407. // ナビゲーション開始 (シミュレーション対応)
408. // ==========================================
409. async function startNavigation(destination) {
410.   let originLat, originLng;
411.   
412.   // シミュレーションモード判定
413.   if (appState.pointSearchMode && appState.searchPoint) {
414.     originLat = appState.searchPoint.lat;
415.     originLng = appState.searchPoint.lng;
416.     appState.isSimulation = true;
417.     console.log('[Navigation] シミュレーションモードで開始');
418.   } else if (appState.currentPos) {
419.     originLat = appState.currentPos.lat;
420.     originLng = appState.currentPos.lng;
421.     appState.isSimulation = false;
422.     console.log('[Navigation] リアルタイムモードで開始');
423.   } else {
424.     console.error('起点が設定されていません'); 
425.     return;
426.   }
427. 
428.   appState.currentDestination = destination;
429.   appState.isNavigating = true;
430.   appState.isPaused = false;
431.   
432.   // UI制御
433.   document.getElementById('searchPanel').style.display = 'none';
434.   document.getElementById('fabStack').style.display = 'flex';  
435.   document.getElementById('appBody').classList.remove('panel-open');
436.   
437.   // コンパス（デバイス向き）監視を停止
438.   stopCompassListener();
439.   
440.   try {
441.     console.log('ルートを取得中...'); 
442. 
443.     const params = new URLSearchParams({
444.       origin: `${originLat},${originLng}`,
445.       destination: `${destination.lat},${destination.lng}`,
446.       mode: 'walking',
447.       language: 'ja'
448.     });
449. 
450.     const response = await fetchWithRetry(`${WORKER_ORIGIN}/directions?${params.toString()}`);
451.     
452.     if (!response.ok) {
453.       const errorText = await response.text();
454.       throw new Error(`Directions API Error: ${response.status} - ${errorText}`);
455.     }
456. 
457.     const result = await response.json();
458.     console.log('[Navigation] Directions Response:', result);
459. 
460.     if (result.routes && result.routes.length > 0) {
461.       const r0 = result.routes[0];
462.       const l0 = (r0.legs && r0.legs[0]) ? r0.legs[0]: null;
463. 
464.       const distanceText = l0 ? readLegDistanceText(l0) : '--';
465.       const durationText = l0 ? readLegDurationText(l0) : '--';
466. 
467.       // UI更新
468.       document.getElementById('destinationName').textContent = destination.name;
469.       document.getElementById('routeDistance').textContent = distanceText;
470.       document.getElementById('routeTime').textContent = `徒歩 ${durationText}`;
471.       document.getElementById('routePanel').style.display = 'block';
472.       document.getElementById('searchPanel').style.display = 'none';
473.       document.getElementById('results').style.display = 'none';
474.       document.getElementById('btnDestination').style.display = 'flex';
475. 
476.       // 道順案内パネルの処理
477.       const instructionsList = document.getElementById('navPanelInstructions');
478.       instructionsList.innerHTML = ''; // クリア
479.       if (l0 && l0.steps && l0.steps.length > 0) {
480.         l0.steps.forEach(step => {
481.           const item = document.createElement('div');
482.           item.className = 'nav-instruction-item';
483.           const cleanInstruction = (step.html_instructions || '').replace(/<[^>]+>/g, ' ');
484.           item.textContent = `${cleanInstruction} (${step.distance.text})`;
485.           instructionsList.appendChild(item);
486.         });
487.       }
488.       document.getElementById('navPanel').style.display = 'block';
489.       
490.       // 道順テキスト出力用にデータを保存
491.       appState.currentRouteData = {
492.         steps: l0.steps,
493.         summary: r0.summary,
494.         distance: distanceText,
495.         duration: durationText,
496.         destinationName: destination.name,
497.         warnings: r0.warnings || []
498.       };
499. 
500.       // インシデントパネルの処理
501.       const incidentPanel = document.getElementById('incidentPanel');
502.       if (r0.warnings && r0.warnings.length > 0) {
503.         incidentPanel.innerHTML = '⚠️ ' + r0.warnings.map(w => w.replace(/<[^>]+>/g, ' ')).join('<br>⚠️ ');
504.         incidentPanel.style.display = 'block';
505.       } else {
506.         incidentPanel.style.display = 'none';
507.       }
508.       
509.       // 天気予報の処理
510.       fetchWeather(originLat, originLng);
511.       
512.       // モードに応じて監視を開始
513.       if (appState.isSimulation) {
514.         // シミュレーションの場合
515.         setUserMarker(originLat, originLng); // マーカーを起点に設置
516.         fetchLocationNameGoogle(originLat, originLng); // 案内パネルの住所を更新
517.         // 目的地への向きを計算してマーカーを回転
518.         if (appState.currentDestination && google.maps.geometry) {
519.           const currentLatLng = new google.maps.LatLng(originLat, originLng);
520.           const destLatLng = new google.maps.LatLng(appState.currentDestination.lat, appState.currentDestination.lng);
521.           let headingDeg = google.maps.geometry.spherical.computeHeading(currentLatLng, destLatLng);
522.           if (headingDeg < 0) { headingDeg += 360; }  
523.           appState.currentHeading = headingDeg;
524.           updateMarkerRotation();
525.         }
526.       } else {
527.         // リアルタイムナビの場合
528.         startLocationWatcher();
529.       }
530. 
531.       // ポリライン描画
532.       drawRoutePolyline(r0);
533. 
534.       // カメラワーク
535.       const bounds = new google.maps.LatLngBounds();
536.       bounds.extend(new google.maps.LatLng(originLat, originLng));
537.       bounds.extend(new google.maps.LatLng(destination.lat, destination.lng));
538.       appState.map.fitBounds(bounds, { top: 100, right: 150, bottom: 300, left: 50 });  
539. 
540.       setTimeout(() => {
541.         appState.map.panTo({ lat: destination.lat, lng: destination.lng });
542.         appState.map.setZoom(18);
543.         setTimeout(() => {
544.           appState.map.panTo({ lat: originLat, lng: originLng });
545.           appState.map.setZoom(18);
546.         }, 2000);
547.       }, 2000);
548. 
549.       console.log(`${destination.name} へのルート案内を開始`); 
550.       console.log(`[Navigation] ルート案内開始: ${destination.name}`);
551.     } else {
552.       throw new Error('ルートが取得できませんでした');
553.     }
554.   } catch (error) {
555.     console.error('[Navigation] Error:', error);
556.     console.error(`ルートエラー: ${error.message}`); 
557.     appState.isNavigating = false;
558.     appState.isSimulation = false;
559.     document.getElementById('fabStack').style.display = 'none';  
560.     startCompassListener(); // エラー時はコンパス監視を再開
561.   }
562. }
563. 
564. // ==========================================
565. // ナビゲーション停止
566. // ==========================================
567. function stopNavigation() {
568.   stopLocationWatcher(); // リアルタイム監視を停止
569.   startCompassListener();  // コンパス監視を再開
570.   
571.   appState.isSimulation = false;  
572.   appState.currentRouteData = null;  
573.   
574.   if (appState.currentPolyline) {
575.     appState.currentPolyline.setMap(null);
576.     appState.currentPolyline = null;
577.   }
578.   
579.   appState.currentDestination = null;
580.   appState.isNavigating = false;
581.   appState.isPaused = false;
582.   
583.   // UI更新
584.   document.getElementById('routePanel').style.display = 'none';
585.   document.getElementById('navPanel').style.display = 'block';  
586.   document.getElementById('navPanelInstructions').innerHTML = '';  
587.   document.getElementById('incidentPanel').style.display = 'none';  
588.   document.getElementById('incidentPanel').innerHTML = '';  
589.   document.getElementById('searchPanel').style.display = 'block';
590.   document.getElementById('btnDestination').style.display = 'none';
591.   document.getElementById('q').value = '';
592.   document.getElementById('results').style.display = 'none';
593.   document.getElementById('results').innerHTML = '';
594.   
595.   // 天気予報をリセット
596.   document.getElementById('weather3h').textContent = '--';
597.   document.getElementById('weather6h').textContent = '--';
598.   document.getElementById('weather9h').textContent = '--';
599.   
600.   // FABボタンを非表示
601.   document.getElementById('fabStack').style.display = 'none';
602.   // document.getElementById('btnSearch').style.display = 'flex'; // ★ 削除 (stopNavでは不要)
603.   
604.   // 一時停止ボタンをリセット
605.   const btnPause = document.getElementById('btnPause');
606.   btnPause.textContent = '一時停止';
607.   btnPause.classList.remove('paused');
608.   
609.   // 検索マーカー削除
610.   appState.searchMarkers.forEach(marker => marker.map = null);
611.   appState.searchMarkers = [];
612.   
613.   // 現在地に戻る
614.   if (appState.currentPos && appState.map) {
615.     appState.map.panTo(appState.currentPos);
616.     appState.map.setZoom(17);
617.   }
618.   
619.   // マーカーの向きをコンパスに戻す
620.   updateMarkerRotation();  
621.   
622.   document.getElementById('appBody').classList.add('panel-open'); // トースト位置
623.   console.log('ルート案内を終了しました'); 
624.   console.log('[Navigation] ルート案内終了');
625. }
626. 
627. // ==========================================
628. // 一時停止/再開トグル
629. // ==========================================
630. function togglePause() {
631.   // シミュレーション中は一時停止不要
632.   if (appState.isSimulation) {
633.      console.warn('シミュレーション中は一時停止できません'); 
634.      return;
635.   }
636.   if (!appState.isNavigating) {
637.     console.warn('ナビゲーション中ではありません'); 
638.     return;
639.   }
640. 
641.   appState.isPaused = !appState.isPaused;
642.   const btnPause = document.getElementById('btnPause');
643.   
644.   if (appState.isPaused) {
645.     btnPause.textContent = '再開';
646.     btnPause.classList.add('paused');
647.     console.warn('ナビゲーションを一時停止しました'); 
648.     console.log('[Navigation] 一時停止');
649.   } else {
650.     btnPause.textContent = '一時停止';
651.     btnPause.classList.remove('paused');
652.     console.log('ナビゲーションを再開しました'); 
653.     console.log('[Navigation] 再開');
654.     // 再開時にマップを現在地に追従
655.     if(appState.currentPos) {
656.       appState.map.panTo(appState.currentPos);
657.       appState.map.setZoom(18);
658.     }
659.   }
660. }
661. 
662. // ==========================================
663. // 検索実行 (Worker経由)
664. // ==========================================
665. const TYPE_MAP = {
666.   "コンビニ": "convenience_store",
667.   "スーパー": "supermarket",
668.   "レストラン": "restaurant",
669.   "カフェ": "cafe",
670.   "ホテル": "lodging",
671.   "病院": "hospital",
672.   "薬局": "pharmacy",
673.   "ガソリンスタンド": "gas_station",
674.   "駐車場": "parking",
675.   "銀行": "bank"
676. };
677. 
678. async function performSearch(query) {
679.   if (!query || !query.trim()) {
680.     console.warn('検索ワードを入力してください'); 
681.     return;
682.   }
683. 
684.   let centerLat, centerLng;
685.   
686.   if (appState.pointSearchMode && appState.searchPoint) {
687.     centerLat = appState.searchPoint.lat;
688.     centerLng = appState.searchPoint.lng;
689.   } else if (appState.currentPos) {
690.     centerLat = appState.currentPos.lat;
691.     centerLng = appState.currentPos.lng;
692.   } else {
693.     console.error('検索の基準地点が不明です'); 
694.     return;
695.   }
696. 
697.   const radiusKm = parseInt(document.getElementById('radiusLabel').textContent);
698.   const radiusMeters = radiusKm * 1000;
699. 
700.   console.log('検索中...'); 
701. 
702.   // Text Search優先
703.   try {
704.     const data = await placesTextSearch({
705.       textQuery: query.trim(),
706.       locationBias: {
707.         circle: { center: { latitude: centerLat, longitude: centerLng }, radius: radiusMeters }
708.       },
709.       maxResultCount: 20,
710.       languageCode: 'ja'
711.     }, DEFAULT_MASK);
712. 
713.     if (data.places?.length) {
714.       displayResults(data.places, centerLat, centerLng);
715.       return;
716.     }
717.   } catch (e) {
718.     console.error('[Search] Text Search Error:', e);
719.   }
720. 
721.   // Nearby Search（タイプが一致する場合のみ）
722.   const typeKey = TYPE_MAP[query.trim()] || TYPE_MAP[query.trim().replace(/\s/g, '')];
723. 
724.   if (typeKey) {
725.     try {
726.       const data = await placesNearby({
727.         includedTypes: [typeKey],
728.         maxResultCount: 20,
729.         locationRestriction: {
730.           circle: { center: { latitude: centerLat, longitude: centerLng }, radius: radiusMeters }
731.         },
732.         languageCode: 'ja'
733.       }, DEFAULT_MASK);
734. 
735.       if (data.places?.length) {
736.         displayResults(data.places, centerLat, centerLng);
737.         return;
738.       }
739.     } catch (e) {
740.       console.error('[Search] Nearby Error:', e);
741.     }
742.   }
743. 
744.   console.warn('検索結果が見つかりませんでした'); 
745.   document.getElementById('results').style.display = 'none';
746.   
747.   // 検索結果がない場合、案内パネルを再表示
748.   document.getElementById('navPanel').style.display = 'block';
749. }
750. 
751. // ==========================================
752. // 検索結果表示
753. // ==========================================
754. function displayResults(places, centerLat, centerLng) {
755.   // 検索結果が表示されるため、案内パネルを非表示にする
756.   document.getElementById('navPanel').style.display = 'none';
757. 
758.   appState.searchMarkers.forEach(marker => marker.map = null);
759.   appState.searchMarkers = [];
760. 
761.   const placesWithDistance = places.map(place => {
762.     const lat = place.location.latitude;
763.     const lng = place.location.longitude;
764.     const distance = calculateDistance(centerLat, centerLng, lat, lng);
765.     return { ...place, distance };
766.   });
767. 
768.   placesWithDistance.sort((a, b) => a.distance - b.distance);
769.   const limitedResults = placesWithDistance.slice(0, 5);
770. 
771.   const resultsDiv = document.getElementById('results');
772.   resultsDiv.innerHTML = '';
773.   resultsDiv.style.display = 'block';
774. 
775.   limitedResults.forEach((place, index) => {
776.     const name = place.displayName?.text || place.displayName || '名称不明';
777.     const address = place.formattedAddress || '住所不明';
778.     const lat = place.location.latitude;
779.     const lng = place.location.longitude;
780.     const distanceKm = (place.distance / 1000).toFixed(2);
781. 
782.     const item = document.createElement('div');
783.     item.className = 'result-item';
784.     item.innerHTML = `
785.       <div class="result-name">${index + 1}. ${name}</div>
786.       <div class="result-address">${address}</div>
787.       <div style="font-size:11px;color:#62b5ff;margin-top:4px">
788.         📍 ${distanceKm}km
789.       </div>
790.     `;
791.     
792.     item.onclick = () => {
793.       startNavigation({
794.         name: name,
795.         lat: lat,
796.         lng: lng
797.       });
798.     };
799. 
800.     resultsDiv.appendChild(item);
801. 
802.     const markerPin = document.createElement('div');
803.     markerPin.style.width = '24px';
804.     markerPin.style.height = '24px';
805.     markerPin.style.borderRadius = '50%';
806.     markerPin.style.background = '#25d07a';
807.     markerPin.style.border = '2px solid #fff';
808.     markerPin.style.boxShadow = '0 2px 6px rgba(0,0,0,.3)';
809.     markerPin.style.display = 'flex';
810.     markerPin.style.alignItems = 'center';
811.     markerPin.style.justifyContent = 'center';
812.     markerPin.style.color = '#fff';
813.     markerPin.style.fontSize = '12px';
814.     markerPin.style.fontWeight = 'bold';
815.     markerPin.textContent = index + 1;
816. 
817.     const marker = new google.maps.marker.AdvancedMarkerElement({
818.       map: appState.map,
819.       position: { lat, lng },
820.       content: markerPin,
821.       zIndex: 500 + index,
822.       title: name
823.     });
824. 
825.     appState.searchMarkers.push(marker);
826.   });
827. 
828.   console.log(`${limitedResults.length}件の検索結果`); 
829.   console.log(`[Search] ${limitedResults.length}件の結果を表示しました`);
830. }
831. 
832. // ==========================================
833. // 音声認識初期化 (クラス切り替え方式に変更)
834. // ==========================================
835. function initSpeechRecognition() {
836.   if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
837.     console.log('[Voice] 音声認識は非対応です');
838.     return false;
839.   }
840. 
841.   const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
842.   appState.recognition = new SpeechRecognition();
843.   appState.recognition.lang = 'ja-JP';
844.   appState.recognition.continuous = false;
845.   appState.recognition.interimResults = false;
846. 
847.   const btnVoiceIcon = document.getElementById('btnVoiceIcon');
848. 
849.   appState.recognition.onstart = () => {
850.     console.log('[Voice] 音声認識開始');
851.     btnVoiceIcon.classList.add('recording'); // ★ クラス追加
852.   };
853. 
854.   appState.recognition.onresult = (event) => {
855.     const transcript = event.results[0][0].transcript;
856.     console.log('[Voice] 認識結果:', transcript);
857.     document.getElementById('q').value = transcript;
858.     performSearch(transcript);
859.     console.log(`音声認識: ${transcript}`); 
860.   };
861. 
862.   appState.recognition.onerror = (event) => {
863.     console.error('[Voice] エラー:', event.error);
864.     btnVoiceIcon.classList.remove('recording'); // ★ クラス削除
865.     console.error('音声認識エラーが発生しました'); 
866.   };
867. 
868.   appState.recognition.onend = () => {
869.     console.log('[Voice] 音声認識終了');
870.     btnVoiceIcon.classList.remove('recording'); // ★ クラス削除
871.   };
872. 
873.   return true;
874. }
875. 
876. // ==========================================
877. // 音声検索開始
878. // ==========================================
879. function startVoiceSearch() {
880.   if (!appState.recognition) {
881.     if (!initSpeechRecognition()) {
882.       console.error('お使いのブラウザは音声認識に対応していません'); 
883.       return;
884.     }
885.   }
886. 
887.   try {
888.     appState.recognition.start();
889.   } catch (e) {
890.     console.error('[Voice] 開始エラー:', e);
891.     appState.recognition.stop();
892.     setTimeout(() => {
893.       try {
894.         appState.recognition.start();
895.       } catch (e2) {
896.         console.error('[Voice] 再開エラー:', e2);
897.         console.error('音声認識の開始に失敗しました'); 
898.       }
899.     }, 100);
900.   }
901. }
902. 
903. // ==========================================
904. // 現在地取得 (初回1回のみ)
905. // ==========================================
906. function acquireLocation() {
907.   const onSuccess = (pos) => {
908.     document.getElementById('loading')?.remove();
909.     
910.     const { latitude, longitude } = pos.coords;
911.     
912.     if (!appState.map) {
913.       initMap({ lat: latitude, lng: longitude });
914.     }
915.     
916.     appState.map.setCenter({ lat: latitude, lng: longitude });
917.     setUserMarker(latitude, longitude);  
918.     fetchLocationNameGoogle(latitude, longitude);  
919.     console.log('現在地を取得しました'); 
920.   };
921.   
922.   const onError = (error) => {
923.     console.log('[WalkNav] geolocation error', error?.message || error);
924.     document.getElementById('loading')?.remove();
925.     
926.     if (!appState.map) {
927.       initMap({ lat: 35.6812, lng: 139.7671 });  
928.     }
929.     
930.     const addressElement = document.getElementById('locAddress');
931.     const coordsElement = document.getElementById('locCoords');
932.     
933.     if (addressElement) {
934.       addressElement.textContent = '位置情報を確認できません';
935.     }
936.     if (coordsElement) {
937.       coordsElement.textContent = '現在地：取得失敗';
938.     }
939. 
9KA.     let errorMessage = '現在地の取得に失敗しました';
941.     if (error.code === 1) { // PERMISSION_DENIED
942.       errorMessage = '位置情報が許可されていません';
943.     } else if (error.code === 2) { // POSITION_UNAVAILABLE
944.       errorMessage = '位置情報が利用できません';
945.     } else if (error.code === 3) { // TIMEOUT
946.       errorMessage = '位置情報の取得がタイムアウトしました';
947.     }
948.     console.error(errorMessage); 
949.   };
950.   
951.   try {
952.     navigator.geolocation.getCurrentPosition(onSuccess, onError, LOCATION_OPTIONS);
953.   } catch (e) {
954.     console.log('[WalkNav] geolocation exception', e);
955.     console.error('位置情報へのアクセスが拒否されました'); 
956.     document.getElementById('loading')?.remove(); // ★ 修正
957.   }
958. }
959. 
960. // ==========================================
961. // 地名取得（逆ジオコーディング）- Cloudflare経由
962. // ==========================================
963. async function fetchLocationNameGoogle(lat, lng) {
964.   const addressElement = document.getElementById('locAddress');
965.   const coordsElement = document.getElementById('locCoords');
966. 
967.   if (!addressElement || !coordsElement) {
968.     console.error('[DEBUG] Elements not found!');
969.     return;
970.   }
971. 
972.   // 1行目: 緯度経度
973.   const coordsText = `現在地：緯度 ${lat.toFixed(6)} / 経度 ${lng.toFixed(6)}`;
974.   coordsElement.textContent = coordsText;
975. 
976.   try {
977.     console.log('[Geocode] Fetching address from Cloudflare...');
978.     const params = new URLSearchParams({ lat: lat, lng: lng, language: 'ja' });
979.     
980.     const response = await fetchWithRetry(`${WORKER_ORIGIN}/geocode?${params.toString()}`);
981.     
982.     if (!response.ok) {
983.       const errorText = await response.text();
984.       throw new Error(`Geocode Worker Error ${response.status}: ${errorText}`);
985.     }
986. 
987.     const data = await response.json();
988. 
989.     if (data.status === 'OK' && data.results[0]) {
990.       const address = data.results[0].formatted_address;
991.       const cleanAddress = address.replace(/^日本、\s*/, '');
992.       // 2行目: 〒住所
993.       const formattedAddress = cleanAddress + ' 付近';
994.       
995.       addressElement.textContent = formattedAddress;
996.     } else {
997.       console.error('[Geocode] Geocode failed via Cloudflare. Status:', data.status);
998.       // 2行目: エラー
999.       addressElement.textContent = '住所情報なし';
1000.       if (data.status !== 'ZERO_RESULTS') {
1001.          console.error(`住所取得エラー: ${data.status}`); 
1002.       }
1003.     }
1004.   } catch (error) {
1005.     console.error('[Geocode] Fetch error:', error);
1006.     // 2行目: エラー
1007.     addressElement.textContent = '住所取得エラー';
1008.   }
1009. }
1010. 
1011. // ==========================================
1012. // ポイント選択時の地名取得
1013. // ==========================================
1014. async function fetchPointAddress(lat, lng) {
1015.   const addressBlock = document.getElementById('pointAddressBlock');
1016.   const addressElement = document.getElementById('pointAddress');
1017.   const coordsElement = document.getElementById('pointCoords');
1018. 
1019.   if (!addressElement || !coordsElement || !addressBlock) {
1020.     console.error('[DEBUG] Point Elements not found!');
1021.     return;
1022.   }
1023. 
1024.   addressElement.textContent = 'ポイント：住所取得中...';
1025.   coordsElement.textContent = `(緯度 ${lat.toFixed(6)} / 経度 ${lng.toFixed(6)})`;
1026.   addressBlock.style.display = 'flex';
1027. 
1028.   try {
1029.     const params = new URLSearchParams({ lat: lat, lng: lng, language: 'ja' });
1030.     const response = await fetchWithRetry(`${WORKER_ORIGIN}/geocode?${params.toString()}`);
1031.     
1032.     if (!response.ok) {
1033.       const errorText = await response.text();
1034.       throw new Error(`Geocode Worker Error ${response.status}: ${errorText}`);
1035.     }
1036. 
1037.     const data = await response.json();
1038. 
1039.     if (data.status === 'OK' && data.results[0]) {
1040.       const address = data.results[0].formatted_address;
1041.       const cleanAddress = address.replace(/^日本、\s*/, '');
1042.       const formattedAddress = 'ポイント：' + cleanAddress + ' 付近';
1043.       addressElement.textContent = formattedAddress;
1044.     } else {
1045.       addressElement.textContent = 'ポイント：住所情報なし';
1046.     }
1047.   } catch (error) {
1048.     console.error('[Geocode] Fetch error for Point:', error);
1049.     addressElement.textContent = 'ポイント：住所取得エラー';
1050.   }
1051. }
1052. 
1053. // ==========================================
1054. // 天気予報取得
1055. // ==========================================
1056. 
1057. // OpenWeatherMapのアイコンコードを絵文字にマッピング
1058. function getWeatherIcon(iconCode) {
1059.   const map = {
1060.     '01d': '☀️', '01n': '🌙',
1061.     '02d': '🌤️', '02n': '☁️',
1062.     '03d': '☁️', '03n': '☁️',
1063.     '04d': '☁️', '04n': '☁️',
1064.     '09d': '🌦️', '09n': '🌦️',
1065.     '10d': '🌧️', '10n': '🌧️',
1066.     '11d': '⛈️', '11n': '⛈️',
1067.     '13d': '❄️', '13n': '❄️',
1068.     '50d': '🌫️', '50n': '🌫️',
1069.   };
1070.   return map[iconCode] || '❔';
1071. }
1072. 
1073. async function fetchWeather(lat, lng) {
1074.   console.log('[Weather] Fetching weather...');
1075.   try {
1076.     const params = new URLSearchParams({ lat: lat, lng: lng });
1077.     const response = await fetchWithRetry(`${WORKER_ORIGIN}/weather?${params.toString()}`);
1078.     
1079.     if (!response.ok) {
1080.        const errorData = await response.json();
1081.        if (errorData.status === 'NOT_IMPLEMENTED') {
1082.         console.warn('[Weather] ' + errorData.error_message);
1083.         throw new Error(errorData.error_message);
1084.        }
1085.        throw new Error(errorData.error_message || `Weather fetch failed (${response.status})`);
1086.     }
1087.     
1088.     const data = await response.json(); // OpenWeatherMapのhourly形式を想定
1089.     
1090.     // 3h, 6h, 9h 後のデータを取得 (インデックスは目安)
1091.     const weather3h = data.hourly[2]?.weather[0]?.icon || null;  
1092.     const weather6h = data.hourly[5]?.weather[0]?.icon || null;
1093.     const weather9h = data.hourly[8]?.weather[0]?.icon || null;
1094.     
1095.     document.getElementById('weather3h').textContent = getWeatherIcon(weather3h);
1096.     document.getElementById('weather6h').textContent = getWeatherIcon(weather6h);
1097.     document.getElementById('weather9h').textContent = getWeatherIcon(weather9h);
1098.     
1099.   } catch (error) {
1100.     console.error('[Weather] Error:', error);
1101.     if (error.message.includes('configured')) {
1102.        // APIキー未設定エラーはトースト表示しない
1103.     } else {
1104.        console.warn(`天気予報の取得に失敗: ${error.message}`); 
1105.     }
1106.     document.getElementById('weather3h').textContent = 'X';
1107.     document.getElementById('weather6h').textContent = 'X';
1108.     document.getElementById('weather9h').textContent = 'X';
1109.   }
1110. }
1111. 
1112. 
1113. // ==========================================
1114. // ダイアログユーティリティ
1115. // ==========================================
1116. function createDialog(config) {
1117.   const overlay = document.createElement('div');
1118.   overlay.className = `dialog-overlay ${config.scroll ? 'scroll' : ''}`;
1119.   overlay.id = config.id || 'dialog';
1120.   
1121.   const box = document.createElement('div');
1122.   box.className = `dialog-box ${config.wide ? 'wide' : ''}`;
1123.   box.innerHTML = config.content;
1124.   
1125.   overlay.appendChild(box);
1126.   document.body.appendChild(overlay);
1127.   
1128.   return overlay;
1129. }
1130. 
1131. // ==========================================
1132. // 現在地登録ダイアログ
1133. // ==========================================
1134. function showSaveLocationDialog() {
1135.   if (!appState.currentPos) {
1136.     console.error('現在地が取得できていません'); 
1137.     return;
1138.   }
1139.   
1140.   const dialog = createDialog({
1141.     id: 'saveLocationDialog',
1142.     content: `
1143.       <h3 class="dialog-title">現在地点登録画面</h3>
1144.       <p class="dialog-text">登録する地点名を入力してください:</p>
1145.       <input type="text" id="locationNameInput" class="dialog-input" placeholder="地点名を入力" />
1146.       <div class="dialog-actions">
1147.         <button id="btnCancelSave" class="dialog-btn cancel">キャンセル</button>
1148.         <button id="btnConfirmSave" class="dialog-btn confirm">OK</button>
1149.       </div>
1150.     `
1151.   });
1152.   
1153.   const input = document.getElementById('locationNameInput');
1154.   const btnCancel = document.getElementById('btnCancelSave');
1155.   const btnConfirm = document.getElementById('btnConfirmSave');
1156.   
1157.   setTimeout(() => input.focus(), 100);
1158.   
1159.   btnCancel.onclick = () => dialog.remove();
1160.   
1161.   btnConfirm.onclick = () => {
1162.     const locationName = input.value.trim();
1163.     
1164.     if (!locationName) {
1165.       input.style.borderColor = 'var(--danger)'; 
1166.       setTimeout(() => { input.style.borderColor = 'var(--stroke)'; }, 2000);
1167.       return;
1168.     }
1169.     
1170.     const locations = JSON.parse(localStorage.getItem('savedLocations') || '[]');
1171.     const savedLocation = {
1172.       name: locationName,
1173.       lat: appState.currentPos.lat,
1174.       lng: appState.currentPos.lng,
1175.       timestamp: Date.now()
1176.     };
1177.     locations.push(savedLocation);
1178.     localStorage.setItem('savedLocations', JSON.stringify(locations));
1179.     
1180.     console.log('[SaveLocation] 現在地を登録:', savedLocation);
1181.     dialog.remove();
1182.     
1183.     console.log(`「${locationName}」を登録しました`); 
1184.   };
1185.   
1186.   input.addEventListener('keypress', (e) => {
1187.     if (e.key === 'Enter') btnConfirm.click();
1188.   });
1189. }
1190. 
1191. // ==========================================
1192. // 登録地点修正ダイアログ
1193. // ==========================================
1194. function showEditLocationDialog() {
1195.   const locations = JSON.parse(localStorage.getItem('savedLocations') || '[]');
1196.   
1197.   if (locations.length === 0) {
1198.     const dialog = createDialog({
1199.       id: 'editDialog',
1200.       content: `
1201.         <h3 class="dialog-title">登録地点修正</h3>
1202.         <p class="dialog-muted">登録された地点がありません</p>
1203.         <button id="btnCloseEmpty" class="dialog-btn confirm full">閉じる</button>
1204.       `
1205.     });
1206.     
1207.     document.getElementById('btnCloseEmpty').onclick = () => dialog.remove();
1208.     return;
1209.   }
1210.   
1211.   let listHTML = '<div class="location-list">';
1212.   locations.forEach((loc, index) => {
1213.     listHTML += `
1214.       <div class="location-item">
1215.         <div class="location-item-name">${loc.name}</div>
1216.         <div class="location-item-coords">緯度: ${loc.lat.toFixed(6)} / 経度: ${loc.lng.toFixed(6)}</div>
1217.         <div class="location-item-actions">
1218.           <button class="location-item-btn nav" data-index="${index}">ナビ開始</button>
1219.           <button class="location-item-btn edit" data-index="${index}">名前変更</button>
1220.           <button class="location-item-btn delete" data-index="${index}">削除</button>
1221.         </div>
1222.       </div>
1223.     `;
1224.   });
1225.   listHTML += '</div>';
1226.   
1227.   const dialog = createDialog({
1228.     id: 'editDialog',
1229.     wide: true,
1230.     scroll: true,
1231.     content: `
1232.       <h3 class="dialog-title">登録地点修正</h3>
1233.       ${listHTML}
1234.       <button id="btnCloseEdit" class="dialog-btn cancel full" style="margin-top:16px">閉じる</button>
1235.     `
1236.   });
1237.   
1238.   document.getElementById('btnCloseEdit').onclick = () => dialog.remove();
1239.   
1240.   // ナビ開始ボタン
1241.   document.querySelectorAll('.location-item-btn.nav').forEach(btn => {
1242.     btn.onclick = () => {
1243.       const index = parseInt(btn.dataset.index);
1244.       const loc = locations[index];
1245.       dialog.remove();
1246.       startNavigation({
1247.         name: loc.name,
1248.         lat: loc.lat,
1249.         lng: loc.lng
1250.       });
1251.     };
1252.   });
1253.   
1254.   // 名前変更ボタン
1255.   document.querySelectorAll('.location-item-btn.edit').forEach(btn => {
1256.     btn.onclick = () => {
1257.       const index = parseInt(btn.dataset.index);
1258.       const loc = locations[index];
1259.       
1260.       const renameDialog = createDialog({
1261.         id: 'renameDialog',
1262.         content: `
1263.           <h3 class="dialog-title">地点名変更</h3>
1264.           <input type="text" id="renameInput" value="${loc.name}" class="dialog-input" />
1265.           <div class="dialog-actions">
1266.             <button id="btnCancelRename" class="dialog-btn cancel">キャンセル</button>
1267.             <button id="btnConfirmRename" class="dialog-btn confirm">OK</button>
1268.           </div>
1269.         `
1270.       });
1271.       
1272.       const renameInput = document.getElementById('renameInput');
1273.       setTimeout(() => {
1274.         renameInput.focus();
1275.         renameInput.select();
1276.       }, 100);
1277.       
1278.       document.getElementById('btnCancelRename').onclick = () => renameDialog.remove();
1279.       
1280.       document.getElementById('btnConfirmRename').onclick = () => {
1281.         const newName = renameInput.value.trim();
1282.         if (!newName) {
1283.           renameInput.style.borderColor = 'var(--danger)'; 
1284.           setTimeout(() => { renameInput.style.borderColor = 'var(--stroke)'; }, 2000);
1285.           return;
1286.         }
1287.         
1288.         locations[index].name = newName;
1289.         localStorage.setItem('savedLocations', JSON.stringify(locations));
1290.         
1291.         renameDialog.remove();
1292.         dialog.remove();
1293.         console.log(`地点名を「${newName}」に変更しました`); 
1294.       };
1295.       
1296.       renameInput.addEventListener('keypress', (e) => {
1297.         if (e.key === 'Enter') document.getElementById('btnConfirmRename').click();
1298.       });
1299.     };
1300.   });
1301.   
1302.   // 削除ボタン
1303.   document.querySelectorAll('.location-item-btn.delete').forEach(btn => {
1304.     btn.onclick = () => {
1305.       const index = parseInt(btn.dataset.index);
1306.       const loc = locations[index];
1307.       
1308.       const confirmDialog = createDialog({
1309.         id: 'confirmDeleteDialog',
1310.         content: `
1311.           <h3 class="dialog-title">削除確認</h3>
1312.           <p class="dialog-text">「${loc.name}」を削除しますか？</p>
1313.           <div class="dialog-actions">
1314.             <button id="btnCancelDelete" class="dialog-btn cancel">キャンセル</button>
1315.             <button id="btnConfirmDelete" class="dialog-btn delete">削除</button>
1316.           </div>
1317.         `
1318.       });
1319.       
1320.       document.getElementById('btnCancelDelete').onclick = () => confirmDialog.remove();
1321.       
1322.       document.getElementById('btnConfirmDelete').onclick = () => {
1323.         locations.splice(index, 1);
1324.         localStorage.setItem('savedLocations', JSON.stringify(locations));
1325.         
1326.         confirmDialog.remove();
1327.         dialog.remove();
1328.         console.log(`「${loc.name}」を削除しました`); 
1329.       };
1330.     };
1331.   });
1332. }
1333. 
1334. // ==========================================
1335. // 道順をクリップボードにコピー
1336. // ==========================================
1337. function exportRouteToClipboard() {
1338.   if (!appState.currentRouteData) {
1339.     console.warn('コピーするルートデータがありません'); 
1340.     return;
1341.   }
1342. 
1343.   const data = appState.currentRouteData;
1344.   let textOutput = `■ 目的地: ${data.destinationName}\n`;
1345.   textOutput += `■ 概要: ${data.summary} (約 ${data.distance}, 徒歩 ${data.duration})\n\n`;
1346.   
1347.   if (data.warnings.length > 0) {
1348.     textOutput += "■ 警告:\n";
1349.     data.warnings.forEach(w => {
1350.        textOutput += `・ ${w.replace(/<[^>]+>/g, ' ')}\n`;
1351.     });
1352.     textOutput += "\n";
1353.   }
1354. 
1355.   textOutput += "■ 道順:\n";
1356.   if (data.steps && data.steps.length > 0) {
1357.     data.steps.forEach((step, index) => {
1358.       const instruction = (step.html_instructions || '').replace(/<[^>]+>/g, ' ');
1359.       textOutput += `${index + 1}. ${instruction} (${step.distance.text})\n`;
1360.     });
1361.   } else {
1362.     textOutput += "詳細な道順はありません。\n";
1363.   }
1364. 
1365.   if (navigator.clipboard) {
1366.     navigator.clipboard.writeText(textOutput)
1367.       .then(() => {
1368.         console.log('道順をクリップボードにコピーしました'); 
1369.       })
1370.       .catch(err => {
1371.         console.error('Clipboard write error:', err);
1372.         console.error('コピーに失敗しました'); 
1373.       });
1374.   } else {
1375.     console.error('お使いのブラウザはコピー機能に非対応です'); 
1376.   }
1377. }
1378. 
1379. // ==========================================
1380. // ★★★ 新規追加 ★★★
1381. // ユーザーを現在地に移動 (FABとパネルから共用)
1382. // ==========================================
1383. let lastLocateTime = 0;
1384. function locateUser() {
1385.   // iOS 13+ のための許可リクエスト
1386.   if (typeof DeviceOrientationEvent.requestPermission === 'function') {
1387.     DeviceOrientationEvent.requestPermission()
1388.       .then(permissionState => {
1389.         if (permissionState === 'granted') {
1390.           console.log('[Compass] iOS permission granted.');
1391.           stopCompassListener();  
1392.           appState.compassWatchId = null;  
1393.           startCompassListener();  
1394.         }
1395.       })
1396.       .catch(console.error);
1397.   }
1398.   
1399.   const now = Date.now();
1400.   if (now - lastLocateTime < 1000) return;
1401.   lastLocateTime = now;
1402.   
1403.   if (appState.currentPos && appState.map) {
1404.     appState.map.panTo(appState.currentPos);
1405.     appState.map.setZoom(18);
1406.     console.log('現在地に移動しました'); 
1407.   } else {  
1408.     console.log('現在地を取得します…'); 
1409.     acquireLocation();  
1410.   }  
1411. }
1412. 
1413. // ==========================================
1414. // ★★★ 変更点 ★★★
1415. // キーボード表示ウォッチャー (干渉対策)
1416. // ==========================================
1417. function bindKeyboardWatch() {
1418.   const searchInput = document.getElementById('q');
1419.   const searchPanel = document.getElementById('searchPanel');
1420.   const appBody = document.getElementById('appBody');
1421.   const navPanel = document.getElementById('navPanel'); // ★ 追加
1422. 
1423.   searchInput.addEventListener('focus', () => {
1424.     console.log('[Keyboard] Input focused');
1425.     appBody.classList.add('keyboard-open');
1426.     navPanel.style.display = 'none'; // ★ 案内パネルを非表示
1427.     
1428.     setTimeout(() => {
1429.         const inputTopInPanel = searchInput.offsetTop;
1430.         searchPanel.scrollTop = inputTopInPanel - 20;
1431.         console.log(`[Keyboard] Scrolled panel to ${searchPanel.scrollTop}`);
1432.     }, 350); 
1433.   });
1434. 
1435.   searchInput.addEventListener('blur', () => {
1436.     console.log('[Keyboard] Input blurred');
1437.     appBody.classList.remove('keyboard-open');
1438.     searchPanel.scrollTop = 0; 
1439.     
1440.     // ★ 状態に応じてnavPanelを再表示
1441.     const resultsVisible = document.getElementById('results').style.display === 'block';
1442.     if (!resultsVisible && !appState.pointSearchMode) {
1443.       navPanel.style.display = 'block';
1444.     }
1445.   });
1446. }
1447. 
1448. 
1449. // ==========================================
1450. // UI イベントバインディング
1451. // ==========================================
1452. 
1453. // 検索パネルのイベント
1454. function bindSearchPanelEvents() {
1455.   const radiusLabel = document.getElementById('radiusLabel');
1456.   const r10 = document.getElementById('r10');
1457.   const r20 = document.getElementById('r20');
1458.   const r30 = document.getElementById('r30');
1459.   const btnPointSearch = document.getElementById('btnPointSearch');
1460.   const navPanel = document.getElementById('navPanel'); 
1461. 
1462.   r10.onclick = () => {  
1463.     r10.classList.add('active');  
1464.     r20.classList.remove('active');
1465.     r30.classList.remove('active');
1466.     radiusLabel.textContent = '10km';  
1467.   };
1468.   
1469.   r20.onclick = () => {  
1470.     r20.classList.add('active');  
1471.     r10.classList.remove('active');
1472.     r30.classList.remove('active');
1473.     radiusLabel.textContent = '20km';  
1474.   };
1475.   
1476.   r30.onclick = () => {  
1477.     r30.classList.add('active');  
1478.     r10.classList.remove('active');
1479.     r20.classList.remove('active');
1480.     radiusLabel.textContent = '30km';  
1481.   };
1482. 
1483.   btnPointSearch.onclick = () => {
1484.     appState.pointSearchMode = !appState.pointSearchMode;
1485.     if (appState.pointSearchMode) {
1486.       btnPointSearch.textContent = '📍 ポイント選択中...';
1487.       btnPointSearch.style.background = '#25d07a';
1488.       btnPointSearch.style.color = '#0a2818';
1489.       btnPointSearch.style.borderColor = 'transparent';
1490.       console.log('地図をタップして検索地点を選択'); 
1491.       navPanel.style.display = 'none'; 
1492.     } else {
1493.       btnPointSearch.textContent = '📍 ポイント選択';
1494.       btnPointSearch.style.background = 'rgba(255,255,255,.08)';
1495.       btnPointSearch.style.color = 'var(--text)';
1496.       btnPointSearch.style.borderColor = 'var(--stroke)';
1497.       
1498.       if (document.getElementById('results').style.display === 'none') {
1499.          navPanel.style.display = 'block';
1500.       }
1501.     }
1502.   };
1503. }
1504. 
1505. function bindLocationEvents() {
1506.   document.getElementById('btnSaveLocation').onclick = showSaveLocationDialog;
1507.   document.getElementById('btnEditLocation').onclick = showEditLocationDialog;
1508. }
1509. 
1510. // ==========================================
1511. // ★★★ 変更点 ★★★
1512. // 検索イベント (アイコンをバインド)
1513. // ==========================================
1514. function bindSearchEvents() {
1515.   // 検索アイコンのクリック
1516.   document.getElementById('btnSearchIcon').onclick = () => {
1517.     const q = document.getElementById('q').value.trim();
1518.     if (q) performSearch(q);
1519.   };
1520.   
1521.   // 検索窓でのEnterキー
1522.   document.getElementById('q').addEventListener('keypress', (e) => {
1523.     if (e.key === 'Enter') {
1524.       const q = document.getElementById('q').value.trim();
1525.       if (q) performSearch(q);
1526.     }
1527.   });
1528.   
1529.   // マイクアイコンのクリック
1530.   document.getElementById('btnVoiceIcon').onclick = startVoiceSearch;
1531.   
1532.   document.getElementById('btnReset').onclick = () => {
1533.     document.getElementById('q').value = '';
1534.     document.getElementById('results').style.display = 'none';
1535.     document.getElementById('results').innerHTML = '';
1536.     
1537.     appState.searchMarkers.forEach(marker => marker.map = null);
1538.     appState.searchMarkers = [];
1539.     
1540.     appState.searchPoint = null;
1541.     if (appState.searchPointMarker) {
1542.       appState.searchPointMarker.map = null;
1543.       appState.searchPointMarker = null;
1544.     }
1Two45.     
1546.     const addressBlock = document.getElementById('pointAddressBlock');
1547.     const addressElement = document.getElementById('pointAddress');
1548.     const coordsElement = document.getElementById('pointCoords');
1549.     addressBlock.style.display = 'none';
1550.     addressElement.textContent = '';
1551.     coordsElement.textContent = '';
1552.     
1553.     appState.pointSearchMode = false;
1554.     const btnPointSearch = document.getElementById('btnPointSearch');
1555.     btnPointSearch.textContent = '📍 ポイント選択';
1556.     btnPointSearch.style.background = 'rgba(255,255,255,.08)';
1557.     btnPointSearch.style.color = 'var(--text)';
1558.     btnPointSearch.style.borderColor = 'var(--stroke)';
1559.     
1560.     document.getElementById('navPanel').style.display = 'block'; 
1561.     
1562.     document.getElementById('r10').classList.add('active');
1563.     document.getElementById('r20').classList.remove('active');
1564.     document.getElementById('r30').classList.remove('active');
1565.     document.getElementById('radiusLabel').textContent = '10km';
1566.     
1567.     console.log('リセットしました'); 
1568.     console.log('[WalkNav] リセット完了');
1569.   };
1570. 
1571.   // ★ 検索パネル内の「現在地」ボタン
1572.   document.getElementById('btnLocatePanel').onclick = locateUser;
1573. }
1574. 
1575. // ==========================================
1576. // ★★★ 変更点 ★★★
1577. // FAB・パネル制御 (ロジックを locateUser に移動)
1578. // ==========================================
1579. function bindFABEvents() {
1580.   
1581.   // 検索パネルボタン（FAB側）
1582.   document.getElementById('btnSearch').onclick = () => {
1583.     document.getElementById('searchPanel').style.display = 'block';
1584.     document.getElementById('fabStack').style.display = 'none';  
1585.     document.getElementById('appBody').classList.add('panel-open');  
1586.     
1587.     if (document.getElementById('results').style.display === 'none' && !appState.pointSearchMode) {
1588.         document.getElementById('navPanel').style.display = 'block';
1589.     }
1590.     
1591.     document.getElementById('navPanelInstructions').innerHTML = '';  
1592.     document.getElementById('incidentPanel').style.display = 'none';  
1593.   };
1594.   
1595.   // 検索パネルを閉じるボタン（パネル側）
1596.   document.getElementById('btnClosePanel').onclick = () => {
1597.     document.getElementById('searchPanel').style.display = 'none';
1CSS.     // ナビ中でなければFABを隠し、現在地パネルも隠す
1599.     if (!appState.isNavigating) {
1600.        document.getElementById('fabStack').style.display = 'none';
1601.        document.getElementById('navPanel').style.display = 'none';
1602.     } else {
1603.        document.getElementById('fabStack').style.display = 'flex'; // ナビ中ならFAB表示
1604.     }
1605.      document.getElementById('appBody').classList.remove('panel-open');  
1606.   };
1607. 
1608.   // ★ 関数呼び出しに変更
1609.   document.getElementById('btnLocate').onclick = locateUser;
1610.   
1611.   document.getElementById('btnDestination').onclick = () => {
1612.     // ★ デバウンスロジックを削除 (locateUser に移動したため)
1Vertical-align: top;
1614.     
1615.     if (appState.currentDestination && appState.map) {
1616.       appState.map.panTo({ lat: appState.currentDestination.lat, lng: appState.currentDestination.lng });
1617.       appState.map.setZoom(18);
1618.       console.log('目的地に移動しました'); 
1619.     }
1620.   };
1621.   
1622.   document.getElementById('btnPause').onclick = togglePause;
1623.   
1624.   document.getElementById('btnReroute').onclick = () => {
1625.     if (appState.currentDestination) {
1626.       startNavigation(appState.currentDestination);
1627.     } else {
1628.       console.warn('目的地が設定されていません'); 
1629.     }
1630.   };
1631. }
1632. 
1633. // ==========================================
1634. // ルートパネルのボタン制御
1635. // ==========================================
1636. function bindRoutePanelEvents() {
1637.    document.getElementById('btnStopRoute').onclick = stopNavigation;
1638.    document.getElementById('btnExportText').onclick = exportRouteToClipboard;
1639. }
1640. 
1641. function bindUI() {
1642.   console.log('[WalkNav] Binding UI...');
1643.   bindSearchPanelEvents();
1644.   bindLocationEvents();
1645.   bindSearchEvents();
1646.   bindFABEvents();
1647.   bindRoutePanelEvents();  
1648.   bindKeyboardWatch(); 
1649.   console.log('[WalkNav] UI binding complete');
1650. }
1651. 
1652. // ==========================================
1653. // アプリケーション起動
1654. // ==========================================
1655. function startApp() {
1656.   console.log('[WalkNav] Starting app...');
1657.   document.documentElement.lang = 'ja';
1658.   
1659.   // 初期状態
1660.   document.getElementById('searchPanel').style.display = 'block';
1661.   document.getElementById('fabStack').style.display = 'none';  
1662.   // document.getElementById('btnSearch').style.display = 'flex'; // ★ 削除
1663.   document.getElementById('appBody').classList.add('panel-open');  
1664.   document.getElementById('navPanel').style.display = 'block';
1665.   
1666.   bindUI();
1667.   acquireLocation(); // 初回取得
1668.   initSpeechRecognition();
1669.   startCompassListener(); // コンパス監視を開始
1670.   
1671.   // ★ 保険的なローディング解除
1672.   // 35秒 (LOCATION_OPTIONSのtimeout 30秒 + 5秒) 経っても
1673.   // loadingが残っていたら強制的に削除
1674.   setTimeout(() => {
1675.     const loadingEl = document.getElementById('loading');
1676.     if (loadingEl) {
1677.       console.warn('[WalkNav] ローディングが残っていたため強制削除します。');
1678.       loadingEl.remove();
1679.     }
KA80.   }, 35000); // 35秒
1681.   
1682.   console.log('[WalkNav] ISSUE', ISSUE_ID, 'boot');
1683. }
1684. 
1685. // ==========================================
1686. // ★★★ 修正 (タイムアウト処理を追加) ★★★
1687. // ==========================================
1688. 
1689. let initAttempts = 0;
1690. const MAX_INIT_ATTEMPTS = 100; // 100ms * 100回 = 10秒
1691. 
1692. function initializeWhenReady() {
1693.   initAttempts++;
1694.   
1695.   // 成功条件
1696.   if (typeof google !== 'undefined' && google.maps && google.maps.Map && google.maps.geometry) {
1697.     console.log('[WalkNav] Google Maps API 読み込み完了');
1698.     startApp();
1699.     return;
1700.   }
1701.   
1702.   // タイムアウト処理
1703.   if (initAttempts > MAX_INIT_ATTEMPTS) {
1704.     console.error('[WalkNav] Google Maps API の読み込みがタイムアウトしました。');
Type.     const loadingEl = document.getElementById('loading');
1706.     if (loadingEl) {
1707.       loadingEl.innerHTML = `
1708.         <div style="text-align:center; padding: 20px;">
1709.           <div style="font-size:24px;margin-bottom:16px; color: var(--danger);">⚠️ ロード失敗</div>
1710.           <div style="font-size:16px;opacity:0.8; line-height: 1.6;">
1711.             マップの読み込みに失敗しました。<br>
1712.             ネットワーク接続を確認し、<br>
1713.             ページを再読み込みしてください。
1714.           </div>
1715.         </div>
1716.       `;
1717.     }
1718.     return;
1719.   }
1720.   
1721.   // 再試行
1722.   setTimeout(initializeWhenReady, 100);
1723. }
1724. 
1725. // DOMContentLoadedからロード監視を開始
1726. window.addEventListener('DOMContentLoaded', initializeWhenReady);
