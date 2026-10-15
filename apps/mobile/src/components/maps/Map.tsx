/**
 * The native map (react-native-maps: Apple Maps on iOS, Google Maps on
 * Android; both work in Expo Go). Screens import the map from here, so the
 * web build gets `Map.web.tsx` instead (react-native-maps has no web
 * version). Mobile manager mode: the live operations map and the work
 * location editor.
 */
export { default as MapView, Marker, Circle, Callout } from "react-native-maps";
export type { Region, LatLng, MapPressEvent, MarkerDragStartEndEvent } from "react-native-maps";
