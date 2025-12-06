
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
  // Currently mocks the check as we don't have segment attributes in the client.
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

  // 2. Comfort Scoring (Stress Score)
  // Calculates a score (0-100) where lower is better (less stress).
  // Inputs: Route object, User Profile, WBGT
  calculateStressScore: function(route, userProfile, wbgt) {
    let score = 0;

    // Base score from duration (1 minute = 1 point)
    const durationSeconds = route.legs.reduce((acc, leg) => acc + (leg.duration.value || 0), 0);
    const durationMinutes = durationSeconds / 60;
    score += durationMinutes;

    // --- Environmental Factors ---
    // High WBGT penalty
    // If WBGT > 28 (Severe Warning), increase stress significantly
    if (wbgt >= 28) {
      score *= 1.5; // 50% more stress
    } else if (wbgt >= 25) {
      score *= 1.2;
    }

    // --- User Profile Factors ---

    // 1. Luggage
    if (userProfile.luggage === 'Suitcase') {
        score *= 1.3; // Suitcases make walking harder
    } else if (userProfile.luggage === 'Light_Pack') {
        score *= 1.1;
    }

    // 2. Physical Condition
    if (userProfile.condition === 'Poor') {
        score *= 1.5; // Everything feels harder when sick/tired
    } else if (userProfile.condition === 'Excellent') {
        score *= 0.9; // Feels easier
    }

    // 3. Companion
    if (userProfile.companion === 'Elderly') {
        score *= 1.4; // Pace is slower, worry is higher
    } else if (userProfile.companion === 'Child') {
        score *= 1.2;
    }

    // --- Route Specifics (Mock) ---
    // If route has 'stairs', apply heavy penalty if Suitcase or Elderly
    const hasStairs = route.legs.some(leg =>
        leg.steps.some(step => (step.html_instructions || '').includes('階段'))
    );

    if (hasStairs) {
        if (userProfile.luggage === 'Suitcase' || userProfile.companion === 'Elderly') {
            score += 50; // Massive penalty for stairs with suitcase/elderly
        } else {
            score += 10; // Mild penalty for stairs otherwise
        }
    }

    // Cap score at 100 (conceptually, though physically it can go higher for sorting)
    return Math.round(score);
  }
};

// Export for usage in app.js (if using modules, otherwise just global)
if (typeof window !== 'undefined') {
    window.RouteEvaluator = RouteEvaluator;
}
