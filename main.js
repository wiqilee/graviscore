/* GraviScore — Main (full UI)
   © 2025 @wiqile | Code: AGPL-3.0-or-later | Assets: CC BY-NC 4.0
   Visible credit required in UI: “GraviScore — by @wiqile”
*/

// ================= Worker dulu (hindari “before initialization”) =================
let worker = null;
let workerReady = false;

// ================= Canvas =================
const canvas = document.getElementById("canvas") || document.querySelector("canvas");
if (!canvas) throw new Error("Canvas element not found");
const ctx = canvas.getContext("2d", { alpha: false });

// ================= State global =================
let G = 2300;
let ultraPhysics = true;
let wallsBounce = true;
let useTimeDilation = true;
let trailsEnabled = true;
let audioEnabled = false;

let running = false;
let planets = []; // {x,y,mass,r}
let level = { notes: [], goal: { x: 0, y: 0, r: 16 } };
let puck = { x: 0, y: 0, vx: 0, vy: 0, r: 7 };
let simTime = 0;
let nextNoteIndex = 0;

const TRAIL_MAX = 160;
const trail = [];

let lastRemoved = null;
let editMode = false; // drag notes/goal ketika true
let drag = null;      // {type:'note'|'goal', index?, dx,dy}

const uid =
  localStorage.getItem("gravi_uid") ||
  (localStorage.setItem("gravi_uid", crypto.randomUUID()), localStorage.getItem("gravi_uid"));
let playerName = localStorage.getItem("gravi_name") || "";
let seed = "level:0";
let daily = false;

let audioCtx = null;

// ================= Utils =================
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const DPR = () => Math.min(window.devicePixelRatio || 1, 2);

function rescaleCanvas() {
  const dpr = DPR();
  canvas.width = Math.max(1, Math.floor(window.innerWidth * dpr));
  canvas.height = Math.max(1, Math.floor(window.innerHeight * dpr));
  canvas.style.width = "100vw";
  canvas.style.height = "100vh";
}

function toWorld(ev) {
  const r = canvas.getBoundingClientRect();
  const dpr = DPR();
  return { x: (ev.clientX - r.left) * dpr, y: (ev.clientY - r.top) * dpr };
}

function b64u(s) {
  return btoa(unescape(encodeURIComponent(s)))
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}
function ub64u(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return decodeURIComponent(escape(atob(s)));
}
function todaySeed() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `daily:${y}-${m}-${dd}`;
}

// ================= Level (starter + share) =================
function starterLevel() {
  const W = canvas.width, H = canvas.height;
  const cx = W * 0.55, cy = H * 0.5, r = Math.min(W, H) * 0.20;
  level = {
    notes: [
      { x: cx - r,     y: cy,       r: 10 },
      { x: cx - r*0.2, y: cy - r*.9, r: 10 },
      { x: cx + r*0.45,y: cy - r*.5, r: 10 },
      { x: cx + r*.80, y: cy + r*.2, r: 10 },
    ],
    goal: { x: cx + r*1.2, y: cy + r*0.5, r: 16 },
  };
}

function applyShareParam() {
  const url = new URL(location.href);
  const g = url.hash.startsWith("#g=") ? url.hash.slice(3) : url.searchParams.get("g");
  if (!g) { starterLevel(); return; }
  try {
    const obj = JSON.parse(ub64u(g));
    if (obj.level) level = obj.level;
    if (Array.isArray(obj.planets)) planets = obj.planets;
    if (obj.opts) {
      ({ G = G, ultraPhysics = ultraPhysics, wallsBounce = wallsBounce, useTimeDilation = useTimeDilation } = obj.opts);
    }
  } catch {
    starterLevel();
  }
}

function packShare() {
  return { level, planets, opts: { G, ultraPhysics, wallsBounce, useTimeDilation } };
}
function updateShareURL() {
  const packed = b64u(JSON.stringify(packShare()));
  history.replaceState(null, "", "#g=" + packed);
}

