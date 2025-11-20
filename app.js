'use strict';

// ==========================================
// 定数定義
// ==========================================
const ISSUE_ID = 'idx20251119_fix_loc_tsurugi_v6'; // つるぎ町＆日本語化強化版 + 登録地UI改善
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

// ==========================================
// 状態管理オブジェクト
// ==========================================
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
  isEditDialogOpen: false
};

// ==========================================
// ヘルパー
// ==========================================
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

// ==========================================
// 登録地管理
// ==========================================
function loadSavedLocations() {
  try {
    const saved = localStorage.getItem(SAVED_LOCATIONS_KEY);
    appState.savedLocations = saved ? JSON.parse(saved) : [];
  } catch(e) {
    console.error('登録地の読み込みエラー:', e);
    appState.savedLocations = [];
  }
}

function saveSavedLocations() {
  try {
    localStorage.setItem(SAVED_LOCATIONS_KEY, JSON.stringify(appState.savedLocations));
    console.log('[SavedLocations] 保存完了:', appState.savedLocations.length, '件');
  } catch(e) {
    console.error('登録地の保存エラー:', e);
  }
}

function showSaveLocationDialog() {
  if (!appState.currentPos) {
    alert('現在地が取得できていません');
    return;
  }

  const address = getEl('locAddress')?.textContent || '現在地';
  const lat = appState.currentPos.lat;
  const lng = appState.currentPos.lng;

  // ダイアログを表示
  const name = prompt('登録地名を入力してください:', address);
  if (!name) return;

  // 登録
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

  // カスタムダイアログを作成
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.7);
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    touch-action: manipulation;
  `;

  const dialog = document.createElement('div');
  dialog.style.cssText = `
    background: #1e1e1e;
    border-radius: 16px;
    padding: 20px;
    max-width: 500px;
    width: 100%;
    max-height: 70vh;
    overflow-y: auto;
    color: #fff;
  `;

  const title = document.createElement('h3');
  title.textContent = '編集する登録地を選択してください:';
  title.style.cssText = 'margin: 0 0 16px 0; font-size: 18px;';
  dialog.appendChild(title);

  const list = document.createElement('div');
  list.style.cssText = 'display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px;';

  appState.savedLocations.forEach((loc, index) => {
    const item = document.createElement('div');
    item.style.cssText = `
      background: rgba(255,255,255,0.1);
      border: 1px solid rgba(255,255,255,0.2);
      border-radius: 12px;
      padding: 12px;
      cursor: pointer;
      transition: background 0.2s;
      touch-action: manipulation;
    `;
    item.innerHTML = `
      <div style="font-weight: 600; margin-bottom: 4px;">${loc.name}</div>
      <div style="font-size: 13px; opacity: 0.7;">${loc.address}</div>
    `;

    item.ontouchstart = () => item.style.background = 'rgba(255,255,255,0.2)';
    item.ontouchend = () => item.style.background = 'rgba(255,255,255,0.1)';

    item.onclick = () => {
      document.body.removeChild(overlay);
      appState.isEditDialogOpen = false;
      showEditOptionsDialog(index);
    };

    list.appendChild(item);
  });

  dialog.appendChild(list);

  const btnClose = document.createElement('button');
  btnClose.textContent = 'キャンセル';
  btnClose.style.cssText = `
    width: 100%;
    padding: 12px;
    border-radius: 12px;
    background: rgba(255,255,255,0.1);
    color: #fff;
    border: 1px solid rgba(255,255,255,0.2);
    font-size: 16px;
    cursor: pointer;
    touch-action: manipulation;
  `;
  btnClose.onclick = () => {
    document.body.removeChild(overlay);
    appState.isEditDialogOpen = false;
  };

  dialog.appendChild(btnClose);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
}

function showEditOptionsDialog(index) {
  const location = appState.savedLocations[index];

  // オプションダイアログを作成
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.7);
    z-index: 10001;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    touch-action: manipulation;
  `;

  const dialog = document.createElement('div');
  dialog.style.cssText = `
    background: #1e1e1e;
    border-radius: 16px;
    padding: 20px;
    max-width: 400px;
    width: 100%;
    color: #fff;
  `;

  const title = document.createElement('h3');
  title.textContent = `「${location.name}」`;
  title.style.cssText = 'margin: 0 0 16px 0; font-size: 18px; text-align: center;';
  dialog.appendChild(title);

  const btnContainer = document.createElement('div');
  btnContainer.style.cssText = 'display: flex; flex-direction: column; gap: 10px;';

  // 修正ボタン
  const btnEdit = document.createElement('button');
  btnEdit.textContent = '修正';
  btnEdit.style.cssText = `
    width: 100%;
    padding: 14px;
    border-radius: 12px;
    background: rgba(37,208,122,0.2);
    color: #25d07a;
    border: 1px solid #25d07a;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    touch-action: manipulation;
  `;
  btnEdit.onclick = () => {
    document.body.removeChild(overlay);
    showEditNameDialog(index);
  };

  // 削除ボタン
  const btnDelete = document.createElement('button');
  btnDelete.textContent = '削除';
  btnDelete.style.cssText = `
    width: 100%;
    padding: 14px;
    border-radius: 12px;
    background: rgba(244,63,94,0.2);
    color: #f43f5e;
    border: 1px solid #f43f5e;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    touch-action: manipulation;
  `;
  btnDelete.onclick = () => {
    document.body.removeChild(overlay);
    showDeleteConfirmDialog(index);
  };

  // キャンセルボタン
  const btnCancel = document.createElement('button');
  btnCancel.textContent = 'キャンセル';
  btnCancel.style.cssText = `
    width: 100%;
    padding: 14px;
    border-radius: 12px;
    background: rgba(255,255,255,0.1);
    color: #fff;
    border: 1px solid rgba(255,255,255,0.2);
    font-size: 16px;
    cursor: pointer;
    touch-action: manipulation;
  `;
  btnCancel.onclick = () => {
    document.body.removeChild(overlay);
  };

  btnContainer.appendChild(btnEdit);
  btnContainer.appendChild(btnDelete);
  btnContainer.appendChild(btnCancel);
  dialog.appendChild(btnContainer);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
}

