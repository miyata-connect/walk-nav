'use strict';

/* =========================================================
   WalkNav - app.js (UI即表示 + ローディング強制解除 + 地図なし耐性)
   ========================================================= */

const ISSUE_ID = 'idx202511050540';
const WORKER_ORIGIN = 'https://ors-proxy.miyata-connect-jp.workers.dev';
const DEFAULT_MASK = 'places.displayName,places.formattedAddress,places.location,places.id,places.types';
const MAX_RETRY = 3;
const RETRY_DELAY = 1000;
const LOCATION_OPTIONS = { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 };

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
  currentRouteData: null
};

/* -----------------------------
   デバッグ可視化
----------------------------- */
function ensureDebugPane() {
  let el = document.getElementById('debugLog');
  if (!el) {
    el = document.createElement('div');
    el.id = 'debugLog';
    Object.assign(el.style, {
      position: 'fixed', bottom: '0', left: '0', width: '100%', maxHeight: '30vh',
      overflow: 'auto', background: '#0b0b0b', color: '#ff8080', fontSize: '12px',
      padding: '6px 8px', zIndex: '99999',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
      borderTop: '1px solid rgba(255,255,255,.15)', whiteSpace: 'pre-wrap'
    });
    document.body.appendChild(el);
  }
  return el;
}
function logDebug(...args) {
  try {
    const el = ensureDebugPane();
    const ts = new Date().toISOString().replace('T',' ').replace('Z','');
    const line = args.map(a => (a instanceof Error) ? (a.stack || a.message) :
      (typeof a === 'object' ? JSON.stringify(a,null,2) : String(a))).join(' ');
    el.textContent += `[${ts}] ${line}\n`;
    el.scrollTop = el.scrollHeight;
    // UIは常に残す
    openUnified('nav');
  } catch {}
}
window.addEventListener('error', e => logDebug('window.onerror:', e?.message || e, e?.error));
window.addEventListener('unhandledrejection', e => logDebug('unhandledrejection:', e?.reason || e));

/* -----------------------------
   統合パネル制御
----------------------------- */
function openUnified(which = 'nav') {
  const unified = document.getElementById('unifiedPanel');
  if (!unified) return;
  unified.style.display = 'block';

  const tabNav = document.getElementById('tabNav');
  const tabSearch = document.getElementById('tabSearch');
  const pageNav = document.getElementById('pageNav');
  const pageSearch = document.getElementById('pageSearch');

  tabNav?.classList.remove('active'); tabSearch?.classList.remove('active');
  pageNav?.classList.remove('active'); pageSearch?.classList.remove('active');

  if (which === 'search') {
    tabSearch?.classList.add('active'); pageSearch?.classList.add('active');
    localStorage.setItem('activeTab', 'search');
  } else {
    tabNav?.classList.add('active'); pageNav?.classList.add('active');
    localStorage.setItem('activeTab', 'nav');
  }
}

/* -----------------------------
   fetch（リトライ）
----------------------------- */
async function fetchWithRetry(url, options = {}, retries = MAX_RETRY) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options);
      if (!res.ok && i < retries - 1) {
        logDebug(`[Retry ${i+1}/${retries}] ${url} → ${res.status}`);
        await new Promise(r => setTimeout(r, RETRY_DELAY * (i + 1)));
        continue;
      }
      return res;
    } catch (err) {
      logDebug(`[Retry ${i+1}/${retries}] fetch error:`, err);
      if (i === retries - 1) throw err;
      await new Promise(r => setTimeout(r, RETRY_DELAY * (i + 1)));
    }
  }
}