// ================= Worker =================
function initWorker() {
  try {
    worker = new Worker("./worker.js", { type: "module" });
  } catch {
    worker = new Worker("./worker.js");
  }
  worker.onmessage = (e) => {
    const msg = e.data;
    if (msg.type === "state") {
      if (msg.puck) puck = msg.puck;
      running = !!msg.running;
      simTime = msg.t ?? simTime;
      nextNoteIndex = msg.nextNoteIndex ?? nextNoteIndex;
    } else if (msg.type === "event") {
      if (msg.name === "goal") { running = false; onGoal(msg.data?.score ?? 0); }
      if (msg.name === "crash" || msg.name === "oob") { running = false; }
    }
  };
  worker.postMessage({
    type: "init",
    opts: { W: canvas.width, H: canvas.height, G, ultraPhysics, wallsBounce, useTimeDilation },
    planets, level,
  });
  workerReady = true;
}
function syncLevelToWorker() { if (workerReady) worker.postMessage({ type: "updateLevel", level }); }
function syncPlanetsToWorker() { if (workerReady) worker.postMessage({ type: "updatePlanets", planets }); }
function setRunning(flag) { if (workerReady) worker.postMessage({ type: "setRunning", running: !!flag }); }
function resetSim() { if (workerReady) worker.postMessage({ type: "reset" }); running = false; trail.length = 0; }

// ================= Drawing =================
function drawGrid() {
  const W = canvas.width, H = canvas.height, step = 40 * DPR();
  ctx.fillStyle = "#0b1016"; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(255,255,255,0.05)"; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = (W % step); x < W; x += step) { ctx.moveTo(x + .5, 0); ctx.lineTo(x + .5, H); }
  for (let y = (H % step); y < H; y += step) { ctx.moveTo(0, y + .5); ctx.lineTo(W, y + .5); }
  ctx.stroke();
}

function drawPlanets() {
  for (const p of planets) {
    ctx.strokeStyle = "rgba(180,170,255,0.15)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 1.4, 0, Math.PI * 2); ctx.stroke();
    const g = ctx.createRadialGradient(p.x - p.r * .4, p.y - p.r * .4, 2, p.x, p.y, p.r);
    g.addColorStop(0, "#a88cff"); g.addColorStop(1, "#5d42b9");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
  }
}

function drawLevel() {
  level.notes.forEach((n, i) => {
    const on = i < nextNoteIndex;
    ctx.fillStyle = on ? "#68ffc0" : "#91f0ff";
    ctx.globalAlpha = on ? 0.55 : 0.9;
    ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  });
  ctx.strokeStyle = "#7cf9a0"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(level.goal.x, level.goal.y, level.goal.r, 0, Math.PI * 2); ctx.stroke();
}

function drawPuckTrail() {
  if (trailsEnabled && trail.length > 1) {
    ctx.strokeStyle = "rgba(120,180,255,0.35)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(trail[0].x, trail[0].y);
    for (let i = 1; i < trail.length; i++) ctx.lineTo(trail[i].x, trail[i].y);
    ctx.stroke();
  }
  const r = puck.r;
  const g = ctx.createRadialGradient(puck.x - r * .4, puck.y - r * .4, 2, puck.x, puck.y, r);
  g.addColorStop(0, "#ffe7a8"); g.addColorStop(1, "#c48a2d");
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(puck.x, puck.y, r, 0, Math.PI * 2); ctx.fill();
}

