"use strict";

// ==== CONFIG ====
const RUN_ID = (window.WALKNAV_RUN_ID || "WALKNAV-20251101-01A7"); // injected/constant
const PROXY_BASE = "https://ors-proxy.miyata-connect-jp.workers.dev";
const PLACES_ENDPOINT = `${PROXY_BASE}/places:searchText`;
const DIRECTIONS_ENDPOINT = `${PROXY_BASE}/directions`;

let map, directionsService, directionsRenderer;
let currentMarker = null, destinationMarker = null;
let watchId = null, isNavigating = false, hasFix = false;

// ==== Trace helper ====
async function trace(level, tag, msg, meta) {
  try {
    await fetch(`${PROXY_BASE}/trace`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Run-Id": RUN_ID },
      body: JSON.stringify({ runId: RUN_ID, level, tag, msg, meta }),
      keepalive: true,
    });
  } catch {}
}

// ==== UI helpers ====
function qs(s){ return document.querySelector(s); }
function setStatus(s){ const el=qs("#status"); if(el) el.textContent=s||""; }
function showError(msg){
  const b=qs("#error-banner"), t=qs("#error-text");
  if(t) t.textContent = msg;
  if(b){ b.classList.remove("hidden"); setTimeout(()=>b.classList.add("hidden"), 3000); }
}
function showLoading(show){
  const el=qs("#loading");
  if(!el) return;
  if(show){ el.style.display="flex"; el.classList.remove("hide"); }
  else { el.classList.add("hide"); setTimeout(()=>el.style.display="none", 350); }
}

// ==== Init Map ====
window.addEventListener("load", initMap);

async function initMap() {
  showLoading(true);
  setStatus("位置情報を取得中…");

  // Wait Maps
  await new Promise((resolve)=>{
    if (window.google?.maps) return resolve();
    const iv = setInterval(()=>{ if(window.google?.maps){ clearInterval(iv); resolve(); } }, 80);
  });

  const { Map } = await google.maps.importLibrary("maps");
  const { AdvancedMarkerElement } = await google.maps.importLibrary("marker");

  let center = null;

  // Geolocation first (initial only)
  try {
    const pos = await new Promise((resolve, reject)=>{
      if(!navigator.geolocation) return reject(new Error("Geolocation unsupported"));
      navigator.geolocation.getCurrentPosition(resolve, reject,
        { enableHighAccuracy:true, timeout: 15000, maximumAge: 0 });
    });
    center = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    hasFix = true;
    setStatus("現在地を取得しました。");
    await trace("info","geo","fix ok", center);
  } catch (e) {
    // 初期値は非表示を許容（中心のみセット）
    center = { lat: 35.681236, lng: 139.767125 }; // will be overridden once watch gets a fix
    setStatus("現在地の取得を待機中…");
    await trace("warn","geo","initial fix failed", { err: e.message });
  }

  map = new Map(document.getElementById("map"), {
    center,
    zoom: 17,          // 初期拡大を強め
    mapId: "WALKNAV_MAP",
    disableDefaultUI: true,
  });

  // Current marker with ripple (AdvancedMarkerElement)
  const ripple = document.createElement("div");
  ripple.innerHTML = `
    <div style="position:relative;width:18px;height:18px;">
      <div style="position:absolute;inset:0;border-radius:50%;background:#5fb1ff;"></div>
      <div style="position:absolute;left:-12px;top:-12px;width:42px;height:42px;border-radius:50%;
                  border:2px solid rgba(95,177,255,.6);animation:rip 2s ease-out infinite;"></div>
      <style>@keyframes rip{0%{transform:scale(.4);opacity:.9}100%{transform:scale(1.6);opacity:0}}</style>
    </div>`;
  currentMarker = new AdvancedMarkerElement({ map, position: center, content: ripple });

  directionsService = new google.maps.DirectionsService();
  directionsRenderer = new google.maps.DirectionsRenderer({ map, suppressMarkers:false });

  bindUI(AdvancedMarkerElement);
  startWatch(AdvancedMarkerElement);

  // Run ID badge (non-intrusive)
  const bid = document.getElementById("runid");
  if (bid) { bid.textContent = RUN_ID; }

  showLoading(false);
  await trace("info","init","map ready");
}

