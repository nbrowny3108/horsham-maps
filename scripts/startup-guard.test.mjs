import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const viewport = await jiti.import("../src/lib/maps/viewport.ts");
const boot = await jiti.import("../src/lib/maps/boot-guard.ts");

test("viewport: a zero measurement does not lock the page at 0px", () => {
  assert.equal(viewport.measureViewportHeight({ innerHeight: 0, clientHeight: 0, visualHeight: 0 }), 0);
  const root = { style: { height: "100%", minHeight: "", setProperty() {} } };
  const body = { style: { height: "100%", minHeight: "" } };
  viewport.applyViewportHeight({ documentElement: root, body, querySelector: () => null }, 0);
  assert.equal(root.style.height, "100%");
  assert.equal(body.style.height, "100%");
});

test("viewport: measured height is written to html, body, and the shell", () => {
  assert.equal(
    viewport.measureViewportHeight({ innerHeight: 800, clientHeight: 700, visualHeight: 956, visualOffsetTop: 0 }),
    956,
  );
  const root = { style: { height: "", minHeight: "", setProperty(name, value) { this[name] = value; } } };
  const body = { style: { height: "", minHeight: "" } };
  const shell = { style: { height: "", minHeight: "" } };
  viewport.applyViewportHeight(
    { documentElement: root, body, querySelector: (sel) => (sel === "[data-app-shell]" ? shell : null) },
    874,
  );
  assert.equal(root.style.height, "874px");
  assert.equal(body.style.minHeight, "874px");
  assert.equal(shell.style.height, "874px");
  assert.equal(root.style["--app-h"], "874px");
});

test("css: lvh does not replace the percentage height", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /height:\s*100lvh/);
  assert.doesNotMatch(css, /height:\s*var\(--app-h/);
  assert.match(css, /min-height:\s*100dvh/);
  assert.match(css, /data-app-shell/);
});