// ================= UI lengkap =================
function setupUI() {
  const root = document.getElementById("ui-root");
  root.innerHTML = `
    <div class="panel" id="panel">
      <div class="row">
        <button id="btnLaunch">▶ Launch</button>
        <button id="btnReset">↺ Reset</button>
        <button id="btnClear">✖ Clear Planets</button>
        <div class="right">
          <button id="btnHelp">Help</button>
          <button id="btnHide">Hide</button>
        </div>
      </div>

      <div class="row">
        <label><input type="checkbox" id="chkTrails" checked> Trails</label>
        <label><input type="checkbox" id="chkAudio"> Audio</label>
        <label><input type="checkbox" id="chkUltra" checked> Ultra Physics</label>
        <label><input type="checkbox" id="chkWalls" checked> Walls Bounce</label>
        <label><input type="checkbox" id="chkTime" checked> Time Dilation</label>
      </div>

      <div class="row">
        <span class="badge" id="badgeCounts">Planets: 0/6 &nbsp; Notes: 0/4</span>
        <span class="badge right" id="badgeTimer">Idle</span>
      </div>

      <div class="row">
        <button id="btnUndo">↑ Undo Planet</button>
        <label><input type="checkbox" id="chkEdit"> Edit Mode</label>
        <button id="btnExport">⬆ Export JSON</button>
        <button id="btnImport">⬇ Import JSON</button>
      </div>

      <div class="row">
        <label><input type="checkbox" id="chkDaily"> Daily</label>
        <button id="btnShare">🔗 Share Link</button>
        <input id="inpName" placeholder="Name (optional)" value="${playerName}">
        <button id="btnTop">🏆 Top 10</button>
        <button id="btnPing">🔈 Ping</button>
      </div>
    </div>
  `;

  // Modal Top 10 + Help
  injectModalStyles();
  createModalContainers();

  const helpBox = document.getElementById("helpBox");
  document.getElementById("btnHelp").onclick = () => helpBox.classList.toggle("hidden");
  document.getElementById("btnHelpClose").onclick = () => helpBox.classList.add("hidden");
  document.getElementById("btnHide").onclick = () => document.getElementById("panel").classList.toggle("hidden");

  // Tombol utama
  assign("#btnLaunch", () => { running = true; setRunning(true); });
  assign("#btnReset",  () => resetSim());
  assign("#btnClear",  () => { lastRemoved = null; planets = []; syncPlanetsToWorker(); updateShareURL(); updateBadges(); });

  assign("#btnUndo", () => {
    if (lastRemoved) { planets.push(lastRemoved); lastRemoved = null; syncPlanetsToWorker(); updateShareURL(); updateBadges(); }
  });

  // Toggles
  onChange("#chkTrails", v => trailsEnabled = v);
  onChange("#chkAudio",  v => audioEnabled = v);
  onChange("#chkUltra",  v => { ultraPhysics = v; if (workerReady) worker.postMessage({type:"setOptions", opts:{ultraPhysics}}); });
  onChange("#chkWalls",  v => { wallsBounce  = v; if (workerReady) worker.postMessage({type:"setOptions", opts:{wallsBounce}}); });
  onChange("#chkTime",   v => { useTimeDilation = v; if (workerReady) worker.postMessage({type:"setOptions", opts:{useTimeDilation}}); });
  onChange("#chkEdit",   v => { editMode = v; });

  // Import/Export
  assign("#btnExport", () => {
    const blob = new Blob([JSON.stringify(packShare(), null, 2)], { type: "application/json" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "graviscore-level.json" });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  });
  assign("#btnImport", () => {
    const inp = document.createElement("input"); inp.type = "file"; inp.accept = "application/json";
    inp.onchange = () => {
      const f = inp.files?.[0]; if (!f) return;
      f.text().then(t => {
        try {
          const obj = JSON.parse(t);
          if (obj.level) level = obj.level;
          if (Array.isArray(obj.planets)) planets = obj.planets;
          if (obj.opts) ({ G = G, ultraPhysics = ultraPhysics, wallsBounce = wallsBounce, useTimeDilation = useTimeDilation } = obj.opts);
          syncLevelToWorker(); syncPlanetsToWorker(); updateShareURL(); updateBadges();
        } catch { alert("Invalid JSON"); }
      });
    };
    inp.click();
  });

  // Sharing & Daily
  onChange("#chkDaily", v => { daily = v; seed = daily ? todaySeed() : "level:0"; });
  assign("#btnShare", () => { updateShareURL(); navigator.clipboard?.writeText(location.href); });

  // Name
  const nameInp = document.getElementById("inpName");
  nameInp.oninput = (e) => { playerName = e.target.value.slice(0, 24); localStorage.setItem("gravi_name", playerName); };

  // Top 10 (modal)
  assign("#btnTop", async () => {
    try {
      const api = (window.Leaderboard?.selectBackend?.("sheets")) || window.Leaderboard;
      const rows = await api.fetchTop(seed, 10);
      showTopModal(rows, seed);
    } catch {
      alert("Failed to fetch Top 10.");
    }
  });

  // Ping (test audio)
  assign("#btnPing", () => {
    if (!audioEnabled) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.001, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.2, audioCtx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.22);
      o.connect(g).connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime + 0.25);
    } catch {}
  });

  updateBadges();
}

// Helpers kecil untuk UI
function assign(sel, fn){ const el=document.querySelector(sel); if(el) el.onclick=fn; }
function onChange(sel, fn){ const el=document.querySelector(sel); if(el) el.onchange=e=>fn(!!e.target.checked); }
function updateBadges(){
  const badge = document.getElementById("badgeCounts");
  if (badge) badge.textContent = `Planets: ${planets.length}/6   Notes: ${level.notes.length}/4`;
}

