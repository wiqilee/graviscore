/* GraviScore — Worker/DOM shim for GitHub Pages
   © 2025 @wiqile | AGPL-3.0-or-later
   Tujuan:
   1) Overlay error agar crash terlihat.
   2) Pastikan selalu ada <canvas id="canvas">, dan alias selector #scene → kanvas ini.
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
  
  // ---------- DOM: pastikan ada canvas & alias selector ----------
  (function ensureCanvasNow() {
    // Buat kanvas kalau belum ada
    let c =
      document.getElementById("canvas") ||
      document.getElementById("scene") ||
      document.querySelector("canvas");
  
    if (!c) {
      c = document.createElement("canvas");
      c.id = "canvas";
      // pastikan <body> sudah ada; kalau belum, tunda sedikit
      const attach = () => {
        (document.body || document.documentElement).prepend(c);
      };
      if (document.body) attach();
      else document.addEventListener("DOMContentLoaded", attach, { once: true });
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
      (document.body || document.documentElement).appendChild(ui);
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
  