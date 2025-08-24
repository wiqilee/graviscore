// leaderboard.js (ES Module) — GraviScore Dual Backend
// Author: @wiqile • 2025 • AGPL-3.0-or-later
// Default backend: Google Sheets (free). Firebase optional.

// ✅ Your live Apps Script Web App URL (must end with /exec)
const SHEETS_ENDPOINT =
  "https://script.google.com/macros/s/AKfycbxm1N12C0ylPwWqcINI9N0gUXXYPa97ap-EpTjZhO5s7wlXjfVKeFLjG3OhV3NYj-Ac/exec";

// Optional: fill to enable Firebase backend from the dropdown.
const FIREBASE_CONFIG = {
  apiKey:     "",
  authDomain: "",
  projectId:  "",
  appId:      ""
  // storageBucket: "", messagingSenderId: "" // optional
};

/* ───────────────────────── Utilities ───────────────────────── */
function httpJson(url, opts = {}, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, { headers: { "Content-Type": "application/json" }, signal: ctrl.signal, ...opts })
    .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .finally(() => clearTimeout(to));
}

// JSONP helper for GET when CORS blocks normal fetch.
function jsonp(url, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const cb = "__gs_cb_" + Math.random().toString(36).slice(2);
    const s = document.createElement("script");
    const timer = setTimeout(() => { cleanup(); reject(new Error("JSONP timeout")); }, timeout);
    function cleanup() { delete window[cb]; s.remove(); clearTimeout(timer); }
    window[cb] = (data) => { cleanup(); resolve(data); };
    s.onerror = () => { cleanup(); reject(new Error("JSONP load error")); };
    s.src = url + (url.includes("?") ? "&" : "?") + "callback=" + cb;
    document.head.appendChild(s);
  });
}

/* ───────────────────── Sheets Adapter (CORS-safe) ───────────────────── */
const Sheets = {
  async submit({ seed, score, planets, uid, name, when }) {
    if (!SHEETS_ENDPOINT) return;
    try {
      const payload = JSON.stringify({ action: "submit", seed, score, planets, uid, name, when });

      // Prefer sendBeacon: fire-and-forget, no preflight, survives tab close.
      if (navigator.sendBeacon) {
        const blob = new Blob([payload], { type: "text/plain" });
        navigator.sendBeacon(SHEETS_ENDPOINT, blob);
        return;
      }

      // Fallback: fetch with mode no-cors + text/plain (also avoids preflight).
      await fetch(SHEETS_ENDPOINT, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain" },
        body: payload
      });
    } catch (e) {
      console.warn("[Sheets] submit failed:", e);
    }
  },

  async fetchTop(seed, limit = 10) {
    if (!SHEETS_ENDPOINT) return [];
    const url = `${SHEETS_ENDPOINT}?action=top&seed=${encodeURIComponent(seed)}&limit=${limit}`;
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      console.warn("[Sheets] fetchTop CORS — fallback to JSONP:", e);
      return await jsonp(url);
    }
  }
};

/* ───────────────────────── Firebase Adapter ───────────────────────── */
let firebaseReady = null;
function firebaseConfigValid(cfg) { return !!(cfg && cfg.apiKey && cfg.projectId && cfg.appId); }

async function ensureFirebase() {
  if (firebaseReady) return firebaseReady;
  if (!firebaseConfigValid(FIREBASE_CONFIG)) throw new Error("Firebase config is empty.");
  firebaseReady = (async () => {
    const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
    const {
      getFirestore, doc, setDoc, getDocs, query, collection, where, orderBy, limit
    } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");

    const app = initializeApp(FIREBASE_CONFIG);
    const db  = getFirestore(app);

    async function submit({ seed, score, planets, uid, name, when }) {
      const id = `${seed}__${uid}`; // best-per-(seed,uid)
      await setDoc(
        doc(db, "scores", id),
        { seed, score, planets: planets || 0, uid, name: name || null, when: when || Date.now() },
        { merge: true }
      );
    }

    async function fetchTop(seed, lim = 10) {
      const q = query(collection(db, "scores"), where("seed", "==", seed), orderBy("score", "desc"), limit(lim));
      const snap = await getDocs(q);
      return snap.docs.map(d => d.data());
    }

    return { submit, fetchTop };
  })();
  return firebaseReady;
}

const Firebase = {
  async submit(payload) {
    try { const api = await ensureFirebase(); return api.submit(payload); }
    catch (e) { console.warn("[Firebase] submit failed — falling back to Sheets:", e); return Sheets.submit(payload); }
  },
  async fetchTop(seed, limit = 10) {
    try { const api = await ensureFirebase(); return api.fetchTop(seed, limit); }
    catch (e) { console.warn("[Firebase] fetchTop failed — falling back to Sheets:", e); return Sheets.fetchTop(seed, limit); }
  }
};

/* ───────────────────── Adapter Switch & Public API ───────────────────── */
let api = Sheets;

function selectBackend(name) {
  const wanted = (name === "firebase" ? "firebase" : "sheets");
  api = (wanted === "firebase" && firebaseConfigValid(FIREBASE_CONFIG)) ? Firebase : Sheets;
  return { submit: api.submit, fetchTop: api.fetchTop };
}

window.Leaderboard = {
  selectBackend,
  submit: (...args) => api.submit(...args),
  fetchTop: (...args) => api.fetchTop(...args)
};

console.log("[Leaderboard] module loaded:", !!window.Leaderboard);

// Initialize to saved preference (or Sheets)
try {
  const pref = localStorage.getItem("gravi_backend") || "sheets";
  selectBackend(pref);
} catch { /* ignore */ }