// ================= Interaksi canvas (place/undo/drag) =================
canvas.addEventListener("contextmenu", e => e.preventDefault());

canvas.addEventListener("mousedown", (e) => {
  const pos = toWorld(e);

  if (editMode) {
    // drag notes / goal
    const hit = level.notes.findIndex(n => Math.hypot(n.x - pos.x, n.y - pos.y) <= n.r + 6);
    if (hit >= 0) { const n = level.notes[hit]; drag = { type: "note", index: hit, dx: pos.x - n.x, dy: pos.y - n.y }; return; }
    const dg = Math.hypot(level.goal.x - pos.x, level.goal.y - pos.y);
    if (dg <= level.goal.r + 8) { drag = { type: "goal", dx: pos.x - level.goal.x, dy: pos.y - level.goal.y }; return; }
    return; // editMode: tidak place planet
  }

  if (e.button === 2) { // right-click = remove nearest
    if (!planets.length) return;
    let bi = 0, bd = 1e12;
    for (let i = 0; i < planets.length; i++) {
      const d = (planets[i].x - pos.x) ** 2 + (planets[i].y - pos.y) ** 2;
      if (d < bd) { bd = d; bi = i; }
    }
    lastRemoved = planets.splice(bi, 1)[0] || null;
    syncPlanetsToWorker(); updateShareURL(); updateBadges();
  } else if (e.button === 0) {
    if (planets.length >= 6) return;
    planets.push({ x: pos.x, y: pos.y, r: 15, mass: 1 });
    syncPlanetsToWorker(); updateShareURL(); updateBadges();
  }
});

canvas.addEventListener("mousemove", (e) => {
  if (!drag) return;
  const pos = toWorld(e);
  if (drag.type === "note") {
    const n = level.notes[drag.index];
    n.x = pos.x - drag.dx; n.y = pos.y - drag.dy;
    syncLevelToWorker(); updateShareURL();
  } else {
    level.goal.x = pos.x - drag.dx; level.goal.y = pos.y - drag.dy;
    syncLevelToWorker(); updateShareURL();
  }
});
window.addEventListener("mouseup", () => drag = null);

// ================= Submit skor =================
async function onGoal(score) {
  try {
    const api = (window.Leaderboard?.selectBackend?.("sheets")) || window.Leaderboard;
    await api.submit({ seed, score, planets: planets.length, uid, name: playerName || null, when: Date.now() });
    showToast(`Goal! Score: ${score}`);
  } catch (e) {
    console.warn("submit failed", e);
    showToast("Submit score failed.");
  }
}

// ================= Modal Top 10 + Toast =================
function injectModalStyles(){
  if (document.getElementById("modalStyles")) return;
  const css = `
  .hidden{display:none}
  .modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:flex-start;justify-content:center;padding:48px 16px;z-index:50}
  .modal{background:#0f141c;border:1px solid #2a3442;border-radius:14px;max-width:560px;width:100%;box-shadow:0 12px 40px rgba(0,0,0,.45)}
  .modal header{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid #243042}
  .modal h3{margin:0;font:600 16px system-ui;color:#dbe9ff}
  .modal .body{padding:10px 14px;color:#cfe3ff}
  .table{width:100%;border-collapse:collapse}
  .table th,.table td{padding:8px;border-bottom:1px solid #223040;text-align:left;font:13px system-ui}
  .iconbtn{background:#1a2738;border:1px solid #2a3b53;color:#d6eaff;border-radius:8px;padding:6px 10px;cursor:pointer}
  .toast{position:fixed;left:12px;bottom:12px;background:#122033;color:#d9ecff;border:1px solid #29405a;border-radius:10px;padding:8px 12px;z-index:60}
  `;
  const style = document.createElement("style");
  style.id = "modalStyles"; style.textContent = css;
  document.head.appendChild(style);
}