function loadWorker() {
  const listeners = {};
  const caches = new Map();
  function memoryCache() {
    const store = new Map();
    return {
      async match(req) {
        const key = typeof req === "string" ? req : req.url;
        return store.get(key);
      },
      async put(req, res) {
        const key = typeof req === "string" ? req : req.url;
        store.set(key, res);
      },
      async delete(req) {
        const key = typeof req === "string" ? req : req.url;
        store.delete(key);
      },
    };
  }
  const context = {
    self: {
      location: new URL("https://maps.example/sw.js"),
      addEventListener(type, fn) {
        (listeners[type] ||= []).push(fn);
      },
      skipWaiting() {
        return Promise.resolve();
      },
      clients: {
        claim() {
          return Promise.resolve();
        },
        matchAll() {
          return Promise.resolve([]);
        },
      },
    },
    caches: {
      async open(name) {
        if (!caches.has(name)) caches.set(name, memoryCache());
        return caches.get(name);
      },
      async keys() {
        return [...caches.keys()];
      },
      async delete(name) {
        return caches.delete(name);
      },
    },
    fetch: async () => {
      throw new Error("offline");
    },
    Response,
    Headers,
    Request,
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
    console,
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"), context);
  const api = context.self.__swTest;
  return { context, api, listeners, caches };
}

test("service worker: failed navigation resolves to a visible page, not a rejection", async () => {
  const { api } = loadWorker();
  const req = new Request("https://maps.example/", { headers: { accept: "text/html" } });
  const res = await api.handleFetch(req);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") || "", /text\/html/);
  assert.equal(res.redirected, false);
  assert.match(await res.text(), /Horsham Maps did not start/);
});

test("service worker: copyResponse strips a redirect so Safari can paint it", async () => {
  const { api } = loadWorker();
  const raw = new Response("<html><body>ok</body></html>", {
    status: 200,
    headers: { "content-type": "text/html", "content-encoding": "gzip", "content-length": "999" },
  });
  Object.defineProperty(raw, "redirected", { value: true });
  const copy = await api.copyResponse(raw);
  assert.ok(copy);
  assert.equal(copy.redirected, false);
  assert.equal(copy.headers.get("content-encoding"), null);
  assert.match(await copy.text(), /ok/);
});

test("service worker: html saved as a script is not cached", async () => {
  const { context, api } = loadWorker();
  let puts = 0;
  const realOpen = context.caches.open;
  context.caches.open = async (name) => {
    const cache = await realOpen(name);
    return {
      match: (req) => cache.match(req),
      delete: (req) => cache.delete(req),
      put: async (...args) => {
        puts += 1;
        return cache.put(...args);
      },
    };
  };
  context.fetch = async () =>
    new Response("<html>nope</html>", { status: 200, headers: { "content-type": "text/html" } });
  const res = await api.handleFetch(new Request("https://maps.example/assets/index-abc.js"));
  assert.equal(res.status, 404);
  assert.equal(puts, 0);
  assert.equal(api.isGoodAsset(new Response("var x=1", { status: 200, headers: { "content-type": "text/javascript" } }), new URL("https://maps.example/assets/index-abc.js")), true);
});

test("service worker: precache failure does not reject install", async () => {
  const { context, listeners } = loadWorker();
  context.caches.open = async () => {
    throw new Error("cache unavailable");
  };
  let waited;
  const event = {
    waitUntil(p) {
      waited = p;
    },
  };
  for (const fn of listeners.install) fn(event);
  await waited;
});

function bootSandbox() {
  const listeners = {};
  const storage = new Map();
  const elements = [];
  const sandbox = {
    listeners,
    elements,
    storage,
    URL,
    Promise,
    setTimeout,
    clearTimeout,
    location: {
      href: "https://maps.example/?sw=1",
      origin: "https://maps.example",
      pathname: "/",
      search: "?sw=1",
      hash: "",
      replace(url) {
        sandbox.replaced = url;
      },
    },
    history: {
      replaceState(_s, _t, url) {
        sandbox.historyUrl = url;
      },
    },
    navigator: { serviceWorker: undefined },
    sessionStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
    },
    document: {
      getElementById: () => null,
      querySelector: (sel) => {
        if (sel === "[data-app-shell],[data-boot-error]") return sandbox.shell || null;
        return null;
      },
      createElement() {
        return {
          id: "",
          style: {},
          setAttribute() {},
          appendChild() {},
          querySelector() {
            return { textContent: "", addEventListener() {} };
          },
        };
      },
      body: {
        appendChild(el) {
          elements.push(el);
        },
      },
      documentElement: { appendChild(el) { elements.push(el); } },
    },
  };
  sandbox.window = {
    addEventListener(type, fn) {
      (listeners[type] ||= []).push(fn);
    },
    setTimeout(fn) {
      sandbox.timers ||= [];
      sandbox.timers.push(fn);
    },
    caches: undefined,
    location: sandbox.location,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(boot.BOOT_GUARD_SOURCE, sandbox);
  return sandbox;
}

test("boot guard: same-origin asset failure recovers once, then shows a message", () => {
  const sandbox = bootSandbox();
  assert.equal(sandbox.historyUrl, "/");
  const onError = sandbox.listeners.error[0];
  onError({ target: { tagName: "IMG", src: "https://maps.example/assets/tile.png" } });
  assert.equal(sandbox.replaced, undefined);
  onError({ target: { tagName: "SCRIPT", src: "https://cdn.example/widget.js" } });
  assert.equal(sandbox.replaced, undefined);
  onError({ target: { tagName: "SCRIPT", src: "https://maps.example/assets/index-old.js" } });
  assert.equal(sandbox.replaced, "/");
  assert.equal(sandbox.storage.get("horsham-boot-recover"), "1");
  sandbox.replaced = undefined;
  sandbox.leaving = false;
  onError({ target: { tagName: "LINK", href: "https://maps.example/assets/styles-old.css" } });
  assert.equal(sandbox.elements.length, 1);
  assert.equal(sandbox.elements[0].id, "boot-fallback");
});

test("boot guard: empty document after load shows the fallback", () => {
  const sandbox = bootSandbox();
  const onLoad = sandbox.listeners.load[0];
  onLoad();
  const timer = sandbox.window && sandbox.timers[0];
  timer();
  assert.equal(sandbox.elements.length, 1);
  sandbox.elements.length = 0;
  sandbox.shell = { tagName: "DIV" };
  const sandbox2 = bootSandbox();
  sandbox2.shell = true;
  sandbox2.document.querySelector = () => ({ tagName: "DIV" });
  sandbox2.listeners.load[0]();
  sandbox2.timers[0]();
  assert.equal(sandbox2.elements.length, 0);
});
