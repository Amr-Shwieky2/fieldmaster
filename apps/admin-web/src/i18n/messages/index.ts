import { mergeMessages, sharedMessages } from "@fieldmaster/i18n";
import app from "./ar.json";

/**
 * The admin web's Arabic messages: the ones shared with the mobile app
 * (@fieldmaster/i18n: common, states, errors, enums, units, auth, devLogin)
 * merged with this app's own ar.json. `pnpm lint` fails if ar.json redefines
 * a shared key.
 */
const ar = mergeMessages(sharedMessages, app);

export type Messages = typeof ar;
export default ar;