function createModalContainers(){
  if(document.getElementById("topBackdrop")){
    // pastikan handler global tetap ada
    addGlobalModalHandlers();
    return;
  }
  // Help box (tetap simpel)
  if(!document.getElementById("helpBox")){
    const hb = document.createElement("div");
    hb.id="helpBox"; hb.className="hidden";
    hb.style.cssText="position:fixed;top:16px;right:16px;background:#0f141c;border:1px solid #283548;border-radius:12px;padding:12px 14px;color:#d7e7ff;z-index:40;max-width:380px";
    hb.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <strong>How to play</strong>
      <button id="btnHelpClose" class="iconbtn">✕</button>
    </div>
    <ol style="margin:0 0 6px 18px;padding:0">
      <li>Place up to six planets, then press Launch.</li>
      <li>Touch the glowing notes in order to unlock the goal.</li>
      <li>Reach the goal to finish and score.</li>
      <li>Right-click removes the nearest planet. Use <em>Edit Mode</em> to drag notes & goal.</li>
    </ol>
    <small>Tip: click <em>Ping</em> once if the browser mutes audio.</small>`;
    document.body.appendChild(hb);
  }

  // Top 10 modal
  const wrap = document.createElement("div");
  wrap.id = "topBackdrop"; wrap.className = "modal-backdrop hidden";
  wrap.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="topTitle">
      <header>
        <h3 id="topTitle">Top 10</h3>
        <button id="btnTopClose" class="iconbtn" aria-label="Close">✕</button>
      </header>
      <div class="body">
        <div id="topCaption" class="muted" style="margin-bottom:8px"></div>
        <table class="table" id="topTable"></table>
      </div>
    </div>`;
  document.body.appendChild(wrap);

  // handler close (backdrop, tombol, Esc)
  addGlobalModalHandlers();
}

function addGlobalModalHandlers(){
  const bd = document.getElementById("topBackdrop");
  if(!bd) return;
  bd.onclick = (e)=>{ if(e.target === bd) hideTopModal(); };
  const btn = document.getElementById("btnTopClose");
  if(btn) btn.onclick = hideTopModal;
  // Esc — add once
  if(!window.__graviEscBound){
    window.addEventListener("keydown", (e)=>{ if(e.key === "Escape") hideTopModal(); });
    window.__graviEscBound = true;
  }
}

function showTopModal(rows, seed){
  // pastikan container ada & rebinding tombol setiap buka
  createModalContainers();
  addGlobalModalHandlers();

  const bd = document.getElementById("topBackdrop");
  const tbl = document.getElementById("topTable");
  const cap = document.getElementById("topCaption");
  cap.textContent = `Seed: ${seed}`;
  tbl.innerHTML = `<tr><th>#</th><th>Name</th><th>Score</th><th>Planets</th></tr>` +
    (rows && rows.length ? rows : []).map((r,i)=>`<tr><td>${i+1}</td><td>${r.name||"—"}</td><td>${r.score}</td><td>${r.planets}</td></tr>`).join("");
  bd.classList.remove("hidden");
}
function hideTopModal(){ const bd=document.getElementById("topBackdrop"); if(bd) bd.classList.add("hidden"); }

function showToast(msg){
  const t=document.createElement("div"); t.className="toast"; t.textContent=msg; document.body.appendChild(t);
  setTimeout(()=>t.remove(), 1600);
}

// ================= Main loop =================
let lastTs = 0;
function loop(ts) {
  if (!lastTs) lastTs = ts;
  const dt = Math.min(0.05, (ts - lastTs) / 1000);
  lastTs = ts;

  if (running && workerReady) worker.postMessage({ type: "step", dt });

  drawGrid(); drawLevel(); drawPlanets();

  if (running) { trail.push({ x: puck.x, y: puck.y }); if (trail.length > TRAIL_MAX) trail.shift(); }
  else if (trail.length) { if (trail.length > 4) trail.shift(); }
  drawPuckTrail();

  const timer = document.getElementById("badgeTimer");
  if (timer) timer.textContent = running ? `${simTime.toFixed(2)}s` : "Idle";

  requestAnimationFrame(loop);
}

// ================= Init =================
function init() {
  rescaleCanvas();
  applyShareParam();                // load dari URL (kalau ada)
  if (!level?.notes?.length) starterLevel();
  updateShareURL();                 // simpan kembali ke URL

  setupUI();
  initWorker();
  syncLevelToWorker(); syncPlanetsToWorker();

  window.addEventListener("resize", () => {
    rescaleCanvas();
    if (workerReady) worker.postMessage({
      type: "init",
      opts: { W: canvas.width, H: canvas.height, G, ultraPhysics, wallsBounce, useTimeDilation },
      planets, level
    });
  });

  seed = daily ? todaySeed() : "level:0";
  requestAnimationFrame(loop);
}

init();