function bindUI(AdvancedMarkerElement){
  const searchBtn = qs("#searchBtn");
  const micBtn = qs("#micBtn");
  const resetBtn = qs("#resetBtn");
  const searchBox = qs("#searchBox");

  if (searchBtn) searchBtn.onclick = () => doSearch();
  if (micBtn) micBtn.onclick = () => startVoice();
  if (resetBtn) resetBtn.onclick = () => {
    if (destinationMarker) { destinationMarker.map = null; destinationMarker = null; }
    setStatus("リセットしました。");
  };
  if (searchBox) searchBox.addEventListener("keydown", (e)=>{ if(e.key==="Enter") doSearch(); });

  // Route control
  const startBtn = qs("#gm-start-nav");
  const stopBtn  = qs("#gm-stop-nav");
  const rerBtn   = qs("#gm-reroute");

  if (startBtn) startBtn.onclick = () => startNav();
  if (stopBtn)  stopBtn.onclick  = () => stopNav();
  if (rerBtn)   rerBtn.onclick   = () => reroute(true);

  // Long-press to pick destination
  let pressTimer = null;
  map.addListener("mousedown", (ev)=>{
    pressTimer = setTimeout(()=>{
      setDestination(ev.latLng, AdvancedMarkerElement);
    }, 600);
  });
  map.addListener("mouseup", ()=>{ if (pressTimer) clearTimeout(pressTimer); });
  map.addListener("dragstart", ()=>{ if (pressTimer) clearTimeout(pressTimer); });
}

function setDestination(latLng, AdvancedMarkerElement){
  if (destinationMarker) destinationMarker.map = null;
  destinationMarker = new google.maps.Marker({ map, position: latLng, title: "目的地" });
  map.panTo(latLng);
  setStatus("目的地を設定しました。");
  trace("info","dest","set", { lat: latLng.lat(), lng: latLng.lng() });
}

function startWatch(AdvancedMarkerElement){
  if (!navigator.geolocation) return;
  if (watchId) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(
    pos=>{
      const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      hasFix = true;
      currentMarker.position = p;
      if (!isNavigating) map.panTo(p);
    },
    err=>{ /* silent */ },
    { enableHighAccuracy:true, maximumAge:0, timeout:15000 }
  );
}

// ==== Search via Places New (proxy) ====
async function doSearch(){
  const qv = (qs("#searchBox")?.value || "").trim();
  if (!qv) { showError("検索したい文字を入力してください。"); return; }

  const cpos = currentMarker?.position;
  const body = {
    textQuery: qv,
    languageCode: "ja",
    regionCode: "JP",
    pageSize: 5,
    locationBias: cpos ? { circle: { center: { latitude: cpos.lat, longitude: cpos.lng }, radius: 20000 } } : undefined,
  };

  setStatus("検索中…");

  try{
    const res = await fetch(PLACES_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.types",
        "X-Run-Id": RUN_ID,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text();
      await trace("error","search","http", { status: res.status, txt });
      showError("検索エラーが発生しました。");
      return;
    }
    const data = await res.json();
    const first = data?.places?.[0];
    if (!first) { setStatus("該当なし"); return; }

    const lat = first.location?.latitude, lng = first.location?.longitude;
    if (typeof lat !== "number" || typeof lng !== "number") { showError("座標なし"); return; }
    if (destinationMarker) destinationMarker.map = null;
    destinationMarker = new google.maps.Marker({ map, position: { lat, lng }, title: first.displayName?.text || qv });
    map.panTo({ lat, lng });
    setStatus("検索完了");
    await trace("info","search","ok", { name: first.displayName?.text, lat, lng });
  } catch (e) {
    await trace("error","search","exception", { msg: e.message });
    showError("検索エラーが発生しました。");
  }
}

// ==== Directions ====
function startNav(){
  if (!currentMarker || !destinationMarker) { showError("現在地または目的地が未設定です。"); return; }
  const origin = currentMarker.position;
  const dest   = destinationMarker.getPosition();
  setStatus("経路計算中…");
  const url = new URL(DIRECTIONS_ENDPOINT);
  url.searchParams.set("origin", `${origin.lat},${origin.lng}`);
  url.searchParams.set("destination", `${dest.lat()},${dest.lng()}`);
  url.searchParams.set("mode", "walking");
  url.searchParams.set("language", "ja");
  url.searchParams.set("region", "JP");

  fetch(url.toString(), { headers: { "X-Run-Id": RUN_ID } })
    .then(r=>r.json())
    .then(j=>{
      if (j.status !== "OK") { showError("経路を取得できません。"); trace("error","route","status", j); return; }
      directionsRenderer.setDirections(j);
      isNavigating = true;
      setStatus("案内中");
      trace("info","route","ok");
    })
    .catch(e=>{ showError("経路エラー"); trace("error","route","exception",{msg:e.message}); });
}

function stopNav(){
  directionsRenderer.setDirections({ routes: [] });
  isNavigating = false;
  setStatus("案内を停止しました。");
  trace("info","route","stop");
}

function reroute(manual){
  if (!isNavigating) { if (manual) showError("案内が開始されていません。"); return; }
  startNav();
}

// ==== Voice (placeholder, non-blocking) ====
function startVoice(){
  try{
    const r = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
    r.lang = "ja-JP";
    r.onresult = (e)=>{
      const t = e.results[0][0].transcript || "";
      const box = qs("#searchBox"); if (box) box.value = t;
      doSearch();
    };
    r.onerror = ()=>{};
    r.start();
  } catch {}
}