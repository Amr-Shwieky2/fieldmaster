/** One rewind may move an open clock-in back by at most 24 hours, and the entry may not end up open for more than that. */
export const DEV_REWIND_MAX_MINUTES = 24 * 60;
