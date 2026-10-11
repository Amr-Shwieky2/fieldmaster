import type { ReactNode } from "react";

/** Native: RTL comes from I18nManager (forced by app.json / expo-localization), so nothing to wrap. See RtlRoot.web.tsx. */
export function RtlRoot({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
