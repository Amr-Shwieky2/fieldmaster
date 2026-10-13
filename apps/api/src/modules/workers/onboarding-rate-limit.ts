import { Throttle } from "@nestjs/throttler";

export const ONBOARDING_RATE_LIMIT_DEFAULT = 10;
export const ONBOARDING_RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * Requests per minute per IP address on each public onboarding route:
 * ONBOARDING_RATE_LIMIT (a positive integer; default 10). Read on every
 * request, so it changes without a restart.
 */
export function onboardingRateLimit(): number {
  const configured = Number(process.env.ONBOARDING_RATE_LIMIT);
  return Number.isInteger(configured) && configured > 0 ? configured : ONBOARDING_RATE_LIMIT_DEFAULT;
}

/** The rate limit of the public (no sign-in) onboarding routes, instead of the global one; over it, 429 RATE_LIMITED. */
export const OnboardingRateLimit = () => Throttle({ default: { limit: () => onboardingRateLimit(), ttl: ONBOARDING_RATE_LIMIT_WINDOW_MS } });
