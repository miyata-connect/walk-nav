/**
 * PulsingMarkerOverlay
 *
 * Google Maps API (google.maps.OverlayView) を継承し、
 * CSSで作成した波動マーカーを地図上に表示するためのクラス。
 * (SwiftUIの PulsingMarkerView.swift の Web版)
 */
class PulsingMarkerOverlay extends google.maps.OverlayView {
    
    constructor(position, map) {
        super();
        this.position = position; // google.maps.LatLng オブジェクト
        this.containerDiv = null; // HTML要素を保持する
        
        // SF Symbolsの "location.north.fill" に相当する矢印のSVGデータ
        // （Font Awesomeの "arrow-up" をベースに調整）
        this.arrowSVG = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512">
            <path d="M214.6 41.4c-12.5-12.5-32.8-12.5-45.3 0l-160 160c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L160 141.2V448c0 17.7 14.3 32 32 32s32-14.3 32-32V141.2L329.4 246.6c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3l-160-160z"/>
        </svg>`;
        
        // このオーバーレイを地図にセットする
        this.setMap(map);
    }

    /**
     * [必須] onAdd: オーバーレイが初めて地図に追加されるときに呼ばれる
     */
    onAdd() {
        // --- 1. HTML要素を作成 ---
        
        // メインのコンテナ
        this.containerDiv = document.createElement('div');
        this.containerDiv.className = 'marker-overlay-container';

        // 波動（パルス）
        const pulseRing = document.createElement('div');
        pulseRing.className = 'pulse-ring';
        
        // 中心の矢印
        const arrowMarker = document.createElement('div');
        arrowMarker.className = 'marker-arrow';
        arrowMarker.innerHTML = this.arrowSVG; // 矢印のSVGを内部に設定

        // --- 2. 組み立て ---
        this.containerDiv.appendChild(pulseRing);
        this.containerDiv.appendChild(arrowMarker);

        // --- 3. 地図の「ペイン（層）」に追加 ---
        // 'overlayLayer' は、マーカーや図形が配置される標準の層
        const panes = this.getPanes();
        panes.overlayLayer.appendChild(this.containerDiv);
    }

    /**
     * [必須] draw: 地図が移動・ズームされるたびに呼ばれる
     * ここでHTML要素の位置を更新する
     */
    draw() {
        // 地図のProjection（投影法）を取得
        const projection = this.getProjection();
        
        // Projectionが準備できていない場合は何もしない
        if (!projection || !this.position) {
            return;
        }
        
        // 緯度経度 (this.position) を、画面上のピクセル座標 (x, y) に変換
        const xy = projection.fromLatLngToDivPixel(this.position);
        
        // HTML要素の位置をCSSで設定
        if (this.containerDiv) {
            this.containerDiv.style.left = `${xy.x}px`;
            this.containerDiv.style.top = `${xy.y}px`;
        }
    }

    /**
     * [必須] onRemove: オーバーレイが地図から削除されるときに呼ばれる
     */
    onRemove() {
        if (this.containerDiv) {
            // DOMからHTML要素を削除
            this.containerDiv.parentNode.removeChild(this.containerDiv);
            this.containerDiv = null;
        }
    }
    
    // --- 以下はYetiアプリで便利に使うためのヘルパー関数 ---
    
    /**
     * マーカーを非表示にする
     */
    hide() {
        if (this.containerDiv) {
            this.containerDiv.style.display = 'none';
        }
    }
    
    /**
     * マーカーを表示する
     */
    show() {
        if (this.containerDiv) {
            this.containerDiv.style.display = 'block';
        }
    }

    /**
     * マーカーの位置を更新する
     * @param {google.maps.LatLng} newPosition 新しい緯度経度
     */
    updatePosition(newPosition) {
        this.position = newPosition;
        this.draw(); // 位置を再描画
    }
}
