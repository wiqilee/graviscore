/* GraviScore — Worker/DOM shim for GitHub Pages
   © 2025 @wiqile | AGPL-3.0-or-later

   Fungsi:
   1) Overlay error (biar kelihatan kalau crash).
   2) Pastikan ada <canvas>, dan alias selector #canvas / #scene / canvas -> kanvas itu.
   3) Patch window.Worker agar path relatif aman di subfolder (/graviscore/).
*/

// ---------- Error overlay ----------
(function () {
    function overlay(msg) {
      try {
        const el = document.createElement("div");
        el.style.cssText =
          "position:fixed;bottom:12px;left:12px;max-width:560px;background:#260b0b;color:#ffd0d0;padding:12px 14px;border:1px solid #6b1c1c;border-radius:10px;font:13px/1.4 system-ui;z-index:99999;white-space:pre-wrap";
        el.textContent = msg;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 12000);
      } catch { /* ignore */ }
    }
    window.addEventListener("error", (e) =>
      overlay("[Error] " + (e.error?.stack || e.message))
    );
    window.addEventListener("unhandledrejection", (e) =>
      overlay("[Promise] " + (e.reason?.stack || e.reason))
    );
  })();
  
  // ---------- DOM alias: #scene / #canvas / canvas ----------
  (function () {
    function ensureCanvas() {
      let c =
        document.getElementById("canvas") ||
        document.getElementById("scene") ||
        document.querySelector("canvas");
  
      if (!c) {
        c = document.createElement("canvas");
        c.id = "canvas";
        document.body.prepend(c);
      }
  
      // Simpan referensi asli
      const _get = document.getElementById.bind(document);
      const _qs  = document.querySelector.bind(document);
      const _qsa = document.querySelectorAll.bind(document);
  
      // Alias id
      document.getElementById = function (id) {
        if (id === "canvas" || id === "scene") return c;
        return _get(id);
      };
  
      // Alias querySelector
      document.querySelector = function (sel) {
        if (sel === "#canvas" || sel === "#scene" || sel === "canvas") return c;
        return _qs(sel);
      };
  
      // Alias querySelectorAll (kasus langka)
      document.querySelectorAll = function (sel) {
        if (sel === "#canvas" || sel === "#scene" || sel === "canvas") return [c];
        return _qsa(sel);
      };
  
      // Pastikan kontainer UI ada
      if (!_get("ui-root")) {
        const ui = document.createElement("div");
        ui.id = "ui-root";
        document.body.appendChild(ui);
      }
    }
  
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", ensureCanvas, { once: true });
    } else {
      ensureCanvas();
    }
  })();
  
  // ---------- Worker path patch ----------
  (function () {
    const NativeWorker = window.Worker;
    if (!NativeWorker || NativeWorker.__graviscore_patched) return;
  
    class PatchedWorker extends NativeWorker {
      constructor(specifier, options) {
        try {
          if (typeof specifier === "string") {
            const url = new URL(specifier, document.baseURI);
            return super(url, options);
          }
          return super(specifier, options);
        } catch (err) {
          console.warn("[Worker patch] Module worker failed, trying classic fallback:", err);
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
            return new NativeWorker(blobUrl); // classic worker
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
  