function showEditNameDialog(index) {
  const location = appState.savedLocations[index];
  const newName = prompt('新しい登録地名を入力してください:', location.name);
  
  if (newName && newName !== location.name) {
    location.name = newName;
    saveSavedLocations();
    alert('更新しました');
  }
}

function showDeleteConfirmDialog(index) {
  const location = appState.savedLocations[index];

  // 削除確認ダイアログを作成
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.7);
    z-index: 10002;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    touch-action: manipulation;
  `;

  const dialog = document.createElement('div');
  dialog.style.cssText = `
    background: #1e1e1e;
    border-radius: 16px;
    padding: 20px;
    max-width: 380px;
    width: 100%;
    color: #fff;
  `;

  const title = document.createElement('h3');
  title.textContent = 'この登録ポイントを削除しますか?';
  title.style.cssText = 'margin: 0 0 12px 0; font-size: 18px; text-align: center;';
  dialog.appendChild(title);

  const locationName = document.createElement('div');
  locationName.textContent = `「${location.name}」`;
  locationName.style.cssText = 'margin-bottom: 20px; text-align: center; font-size: 16px; color: #f43f5e;';
  dialog.appendChild(locationName);

  const btnContainer = document.createElement('div');
  btnContainer.style.cssText = 'display: flex; gap: 10px;';

  // はいボタン
  const btnYes = document.createElement('button');
  btnYes.textContent = 'はい';
  btnYes.style.cssText = `
    flex: 1;
    padding: 14px;
    border-radius: 12px;
    background: rgba(244,63,94,0.3);
    color: #fff;
    border: 1px solid #f43f5e;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    touch-action: manipulation;
  `;
  btnYes.onclick = () => {
    appState.savedLocations.splice(index, 1);
    saveSavedLocations();
    document.body.removeChild(overlay);
    alert('削除しました');
  };

  // いいえボタン
  const btnNo = document.createElement('button');
  btnNo.textContent = 'いいえ';
  btnNo.style.cssText = `
    flex: 1;
    padding: 14px;
    border-radius: 12px;
    background: rgba(255,255,255,0.1);
    color: #fff;
    border: 1px solid rgba(255,255,255,0.2);
    font-size: 16px;
    cursor: pointer;
    touch-action: manipulation;
  `;
  btnNo.onclick = () => {
    document.body.removeChild(overlay);
  };

  btnContainer.appendChild(btnYes);
  btnContainer.appendChild(btnNo);
  dialog.appendChild(btnContainer);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
}

// ==========================================
// タブ切り替え（高さ完全固定版）
// ==========================================
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
  const paneSearch = getEl('tabPaneSearch');
  const paneNav = getEl('tabPaneNav');

  if (paneSearch && paneNav) {
    paneSearch.classList.toggle('active', !isNav);
    paneNav.classList.toggle('active', isNav);
  }

  const target = isNav ? 'nav' : 'search';
  document.querySelectorAll('[data-panel-tab]').forEach(btn => {
    const active = btn.dataset.panelTab === target;
    btn.classList.toggle('active', active);
  });
}

// ==========================================
// API (Worker)
// ==========================================
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
        ...(fieldMask ? { 'X-Goog-FieldMask': fieldMask } : {})
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
        'Content-Type': 'application/json',
        ...(fieldMask ? { 'X-Goog-FieldMask': fieldMask } : {})
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

// ==========================================
// 地図初期化
// ==========================================
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
    appState.mapInitialized = true;
    console.log('[WalkNav] Map initialized');
  } catch (e) {
    console.error('[WalkNav] Map initialization failed:', e);
    alert('地図の読み込みに失敗しました。APIキーの設定を確認してください。');
  }
}

// ==========================================
// マーカー
// ==========================================
function setUserMarker(lat, lng) {
  appState.currentPos = { lat, lng };
  if (!appState.map) return;

  if (!appState.userMarker) {
    const pin = document.createElement('div');
    pin.style.width = '32px';
    pin.style.height = '32px';
    pin.innerHTML = `
      <svg id="user-marker-icon" viewBox="0 0 24 24" 
           style="width: 100%; height: 100%;
                   transform: rotate(${appState.currentHeading}deg);
                   transition: transform 0.2s ease-out;
                   filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4));">
        <path d="M12 2L4.5 20.5L12 16.5L19.5 20.5L12 2Z"
              fill="#3aa0ff" stroke="#ffffff" stroke-width="2" stroke-linejoin="round" />
      </svg>`;

    try {
      appState.userMarker = new google.maps.marker.AdvancedMarkerElement({
        map: appState.map, position: { lat, lng }, content: pin, zIndex: 1000
      });
    } catch(e) {
      appState.userMarker = new google.maps.Marker({ map: appState.map, position: { lat, lng } });
    }
  } else {
    appState.userMarker.position = { lat, lng };
  }
}

function setSearchPoint(lat, lng) {
  appState.searchPoint = { lat, lng };
  if (appState.searchPointMarker) appState.searchPointMarker.map = null;

  const pin = document.createElement('div');
  pin.style.width = '30px';
  pin.style.height = '30px';
  pin.style.borderRadius = '50% 50% 50% 0';
  pin.style.background = '#ff6565';
  pin.style.border = '3px solid #fff';
  pin.style.transform = 'rotate(-45deg)';
  pin.style.boxShadow = '0 4px 8px rgba(0,0,0,.3)';

  try {
    appState.searchPointMarker = new google.maps.marker.AdvancedMarkerElement({
      map: appState.map, position: { lat, lng }, content: pin, zIndex: 999
    });
  } catch(e) {
    appState.searchPointMarker = new google.maps.Marker({ map: appState.map, position: { lat, lng } });
  }
  fetchPointAddress(lat, lng);
}

// 以降のコードは前回と同じため省略...
// (続きは次のメッセージで提供します)
