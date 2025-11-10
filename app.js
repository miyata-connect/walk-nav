01 'use strict';
02 
03 // ==========================================
04 // 定数定義
05 // ==========================================
06 const ISSUE_ID = 'idx202511050540'; // 更新：パネル表示ロJック、ボタン配置
07 const API_KEY = 'AIzaSyBXC6CB2yaUkrJ5UYj3mymAsruQe4MzGPk'; // Maps表示用のみ
08 const WORKER_ORIGIN = 'https://ors-proxy.miyata-connect-jp.workers.dev';
09 const DEFAULT_MASK = 'places.displayName,places.formattedAddress,places.location,places.id,places.types';
10 const MAX_RETRY = 3;
11 const RETRY_DELAY = 1000;
12 const LOCATION_OPTIONS = {
13   enableHighAccuracy: true,
14   timeout: 30000,
15   maximumAge: 0
16 };
17 
18 // ==========================================
19 // 状態管理オブジェクト
20 // ==========================================
21 const appState = {
22   map: null,
23   userMarker: null,
24   currentPos: null,
25   pointSearchMode: false,
26   searchPoint: null,
27   searchPointMarker: null,
28   mapInitialized: false,
29   searchMarkers: [],
30   currentDestination: null,
31   currentPolyline: null,
32   recognition: null,
33   isPaused: false,
34   isNavigating: false,
35   locationWatchId: null,  
36   compassWatchId: null,
37   currentHeading: 0,
38   isSimulation: false,
39   currentRouteData: null
40 };
41 
42 // ==========================================
43 // リトライ機能付きfetch
44 // ==========================================
45 async function fetchWithRetry(url, options = {}, retries = MAX_RETRY) {
46   for (let i = 0; i < retries; i++) {
47     try {
48       const response = await fetch(url, options);
49       if (!response.ok && i < retries - 1) {
50         console.log(`[Retry] ${i + 1}/${retries}: ${url}`);
51         await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (i + 1)));
52         continue;
53       }
54       return response;
55     } catch (error) {
56       if (i === retries - 1) throw error;
57       console.log(`[Retry] ${i + 1}/${retries}: ${error.message}`);
58       await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (i + 1)));
59     }
60   }
61 }
62 
63 // ==========================================
64 // API (Worker経由)
65 // ==========================================
66 async function placesTextSearch(payload, fieldMask) {
67   try {
68     const resp = await fetchWithRetry(`${WORKER_ORIGIN}/places:searchText`, {
69       method: 'POST',
70       headers: {
71         'Content-Type': 'application/json',
72         ...(fieldMask ? { 'X-Goog-FieldMask': fieldMask } : {})
73       },
74       body: JSON.stringify(payload)
75     });
76     
77     if (!resp.ok) {
78       const text = await resp.text();
79       throw new Error(`TextSearch ${resp.status}: ${text}`);
80     }
81     return await resp.json();
82   } catch (error) {
83     console.error(`検索エラー: ${error.message}`); 
84     throw error;
85   }
86 }
87 
88 async function placesNearby(payload, fieldMask) {
89   try {
90     const resp = await fetchWithRetry(`${WORKER_ORIGIN}/places:searchNearby`, {
91       method: 'POST',
92       headers: {
93         'Content-Type': 'application/json',
94         ...(fieldMask ? { 'X-Goog-FieldMask': fieldMask } : {})
95       },
96       body: JSON.stringify(payload)
97     });
98     
99     if (!resp.ok) {
100       const text = await resp.text();
101       throw new Error(`Nearby ${resp.status}: ${text}`);
102     }
103     return await resp.json();
104   } catch (error) {
105     console.error(`検索エラー: ${error.message}`); 
106     throw error;
107   }
108 }
109 
110 // ==========================================
111 // 地図初期化
112 // ==========================================
113 function initMap(center) {
114   appState.map = new google.maps.Map(document.getElementById('map'), {
115     center,
116     zoom: 17,
117     mapId: 'DEMO_MAP',
118     gestureHandling: 'greedy',
119     clickableIcons: true,
120     disableDefaultUI: true
121   });
122 
123   appState.map.addListener('click', (e) => {
124     if (!appState.pointSearchMode) return;
125     if (e.latLng) {
126       setSearchPoint(e.latLng.lat(), e.latLng.lng());
127     }
128   });
129 
130   appState.mapInitialized = true;
131   console.log('[WalkNav] Map initialized');
132 }
133 
134 // ==========================================
135 // ユーザー位置マーカー設定 (SVG矢印)
136 // ==========================================
137 function setUserMarker(lat, lng) {
138   appState.currentPos = { lat, lng };
139   
140   if (!appState.userMarker) {
141     const pin = document.createElement('div');
142     pin.style.width = '32px';
143     pin.style.height = '32px';
144     
145     pin.innerHTML = `
146       <svg id="user-marker-icon" viewBox="0 0 24 24"  
147             style="width: 100%; height: 100%;  
148                    transform: rotate(${appState.currentHeading}deg);  
149                    transition: transform 0.2s ease-out;
150                    filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4));">
151         <path d="M12 2L4.5 20.5L12 16.5L19.5 20.5L12 2Z"  
152               fill="#3aa0ff"  
153               stroke="#ffffff"  
154               stroke-width="2"  
155               stroke-linejoin="round" />
156       </svg>
157     `;
158     
159     appState.userMarker = new google.maps.marker.AdvancedMarkerElement({
160       map: appState.map,
161       position: { lat, lng },
162       content: pin,
163       zIndex: 1000
164     });
165     
166   } else {
167     appState.userMarker.position = { lat, lng };
168   }
169 }
170 
171 // ==========================================
172 // 検索地点設定
173 // ==========================================
174 function setSearchPoint(lat, lng) {
175   appState.searchPoint = { lat, lng };
176   
177   if (appState.searchPointMarker) {
178     appState.searchPointMarker.map = null;
179   }
180 
181   const pin = document.createElement('div');
182   pin.style.width = '30px';
183   pin.style.height = '30px';
184   pin.style.borderRadius = '50% 50% 50% 0';
185   pin.style.background = '#ff6565';
186   pin.style.border = '3px solid #fff';
187   pin.style.transform = 'rotate(-45deg)';
188   pin.style.boxShadow = '0 4px 8px rgba(0,0,0,.3)';
189   pin.style.transition = 'all 0.3s ease-out';
190 
191   appState.searchPointMarker = new google.maps.marker.AdvancedMarkerElement({
192     map: appState.map,
193     position: { lat, lng },
194     content: pin,
195     zIndex: 999
196   });
197 
198   console.log(`[WalkNav] 検索地点設定: ${lat.toFixed(6)}, ${lng.toFixed(6)}`);
199   console.log('検索地点を設定しました'); 
200   
201   fetchPointAddress(lat, lng);
202 }
203 
204 // ==========================================
205 // 距離計算
206 // ==========================================
207 function calculateDistance(lat1, lon1, lat2, lon2) {
208   const R = 6371000;  
209   const dLat = (lat2 - lat1) * Math.PI / 180;
210   const dLon = (lon2 - lon1) * Math.PI / 180;
211   const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
212             Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
213             Math.sin(dLon / 2) * Math.sin(dLon / 2);
214   const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
215   return R * c;
216 }
217 
218 // ==========================================
219 // レスポンスから距離/時間を取得
220 // ==========================================
221 function readLegDistanceText(leg) {
222   if (leg?.distance?.text) return leg.distance.text;
223   if (typeof leg?.distanceMeters === 'number') {
224     const km = (leg.distanceMeters / 1000).toFixed(1);
225     return `${km} km`;
226   }
227   return leg?.localizedValues?.distance?.text || '--';
228 }
229 
230 function readLegDurationText(leg) {
231   if (leg?.duration?.text) return leg.duration.text;
232   if (typeof leg?.duration === 'string' && leg.duration.endsWith('s')) {
233     const sec = parseInt(leg.duration.replace('s', ''), 10) || 0;
234     const min = Math.max(1, Math.round(sec / 60));
235     return `${min} 分`;
236   }
237   return leg?.localizedValues?.duration?.text || '--';
238 }
239 
240 // ==========================================
241 // エンコードされたポリラインを取得
242 // ==========================================
243 function getEncodedPolylineFromRoute(route) {
244   if (route?.overview_polyline?.points) return route.overview_polyline.points;
245   if (route?.polyline?.encodedPolyline) return route.polyline.encodedPolyline;
246   if (route?.overviewPolyline?.encodedPolyline) return route.overviewPolyline.encodedPolyline;
247   return null;
248 }
249 
250 // ==========================================
251 // ルートポリライン描画
252 // ==========================================
253 function drawRoutePolyline(route) {
254   if (appState.currentPolyline) {
255     appState.currentPolyline.setMap(null);
256     appState.currentPolyline = null;
257   }
258 
259   const encoded = getEncodedPolylineFromRoute(route);
260   if (!encoded) {
261     console.error('[Navigation] No encoded polyline found');
262     console.error('ルート線の取得に失敗しました'); 
263     return;
264   }
265 
266   const path = google.maps.geometry.encoding.decodePath(encoded);
267   appState.currentPolyline = new google.maps.Polyline({
268     path: path,
269     geodesic: true,
270     strokeColor: '#62b5ff',
271     strokeOpacity: 0.8,
272     strokeWeight: 6,
273     map: appState.map
274   });
275 
276   console.log('[Navigation] Polyline drawn');
277 }
278 
279 // ==========================================
280 // コンパス（デバイスの向き）監視
281 // ==========================================
282 const compassHandler = (event) => {
283   if (appState.isNavigating) return;  
284   let heading = null;
285   if (event.webkitCompassHeading) {
286     heading = event.webkitCompassHeading;
287   } else if (event.absolute === true && event.alpha !== null) {
288     heading = event.alpha;
289   }
290   if (heading !== null) {
291     appState.currentHeading = heading;
292     updateMarkerRotation();
293   }
294 };
295 
296 function startCompassListener() {
297   if (appState.compassWatchId || !window.DeviceOrientationEvent) {
298     if(!window.DeviceOrientationEvent) console.warn('[Compass] DeviceOrientationEvent is not supported.');
299     return;
300   }
301   console.log('[Compass] Starting compass listener...');
302   if (typeof DeviceOrientationEvent.requestPermission === 'function') {
303      DeviceOrientationEvent.requestPermission()
304       .then(permissionState => {
305         if (permissionState === 'granted') {
306           window.addEventListener('deviceorientationabsolute', compassHandler, true);
307           window.addEventListener('deviceorientation', compassHandler, true);
308           appState.compassWatchId = 1;
309         }
310       })
311       .catch(console.error);
312   } else {
313     window.addEventListener('deviceorientationabsolute', compassHandler, true);
314     window.addEventListener('deviceorientation', compassHandler, true);
315     appState.compassWatchId = 1;
316   }
317 }
318 
319 function stopCompassListener() {
320   if (appState.compassWatchId) {
321     console.log('[Compass] Stopping compass listener...');
322    .window.removeEventListener('deviceorientationabsolute', compassHandler, true);
323     window.removeEventListener('deviceorientation', compassHandler, true);
324     appState.compassWatchId = null;
325   }
326 }
327 
328 function updateMarkerRotation() {
329   const icon = document.getElementById('user-marker-icon');
330   if (icon) {
331     icon.style.transform = `rotate(${appState.currentHeading}deg)`;
332   }
333 }
334 
335 // ==========================================
336 // リアルタイム位置情報監視（ナビ中）
337 // ==========================================
338 function startLocationWatcher() {
339   if (appState.locationWatchId) {
340     navigator.geolocation.clearWatch(appState.locationWatchId);
341     appState.locationWatchId = null;
342   }
343   console.log('[Location] Starting watchPosition (Nav Mode)...');
344 
345   const onWatchSuccess = (pos) => {
346     const { latitude, longitude } = pos.coords;
347     console.log(`[Location] Watch update: ${latitude}, ${longitude}`);
348     
349     setUserMarker(latitude, longitude);
350     fetchLocationNameGoogle(latitude, longitude);
351     
352     if (appState.isNavigating && !appState.isPaused) {
353       appState.map.panTo({ lat: latitude, lng: longitude });
354       if (appState.currentDestination && google.maps.geometry) {
355         const currentLatLng = new google.maps.LatLng(latitude, longitude);
356         const destLatLng = new google.maps.LatLng(appState.currentDestination.lat, appState.currentDestination.lng);
357         let headingDeg = google.maps.geometry.spherical.computeHeading(currentLatLng, destLatLng);
358         if (headingDeg < 0) { headingDeg += 360; }  
359         appState.currentHeading = headingDeg;
360         updateMarkerRotation();
361       }
362     }
363   };
364 
365   const onWatchError = (error) => {
366     console.error('[Location] Watch error:', error.message);
367     console.error('リアルタイム位置情報の取得に失敗'); 
368     stopLocationWatcher();
369   };
370 
371   appState.locationWatchId = navigator.geolocation.watchPosition(
372     onWatchSuccess,
373     onWatchError,
374     LOCATION_OPTIONS
375   );
376 }
377 
378 function stopLocationWatcher() {
379    if (appState.locationWatchId) {
380     console.log('[Location] Stopping watchPosition (Nav Mode)...');
381     navigator.geolocation.clearWatch(appState.locationWatchId);
382     appState.locationWatchId = null;
383   }
384 }
385 
386 // ==========================================
387 // ナビゲーション開始 (シミュレーション対応)
388 // ==========================================
389 async function startNavigation(destination) {
390   let originLat, originLng;
391   if (appState.pointSearchMode && appState.searchPoint) {
392     originLat = appState.searchPoint.lat;
393     originLng = appState.searchPoint.lng;
394     appState.isSimulation = true;
395     console.log('[Navigation] シミュレーションモードで開始');
396   } else if (appState.currentPos) {
397     originLat = appState.currentPos.lat;
398     originLng = appState.currentPos.lng;
399     appState.isSimulation = false;
400     console.log('[Navigation] リアルタイムモードで開始');
401   } else {
402     console.error('起点が設定されていません'); 
403     return;
404   }
405 
406   appState.currentDestination = destination;
407   appState.isNavigating = true;
408   appState.isPaused = false;
409   
410   document.getElementById('searchPanel').style.display = 'none';
411   document.getElementById('fabStack').style.display = 'flex';  
412   document.getElementById('appBody').classList.remove('panel-open');
413   stopCompassListener();
414   
415   try {
416     console.log('ルートを取得中...'); 
417     const params = new URLSearchParams({
418       origin: `${originLat},${originLng}`,
419       destination: `${destination.lat},${destination.lng}`,
420       mode: 'walking',
421       language: 'ja'
422     });
423 
424     const response = await fetchWithRetry(`${WORKER_ORIGIN}/directions?${params.toString()}`);
425     if (!response.ok) {
426       const errorText = await response.text();
427       throw new Error(`Directions API Error: ${response.status} - ${errorText}`);
428     }
429 
430     const result = await response.json();
431     console.log('[Navigation] Directions Response:', result);
432 
433     if (result.routes && result.routes.length > 0) {
434       const r0 = result.routes[0];
435       const l0 = (r0.legs && r0.legs[0]) ? r0.legs[0]: null;
436 
437       const distanceText = l0 ? readLegDistanceText(l0) : '--';
438       const durationText = l0 ? readLegDurationText(l0) : '--';
439 
440       document.getElementById('destinationName').textContent = destination.name;
441       document.getElementById('routeDistance').textContent = distanceText;
442       document.getElementById('routeTime').textContent = `徒歩 ${durationText}`;
443       document.getElementById('routePanel').style.display = 'block';
444       document.getElementById('searchPanel').style.display = 'none';
445       document.getElementById('results').style.display = 'none';
446       document.getElementById('btnDestination').style.display = 'flex';
447 
448       const instructionsList = document.getElementById('navPanelInstructions');
449       instructionsList.innerHTML = '';
450       if (l0 && l0.steps && l0.steps.length > 0) {
451         l0.steps.forEach(step => {
452           const item = document.createElement('div');
453           item.className = 'nav-instruction-item';
454           const cleanInstruction = (step.html_instructions || '').replace(/<[^>]+>/g, ' ');
455           item.textContent = `${cleanInstruction} (${step.distance.text})`;
456           instructionsList.appendChild(item);
457         });
458       }
459       document.getElementById('navPanel').style.display = 'block';
460       
461       appState.currentRouteData = {
462         steps: l0.steps,
463         summary: r0.summary,
464         distance: distanceText,
465         duration: durationText,
466         destinationName: destination.name,
467         warnings: r0.warnings || []
468       };
469 
470       const incidentPanel = document.getElementById('incidentPanel');
471       if (r0.warnings && r0.warnings.length > 0) {
472         incidentPanel.innerHTML = '⚠️ ' + r0.warnings.map(w => w.replace(/<[^>]+>/g, ' ')).join('<br>⚠️ ');
473         incidentPanel.style.display = 'block';
474       } else {
475         incidentPanel.style.display = 'none';
476       }
477       
478       // ★ 天気取得（起点の緯度経度）—OpenWeather（Worker経由）
479       await fetchWeather(originLat, originLng);
480       
481       if (appState.isSimulation) {
482         setUserMarker(originLat, originLng);
483         fetchLocationNameGoogle(originLat, originLng);
484         if (appState.currentDestination && google.maps.geometry) {
485           const currentLatLng = new google.maps.LatLng(originLat, originLng);
486           const destLatLng = new google.maps.LatLng(appState.currentDestination.lat, appState.currentDestination.lng);
487           let headingDeg = google.maps.geometry.spherical.computeHeading(currentLatLng, destLatLng);
488           if (headingDeg < 0) { headingDeg += 360; }  
489           appState.currentHeading = headingDeg;
490           updateMarkerRotation();
491         }
492       } else {
493         startLocationWatcher();
494       }
495 
496       drawRoutePolyline(r0);
497 
498       const bounds = new google.maps.LatLngBounds();
499       bounds.extend(new google.maps.LatLng(originLat, originLng));
500       bounds.extend(new google.maps.LatLng(destination.lat, destination.lng));
501       appState.map.fitBounds(bounds, { top: 100, right: 150, bottom: 300, left: 50 });  
502 
503       setTimeout(() => {
504         appState.map.panTo({ lat: destination.lat, lng: destination.lng });
505         appState.map.setZoom(18);
506         setTimeout(() => {
507           appState.map.panTo({ lat: originLat, lng: originLng });
508           appState.map.setZoom(18);
509         }, 2000);
510       }, 2000);
511 
512       console.log(`${destination.name} へのルート案内を開始`); 
513       console.log('[Navigation] ルート案内開始: ${destination.name}');
514     } else {
515       throw new Error('ルートが取得できませんでした');
516     }
517   } catch (error) {
518     console.error('[Navigation] Error:', error);
519     console.error(`ルートエラー: ${error.message}`); 
520     appState.isNavigating = false;
521     appState.isSimulation = false;
522     document.getElementById('fabStack').style.display = 'none';  
523     startCompassListener();
524   }
525 }
526 
527 // ==========================================
528 // ナビゲーション停止
529 // ==========================================
530 function stopNavigation() {
531   stopLocationWatcher();
532   startCompassListener();
533   
534   appState.isSimulation = false;  
535   appState.currentRouteData = null;  
536   
537   if (appState.currentPolyline) {
538     appState.currentPolyline.setMap(null);
539     appState.currentPolyline = null;
540   }
541   
542   appState.currentDestination = null;
543   appState.isNavigating = false;
544   appState.isPaused = false;
545   
546   document.getElementById('routePanel').style.display = 'none';
547   document.getElementById('navPanel').style.display = 'block';  
548   document.getElementById('navPanelInstructions').innerHTML = '';  
549   document.getElementById('incidentPanel').style.display = 'none';  
550   document.getElementById('incidentPanel').innerHTML = '';  
551   document.getElementById('searchPanel').style.display = 'block';
552   document.getElementById('btnDestination').style.display = 'none';
553   document.getElementById('q').value = '';
554   document.getElementById('results').style.display = 'none';
555   document.getElementById('results').innerHTML = '';
556   
557   document.getElementById('weather1h').textContent = '--';
558   document.getElementById('weather2h').textContent = '--';
559   document.getElementById('weather3h').textContent = '--';
560   
561   document.getElementById('fabStack').style.display = 'none';
562   document.getElementById('btnSearch').style.display = 'flex';  
563   
564   const btnPause = document.getElementById('btnPause');
565   btnPause.textContent = '一時停止';
566   btnPause.classList.remove('paused');
567   
568   appState.searchMarkers.forEach(marker => marker.map = null);
569   appState.searchMarkers = [];
570   
571   if (appState.currentPos && appState.map) {
572     appState.map.panTo(appState.currentPos);
573     appState.map.setZoom(17);
574   }
575   updateMarkerRotation();  
576   document.getElementById('appBody').classList.add('panel-open');
577   console.log('ルート案内を終了しました'); 
578   console.log('[Navigation] ルート案内終了');
579 }
580 
581 // ==========================================
582 // 一時停止/再開トグル
583 // ==========================================
584 function togglePause() {
585   if (appState.isSimulation) {
586      console.warn('シミュレーション中は一時停止できません'); 
587      return;
588   }
589   if (!appState.isNavigating) {
590     console.warn('ナビゲーション中ではありません'); 
591     return;
592   }
593 
594   appState.isPaused = !appState.isPaused;
595   const btnPause = document.getElementById('btnPause');
596   
597   if (appState.isPaused) {
598     btnPause.textContent = '再開';
599     btnPause.classList.add('paused');
600     console.warn('ナビゲーションを一時停止しました'); 
601     console.log('[Navigation] 一時停止');
602   } else {
603     btnPause.textContent = '一時停止';
604     btnPause.classList.remove('paused');
605     console.log('ナビゲーションを再開しました'); 
606     console.log('[Navigation] 再開');
607     if(appState.currentPos) {
608       appState.map.panTo(appState.currentPos);
609       appState.map.setZoom(18);
610     }
611   }
612 }
613 
614 // ==========================================
615 // 検索実行 (Worker経由)
616 // ==========================================
617 const TYPE_MAP = {
618   "コンビニ": "convenience_store",
619   "スーパー": "supermarket",
620   "レストラン": "restaurant",
621   "カフェ": "cafe",
622   "ホテル": "lodging",
623   "病院": "hospital",
624   "薬局": "pharmacy",
625   "ガソリンスタンド": "gas_station",
626   "駐車場": "parking",
627   "銀行": "bank"
628 };
629 
630 async function performSearch(query) {
631   if (!query || !query.trim()) {
632     console.warn('検索ワードを入力してください'); 
633     return;
634   }
635 
636   let centerLat, centerLng;
637   if (appState.pointSearchMode && appState.searchPoint) {
638     centerLat = appState.searchPoint.lat;
639     centerLng = appState.searchPoint.lng;
640   } else if (appState.currentPos) {
641     centerLat = appState.currentPos.lat;
642     centerLng = appState.currentPos.lng;
643   } else {
644     console.error('検索の基準地点が不明です'); 
645     return;
646   }
647 
648   const radiusKm = parseInt(document.getElementById('radiusLabel').textContent);
649   const radiusMeters = radiusKm * 1000;
650 
651   console.log('検索中...'); 
652 
653   try {
654     const data = await placesTextSearch({
655       textQuery: query.trim(),
656       locationBias: {
657         circle: { center: { latitude: centerLat, longitude: centerLng }, radius: radiusMeters }
658       },
659       maxResultCount: 20,
660       languageCode: 'ja'
661     }, DEFAULT_MASK);
662 
663     if (data.places?.length) {
664       displayResults(data.places, centerLat, centerLng);
665       return;
666     }
667   } catch (e) {
668     console.error('[Search] Text Search Error:', e);
669   }
670 
671   const typeKey = TYPE_MAP[query.trim()] || TYPE_MAP[query.trim().replace(/\s/g, '')];
672   if (typeKey) {
673     try {
674       const data = await placesNearby({
675         includedTypes: [typeKey],
676         maxResultCount: 20,
677         locationRestriction: {
678           circle: { center: { latitude: centerLat, longitude: centerLng }, radius: radiusMeters }
679         },
680         languageCode: 'ja'
681       }, DEFAULT_MASK);
682 
683       if (data.places?.length) {
684         displayResults(data.places, centerLat, centerLng);
685         return;
686       }
687     } catch (e) {
688       console.error('[Search] Nearby Error:', e);
689     }
690   }
691 
692   console.warn('検索結果が見つかりませんでした'); 
693   document.getElementById('results').style.display = 'none';
694   document.getElementById('navPanel').style.display = 'block';
695 }
696 
697 // ==========================================
698 // 検索結果表示
699 // ==========================================
700 function displayResults(places, centerLat, centerLng) {
701   document.getElementById('navPanel').style.display = 'none';
702 
703   appState.searchMarkers.forEach(marker => marker.map = null);
704   appState.searchMarkers = [];
705 
706   const placesWithDistance = places.map(place => {
707     const lat = place.location.latitude;
708     const lng = place.location.longitude;
709     const distance = calculateDistance(centerLat, centerLng, lat, lng);
710     return { ...place, distance };
711   });
712 
713   placesWithDistance.sort((a, b) => a.distance - b.distance);
714   const limitedResults = placesWithDistance.slice(0, 5);
715 
716   const resultsDiv = document.getElementById('results');
717   resultsDiv.innerHTML = '';
718   resultsDiv.style.display = 'block';
719 
720   limitedResults.forEach((place, index) => {
721     const name = place.displayName?.text || place.displayName || '名称不明';
722    const address = place.formattedAddress || '住所不明';
723     const lat = place.location.latitude;
724     const lng = place.location.longitude;
725     const distanceKm = (place.distance / 1000).toFixed(2);
726 
727     const item = document.createElement('div');
728     item.className = 'result-item';
729     item.innerHTML = `
730       <div class="result-name">${index + 1}. ${name}</div>
731       <div class="result-address">${address}</div>
732       <div style="font-size:11px;color:#62b5ff;margin-top:4px">
733         📍 ${distanceKm}km
734       </div>
735     `;
736     
737     item.onclick = () => {
738       startNavigation({
739         name: name,
740         lat: lat,
741         lng: lng
742       });
743     };
744 
745     resultsDiv.appendChild(item);
746 
747     const markerPin = document.createElement('div');
748     markerPin.style.width = '24px';
749     markerPin.style.height = '24px';
750     markerPin.style.borderRadius = '50%';
751     markerPin.style.background = '#25d07a';
752     markerPin.style.border = '2px solid #fff';
753     markerPin.style.boxShadow = '0 2px 6px rgba(0,0,0,.3)';
754     markerPin.style.display = 'flex';
755     markerPin.style.alignItems = 'center';
756     markerPin.style.justifyContent = 'center';
757     markerPin.style.color = '#fff';
758     markerPin.style.fontSize = '12px';
759     markerPin.style.fontWeight = 'bold';
760     markerPin.textContent = index + 1;
761 
762     const marker = new google.maps.marker.AdvancedMarkerElement({
763       map: appState.map,
764       position: { lat, lng },
765       content: markerPin,
766       zIndex: 500 + index,
767       title: name
768     });
769 
770     appState.searchMarkers.push(marker);
771   });
772 
773   console.log(`${limitedResults.length}件の検索結果`); 
774   console.log(`[Search] ${limitedResults.length}件の結果を表示しました`);
775 }
776 
777 // ==========================================
778 // 音声認識初期化
779 // ==========================================
780 function initSpeechRecognition() {
781   if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
782     console.log('[Voice] 音声認識は非対応です');
783     return false;
784   }
785   const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
786   appState.recognition = new SpeechRecognition();
787   appState.recognition.lang = 'ja-JP';
788   appState.recognition.continuous = false;
789   appState.recognition.interimResults = false;
790 
791   const btnVoiceIcon = document.getElementById('btnVoiceIcon');
792 
793   appState.recognition.onstart = () => {
794     console.log('[Voice] 音声認識開始');
795     btnVoiceIcon.classList.add('recording');
796   };
797 
798   appState.recognition.onresult = (event) => {
799     const transcript = event.results[0][0].transcript;
800     console.log('[Voice] 認識結果:', transcript);
801     document.getElementById('q').value = transcript;
802     performSearch(transcript);
803     console.log(`音声認識: ${transcript}`); 
804   };
805 
806   appState.recognition.onerror = (event) => {
807     console.error('[Voice] エラー:', event.error);
808     btnVoiceIcon.classList.remove('recording');
809     console.error('音声認識エラーが発生しました'); 
810   };
811 
812   appState.recognition.onend = () => {
813     console.log('[Voice] 音声認識終了');
814     btnVoiceIcon.classList.remove('recording');
815   };
816 
817   return true;
818 }
819 
820 // ==========================================
821 // 音声検索開始
822 // ==========================================
823 function startVoiceSearch() {
824   if (!appState.recognition) {
825     if (!initSpeechRecognition()) {
826       console.error('お使いのブラウザは音声認識に対応していません'); 
827       return;
828     }
829   }
830   try {
831     appState.recognition.start();
832   } catch (e) {
833     console.error('[Voice] 開始エラー:', e);
834     appState.recognition.stop();
835     setTimeout(() => {
836       try {
837         appState.recognition.start();
838       } catch (e2) {
839         console.error('[Voice] 再開エラー:', e2);
840         console.error('音声認識の開始に失敗しました'); 
841       }
842     }, 100);
843   }
844 }
845 
846 // ==========================================
847 // 現在地取得 (初回1回のみ)
848 // ==========================================
849 function acquireLocation() {
850   const onSuccess = (pos) => {
851     const { latitude, longitude } = pos.coords;
852     document.getElementById('loading')?.remove();
853     if (!appState.map) {
854       initMap({ lat: latitude, lng: longitude });
855     }
856     appState.map.setCenter({ lat: latitude, lng: longitude });
857     setUserMarker(latitude, longitude);  
858     fetchLocationNameGoogle(latitude, longitude);  
859     // ★ 起動直後にも天気を描画（Worker経由）
860     fetchWeather(latitude, longitude);
861     console.log('現在地を取得しました'); 
862   };
863   
864   const onError = (error) => {
865     console.log('[WalkNav] geolocation error', error?.message || error);
866     document.getElementById('loading')?.remove();
867     if (!appState.map) {
868       // 位置不明でも地図は初期化（センタは仮に日本座標の中央付近）
869       initMap({ lat: 35.0, lng: 135.0 });
870     }
871     const addressElement = document.getElementById('locAddress');
872     const coordsElement = document.getElementById('locCoords');
873     if (addressElement) addressElement.textContent = '位置情報を確認できません';
874     if (coordsElement) coordsElement.textContent = '現在地：取得失敗';
875     console.error('現在地の取得に失敗しました'); 
876   };
877   
878   try {
879     navigator.geolocation.getCurrentPosition(onSuccess, onError, LOCATION_OPTIONS);
880   } catch (e) {
881     console.log('[WalkNav] geolocation exception', e);
882     console.error('位置情報へのアクセスが拒否されました'); 
883   }
884 }
885 
886 // ==========================================
887 // 地名取得（逆ジオコーディング）- Cloudflare経由
888 // ==========================================
889 async function fetchLocationNameGoogle(lat, lng) {
890   const addressElement = document.getElementById('locAddress');
891   const coordsElement = document.getElementById('locCoords');
892 
893   if (!addressElement || !coordsElement) {
894     console.error('[DEBUG] Elements not found!');
895     return;
896   }
897   const coordsText = `現在地：緯度 ${lat.toFixed(6)} / 経度 ${lng.toFixed(6)}`;
898   coordsElement.textContent = coordsText;
899 
900   try {
901     console.log('[Geocode] Fetching address from Cloudflare...');
902     const params = new URLSearchParams({ lat: lat, lng: lng, language: 'ja' });
903     const response = await fetchWithRetry(`${WORKER_ORIGIN}/geocode?${params.toString()}`);
904     if (!response.ok) {
905       const errorText = await response.text();
906       throw new Error(`Geocode Worker Error ${response.status}: ${errorText}`);
907     }
908     const data = await response.json();
909     if (data.status === 'OK' && data.results[0]) {
910       const address = data.results[0].formatted_address;
911       const cleanAddress = address.replace(/^日本、\s*/, '');
912       const formattedAddress = cleanAddress + ' 付近';
913       addressElement.textContent = formattedAddress;
914     } else {
915       addressElement.textContent = '住所情報なし';
916       if (data.status !== 'ZERO_RESULTS') {
917          console.error(`住所取得エラー: ${data.status}`); 
918       }
919     }
920   } catch (error) {
921     console.error('[Geocode] Fetch error:', error);
922     addressElement.textContent = '住所取得エラー';
923   }
924 }
925 
926 // ==========================================
927 // ポイント選択時の地名取得
928 // ==========================================
929 async function fetchPointAddress(lat, lng) {
930   const addressBlock = document.getElementById('pointAddressBlock');
931   const addressElement = document.getElementById('pointAddress');
932   const coordsElement = document.getElementById('pointCoords');
933 
934   if (!addressElement || !coordsElement || !addressBlock) {
935     console.error('[DEBUG] Point Elements not found!');
936     return;
937   }
938 
939   addressElement.textContent = 'ポイント：住所取得中...';
940   coordsElement.textContent = `(緯度 ${lat.toFixed(6)} / 経度 ${lng.toFixed(6)})`;
941   addressBlock.style.display = 'flex';
942 
943   try {
944     const params = new URLSearchParams({ lat: lat, lng: lng, language: 'ja' });
945     const response = await fetchWithRetry(`${WORKER_ORIGIN}/geocode?${params.toString()}`);
946     if (!response.ok) {
947       const errorText = await response.text();
948       throw new Error(`Geocode Worker Error ${response.status}: ${errorText}`);
949     }
950     const data = await response.json();
951     if (data.status === 'OK' && data.results[0]) {
952       const address = data.results[0].formatted_address;
953       const cleanAddress = address.replace(/^日本、\s*/, '');
954       const formattedAddress = 'ポイント：' + cleanAddress + ' 付近';
955       addressElement.textContent = formattedAddress;
956     } else {
957       addressElement.textContent = 'ポイント：住所情報なし';
958     }
959   } catch (error) {
960     console.error('[Geocode] Fetch error for Point:', error);
961     addressElement.textContent = 'ポイント：住所取得エラー';
962   }
963 }
964 
965 // ==========================================
966 // 天気取得（OpenWeatherをWorker経由で）
967 // ==========================================
968 async function fetchWeather(lat, lng) {
969   try {
970     const params = new URLSearchParams({
971       lat: String(lat),
972       lng: String(lng),
973       units: 'metric',
974       lang: 'ja'
975     });
976     const response = await fetchWithRetry(`${WORKER_ORIGIN}/weather?${params.toString()}`);
977     if (!response.ok) {
978       const errorText = await response.text();
979       throw new Error(`Weather fetch failed (${response.status}): ${errorText}`);
980     }
981     const data = await response.json(); // OpenWeatherのforecast応答を想定（proxy透過）
982     console.log('[Weather] Worker Response:', data);
983 
984     const now = Date.now();
985     const list = Array.isArray(data?.list) ? data.list : [];
986     const forecasts = list.filter(item => {
987       const dt = (item?.dt || 0) * 1000;
988       const diffHours = Math.round((dt - now) / (1000 * 60 * 60));
989       return [1, 2, 3].includes(diffHours);
990     });
991 
992     ['weather1h', 'weather2h', 'weather3h'].forEach(id => {
993       const el = document.getElementById(id);
994       if (el) el.textContent = '--';
995     });
996 
997     forecasts.forEach(item => {
998       const dt = (item?.dt || 0) * 1000;
999       const diffHours = Math.round((dt - now) / (1000 * 60 * 60));
1000      const temp = Math.round(item?.main?.temp ?? NaN);
1001      const condition = (item?.weather && item.weather[0]?.description) ? item.weather[0].description : '';
1002      const el = document.getElementById(`weather${diffHours}h`);
1003      if (el && !Number.isNaN(temp)) el.textContent = `${temp}℃ / ${condition}`;
1004    });
1005 
1006   } catch (error) {
1007     console.error('[Weather] Error:', error.message);
1008     ['weather1h', 'weather2h', 'weather3h'].forEach(id => {
1009       const el = document.getElementById(id);
1010       if (el) el.textContent = '--';
1011     });
1012   }
1013 }
1014 
1015 // ==========================================
1016 // ダイアログユーティリティ
1017 // ==========================================
1018 function createDialog(config) {
1019   const overlay = document.createElement('div');
1020   overlay.className = `dialog-overlay ${config.scroll ? 'scroll' : ''}`;
1021   overlay.id = config.id || 'dialog';
1022   
1023   const box = document.createElement('div');
1024   box.className = `dialog-box ${config.wide ? 'wide' : ''}`;
1025   box.innerHTML = config.content;
1026   
1027   overlay.appendChild(box);
1028   document.body.appendChild(overlay);
1029   return overlay;
1030 }
1031 
1032 // ==========================================
1033 // 現在地登録ダイアログ
1034 // ==========================================
1035 function showSaveLocationDialog() {
1036   if (!appState.currentPos) {
1037     console.error('現在地が取得できていません'); 
1038     return;
1039   }
1040   const dialog = createDialog({
1041     id: 'saveLocationDialog',
1042     content: `
1043       <h3 class="dialog-title">現在地点登録画面</h3>
1044       <p class="dialog-text">登録する地点名を入力してください:</p>
1045       <input type="text" id="locationNameInput" class="dialog-input" placeholder="地点名を入力" />
1046       <div class="dialog-actions">
1047         <button id="btnCancelSave" class="dialog-btn cancel">キャンセル</button>
1048         <button id="btnConfirmSave" class="dialog-btn confirm">OK</button>
1049       </div>
1050     `
1051   });
1052   const input = document.getElementById('locationNameInput');
1053   const btnCancel = document.getElementById('btnCancelSave');
1054   const btnConfirm = document.getElementById('btnConfirmSave');
1055   setTimeout(() => input.focus(), 100);
1056   btnCancel.onclick = () => dialog.remove();
1057   btnConfirm.onclick = () => {
1058     const locationName = input.value.trim();
1059     if (!locationName) {
1060       input.style.borderColor = 'var(--danger)'; 
1061       setTimeout(() => { input.style.borderColor = 'var(--stroke)'; }, 2000);
1062       return;
1063     }
1064     const locations = JSON.parse(localStorage.getItem('savedLocations') || '[]');
1065     const savedLocation = {
1066       name: locationName,
1067       lat: appState.currentPos.lat,
1068       lng: appState.currentPos.lng,
1069       timestamp: Date.now()
1070     };
1071     locations.push(savedLocation);
1072     localStorage.setItem('savedLocations', JSON.stringify(locations));
1073     console.log('[SaveLocation] 現在地を登録:', savedLocation);
1074     dialog.remove();
1075     console.log(`「${locationName}」を登録しました`); 
1076   };
1077   input.addEventListener('keypress', (e) => {
1078     if (e.key === 'Enter') btnConfirm.click();
1079   });
1080 }
1081 
1082 // ==========================================
1083 // 登録地点修正ダイアログ
1084 // ==========================================
1085 function showEditLocationDialog() {
1086   const locations = JSON.parse(localStorage.getItem('savedLocations') || '[]');
1087   if (locations.length === 0) {
1088     const dialog = createDialog({
1089       id: 'editDialog',
1090       content: `
1091         <h3 class="dialog-title">登録地点修正</h3>
1092         <p class="dialog-muted">登録された地点がありません</p>
1093         <button id="btnCloseEmpty" class="dialog-btn confirm full">閉じる</button>
1094       `
1095     });
1096     document.getElementById('btnCloseEmpty').onclick = () => dialog.remove();
1097     return;
1098   }
1099   let listHTML = '<div class="location-list">';
1100   locations.forEach((loc, index) => {
1101     listHTML += `
1102       <div class="location-item">
1103         <div class="location-item-name">${loc.name}</div>
1104         <div class="location-item-coords">緯度: ${loc.lat.toFixed(6)} / 経度: ${loc.lng.toFixed(6)}</div>
1105         <div class="location-item-actions">
1106           <button class="location-item-btn nav" data-index="${index}">ナビ開始</button>
1107           <button class="location-item-btn edit" data-index="${index}">名前変更</button>
1108           <button class="location-item-btn delete" data-index="${index}">削除</button>
1109         </div>
1110       </div>
1111     `;
1112   });
1113   listHTML += '</div>';
1114   const dialog = createDialog({
1115     id: 'editDialog',
1116     wide: true,
1117     scroll: true,
1118     content: `
1119       <h3 class="dialog-title">登録地点修正</h3>
1120       ${listHTML}
1121       <button id="btnCloseEdit" class="dialog-btn cancel full" style="margin-top:16px">閉じる</button>
1122     `
1123   });
1124   document.getElementById('btnCloseEdit').onclick = () => dialog.remove();
1125   document.querySelectorAll('.location-item-btn.nav').forEach(btn => {
1126     btn.onclick = () => {
1127       const index = parseInt(btn.dataset.index);
1128       const loc = locations[index];
1129       dialog.remove();
1130       startNavigation({ name: loc.name, lat: loc.lat, lng: loc.lng });
1131     };
1132   });
1133   document.querySelectorAll('.location-item-btn.edit').forEach(btn => {
1134     btn.onclick = () => {
1135       const index = parseInt(btn.dataset.index);
1136       const loc = locations[index];
1137       const renameDialog = createDialog({
1138         id: 'renameDialog',
1139         content: `
1140           <h3 class="dialog-title">地点名変更</h3>
1141           <input type="text" id="renameInput" value="${loc.name}" class="dialog-input" />
1142           <div class="dialog-actions">
1143             <button id="btnCancelRename" class="dialog-btn cancel">キャンセル</button>
1144             <button id="btnConfirmRename" class="dialog-btn confirm">OK</button>
1145           </div>
1146         `
1147       });
1148       const renameInput = document.getElementById('renameInput');
1149       setTimeout(() => {
1150         renameInput.focus();
1151         renameInput.select();
1152       }, 100);
1153       document.getElementById('btnCancelRename').onclick = () => renameDialog.remove();
1154       document.getElementById('btnConfirmRename').onclick = () => {
1155         const newName = renameInput.value.trim();
1156         if (!newName) {
1157           renameInput.style.borderColor = 'var(--danger)'; 
1158           setTimeout(() => { renameInput.style.borderColor = 'var(--stroke)'; }, 2000);
1159           return;
1160         }
1161         locations[index].name = newName;
1162         localStorage.setItem('savedLocations', JSON.stringify(locations));
1163         renameDialog.remove();
1164         dialog.remove();
1165         console.log(`地点名を「${newName}」に変更しました`); 
1166       };
1167       renameInput.addEventListener('keypress', (e) => {
1168         if (e.key === 'Enter') document.getElementById('btnConfirmRename').click();
1169       });
1170     };
1171   });
1172   document.querySelectorAll('.location-item-btn.delete').forEach(btn => {
1173     btn.onclick = () => {
1174       const index = parseInt(btn.dataset.index);
1175       const loc = locations[index];
1176       const confirmDialog = createDialog({
1177         id: 'confirmDeleteDialog',
1178         content: `
1179           <h3 class="dialog-title">削除確認</h3>
1180           <p class="dialog-text">「${loc.name}」を削除しますか？</p>
1181           <div class="dialog-actions">
1182             <button id="btnCancelDelete" class="dialog-btn cancel">キャンセル</button>
1183             <button id="btnConfirmDelete" class="dialog-btn delete">削除</button>
1184           </div>
1185         `
1186       });
1187       document.getElementById('btnCancelDelete').onclick = () => confirmDialog.remove();
1188       document.getElementById('btnConfirmDelete').onclick = () => {
1189         locations.splice(index, 1);
1190         localStorage.setItem('savedLocations', JSON.stringify(locations));
1191         confirmDialog.remove();
1192         dialog.remove();
1193         console.log(`「${loc.name}」を削除しました`); 
1194       };
1195     };
1196   });
1197 }
1198 
1199 // ==========================================
1200 // 道順をクリップボードにコピー
1201 // ==========================================
1202 function exportRouteToClipboard() {
1203   if (!appState.currentRouteData) {
1204     console.warn('コピーするルートデータがありません'); 
1205     return;
1206   }
1207   const data = appState.currentRouteData;
1208   let textOutput = `■ 目的地: ${data.destinationName}\n`;
1209   textOutput += `■ 概要: ${data.summary} (約 ${data.distance}, 徒歩 ${data.duration})\n\n`;
1210   if (data.warnings.length > 0) {
1211     textOutput += "■ 警告:\n";
1212     data.warnings.forEach(w => {
1213        textOutput += `・ ${w.replace(/<[^>]+>/g, ' ')}\n`;
1214     });
1215     textOutput += "\n";
1216   }
1217   textOutput += "■ 道順:\n";
1218   if (data.steps && data.steps.length > 0) {
1219     data.steps.forEach((step, index) => {
1220       const instruction = (step.html_instructions || '').replace(/<[^>]+>/g, ' ');
1221       textOutput += `${index + 1}. ${instruction} (${step.distance.text})\n`;
1222     });
1223   } else {
1224     textOutput += "詳細な道順はありません。\n";
1225   }
1226   if (navigator.clipboard) {
1227     navigator.clipboard.writeText(textOutput)
1228       .then(() => console.log('道順をクリップボードにコピーしました'))
1229       .catch(err => {
1230         console.error('Clipboard write error:', err);
1231         console.error('コピーに失敗しました'); 
1232       });
1233   } else {
1234     console.error('お使いのブラウザはコピー機能に非対応です'); 
1235   }
1236 }
1237 
1238 // ==========================================
1239 // 現在地へ移動
1240 // ==========================================
1241 let lastLocateTime = 0;
1242 function locateUser() {
1243   if (typeof DeviceOrientationEvent.requestPermission === 'function') {
1244     DeviceOrientationEvent.requestPermission()
1245       .then(permissionState => {
1246         if (permissionState === 'granted') {
1247           console.log('[Compass] iOS permission granted.');
1248           stopCompassListener();  
1249           appState.compassWatchId = null;  
1250           startCompassListener();  
1251         }
1252       })
1253       .catch(console.error);
1254   }
1255   const now = Date.now();
1256   if (now - lastLocateTime < 1000) return;
1257   lastLocateTime = now;
1258   if (appState.currentPos && appState.map) {
1259     appState.map.panTo(appState.currentPos);
1260     appState.map.setZoom(18);
1261     console.log('現在地に移動しました'); 
1262   } else {  
1263     console.log('現在地を取得します…'); 
1264     acquireLocation();  
1265   }  
1266 }
1267 
1268 // ==========================================
1269 // キーボード表示ウォッチャー
1270 // ==========================================
1271 function bindKeyboardWatch() {
1272   const searchInput = document.getElementById('q');
1273   const searchPanel = document.getElementById('searchPanel');
1274   const appBody = document.getElementById('appBody');
1275   const navPanel = document.getElementById('navPanel');
1276 
1277   searchInput.addEventListener('focus', () => {
1278     console.log('[Keyboard] Input focused');
1279     appBody.classList.add('keyboard-open');
1280     navPanel.style.display = 'none';
1281     setTimeout(() => {
1282         const inputTopInPanel = searchInput.offsetTop;
1283         searchPanel.scrollTop = inputTopInPanel - 20;
1284         console.log(`[Keyboard] Scrolled panel to ${searchPanel.scrollTop}`);
1285     }, 350); 
1286   });
1287 
1288   searchInput.addEventListener('blur', () => {
1289     console.log('[Keyboard] Input blurred');
1290     appBody.classList.remove('keyboard-open');
1291     searchPanel.scrollTop = 0; 
1292     const resultsVisible = document.getElementById('results').style.display === 'block';
1293     if (!resultsVisible && !appState.pointSearchMode) {
1294       navPanel.style.display = 'block';
1295     }
1296   });
1297 }
1298 
1299 // ==========================================
1300 // UI イベントバインディング
1301 // ==========================================
1302 function bindSearchPanelEvents() {
1303   const radiusLabel = document.getElementById('radiusLabel');
1304   const r10 = document.getElementById('r10');
1305   const r20 = document.getElementById('r20');
1306   const r30 = document.getElementById('r30');
1307   const btnPointSearch = document.getElementById('btnPointSearch');
1308   const navPanel = document.getElementById('navPanel'); 
1309 
1310   r10.onclick = () => {  
1311     r10.classList.add('active');  
1312     r20.classList.remove('active');
1313     r30.classList.remove('active');
1314     radiusLabel.textContent = '10km';  
1315   };
1316   r20.onclick = () => {  
1317     r20.classList.add('active');  
1318     r10.classList.remove('active');
1319     r30.classList.remove('active');
1320     radiusLabel.textContent = '20km';  
1321   };
1322   r30.onclick = () => {  
1323     r30.classList.add('active');  
1324     r10.classList.remove('active');
1325     r20.classList.remove('active');
1326     radiusLabel.textContent = '30km';  
1327   };
1328 
1329   btnPointSearch.onclick = () => {
1330     appState.pointSearchMode = !appState.pointSearchMode;
1331     if (appState.pointSearchMode) {
1332       btnPointSearch.textContent = '📍 ポイント選択中...';
1333       btnPointSearch.style.background = '#25d07a';
1334       btnPointSearch.style.color = '#0a2818';
1335       btnPointSearch.style.borderColor = 'transparent';
1336       console.log('地図をタップして検索地点を選択'); 
1337       navPanel.style.display = 'none'; 
1338     } else {
1339       btnPointSearch.textContent = '📍 ポイント選択';
1340       btnPointSearch.style.background = 'rgba(255,255,255,.08)';
1341       btnPointSearch.style.color = 'var(--text)';
1342       btnPointSearch.style.borderColor = 'var(--stroke)';
1343       if (document.getElementById('results').style.display === 'none') {
1344          navPanel.style.display = 'block';
1345       }
1346     }
1347   };
1348 }
1349 
1350 function bindLocationEvents() {
1351   document.getElementById('btnSaveLocation').onclick = showSaveLocationDialog;
1352   document.getElementById('btnEditLocation').onclick = showEditLocationDialog;
1353 }
1354 
1355 function bindSearchEvents() {
1356   document.getElementById('btnSearchIcon').onclick = () => {
1357     const q = document.getElementById('q').value.trim();
1358     if (q) performSearch(q);
1359   };
1360   document.getElementById('q').addEventListener('keypress', (e) => {
1361     if (e.key === 'Enter') {
1362       const q = document.getElementById('q').value.trim();
1363       if (q) performSearch(q);
1364     }
1365   });
1366   document.getElementById('btnVoiceIcon').onclick = startVoiceSearch;
1367   document.getElementById('btnReset').onclick = () => {
1368     document.getElementById('q').value = '';
1369     document.getElementById('results').style.display = 'none';
1370     document.getElementById('results').innerHTML = '';
1371     appState.searchMarkers.forEach(marker => marker.map = null);
1372     appState.searchMarkers = [];
1373     appState.searchPoint = null;
1374     if (appState.searchPointMarker) {
1375       appState.searchPointMarker.map = null;
1376       appState.searchPointMarker = null;
1377     }
1378     const addressBlock = document.getElementById('pointAddressBlock');
1379     const addressElement = document.getElementById('pointAddress');
1380     const coordsElement = document.getElementById('pointCoords');
1381     addressBlock.style.display = 'none';
1382     addressElement.textContent = '';
1383     coordsElement.textContent = '';
1384     appState.pointSearchMode = false;
1385     const btnPointSearch = document.getElementById('btnPointSearch');
1386     btnPointSearch.textContent = '📍 ポイント選択';
1387     btnPointSearch.style.background = 'rgba(255,255,255,.08)';
1388     btnPointSearch.style.color = 'var(--text)';
1389     btnPointSearch.style.borderColor = 'var(--stroke)';
1390     document.getElementById('navPanel').style.display = 'block'; 
1391     document.getElementById('r10').classList.add('active');
1392     document.getElementById('r20').classList.remove('active');
1393     document.getElementById('r30').classList.remove('active');
1394     document.getElementById('radiusLabel').textContent = '10km';
1395     console.log('リセットしました'); 
1396     console.log('[WalkNav] リセット完了');
1397   };
1398   document.getElementById('btnLocatePanel').onclick = locateUser;
1399 }
1400 
1401 function bindFABEvents() {
1402   document.getElementById('btnSearch').onclick = () => {
1403     document.getElementById('searchPanel').style.display = 'block';
1404     document.getElementById('fabStack').style.display = 'none';  
1405     document.getElementById('appBody').classList.add('panel-open');  
1406     if (document.getElementById('results').style.display === 'none' && !appState.pointSearchMode) {
1407         document.getElementById('navPanel').style.display = 'block';
1408     }
1409     document.getElementById('navPanelInstructions').innerHTML = '';  
1410     document.getElementById('incidentPanel').style.display = 'none';  
1411   };
1412   document.getElementById('btnClosePanel').onclick = () => {
1413     document.getElementById('searchPanel').style.display = 'none';
1414     if (!appState.isNavigating) {
1415        document.getElementById('fabStack').style.display = 'none';
1416        document.getElementById('navPanel').style.display = 'none';
1417     } else {
1418        document.getElementById('fabStack').style.display = 'flex';
1419     }
1420     document.getElementById('appBody').classList.remove('panel-open');  
1421   };
1422   document.getElementById('btnLocate').onclick = locateUser;
1423   document.getElementById('btnDestination').onclick = () => {
1424     if (appState.currentDestination && appState.map) {
1425       appState.map.panTo({ lat: appState.currentDestination.lat, lng: appState.currentDestination.lng });
1426       appState.map.setZoom(18);
1427       console.log('目的地に移動しました'); 
1428     }
1429   };
1430   document.getElementById('btnPause').onclick = togglePause;
1431   document.getElementById('btnReroute').onclick = () => {
1432     if (appState.currentDestination) {
1433       startNavigation(appState.currentDestination);
1434     } else {
1435       console.warn('目的地が設定されていません'); 
1436     }
1437   };
1438 }
1439 
1440 function bindRoutePanelEvents() {
1441    document.getElementById('btnStopRoute').onclick = stopNavigation;
1442    document.getElementById('btnExportText').onclick = exportRouteToClipboard;
1443 }
1444 
1445 function bindUI() {
1446   console.log('[WalkNav] Binding UI...');
1447   bindSearchPanelEvents();
1448   bindLocationEvents();
1449   bindSearchEvents();
1450   bindFABEvents();
1451   bindRoutePanelEvents();  
1452   bindKeyboardWatch(); 
1453   console.log('[WalkNav] UI binding complete');
1454 }
1455 
1456 // ==========================================
1457 // アプリケーション起動
1458 // ==========================================
1459 function startApp() {
1460   console.log('[WalkNav] Starting app...');
1461   document.documentElement.lang = 'ja';
1462   document.getElementById('searchPanel').style.display = 'block';
1463   document.getElementById('fabStack').style.display = 'none';  
1464   document.getElementById('btnSearch').style.display = 'flex';  
1465   document.getElementById('appBody').classList.add('panel-open');  
1466   document.getElementById('navPanel').style.display = 'block';
1467   bindUI();
1468   acquireLocation();
1469   initSpeechRecognition();
1470   startCompassListener();
1471   console.log('[WalkNav] ISSUE', ISSUE_ID, 'boot');
1472 }
1473 
1474 function initializeWhenReady() {
1475   if (typeof google !== 'undefined' && google.maps && google.maps.Map && google.maps.geometry) {
1476     startApp();
1477   } else {
1478     setTimeout(initializeWhenReady, 100);
1479   }
1480 }
1481 window.addEventListener('DOMContentLoaded', initializeWhenReady);
