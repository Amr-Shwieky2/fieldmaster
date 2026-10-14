/**
 * jest: react-native-webview needs its native module (importing it throws).
 * This fake renders a plain View that keeps the WebView's props (so a test
 * can read `source.html` or call `onMessage`) and records the scripts the
 * app injects. Registered in jest.setup.ts.
 */
import { createElement, forwardRef, useImperativeHandle } from "react";
import { View } from "react-native";

export const webViewMock = {
  /** Every script passed to `injectJavaScript`, in order. */
  injected: [] as string[],
  reset() {
    webViewMock.injected = [];
  },
};

export const WebView = forwardRef(function WebView(props: Record<string, unknown>, ref) {
  useImperativeHandle(ref, () => ({
    injectJavaScript: (script: string) => {
      webViewMock.injected.push(script);
    },
    postMessage: () => undefined,
    reload: () => undefined,
  }));
  return createElement(View, props as object);
});

export default WebView;
