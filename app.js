// [app.js の 1003行目あたりを修正]

// ==========================================
// 天気予報取得（OpenWeather API に修正）
// ==========================================

// [修正] OpenWeather の "main" テキストから絵文字に変換
function iconFromWeatherType(type) {
  const t = (type || '').toUpperCase();
  if (t.includes('THUNDER')) return '⛈️';
  if (t.includes('RAIN') || t.includes('DRIZZLE')) return '🌧️';
  if (t.includes('SNOW') || t.includes('SLEET')) return '❄️';
  if (t.includes('FOG') || t.includes('MIST') || t.includes('HAZE')) return '🌫️';
  if (t.includes('CLOUDS')) return '☁️'; // 曇り
  if (t.includes('CLEAR')) return '☀️'; // 晴れ
  return '☀️'; // デフォルト
}

async function fetchWeather(lat, lng) {
  // [修正] ログメッセージを変更
  console.log('[Weather] Fetching OpenWeather (via Worker)...');
  try {
    
    // [追加] POSTメソッド用の body
    const payload = {
      lat: lat,
      lon: lng, // 経度 'lon'
      units: 'metric'
    };

    // [修正] エンドポイントを /weather に、メソッドを POST に変更
    const response = await fetchWithRetry(`${WORKER_ORIGIN}/weather`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Weather fetch failed (${response.status}): ${errText}`);
    }
    const data = await response.json();

    // [修正] OpenWeather (onecall) の "hourly" 予報をパース
    // data.hourly[2] = 3時間後 (0=今, 1=1h, 2=2h ... ではなく、予報の3番目のインデックス)
    // OpenWeather APIは 0 が 1時間後、1 が 2時間後のため、
    // 3時間後はインデックス 2
    // 6時間後はインデックス 5
    // 9時間後はインデックス 8
    
    const fh = Array.isArray(data.hourly) ? data.hourly : [];
    const icon3 = (fh[2] && fh[2].weather[0]) ? iconFromWeatherType(fh[2].weather[0].main) : null;
    const icon6 = (fh[5] && fh[5].weather[0]) ? iconFromWeatherType(fh[5].weather[0].main) : null;
    const icon9 = (fh[8] && fh[8].weather[0]) ? iconFromWeatherType(fh[8].weather[0].main) : null;
    
    document.getElementById('weather3h').textContent = icon3 || '—';
    document.getElementById('weather6h').textContent = icon6 || '—';
    document.getElementById('weather9h').textContent = icon9 || '—';
    
  } catch (error) {
    console.error('[Weather] Error:', error);
    document.getElementById('weather3h').textContent = 'X';
    document.getElementById('weather6h').textContent = 'X';
    document.getElementById('weather9h').textContent = 'X';
  }
}
