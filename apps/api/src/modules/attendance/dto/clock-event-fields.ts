/** Step 9: movement heuristics one clock event may carry (recorded for review only, never a refusal). */
export const MAX_LOCATION_SIGNALS = 10;
export const MAX_LOCATION_SIGNAL_LENGTH = 40;
/** A signal is a code such as IMPOSSIBLE_SPEED or ZERO_ACCURACY. */
export const LOCATION_SIGNAL_PATTERN = /^[A-Z_]+$/;
