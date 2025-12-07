
/*
 * RouteEvaluator.js
 * MVP Logic for WalkNav route scoring.
 * Encapsulates WBGT mock, safety filter, and stress score calculation.
 */

const RouteEvaluator = {
  // Mock WBGT (Wet Bulb Globe Temperature)
  // In production, this would fetch from an external API (e.g., OpenWeatherMap, local sensors).
  fetchWBGT: async function() {
    // Return a dummy value simulating a hot summer day in Japan
    return 28.5;
  },

  // 1. Safety/Compliance Filter
  // Filters out routes that contain unsafe segments.
  filterSafeRoutes: function(routes) {
    if (!routes || routes.length === 0) return [];

    // Logic: In a real scenario, we would check route.legs[].steps[].html_instructions
    // or attributes for "stairway", "private road", etc.
    // For MVP, we pass all routes but log a warning if keywords are found.
    const safeRoutes = routes.filter(route => {
      // Mock check: if any step instruction contains '立ち入り禁止' (Keep Out), reject.
      const hasDanger = route.legs && route.legs.some(leg =>
        leg.steps && leg.steps.some(step =>
          (step.html_instructions || '').includes('立ち入り禁止') ||
          (step.html_instructions || '').includes('私有地')
        )
      );
      return !hasDanger;
    });

    return safeRoutes;
  },

  // --- Penalty Calculation Modules ---

  // Rule 1: WBGT Penalty
  // Non-linear penalty if WBGT >= 28. Doubled for Child/Elderly.
  _calculateWBGTPenalty: function(wbgt, userProfile) {
    let penaltyMultiplier = 1.0;

    if (wbgt >= 28) {
      // Base penalty: +50% stress for every degree above 28?
      // Let's use the previous logic: if >= 28, * 1.5.
      // The prompt asks for "Non-linear weight".
      // Let's model it as: factor = 1.0 + (wbgt - 25) * 0.1?
      // Simplified MVP:
      // If >= 28: Base multiplier 1.5.
      // If >= 31: Base multiplier 2.0.

      let basePenalty = 0.5; // +50%
      if (wbgt >= 31) basePenalty = 1.0; // +100%

      // Double penalty for vulnerable companions
      if (userProfile.companion === 'Child' || userProfile.companion === 'Elderly') {
        basePenalty *= 2.0;
      }

      penaltyMultiplier += basePenalty;
    } else if (wbgt >= 25) {
        // Mild penalty
        penaltyMultiplier += 0.2;
    }

    return penaltyMultiplier;
  },

  // Rule 2: Slope Penalty (Stub)
  // If Suitcase or Poor condition, apply fixed high penalty for slopes >= 5 deg.
  _calculateSlopePenalty: function(route, userProfile) {
    let penaltyScore = 0;

    const isVulnerable = (userProfile.luggage === 'Suitcase' || userProfile.condition === 'Poor');

    if (isVulnerable) {
        // Mock check: look for "slope" or "hill" or "stairs" in instructions
        const hasSlope = route.legs && route.legs.some(leg =>
            leg.steps && leg.steps.some(step =>
                (step.html_instructions || '').includes('坂') || // Slope/Hill
                (step.html_instructions || '').includes('階段')  // Stairs
            )
        );

        if (hasSlope) {
            penaltyScore += 50; // Fixed high penalty
        }
    }

    return penaltyScore;
  },

  // Rule 3: Safety/Lighting Penalty (Stub)
  // If Night (>= 18:00), penalize low lighting.
  _calculateSafetyPenalty: function(route) {
    let penaltyScore = 0;
    const currentHour = new Date().getHours();

    if (currentHour >= 18 || currentHour < 5) {
        // Mock: assume all routes have "average" lighting, but if instruction mentions "alley" (路地), penalize.
        const isDark = route.legs && route.legs.some(leg =>
            leg.steps && leg.steps.some(step =>
                (step.html_instructions || '').includes('路地') ||
                (step.html_instructions || '').includes('裏道')
            )
        );

        if (isDark) {
            penaltyScore += 20;
        }
    }

    return penaltyScore;
  },

  // Main Scoring Function
  calculateStressScore: function(route, userProfile, wbgt) {
    // 1. Base Score (Duration in minutes)
    const durationSeconds = route.legs.reduce((acc, leg) => acc + (leg.duration.value || 0), 0);
    let score = durationSeconds / 60;

    // 2. Apply WBGT Multiplier
    const wbgtMultiplier = this._calculateWBGTPenalty(wbgt, userProfile);
    score *= wbgtMultiplier;

    // 3. Add Slope Penalty
    score += this._calculateSlopePenalty(route, userProfile);

    // 4. Add Safety Penalty
    score += this._calculateSafetyPenalty(route);

    // 5. General Profile Factors (Legacy logic, simplified)
    if (userProfile.luggage === 'Suitcase') score *= 1.1;
    if (userProfile.condition === 'Poor') score *= 1.2;

    return Math.round(score);
  }
};

// Export for usage in app.js
if (typeof window !== 'undefined') {
    window.RouteEvaluator = RouteEvaluator;
}