/* -----------------------------
   Worker経由API
----------------------------- */
async function placesTextSearch(payload, fieldMask) {
  const resp = await fetchWithRetry(`${WORKER_ORIGIN}/places:searchText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(fieldMask ? { 'X-Goog-FieldMask': fieldMask } : {}) },
    body: JSON.stringify(payload)
  });
  if (!resp.ok) {
    const t = await resp.text();
    logDebug('TextSearch error:', t);
    throw new Error(`TextSearch ${resp.status}: ${t}`);
  }
  return await resp.json();
}
async function placesNearby(payload, fieldMask) {
  const resp = await fetchWithRetry(`${WORKER_ORIGIN}/places:searchNearby`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(fieldMask ? { 'X-Goog-FieldMask': fieldMask } : {}) },
    body: JSON.stringify(payload)
  });
  if (!resp.ok) {
    const t = await resp.text();
    logDebug('Nearby error:', t);
    throw new Error(`Nearby ${resp.status}: ${t}`);
  }
  return await resp.json();
}

/* -----------------------------
   地図初期化（地図無しでも落ちない）
----------------------------- */
function hasGoogle() {
  return (typeof google !== 'undefined' && google?.maps?.Map);
}
function initMap(center) {
  if (!hasGoogle()) { logDebug('[Map] google.maps 未ロード'); return; }
  try {
    appState.map = new google.maps.Map(document.getElementById('map'), {
      center, zoom: 17, mapId: 'DEMO_MAP', gestureHandling: 'greedy',
      clickableIcons: true, disableDefaultUI: true
    });
    appState.map.addListener('click', (e) => {
      if (!appState.pointSearchMode) return;
      if (e.latLng) setSearchPoint(e.latLng.lat(), e.latLng.lng());
    });
    appState.mapInitialized = true;
    logDebug('[Map] initialized');
  } catch (e) {
    logDebug('[Map] init error:', e);
  }
}

/* -----------------------------
   マーカー（地図なしガード）
----------------------------- */
function setUserMarker(lat, lng) {
  appState.currentPos = { lat, lng };
  if (!appState.map || !google?.maps?.marker?.AdvancedMarkerElement) return; // 地図未準備ならスキップ
  try {
    if (!appState.userMarker) {
      const pin = document.createElement('div');
      pin.style.width = '32px'; pin.style.height = '32px';
      pin.innerHTML = `
        <svg id="user-marker-icon" viewBox="0 0 24 24"
             style="width:100%;height:100%;transform:rotate(${appState.currentHeading}deg);
                    transition:transform .2s ease-out;filter:drop-shadow(0 2px 4px rgba(0,0,0,.4));">
          <path d="M12 2L4.5 20.5L12 16.5L19.5 20.5L12 2Z" fill="#3aa0ff" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/>
        </svg>`;
      appState.userMarker = new google.maps.marker.AdvancedMarkerElement({
        map: appState.map, position: { lat, lng }, content: pin, zIndex: 1000
      });
    } else {
      appState.userMarker.position = { lat, lng };
    }
  } catch (e) { logDebug('[Marker] setUserMarker error:', e); }
}

/* -----------------------------
   検索地点マーカー（地図なしガード）
----------------------------- */
function setSearchPoint(lat, lng) {
  appState.searchPoint = { lat, lng };
  try {
    if (appState.searchPointMarker) appState.searchPointMarker.map = null;
    if (appState.map && google?.maps?.marker?.AdvancedMarkerElement) {
      const pin = document.createElement('div');
      Object.assign(pin.style, {
        width: '30px', height: '30px', borderRadius: '50% 50% 50% 0',
        background: '#ff6565', border: '3px solid #fff', transform: 'rotate(-45deg)',
        boxShadow: '0 4px 8px rgba(0,0,0,.3)', transition: 'all .3s ease-out'
      });
      appState.searchPointMarker = new google.maps.marker.AdvancedMarkerElement({
        map: appState.map, position: { lat, lng }, content: pin, zIndex: 999
      });
    }
    logDebug(`[SearchPoint] ${lat.toFixed(6)}, ${lng.toFixed(6)}`);
    fetchPointAddress(lat, lng);
    openUnified('search');
  } catch (e) { logDebug('[SearchPoint] error:', e); }
}

/* -----------------------------
   距離/時間
----------------------------- */
function calculateDistance(a,b,c,d){const R=6371000, dLat=(c-a)*Math.PI/180, dLon=(d-b)*Math.PI/180;
  const x=Math.sin(dLat/2)**2 + Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(dLon/2)**2;
  return 2*R*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));}
function readLegDistanceText(leg){ if(leg?.distance?.text) return leg.distance.text;
  if(typeof leg?.distanceMeters==='number') return (leg.distanceMeters/1000).toFixed(1)+' km';
  return leg?.localizedValues?.distance?.text || '--';}
function readLegDurationText(leg){ if(leg?.duration?.text) return leg.duration.text;
  if(typeof leg?.duration==='string' && leg.duration.endsWith('s')) {
    const sec=parseInt(leg.duration.replace('s',''),10)||0; return Math.max(1,Math.round(sec/60))+' 分'; }
  return leg?.localizedValues?.duration?.text || '--';}

/* -----------------------------
   ルート線（地図なしガード）
----------------------------- */
function getEncodedPolylineFromRoute(route){
  return route?.overview_polyline?.points || route?.polyline?.encodedPolyline || route?.overviewPolyline?.encodedPolyline || null;
}
function drawRoutePolyline(route){
  if (!appState.map || !google?.maps?.geometry?.encoding) return;
  try {
    if (appState.currentPolyline){ appState.currentPolyline.setMap(null); appState.currentPolyline=null; }
    const encoded = getEncodedPolylineFromRoute(route); if (!encoded){ logDebug('[Nav] no polyline'); return; }
    const path = google.maps.geometry.encoding.decodePath(encoded);
    appState.currentPolyline = new google.maps.Polyline({ path, geodesic:true, strokeColor:'#62b5ff', strokeOpacity:0.8, strokeWeight:6, map: appState.map });
  } catch(e){ logDebug('[Nav] draw polyline error:', e); }
}

/* -----------------------------
   コンパス
----------------------------- */
const compassHandler = (event) => {
  if (appState.isNavigating) return;
  let h=null;
  if (event.webkitCompassHeading) h=event.webkitCompassHeading;
  else if (event.absolute===true && event.alpha!=null) h=event.alpha;
  if (h!=null){ appState.currentHeading=h; updateMarkerRotation(); }
};
function startCompassListener(){
  if (appState.compassWatchId || !window.DeviceOrientationEvent){ return; }
  if (typeof DeviceOrientationEvent.requestPermission==='function'){
    DeviceOrientationEvent.requestPermission().then(st=>{
      if (st==='granted'){
        window.addEventListener('deviceorientationabsolute',compassHandler,true);
        window.addEventListener('deviceorientation',compassHandler,true);
        appState.compassWatchId=1;
      }
    }).catch(e=>logDebug('[Compass] perm error:',e));
  }else{
    window.addEventListener('deviceorientationabsolute',compassHandler,true);
    window.addEventListener('deviceorientation',compassHandler,true);
    appState.compassWatchId=1;
  }
}
function stopCompassListener(){
  if (!appState.compassWatchId) return;
  window.removeEventListener('deviceorientationabsolute',compassHandler,true);
  window.removeEventListener('deviceorientation',compassHandler,true);
  appState.compassWatchId=null;
}
function updateMarkerRotation(){
  const icon=document.getElementById('user-marker-icon');
  if (icon) icon.style.transform=`rotate(${appState.currentHeading}deg)`;
}

/* -----------------------------
   位置監視（地図なしでも安全）
----------------------------- */
function startLocationWatcher(){
  if (appState.locationWatchId){ navigator.geolocation.clearWatch(appState.locationWatchId); appState.locationWatchId=null; }
  const onWatchSuccess = (pos)=>{
    const {latitude,longitude}=pos.coords;
    setUserMarker(latitude,longitude);
    fetchLocationNameGoogle(latitude,longitude);
    if (appState.isNavigating && !appState.isPaused && appState.map){
      appState.map.panTo({lat:latitude,lng:longitude});
      if (appState.currentDestination && google?.maps?.geometry){
        const cur=new google.maps.LatLng(latitude,longitude);
        const dst=new google.maps.LatLng(appState.currentDestination.lat,appState.currentDestination.lng);
        let hd=google.maps.geometry.spherical.computeHeading(cur,dst); if (hd<0) hd+=360;
        appState.currentHeading=hd; updateMarkerRotation();
      }
    }
  };
  const onWatchError = (err)=>{ logDebug('[Location watch] error:', err?.message||err); stopLocationWatcher(); };
  appState.locationWatchId = navigator.geolocation.watchPosition(onWatchSuccess,onWatchError,LOCATION_OPTIONS);
}
function stopLocationWatcher(){
  if (!appState.locationWatchId) return;
  navigator.geolocation.clearWatch(appState.locationWatchId);
  appState.locationWatchId=null;
}

/* -----------------------------
   ナビ
----------------------------- */
async function startNavigation(destination){
  let originLat, originLng;
  if (appState.pointSearchMode && appState.searchPoint){ originLat=appState.searchPoint.lat; originLng=appState.searchPoint.lng; appState.isSimulation=true; }
  else if (appState.currentPos){ originLat=appState.currentPos.lat; originLng=appState.currentPos.lng; appState.isSimulation=false; }
  else { logDebug('[Nav] 起点未設定'); openUnified('nav'); return; }

  appState.currentDestination=destination; appState.isNavigating=true; appState.isPaused=false;

  openUnified('nav');
  document.getElementById('fabStack').style.display='flex';
  document.getElementById('appBody').classList.remove('panel-open');
  stopCompassListener();

  try{
    const params=new URLSearchParams({ origin:`${originLat},${originLng}`, destination:`${destination.lat},${destination.lng}`, mode:'walking', language:'ja' });
    const response=await fetchWithRetry(`${WORKER_ORIGIN}/directions?${params.toString()}`,{},3);
    if (!response.ok){ throw new Error(`Directions ${response.status}: ${await response.text()}`); }
    const result=await response.json();
    if (result.routes?.length){
      const r0=result.routes[0]; const l0 = r0.legs?.[0]||null;
      const distanceText = l0 ? readLegDistanceText(l0) : '--';
      const durationText = l0 ? readLegDurationText(l0) : '--';
      document.getElementById('destinationName').textContent = destination.name;
      document.getElementById('routeDistance').textContent = distanceText;
      document.getElementById('routeTime').textContent = `徒歩 ${durationText}`;
      document.getElementById('routePanel').style.display='block';
      document.getElementById('results').style.display='none';
      document.getElementById('btnDestination').style.display='flex';

      const list=document.getElementById('navPanelInstructions'); list.innerHTML='';
      if (l0?.steps?.length){
        l0.steps.forEach(step=>{
          const item=document.createElement('div'); item.className='nav-instruction-item';
          const txt=(step.html_instructions||'').replace(/<[^>]+>/g,' ').trim();
          const dist=step?.distance?.text||step?.distance||'';
          item.textContent= dist? `${txt} (${dist})`:txt; list.appendChild(item);
        });
      }

      // warnings → 統合パネル
      const ip=document.getElementById('incidentPanel'); const il=document.getElementById('incidentList');
      if (ip && il){ il.innerHTML=''; if (r0.warnings?.length){
        r0.warnings.forEach(w=>{ const div=document.createElement('div'); div.className='incident-item other';
          div.innerHTML=`<div class="incident-type"><span class="incident-icon">⚠️</span><span>注意</span></div>
                         <div class="incident-description">${String(w).replace(/<[^>]+>/g,' ')}</div>`; il.appendChild(div); });
        ip.classList.add('has-incidents'); ip.style.display='block';
      } else { ip.classList.remove('has-incidents'); ip.style.display='none'; } }

      await fetchWeather(originLat,originLng);

      if (appState.isSimulation){
        setUserMarker(originLat,originLng);
        fetchLocationNameGoogle(originLat,originLng);
      } else { startLocationWatcher(); }

      drawRoutePolyline(r0);
      if (appState.map){
        const bounds=new google.maps.LatLngBounds();
        bounds.extend(new google.maps.LatLng(originLat,originLng));
        bounds.extend(new google.maps.LatLng(destination.lat,destination.lng));
        appState.map.fitBounds(bounds,{top:100,right:150,bottom:300,left:50});
      }
    } else {
      throw new Error('ルートなし');
    }
  }catch(e){
    logDebug('[Nav] error:', e);
    appState.isNavigating=false; appState.isSimulation=false;
    document.getElementById('fabStack').style.display='none';
    startCompassListener(); openUnified('nav');
  }
}

function stopNavigation(){
  stopLocationWatcher(); startCompassListener();
  appState.isSimulation=false; appState.currentRouteData=null;
  if (appState.currentPolyline){ appState.currentPolyline.setMap?.(null); appState.currentPolyline=null; }
  appState.currentDestination=null; appState.isNavigating=false; appState.isPaused=false;

  document.getElementById('routePanel').style.display='none';
  document.getElementById('navPanelInstructions').innerHTML='';
  const ip=document.getElementById('incidentPanel'); if (ip){ ip.style.display='none'; ip.classList.remove('has-incidents'); }
  const results=document.getElementById('results'); results.style.display='none'; results.innerHTML='';
  ['weather1h','weather2h','weather3h'].forEach(id=>{ const el=document.getElementById(id); if (el) el.textContent='--'; });
  document.getElementById('fabStack').style.display='none';
  document.getElementById('btnSearch').style.display='flex';
  const btnPause=document.getElementById('btnPause'); btnPause.textContent='一時停止'; btnPause.classList.remove('paused');
  appState.searchMarkers.forEach(m=> m.map && (m.map=null)); appState.searchMarkers=[];
  if (appState.currentPos && appState.map){ appState.map.panTo(appState.currentPos); appState.map.setZoom(17); }
  document.getElementById('appBody').classList.add('panel-open');
  openUnified('nav');
}

/* -----------------------------
   Pause/Resume
----------------------------- */
function togglePause(){
  if (appState.isSimulation){ logDebug('シミュレーション中は一時停止不可'); return; }
  if (!appState.isNavigating){ logDebug('ナビ中ではありません'); return; }
  appState.isPaused=!appState.isPaused;
  const btn=document.getElementById('btnPause');
  if (appState.isPaused){ btn.textContent='再開'; btn.classList.add('paused'); }
  else { btn.textContent='一時停止'; btn.classList.remove('paused'); if (appState.currentPos && appState.map){ appState.map.panTo(appState.currentPos); appState.map.setZoom(18); } }
}

/* -----------------------------
   検索
----------------------------- */
const TYPE_MAP = {'コンビニ':'convenience_store','スーパー':'supermarket','レストラン':'restaurant','カフェ':'cafe','ホテル':'lodging','病院':'hospital','薬局':'pharmacy','ガソリンスタンド':'gas_station','駐車場':'parking','銀行':'bank'};

async function performSearch(query){
  if (!query?.trim()){ logDebug('検索ワード未入力'); return; }
  let centerLat, centerLng;
  if (appState.pointSearchMode && appState.searchPoint){ centerLat=appState.searchPoint.lat; centerLng=appState.searchPoint.lng; }
  else if (appState.currentPos){ centerLat=appState.currentPos.lat; centerLng=appState.currentPos.lng; }
  else { logDebug('検索基準地点不明'); return; }

  const radiusKm=parseInt((document.getElementById('radiusLabel')?.textContent||'10km'));
  const radiusMeters=radiusKm*1000;
  openUnified('search');

  try{
    const data=await placesTextSearch({
      textQuery: query.trim(),
      locationBias:{ circle:{ center:{ latitude:centerLat, longitude:centerLng }, radius: radiusMeters }},
      maxResultCount:20, languageCode:'ja'
    }, DEFAULT_MASK);
    if (data.places?.length){ displayResults(data.places,centerLat,centerLng); return; }
  }catch(e){ logDebug('[Search] Text error:', e); }

  const typeKey = TYPE_MAP[query.trim()] || TYPE_MAP[query.trim().replace(/\s/g,'')];
  if (typeKey){
    try{
      const data=await placesNearby({
        includedTypes:[typeKey], maxResultCount:20,
        locationRestriction:{ circle:{ center:{ latitude:centerLat, longitude:centerLng }, radius: radiusMeters }},
        languageCode:'ja'
      }, DEFAULT_MASK);
      if (data.places?.length){ displayResults(data.places,centerLat,centerLng); return; }
    }catch(e){ logDebug('[Search] Nearby error:', e); }
  }

  document.getElementById('results').style.display='none';
  openUnified('nav');
}

function displayResults(places, centerLat, centerLng){
  document.getElementById('navPanel').style.display='none';
  appState.searchMarkers.forEach(m=> m.map && (m.map=null));
  appState.searchMarkers=[];

  const list = places.map(p=>{
    const lat=p.location.latitude, lng=p.location.longitude;
    return {...p, distance: calculateDistance(centerLat,centerLng,lat,lng)};
  }).sort((a,b)=>a.distance-b.distance).slice(0,5);

  const results=document.getElementById('results');
  results.innerHTML=''; results.style.display='block'; openUnified('search');

  list.forEach((place,i)=>{
    const name=place.displayName?.text || place.displayName || '名称不明';
    const address=place.formattedAddress || '住所不明';
    const lat=place.location.latitude, lng=place.location.longitude;
    const item=document.createElement('div'); item.className='result-item';
    item.innerHTML=`
      <div class="result-name">${i+1}. ${name}</div>
      <div class="result-address">${address}</div>
      <div style="font-size:11px;color:#62b5ff;margin-top:4px">📍 ${(place.distance/1000).toFixed(2)}km</div>`;
    item.onclick=()=> startNavigation({ name, lat, lng });
    results.appendChild(item);

    if (appState.map && google?.maps?.marker?.AdvancedMarkerElement){
      const pin=document.createElement('div');
      Object.assign(pin.style,{width:'24px',height:'24px',borderRadius:'50%',background:'#25d07a',border:'2px solid #fff',
        boxShadow:'0 2px 6px rgba(0,0,0,.3)',display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontSize:'12px',fontWeight:'bold'});
      pin.textContent= i+1;
      try{
        const marker = new google.maps.marker.AdvancedMarkerElement({ map: appState.map, position:{lat,lng}, content:pin, zIndex:500+i, title:name });
        appState.searchMarkers.push(marker);
      }catch(e){ logDebug('[Marker] result marker error:', e); }
    }
  });

  logDebug(`[Search] ${list.length}件表示`);
}

/* -----------------------------
   音声
----------------------------- */
function initSpeechRecognition(){
  if (!('webkitSpeechRecognition'in window) && !('SpeechRecognition'in window)){ logDebug('[Voice] 非対応'); return false; }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  appState.recognition = new SR(); appState.recognition.lang='ja-JP'; appState.recognition.continuous=false; appState.recognition.interimResults=false;
  const btn=document.getElementById('btnVoiceIcon');
  appState.recognition.onstart=()=>{ btn?.classList.add('recording'); };
  appState.recognition.onresult=(ev)=>{ const txt=ev.results[0][0].transcript; const q=document.getElementById('q'); if(q) q.value=txt; performSearch(txt); };
  appState.recognition.onerror=()=>{ btn?.classList.remove('recording'); };
  appState.recognition.onend=()=>{ btn?.classList.remove('recording'); };
  return true;
}
function startVoiceSearch(){
  if (!appState.recognition && !initSpeechRecognition()){ return; }
  try{ appState.recognition.start(); }catch(e){ try{ appState.recognition.stop(); setTimeout(()=>appState.recognition.start(),120); }catch(_){} }
}

/* -----------------------------
   現在地（地図不要で動く）
----------------------------- */
function acquireLocation(){
  const onSuccess = (pos)=>{
    const { latitude, longitude }=pos.coords;
    removeLoading();
    if (!appState.map && hasGoogle()) initMap({lat:latitude,lng:longitude});
    if (appState.map){ appState.map.setCenter({lat:latitude,lng:longitude}); }
    setUserMarker(latitude,longitude);  // 地図が無ければ内部でスキップ
    fetchLocationNameGoogle(latitude,longitude);
    fetchWeather(latitude,longitude);
    openUnified('nav');
  };
  const onError = (err)=>{
    logDebug('[Geolocation] error:', err?.message||err);
    removeLoading();
    if (!appState.map && hasGoogle()) initMap({lat:35,lng:135});
    const a=document.getElementById('locAddress'), c=document.getElementById('locCoords');
    if (a) a.textContent='位置情報を確認できません'; if (c) c.textContent='現在地：取得失敗';
    openUnified('nav');
  };
  try{ navigator.geolocation.getCurrentPosition(onSuccess,onError,LOCATION_OPTIONS); }
  catch(e){ logDebug('[Geolocation] exception:', e); removeLoading(); openUnified('nav'); }
}

/* -----------------------------
   逆ジオコーディング
----------------------------- */
async function fetchLocationNameGoogle(lat,lng){
  const addr=document.getElementById('locAddress'); const coords=document.getElementById('locCoords');
  if (coords) coords.textContent=`現在地：緯度 ${lat.toFixed(6)} / 経度 ${lng.toFixed(6)}`;
  if (!addr) return;
  try{
    const response=await fetchWithRetry(`${WORKER_ORIGIN}/geocode?${new URLSearchParams({lat,lng,language:'ja'}).toString()}`);
    if (!response.ok){ throw new Error(`Geocode ${response.status}: ${await response.text()}`); }
    const data=await response.json(); const results=Array.isArray(data?.results)?data.results:[];
    if (data.status==='OK' && results[0]){
      const address=results[0].formatted_address||''; addr.textContent=address.replace(/^日本、\s*/,'')+' 付近';
    }else{ addr.textContent='住所情報なし'; if (data.status && data.status!=='ZERO_RESULTS') logDebug('[Geocode] status:', data.status); }
  }catch(e){ addr.textContent='住所取得エラー'; logDebug('[Geocode] error:', e); }
}
async function fetchPointAddress(lat,lng){
  const block=document.getElementById('pointAddressBlock');
  const addr=document.getElementById('pointAddress'); const coords=document.getElementById('pointCoords');
  if (coords) coords.textContent=`(緯度 ${lat.toFixed(6)} / 経度 ${lng.toFixed(6)})`;
  if (block) block.style.display='flex'; if (addr) addr.textContent='ポイント：住所取得中...';
  try{
    const response=await fetchWithRetry(`${WORKER_ORIGIN}/geocode?${new URLSearchParams({lat,lng,language:'ja'}).toString()}`);
    if (!response.ok){ throw new Error(`Geocode ${response.status}: ${await response.text()}`); }
    const data=await response.json(); const results=Array.isArray(data?.results)?data.results:[];
    if (data.status==='OK' && results[0]){
      const address=results[0].formatted_address||''; if (addr) addr.textContent=`ポイント：${address.replace(/^日本、\s*/,'')} 付近`;
    }else{ if (addr) addr.textContent='ポイント：住所情報なし'; }
  }catch(e){ if (addr) addr.textContent='ポイント：住所取得エラー'; logDebug('[Geocode Point] error:', e); }
}

/* -----------------------------
   天気
----------------------------- */
async function fetchWeather(lat,lng){
  try{
    const resp=await fetchWithRetry(`${WORKER_ORIGIN}/weather?${new URLSearchParams({lat:String(lat),lng:String(lng),units:'metric',lang:'ja'}).toString()}`,{},3);
    if (!resp.ok) throw new Error(`Weather ${resp.status}: ${await resp.text()}`);
    const data=await resp.json(); const list=Array.isArray(data?.list)?data.list:[];
    ['weather1h','weather2h','weather3h'].forEach(id=>{ const el=document.getElementById(id); if (el) el.textContent='--'; });
    if (!list.length) return;
    const now=Date.now();
    [1,2,3].forEach(h=>{
      const target=now+h*3600*1000; let best=null, diff=Infinity;
      for (const item of list){ const t=(item?.dt||0)*1000; const d=Math.abs(t-target); if (d<diff){ diff=d; best=item; } }
      const el=document.getElementById(`weather${h}h`);
      if (el && best){ const temp=Math.round(best?.main?.temp ?? NaN);
        const cond=(best?.weather && best.weather[0]?.description)||'';
        el.textContent = Number.isNaN(temp)? (cond||'--') : `${temp}℃ / ${cond}`; }
    });
  }catch(e){ logDebug('[Weather] error:', e); ['weather1h','weather2h','weather3h'].forEach(id=>{ const el=document.getElementById(id); if (el) el.textContent='--'; }); }
}

/* -----------------------------
   ダイアログ / 保存・編集
----------------------------- */
function createDialog(config){
  const overlay=document.createElement('div'); overlay.className=`dialog-overlay ${config.scroll?'scroll':''}`; overlay.id=config.id||'dialog';
  const box=document.createElement('div'); box.className=`dialog-box ${config.wide?'wide':''}`; box.innerHTML=config.content;
  overlay.appendChild(box); document.body.appendChild(overlay); return overlay;
}
function showSaveLocationDialog(){
  if (!appState.currentPos){ logDebug('現在地なし'); return; }
  const d=createDialog({ id:'saveLocationDialog', content:`
    <h3 class="dialog-title">現在地点登録画面</h3>
    <p class="dialog-text">登録する地点名を入力してください:</p>
    <input type="text" id="locationNameInput" class="dialog-input" placeholder="地点名を入力" />
    <div class="dialog-actions">
      <button id="btnCancelSave" class="dialog-btn cancel">キャンセル</button>
      <button id="btnConfirmSave" class="dialog-btn confirm">OK</button>
    </div>`});
  const input=document.getElementById('locationNameInput');
  setTimeout(()=>input?.focus(),80);
  document.getElementById('btnCancelSave').onclick=()=>d.remove();
  document.getElementById('btnConfirmSave').onclick=()=>{
    const name=input.value.trim(); if(!name){ input.style.borderColor='var(--danger)'; setTimeout(()=>input.style.borderColor='var(--stroke)',1500); return; }
    const list=JSON.parse(localStorage.getItem('savedLocations')||'[]');
    list.push({ name, lat:appState.currentPos.lat, lng:appState.currentPos.lng, timestamp:Date.now() });
    localStorage.setItem('savedLocations',JSON.stringify(list)); d.remove();
  };
  input.addEventListener('keypress',e=>{ if(e.key==='Enter') document.getElementById('btnConfirmSave').click(); });
}
function showEditLocationDialog(){
  const list=JSON.parse(localStorage.getItem('savedLocations')||'[]');
  if (!list.length){
    const d=createDialog({id:'editDialog',content:`<h3 class="dialog-title">登録地点修正</h3><p class="dialog-muted">登録された地点がありません</p><button id="btnCloseEmpty" class="dialog-btn confirm full">閉じる</button>`});
    document.getElementById('btnCloseEmpty').onclick=()=>d.remove(); return;
  }
  let html='<div class="location-list">';
  list.forEach((loc,i)=>{ html+=`
    <div class="location-item">
      <div class="location-item-name">${loc.name}</div>
      <div class="location-item-coords">緯度: ${Number(loc.lat).toFixed(6)} / 経度: ${Number(loc.lng).toFixed(6)}</div>
      <div class="location-item-actions">
        <button class="location-item-btn nav" data-i="${i}">ナビ開始</button>
        <button class="location-item-btn edit" data-i="${i}">名前変更</button>
        <button class="location-item-btn delete" data-i="${i}">削除</button>
      </div>
    </div>`; });
  html+='</div>';
  const d=createDialog({id:'editDialog',wide:true,scroll:true,content:`<h3 class="dialog-title">登録地点修正</h3>${html}<button id="btnCloseEdit" class="dialog-btn cancel full" style="margin-top:16px">閉じる</button>`});
  document.getElementById('btnCloseEdit').onclick=()=>d.remove();
  d.querySelectorAll('.location-item-btn.nav').forEach(b=> b.onclick=()=>{ const i=+b.dataset.i; const loc=list[i]; d.remove(); startNavigation({name:loc.name,lat:loc.lat,lng:loc.lng}); });
  d.querySelectorAll('.location-item-btn.edit').forEach(b=> b.onclick=()=>{
    const i=+b.dataset.i; const loc=list[i];
    const r=createDialog({id:'renameDialog',content:`<h3 class="dialog-title">地点名変更</h3><input id="renameInput" class="dialog-input" value="${loc.name}"/><div class="dialog-actions"><button id="btnCancelRename" class="dialog-btn cancel">キャンセル</button><button id="btnConfirmRename" class="dialog-btn confirm">OK</button></div>`});
    const inp=document.getElementById('renameInput'); setTimeout(()=>{inp.focus();inp.select();},80);
    document.getElementById('btnCancelRename').onclick=()=>r.remove();
    document.getElementById('btnConfirmRename').onclick=()=>{ const v=inp.value.trim(); if(!v){ inp.style.borderColor='var(--danger)'; setTimeout(()=>inp.style.borderColor='var(--stroke)',1500); return; } list[i].name=v; localStorage.setItem('savedLocations',JSON.stringify(list)); r.remove(); d.remove(); };
    inp.addEventListener('keypress',e=>{ if(e.key==='Enter') document.getElementById('btnConfirmRename').click(); });
  });
  d.querySelectorAll('.location-item-btn.delete').forEach(b=> b.onclick=()=>{
    const i=+b.dataset.i; const loc=list[i];
    const c=createDialog({id:'confirmDeleteDialog',content:`<h3 class="dialog-title">削除確認</h3><p class="dialog-text">「${loc.name}」を削除しますか？</p><div class="dialog-actions"><button id="btnCancelDelete" class="dialog-btn cancel">キャンセル</button><button id="btnConfirmDelete" class="dialog-btn delete">削除</button></div>`});
    document.getElementById('btnCancelDelete').onclick=()=>c.remove();
    document.getElementById('btnConfirmDelete').onclick=()=>{ list.splice(i,1); localStorage.setItem('savedLocations',JSON.stringify(list)); c.remove(); d.remove(); };
  });
}

/* -----------------------------
   共有用：道順コピー
----------------------------- */
function exportRouteToClipboard(){
  const d=appState.currentRouteData;
  if (!d){ logDebug('コピー対象なし'); return; }
  let t=`■ 目的地: ${d.destinationName}\n■ 概要: ${d.summary} (約 ${d.distance}, 徒歩 ${d.duration})\n\n`;
  if (d.warnings?.length){ t+='■ 警告:\n'+d.warnings.map(w=>'・ '+String(w).replace(/<[^>]+>/g,' ')).join('\n')+'\n\n'; }
  t+='■ 道順:\n';
  if (d.steps?.length){ d.steps.forEach((s,i)=>{ const ins=(s.html_instructions||'').replace(/<[^>]+>/g,' ').trim(); const dist=s?.distance?.text||s?.distance||''; t+=`${i+1}. ${ins}${dist?` (${dist})`:''}\n`; }); }
  else t+='詳細な道順はありません。\n';
  navigator.clipboard?.writeText(t).then(()=>logDebug('コピー完了')).catch(e=>logDebug('Clipboard error:',e));
}

/* -----------------------------
   現在地へ移動
----------------------------- */
let lastLocateTime=0;
function locateUser(){
  if (typeof DeviceOrientationEvent?.requestPermission==='function'){
    DeviceOrientationEvent.requestPermission().then(st=>{ if(st==='granted'){ stopCompassListener(); appState.compassWatchId=null; startCompassListener(); }}).catch(()=>{});
  }
  const now=Date.now(); if (now-lastLocateTime<1000) return; lastLocateTime=now;
  if (appState.currentPos && appState.map){ appState.map.panTo(appState.currentPos); appState.map.setZoom(18); }
  else { acquireLocation(); }
}

/* -----------------------------
   キーボード監視
----------------------------- */
function bindKeyboardWatch(){
  const input=document.getElementById('q'); const appBody=document.getElementById('appBody'); const navPanel=document.getElementById('navPanel');
  if (!input) return;
  input.addEventListener('focus',()=>{ appBody?.classList.add('keyboard-open'); navPanel && (navPanel.style.display='none'); });
  input.addEventListener('blur',()=>{ appBody?.classList.remove('keyboard-open'); const visible=document.getElementById('results')?.style.display==='block';
    if (!visible && !appState.pointSearchMode){ navPanel && (navPanel.style.display='block'); } });
}

/* -----------------------------
   UIバインド
----------------------------- */
function bindSearchPanelEvents(){
  const radiusLabel=document.getElementById('radiusLabel');
  const r10=document.getElementById('r10'), r20=document.getElementById('r20'), r30=document.getElementById('r30');
  const btnPointSearch=document.getElementById('btnPointSearch'); const navPanel=document.getElementById('navPanel');
  r10.onclick=()=>{ r10.classList.add('active'); r20.classList.remove('active'); r30.classList.remove('active'); radiusLabel.textContent='10km'; };
  r20.onclick=()=>{ r20.classList.add('active'); r10.classList.remove('active'); r30.classList.remove('active'); radiusLabel.textContent='20km'; };
  r30.onclick=()=>{ r30.classList.add('active'); r10.classList.remove('active'); r20.classList.remove('active'); radiusLabel.textContent='30km'; };
  btnPointSearch.onclick=()=>{
    appState.pointSearchMode=!appState.pointSearchMode;
    if (appState.pointSearchMode){
      btnPointSearch.textContent='📍 ポイント選択中...'; btnPointSearch.style.background='#25d07a'; btnPointSearch.style.color='#0a2818'; btnPointSearch.style.borderColor='transparent';
      navPanel.style.display='none';
    }else{
      btnPointSearch.textContent='📍 ポイント選択'; btnPointSearch.style.background='rgba(255,255,255,.08)'; btnPointSearch.style.color='var(--text)'; btnPointSearch.style.borderColor='var(--stroke)';
      if (document.getElementById('results').style.display!=='block'){ navPanel.style.display='block'; openUnified('nav'); }
    }
  };
}
function bindLocationEvents(){
  document.getElementById('btnSaveLocation').onclick=showSaveLocationDialog;
  document.getElementById('btnEditLocation').onclick=showEditLocationDialog;
}
function bindSearchEvents(){
  const q=document.getElementById('q');
  document.getElementById('btnSearchIcon').onclick=()=>{ const v=q.value.trim(); if(v) performSearch(v); };
  q.addEventListener('keypress',e=>{ if(e.key==='Enter'){ const v=q.value.trim(); if(v) performSearch(v); }});
  document.getElementById('btnVoiceIcon').onclick=startVoiceSearch;
  document.getElementById('btnReset').onclick=()=>{
    q.value=''; const results=document.getElementById('results'); results.style.display='none'; results.innerHTML='';
    appState.searchMarkers.forEach(m=> m.map && (m.map=null)); appState.searchMarkers=[]; appState.searchPoint=null;
    if (appState.searchPointMarker){ appState.searchPointMarker.map=null; appState.searchPointMarker=null; }
    const block=document.getElementById('pointAddressBlock'), addr=document.getElementById('pointAddress'), coords=document.getElementById('pointCoords');
    block.style.display='none'; addr.textContent=''; coords.textContent='';
    appState.pointSearchMode=false;
    const b=document.getElementById('btnPointSearch');
    b.textContent='📍 ポイント選択'; b.style.background='rgba(255,255,255,.08)'; b.style.color='var(--text)'; b.style.borderColor='var(--stroke)';
    document.getElementById('navPanel').style.display='block';
    document.getElementById('r10').classList.add('active'); document.getElementById('r20').classList.remove('active'); document.getElementById('r30').classList.remove('active');
    radiusLabel.textContent='10km';
    openUnified('nav');
  };
  document.getElementById('btnLocatePanel').onclick=locateUser;
}
function bindFABEvents(){
  document.getElementById('btnSearch').onclick=()=>{
    openUnified('search'); document.getElementById('fabStack').style.display='none'; document.getElementById('appBody').classList.add('panel-open');
    if (document.getElementById('results').style.display!=='block' && !appState.pointSearchMode){ document.getElementById('navPanel').style.display='block'; }
    document.getElementById('navPanelInstructions').innerHTML=''; document.getElementById('incidentPanel').style.display='none';
  };
  document.getElementById('btnClosePanel').onclick=()=>{
    openUnified('nav');
    if (!appState.isNavigating){ document.getElementById('fabStack').style.display='none'; document.getElementById('navPanel').style.display='none'; }
    else { document.getElementById('fabStack').style.display='flex'; }
    document.getElementById('appBody').classList.remove('panel-open');
  };
  document.getElementById('btnLocate').onclick=locateUser;
  document.getElementById('btnDestination').onclick=()=>{
    if (appState.currentDestination && appState.map){
      appState.map.panTo({lat:appState.currentDestination.lat,lng:appState.currentDestination.lng}); appState.map.setZoom(18);
    }
  };
  document.getElementById('btnPause').onclick=togglePause;
  document.getElementById('btnReroute').onclick=()=>{ if (appState.currentDestination) startNavigation(appState.currentDestination); else { logDebug('目的地未設定'); openUnified('nav'); } };
}
function bindRoutePanelEvents(){
  document.getElementById('btnStopRoute').onclick=stopNavigation;
  document.getElementById('btnExportText').onclick=exportRouteToClipboard;
}
function bindUI(){
  bindSearchPanelEvents(); bindLocationEvents(); bindSearchEvents(); bindFABEvents(); bindRoutePanelEvents(); bindKeyboardWatch();
}

/* -----------------------------
   ローディング強制解除
----------------------------- */
let loadingWatchStarted=false;
function removeLoading(){ document.getElementById('loading')?.remove(); }
function startLoadingWatchdog(){
  if (loadingWatchStarted) return; loadingWatchStarted=true;
  // 5秒で強制解除（Maps/位置情報が止まってもUIは必ず出す）
  setTimeout(()=>{ if (document.getElementById('loading')){ logDebug('[Boot] watchdog: loading removed'); removeLoading(); openUnified('nav'); } }, 5000);
}

/* -----------------------------
   アプリ起動
----------------------------- */
function startAppLiteUI(){
  // Maps未読込でも UI を先に出す
  openUnified('nav');
  document.getElementById('fabStack').style.display='none';
  document.getElementById('btnSearch').style.display='flex';
  document.getElementById('navPanel').style.display='block';
  document.getElementById('appBody').classList.add('panel-open');
  bindUI();
  initSpeechRecognition();
  startCompassListener();
}

function tryInitMapOnceWithFallback(center){
  if (hasGoogle()){ initMap(center); return true; }
  return false;
}

function startApp(){
  logDebug('[Boot] start', ISSUE_ID);
  startAppLiteUI();          // まずUIを出す
  startLoadingWatchdog();    // ローディングは5秒で強制解除

  // 現在地 → 地図がまだでもOK
  acquireLocation();

  // Maps が遅延ロードの場合に備え、しばらくポーリングして地図を初期化
  let tries=0; const maxTries=60; // 60 * 250ms = 15秒
  const h=setInterval(()=>{
    tries++;
    if (appState.mapInitialized){ clearInterval(h); return; }
    if (tryInitMapOnceWithFallback(appState.currentPos || {lat:35,lng:135})){
      logDebug('[Boot] map late-initialized');
      clearInterval(h);
      // すでに現在地が取れていたら反映
      if (appState.currentPos){ setUserMarker(appState.currentPos.lat, appState.currentPos.lng); }
    }
    if (tries>=maxTries){ clearInterval(h); logDebug('[Boot] map init timeout'); }
  }, 250);
}

/* -----------------------------
   初期化
----------------------------- */
window.addEventListener('DOMContentLoaded', () => {
  ensureDebugPane();
  openUnified('nav'); // DOM直後から案内を固定表示
  startApp();
});