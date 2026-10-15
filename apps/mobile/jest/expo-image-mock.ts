/**
 * jest: expo-image renders through its native module. This fake is a plain
 * View that keeps the props (`source`, `cachePolicy`), so a test can check
 * that a sensitive image is shown without any cache. Registered in jest.setup.ts.
 */
import { createElement } from "react";
import { View } from "react-native";

export function Image(props: Record<string, unknown>) {
  return createElement(View, { testID: "expo-image", ...props } as object);
}

export default Image;
