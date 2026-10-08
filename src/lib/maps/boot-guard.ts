/**
 * Inline startup guard. It has to live in the HTML itself: if the module
 * bundle 404s or throws while parsing, this file's imports never run.
 * Keep the script free of template placeholders and `</script>`.
 */
export const BOOT_GUARD_SOURCE = `(function () {
  var KEY = "horsham-boot-recover";
  function isAppAsset(url) {
    try {
      var u = new URL(url, location.href);
      return u.origin === location.origin && u.pathname.indexOf("/assets/") === 0;
    } catch (e) {
      return false;
    }
  }
  function recovered() {
    try { return sessionStorage.getItem(KEY) === "1"; } catch (e) { return false; }
  }
  function show(message) {
    if (document.getElementById("boot-fallback")) return;
    var el = document.createElement("div");
    el.id = "boot-fallback";
    el.setAttribute("role", "alert");
    el.style.cssText = "position:fixed;inset:0;z-index:2147483646;background:#fff;color:#202124;font:16px/1.45 system-ui,sans-serif;padding:28px 20px;box-sizing:border-box";
    el.innerHTML = '<div style="max-width:28rem;margin:10vh auto 0"><h1 style="font-size:1.35rem;margin:0 0 .5rem">Horsham Maps did not start</h1><p id="boot-fallback-msg" style="margin:0 0 1rem"></p><button type="button" id="boot-fallback-btn" style="height:3rem;padding:0 1rem;border:0;border-radius:8px;background:#1a73e8;color:#fff;font-weight:700">Reload a fresh copy</button></div>';
    var msg = el.querySelector("#boot-fallback-msg");
    if (msg) msg.textContent = message;
    var btn = el.querySelector("#boot-fallback-btn");
    if (btn) btn.addEventListener("click", recover);
    (document.body || document.documentElement).appendChild(el);
  }
  var leaving = false;
  function recover() {
    if (leaving) return;
    leaving = true;
    try { sessionStorage.setItem(KEY, "1"); } catch (e) {}
    var finished = false;
    function finish() {
      if (finished) return;
      finished = true;
      location.replace("/");
    }
    var jobs = [];
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage("CLEAR_CACHES");
      }
    } catch (e) {}
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      jobs.push(navigator.serviceWorker.getRegistrations().then(function (regs) {
        return Promise.all(regs.map(function (reg) { return reg.unregister(); }));
      }).catch(function () {}));
    }
    if (window.caches && window.caches.keys) {
      jobs.push(window.caches.keys().then(function (keys) {
        return Promise.all(keys.map(function (key) { return window.caches.delete(key); }));
      }).catch(function () {}));
    }
    window.setTimeout(finish, 2500);
    if (!jobs.length) finish();
    else Promise.all(jobs).then(finish, finish);
  }
  function onResourceError(target) {
    if (!target || target === window) return;
    var tag = String(target.tagName || "").toUpperCase();
    if (tag !== "SCRIPT" && tag !== "LINK") return;
    var url = target.src || target.href || "";
    if (!isAppAsset(url)) return;
    if (!recovered()) recover();
    else show("A saved file failed to load, and reloading a fresh copy did not fix it. Check the connection, then try again.");
  }
  window.addEventListener("error", function (event) {
    onResourceError(event && event.target);
  }, true);
  window.addEventListener("vite:preloadError", function (event) {
    if (event && event.preventDefault) event.preventDefault();
    if (!recovered()) recover();
    else show("This saved copy of Horsham Maps is out of date.");
  });
  window.addEventListener("load", function () {
    window.setTimeout(function () {
      if (document.querySelector("[data-app-shell],[data-boot-error]")) return;
      if (document.getElementById("boot-fallback")) return;
      show("Horsham Maps did not finish opening.");
    }, 4000);
  });
  try {
    if (location.search.indexOf("sw=1") !== -1 && history.replaceState) {
      history.replaceState(null, "", location.pathname + location.hash);
    }
  } catch (e) {}
  var guard = { isAppAsset: isAppAsset, recover: recover, show: show, onResourceError: onResourceError };
  try { globalThis.__horshamBootGuard = guard; } catch (e) {}
})();`;

export function recoverOrReload(): void {
  const guard = (globalThis as { __horshamBootGuard?: { recover?: () => void } }).__horshamBootGuard;
  if (guard?.recover) {
    guard.recover();
    return;
  }
  location.reload();
}
