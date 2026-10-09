import type { ReactNode } from "react";
import { View } from "react-native";

/**
 * Web: react-native-web ignores I18nManager. A root View with dir="rtl" and
 * lang="ar" sets its locale context, so marginStart/paddingEnd/start/end
 * resolve to the right side, and emits dir="rtl" on the root element so
 * flex rows run right-to-left. public/index.html also sets <html dir="rtl">
 * for the first paint and for portals.
 */
export function RtlRoot({ children }: { children: ReactNode }) {
  return (
    // eslint-disable-next-line i18next/no-literal-string -- HTML dir/lang attribute values, not UI text
    <View {...({ dir: "rtl", lang: "ar" } as object)} style={{ flex: 1 }}>
      {children}
    </View>
  );
}
