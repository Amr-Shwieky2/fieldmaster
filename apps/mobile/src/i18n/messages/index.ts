import { mergeMessages, sharedMessages } from "@fieldmaster/i18n";
import app from "./ar.json";

/**
 * The mobile app's Arabic messages: the ones shared with the admin web
 * (@fieldmaster/i18n: common, states, errors, enums, units, auth, devLogin)
 * merged with this app's own ar.json. `pnpm lint` fails if ar.json redefines
 * a shared key, so shared wording is changed in one place.
 */
const ar = mergeMessages(sharedMessages, app);

export type Messages = typeof ar;
export default ar;
