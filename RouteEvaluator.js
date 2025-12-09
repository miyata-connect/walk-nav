'use strict';

/**
 * RouteEvaluator.js
 *
 * 役割:
 *  - Google Directions API が返した複数ルート候補から
 *    「ユーザープロファイルに合ったルート」を選ぶ。
 *  - app.js からは RouteEvaluator.pickBestRoute(routes, profile, mode) を呼ぶだけ。
 *
 * 前提:
 *  - routes は Directions API の `routes` 配列そのまま。
 *  - profile = { luggage, condition, companion }
 *      luggage: "None" | "Light_Pack" | "Suitcase"
 *      condition: "Excellent" | "Normal" | "Poor"
 *      companion: "None" | "Child" | "Elderly"
 *  - mode: "normal" | "ai"
 *
 * 注意:
 *  - ルートが 1 本しか無い場合は、そのままそれを返す。
 *  - 「階段 / 坂 / 横断回数」などを、steps のテキストから簡易推定している。
 */

(function (global) {

  function safeLeg(route) {
    if (!route) return null;
    if (route.legs && route.legs.length > 0) return route.legs[0];
    return null;
  }

  function analyzeRoute(route) {
    const leg = safeLeg(route);
    if (!leg) {
      return {
        distanceMeters: Infinity,
        durationSeconds: Infinity,
        stairsCount: 0,
        slopeCount: 0,
        crossingCount: 0,
        scoreDetails: {}
      };
    }

    const distanceMeters = (leg.distance && leg.distance.value) || Infinity;
    const durationSeconds = (leg.duration && leg.duration.value) || Infinity;

    let stairsCount = 0;
    let slopeCount = 0;
    let crossingCount = 0;

    const steps = leg.steps || [];
    for (const s of steps) {
      const html = (s.html_instructions || '') + ' ' + (s.maneuver || '');
      const text = html.replace(/<[^>]+>/g, '').toLowerCase();

      if (text.match(/階段|stairs|段差/)) stairsCount++;
      if (text.match(/坂|hill|slope/)) slopeCount++;
      if (text.match(/横断|crosswalk|cross the street/)) crossingCount++;
    }

    return {
      distanceMeters,
      durationSeconds,
      stairsCount,
      slopeCount,
      crossingCount,
      scoreDetails: {}
    };
  }

  function normalizeProfile(profile) {
    const p = profile || {};
    return {
      luggage: p.luggage || 'None',
      condition: p.condition || 'Normal',
      companion: p.companion || 'None'
    };
  }

  function computeWeights(profile, mode) {
    // ベース
    let wTime = 1.0;
    let wDist = 0.1; // 10m = 1秒相当
    let wStairs = 30;
    let wSlope = 10;
    let wCross = 3;

    if (mode === 'ai') {
      // AI モードは体への負担を優先
      wTime = 1.2;
      wDist = 0.08;
    }

    // 手荷物
    if (profile.luggage === 'Light_Pack') {
      wStairs *= 1.2;
      wSlope *= 1.1;
    } else if (profile.luggage === 'Suitcase') {
      wStairs *= 3.0;
      wSlope *= 1.8;
      wCross *= 1.2;
    }

    // 体調
    if (profile.condition === 'Excellent') {
      wTime *= 0.9;
      wSlope *= 1.1;
    } else if (profile.condition === 'Poor') {
      wTime *= 1.2;
      wSlope *= 2.0;
      wStairs *= 2.0;
    }

    // 同行者
    if (profile.companion === 'Child') {
      wCross *= 1.8;     // 横断が多いルートを避ける
      wTime *= 1.1;
    } else if (profile.companion === 'Elderly') {
      wStairs *= 3.0;
      wSlope *= 2.5;
      wTime *= 1.3;
    }

    return { wTime, wDist, wStairs, wSlope, wCross };
  }

  function scoreRoute(route, profile, mode) {
    const metrics = analyzeRoute(route);
    const w = computeWeights(profile, mode);

    const stairPenalty = metrics.stairsCount * w.wStairs;
    const slopePenalty = metrics.slopeCount * w.wSlope;
    const crossPenalty = metrics.crossingCount * w.wCross;

    const baseScore =
      metrics.durationSeconds * w.wTime +
      metrics.distanceMeters * w.wDist +
      stairPenalty +
      slopePenalty +
      crossPenalty;

    const details = {
      distanceMeters: metrics.distanceMeters,
      durationSeconds: metrics.durationSeconds,
      stairsCount: metrics.stairsCount,
      slopeCount: metrics.slopeCount,
      crossingCount: metrics.crossingCount,
      weights: w,
      stairPenalty,
      slopePenalty,
      crossPenalty,
      baseScore
    };

    return { score: baseScore, details };
  }

  function describeReason(details, profile, mode) {
    if (!details) return '標準ルートを使用';

    const parts = [];

    if (mode === 'ai') {
      parts.push('AIモード: 体への負担を考慮');
    }

    if (details.stairsCount > 0) {
      parts.push(`階段: ${details.stairsCount} 箇所`);
    }
    if (details.slopeCount > 0) {
      parts.push(`坂道: ${details.slopeCount} 区間`);
    }
    if (details.crossingCount > 0) {
      parts.push(`横断: ${details.crossingCount} 回`);
    }

    if (parts.length === 0) {
      parts.push('段差の少ないルート');
    }

    const luggageLabel =
      profile.luggage === 'Suitcase' ? 'スーツケース' :
      profile.luggage === 'Light_Pack' ? '軽量荷物' : '手荷物なし';

    const condLabel =
      profile.condition === 'Poor' ? '体調: 不調' :
      profile.condition === 'Excellent' ? '体調: 良好' : '体調: 普通';

    const compLabel =
      profile.companion === 'Elderly' ? '同行者: 高齢者' :
      profile.companion === 'Child' ? '同行者: 子供' : '同行者: なし';

    return `${luggageLabel} / ${condLabel} / ${compLabel} を考慮し、${parts.join(' / ')} を優先`;
  }

  /**
   * routes: Directions API の routes 配列
   * profile: ユーザープロファイル
   * mode: "normal" | "ai"
   *
   * 戻り値:
   *  {
   *    route: 選択された route,
   *    index: その route の index,
   *    reason: 人間向け説明テキスト,
   *    debug: { 各ルートのスコア一覧 }
   *  }
   */
  function pickBestRoute(routes, profile, mode) {
    const prof = normalizeProfile(profile);
    const m = mode === 'ai' ? 'ai' : 'normal';

    if (!Array.isArray(routes) || routes.length === 0) {
      return {
        route: null,
        index: -1,
        reason: 'ルート情報なし',
        debug: {}
      };
    }

    if (routes.length === 1) {
      const s = scoreRoute(routes[0], prof, m);
      return {
        route: routes[0],
        index: 0,
        reason: describeReason(s.details, prof, m),
        debug: { scores: [s] }
      };
    }

    let bestIdx = 0;
    let bestScore = Infinity;
    const allScores = [];

    for (let i = 0; i < routes.length; i++) {
      const { score, details } = scoreRoute(routes[i], prof, m);
      allScores.push({ index: i, score, details });
      if (score < bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    const chosen = allScores.find(s => s.index === bestIdx);

    return {
      route: routes[bestIdx],
      index: bestIdx,
      reason: describeReason(chosen.details, prof, m),
      debug: { scores: allScores }
    };
  }

  const api = {
    pickBestRoute
  };

  global.RouteEvaluator = api;

})(typeof window !== 'undefined' ? window : this);
