// Node 22+ ships an experimental global `localStorage` that throws/warns
// without a `--localstorage-file` flag, and it shadows jsdom's own Storage
// implementation on `window` in this Vitest/jsdom/Node combination. Replace
// it with a plain in-memory Storage polyfill sufficient for the app's own
// sessionStore (getItem/setItem/removeItem) before any test runs.
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length() {
    return this.store.size;
  }
  clear() {
    this.store.clear();
  }
  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  key(index: number) {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
  setItem(key: string, value: string) {
    this.store.set(key, value);
  }
}

const memoryStorage = new MemoryStorage();
Object.defineProperty(globalThis, "localStorage", { value: memoryStorage, configurable: true, writable: true });
Object.defineProperty(window, "localStorage", { value: memoryStorage, configurable: true, writable: true });

// Vitest runs with `globals: false`, so Testing Library cannot register its
// own automatic cleanup. Do it here so tests never leak DOM into each other.
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
