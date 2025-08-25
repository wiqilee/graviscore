/* GraviScore — Worker path fix + error overlay
   © 2025 @wiqile | AGPL-3.0-or-later
   Purpose:
   - Make `new Worker("worker.js", {type:"module"})` safe on GitHub Pages subfolders.
   - Provide a visible overlay when JS crashes (helps debugging on Pages).
*/

// ---------------- Error overlay (dev helper) ----------------
(function () {
    function overlay(msg) {
      try {
        const el = document.createElement("div");
        el.style.cssText =
          "position:fixed;bottom:12px;left:12px;max-width:560px;background:#260b0b;color:#ffd0d0;padding:12px 14px;border:1px solid #6b1c1c;border-radius:10px;font:13px/1.4 system-ui;z-index:99999;white-space:pre-wrap";
        el.textContent = msg;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 12000);
      } catch {/* ignore */}
    }
    window.addEventListener("error", (e) => {
      overlay("[Error] " + (e.error?.stack || e.message));
    });
    window.addEventListener("unhandledrejection", (e) => {
      overlay("[Promise] " + (e.reason?.stack || e.reason));
    });
  })();
  
  // ---------------- Worker path patch ----------------
  (function () {
    const NativeWorker = window.Worker;
    if (!NativeWorker) return;
  
    // Only patch once
    if (NativeWorker.__graviscore_patched) return;
  
    class PatchedWorker extends NativeWorker {
      constructor(specifier, options) {
        // If `specifier` is a string (e.g., "worker.js"), resolve it against the page URL,
        // so /graviscore/worker.js loads correctly on GitHub Pages.
        try {
          if (typeof specifier === "string") {
            const url = new URL(specifier, document.baseURI);
            return super(url, options);
          }
          // If it's already a URL (e.g., new URL("./worker.js", import.meta.url)), pass through.
          return super(specifier, options);
        } catch (err) {
          console.warn("[Worker patch] Module worker failed, trying classic fallback:", err);
          // Fallback: classic worker via Blob + importScripts
          try {
            const href =
              typeof specifier === "string"
                ? new URL(specifier, document.baseURI).href
                : specifier instanceof URL
                ? specifier.href
                : String(specifier);
            const blob = new Blob([`importScripts(${JSON.stringify(href)});`], {
              type: "application/javascript",
            });
            const blobUrl = URL.createObjectURL(blob);
            return new NativeWorker(blobUrl); // classic worker (no {type:"module"})
          } catch (err2) {
            console.error("[Worker patch] Fallback failed:", err2);
            throw err;
          }
        }
      }
    }
  
    PatchedWorker.__graviscore_patched = true;
    window.Worker = PatchedWorker;
  })();
  