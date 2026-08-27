const store = new Map();
const localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => {
    store.set(String(k), String(v));
  },
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};
const fakeDocument = {
  hidden: false,
  querySelector: () => null,
  addEventListener() {},
  removeEventListener() {},
};
const fakeNavigator = {
  geolocation: undefined,
  wakeLock: undefined,
  standalone: true,
  permissions: { query: async () => ({ state: "granted" }) },
  serviceWorker: undefined,
};
function def(obj, key, value) {
  try {
    Object.defineProperty(obj, key, { configurable: true, writable: true, value });
  } catch {
    try {
      obj[key] = value;
    } catch {
      /* native getter */
    }
  }
}
def(globalThis, "localStorage", localStorage);
def(globalThis, "document", fakeDocument);
def(globalThis, "window", globalThis);
if (!globalThis.location) def(globalThis, "location", { origin: "http://127.0.0.1:8080" });
try {
  globalThis.window.localStorage = localStorage;
  globalThis.window.document = fakeDocument;
  globalThis.window.self = globalThis.window;
  globalThis.window.top = globalThis.window;
  globalThis.window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  globalThis.window.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 16);
  globalThis.window.cancelAnimationFrame = (id) => clearTimeout(id);
} catch {
  /* ok */
}
export { store, fakeNavigator };
