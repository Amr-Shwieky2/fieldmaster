/**
 * jest: react-native-maps needs its native module (importing it throws).
 * These fakes render plain Views that keep their props, so a test can read a
 * marker's coordinate or a circle's radius, and call `onDragEnd` / `onPress`
 * (`fireEvent(marker, "dragEnd", { nativeEvent: { coordinate } })`). The
 * map's imperative `animateToRegion` is recorded. Registered in jest.setup.ts.
 */
import { createElement, forwardRef, useImperativeHandle } from "react";
import { View } from "react-native";

export const mapsMock = {
  /** Every region passed to `animateToRegion`, in order. */
  animatedTo: [] as unknown[],
  reset() {
    mapsMock.animatedTo = [];
  },
};

const MapView = forwardRef(function MapView(props: Record<string, unknown>, ref) {
  useImperativeHandle(ref, () => ({
    animateToRegion: (region: unknown) => {
      mapsMock.animatedTo.push(region);
    },
  }));
  return createElement(View, { testID: "map", ...props } as object);
});

export function Marker(props: Record<string, unknown>) {
  return createElement(View, { testID: "map-marker", ...props } as object);
}

export function Circle(props: Record<string, unknown>) {
  return createElement(View, { testID: "map-circle", ...props } as object);
}

export function Callout(props: Record<string, unknown>) {
  return createElement(View, props as object);
}

export const PROVIDER_DEFAULT = undefined;

export default MapView;
