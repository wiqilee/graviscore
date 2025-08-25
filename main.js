/* GraviScore — Main
   © 2025 @wiqile | Code: AGPL-3.0-or-later | Assets: CC BY-NC 4.0
   Visible credit required: “GraviScore — by @wiqile”
   Notes:
   - This file assumes worker-path-fix.js is loaded first (index.html does that).
   - It talks to worker.js via messages: init / updatePlanets / updateLevel / setOptions / setRunning / reset / step.
   - Worker posts: {type:'state', puck, running, t, nextNoteIndex} and {type:'event', name:'note'|'goal'|'crash'|'oob', data?}
*/

// ------------------------------ Globals
console.log("GraviScore — by @wiqile");

const canvas =
  document.getElementById("canvas") ||
  document.getElementById("scene") ||
  document.querySelector("canvas");

if (!canvas) throw new Error("Canvas element not found.");

const ctx = canvas.getContext("2d", { alpha: false });

// Physics / options (synced to worker)
let G = 2300;
let ultraPhysics = true;
let wallsBounce = true;
let useTimeDilation = true;

// Game state
let planets = []; // {x,y,mass,r}
let level = {
  notes: [],
  goal: { x: 0, y: 0, r: 16 },
};
let running = false;
let trail = [];
const TRAIL_MAX = 160;

// Puck state (from worker)
let puck = { x: 0, y: 0, vx: 0, vy: 0, r: 7 };
let simTime = 0;
let nextNoteIndex = 0;

// Backend / identity
const uid =
  localStorage.getItem("gravi_uid") ||
  (localStorage.setItem("gravi_uid", crypto.randomUUID()), localStorage.getItem("gravi_uid"));
let playerName = localStorage.getItem("gravi_name") || "";

// Seed (for leaderboard)
let seed = "level:0";
let daily = false;

// Audio (unlock only when user clicks Ping)
let audioCtx = null;

// Worker lifecycle
let worker = null;
let workerReady = false;

// Time
let lastTs = 0;
const RAF = (fn) => requestAnimationFrame(fn);

// ------------------------------ Utils
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

function dpr() {
  return Math.min(window.devicePixelRatio || 1, 2);
}

function rescaleCanvas() {
  const DPR = dpr();
  canvas.width = Math.max(1, Math.floor(window.innerWidth * DPR));
  canvas.height = Math.max(1, Math.floor(window.innerHeight * DPR));
  canvas.style.width = "100vw";
  canvas.style.height = "100vh";
}

function toWorld(ev) {
  const rect = canvas.getBoundingClientRect();
  const DPR = dpr();
  return {
    x: (ev.clientX - rect.left) * DPR,
    y: (ev.clientY - rect.top) * DPR,
  };
}

function b64u(s) {
  return btoa(unescape(encodeURIComponent(s))).replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function ub64u(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return decodeURIComponent(escape(atob(s)));
}

// ------------------------------ Default level + URL import
function starterLevel() {
  // Simple C–E–G–C arc
  const W = canvas.width,
    H = canvas.height,
    cx = W * 0.55,
    cy = H * 0.5,
    r = Math.min(W, H) * 0.2;
  level = {
    notes: [
      { x: cx - r, y: cy, r: 10 }, // C
      { x: cx - r * 0.2, y: cy - r * 0.9, r: 10 }, // E
      { x: cx + r * 0.45, y: cy - r * 0.5, r: 10 }, // G
      { x: cx + r * 0.8, y: cy + r * 0.2, r: 10 }, // c'
    ],
    goal: { x: cx + r * 1.2, y: cy + r * 0.5, r: 16 },
  };
}

function applyShareParam() {
  const url = new URL(location.href);
  const g = url.hash.slice(3) || url.searchParams.get("g");
  if (!g) {
    starterLevel();
    return;
  }
  try {
    const obj = JSON.parse(ub64u(g));
    if (obj.level) level = obj.level;
    if (Array.isArray(obj.planets)) planets = obj.planets;
    if (obj.opts) {
      ({ G = G, ultraPhysics = ultraPhysics, wallsBounce = wallsBounce, useTimeDilation = useTimeDilation } =
        obj.opts);
    }
  } catch {
    starterLevel();
  }
}

// ------------------------------ Share / Daily
function buildShareObject() {
  return {
    level,
    planets,
    opts: { G, ultraPhysics, wallsBounce, useTimeDilation },
  };
}
function setShareLink() {
  const obj = buildShareObject();
  const packed = b64u(JSON.stringify(obj));
  history.replaceState(null, "", "#g=" + packed);
}

function todaySeed() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `daily:${yyyy}-${mm}-${dd}`;
}

// ------------------------------ Worker wiring
function initWorker() {
  try {
    worker = new Worker("./worker.js", { type: "module" });
  } catch (err) {
    console.warn("[worker] module failed, fallback classic", err);
    worker = new Worker("./worker.js");
  }

  worker.onmessage = (e) => {
    const msg = e.data;
    if (msg.type === "state") {
      // state update from worker
      if (msg.puck) puck = msg.puck;
      running = !!msg.running;
      simTime = msg.t ?? simTime;
      nextNoteIndex = msg.nextNoteIndex ?? nextNoteIndex;
    } else if (msg.type === "event") {
      switch (msg.name) {
        case "note":
          // you can add tiny haptic / sound here
          break;
        case "goal":
          running = false;
          onGoal(msg.data?.score ?? 0);
          break;
        case "crash":
        case "oob":
          running = false;
          break;
      }
    }
  };

  // init after canvas size is known
  worker.postMessage({
    type: "init",
    opts: { W: canvas.width, H: canvas.height, G, ultraPhysics, wallsBounce, useTimeDilation },
    planets,
    level,
  });
  workerReady = true;
}

function syncLevelToWorker() {
  if (!workerReady || !worker) return;
  worker.postMessage({ type: "updateLevel", level });
}
function syncPlanetsToWorker() {
  if (!workerReady || !worker) return;
  worker.postMessage({ type: "updatePlanets", planets });
}
function setRunning(flag) {
  if (!workerReady || !worker) return;
  worker.postMessage({ type: "setRunning", running: !!flag });
}
function sendStep(dt) {
  if (!workerReady || !worker) return;
  worker.postMessage({ type: "step", dt });
}
function resetSim() {
  if (!workerReady || !worker) return;
  worker.postMessage({ type: "reset" });
  running = false;
  trail.length = 0;
}

// ------------------------------ Drawing
function drawGrid() {
  const W = canvas.width,
    H = canvas.height;
  ctx.fillStyle = "#0b1016";
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.lineWidth = 1;
  const step = 40 * dpr();
  ctx.beginPath();
  for (let x = (W % step); x < W; x += step) {
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, H);
  }
  for (let y = (H % step); y < H; y += step) {
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(W, y + 0.5);
  }
  ctx.stroke();
}

function drawPlanets() {
  for (const p of planets) {
    // rings
    ctx.strokeStyle = "rgba(180,170,255,0.15)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * 1.4, 0, Math.PI * 2);
    ctx.stroke();

    // body
    const grd = ctx.createRadialGradient(p.x - p.r * 0.4, p.y - p.r * 0.4, 2, p.x, p.y, p.r);
    grd.addColorStop(0, "#a88cff");
    grd.addColorStop(1, "#5d42b9");
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawLevel() {
  // notes
  level.notes.forEach((n, i) => {
    const on = i < nextNoteIndex;
    ctx.fillStyle = on ? "#68ffc0" : "#91f0ff";
    ctx.globalAlpha = on ? 0.55 : 0.9;
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  });
  // goal
  ctx.strokeStyle = "#7cf9a0";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(level.goal.x, level.goal.y, level.goal.r, 0, Math.PI * 2);
  ctx.stroke();
}

function drawPuckAndTrail() {
  // trail
  if (trail.length > 1) {
    ctx.strokeStyle = "rgba(120,180,255,0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(trail[0].x, trail[0].y);
    for (let i = 1; i < trail.length; i++) ctx.lineTo(trail[i].x, trail[i].y);
    ctx.stroke();
  }

  // puck
  const r = puck.r;
  const grd = ctx.createRadialGradient(puck.x - r * 0.4, puck.y - r * 0.4, 2, puck.x, puck.y, r);
  grd.addColorStop(0, "#ffe7a8");
  grd.addColorStop(1, "#c48a2d");
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.arc(puck.x, puck.y, r, 0, Math.PI * 2);
  ctx.fill();
}

// ------------------------------ UI (very compact)
function setupUI() {
  const root = document.getElementById("ui-root");
  if (!root) return;

  root.innerHTML = `
    <div class="panel">
      <div class="row">
        <button id="btnLaunch">▶ Launch</button>
        <button id="btnReset">↺ Reset</button>
        <button id="btnClear">✖ Clear Planets</button>
      </div>
      <div class="row">
        <label><input type="checkbox" id="chkTrails" checked> Trails</label>
        <label><input type="checkbox" id="chkAudio"> Audio</label>
        <label><input type="checkbox" id="chkUltra" checked> Ultra Physics</label>
        <label><input type="checkbox" id="chkWalls" checked> Walls Bounce</label>
        <label><input type="checkbox" id="chkTime" checked> Time Dilation</label>
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

  // CSS (inline minimal)
  const style = document.createElement("style");
  style.textContent = `
    .panel{position:fixed;left:16px;top:16px;background:rgba(15,20,28,.9);border:1px solid #2a3442;border-radius:12px;padding:12px 12px;color:#cfe3ff;font:14px/1.4 system-ui;backdrop-filter:saturate(150%) blur(4px);max-width:520px}
    .row{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0}
    button{background:#162233;color:#d7e7ff;border:1px solid #31435a;border-radius:10px;padding:8px 10px;cursor:pointer}
    button:hover{filter:brightness(1.05)}
    input[type=text]{background:#0d1520;color:#cfe3ff;border:1px solid #2a3a4f;border-radius:10px;padding:8px 10px;min-width:160px}
    label{display:flex;align-items:center;gap:6px}
    #credit{position:fixed;left:12px;bottom:12px;color:#a5bad6;font:13px system-ui}
    #credit a{color:#8ac7ff}
  `;
  document.head.appendChild(style);

  // Wiring
  root.querySelector("#btnLaunch").onclick = () => {
    running = true;
    setRunning(true);
  };
  root.querySelector("#btnReset").onclick = () => {
    resetSim();
  };
  root.querySelector("#btnClear").onclick = () => {
    planets = [];
    syncPlanetsToWorker();
    setShareLink();
  };

  root.querySelector("#chkUltra").onchange = (e) => {
    ultraPhysics = !!e.target.checked;
    if (workerReady) worker.postMessage({ type: "setOptions", opts: { ultraPhysics } });
  };
  root.querySelector("#chkWalls").onchange = (e) => {
    wallsBounce = !!e.target.checked;
    if (workerReady) worker.postMessage({ type: "setOptions", opts: { wallsBounce } });
  };
  root.querySelector("#chkTime").onchange = (e) => {
    useTimeDilation = !!e.target.checked;
    if (workerReady) worker.postMessage({ type: "setOptions", opts: { useTimeDilation } });
  };

  root.querySelector("#chkDaily").onchange = (e) => {
    daily = !!e.target.checked;
    seed = daily ? todaySeed() : "level:0";
  };

  root.querySelector("#btnShare").onclick = () => {
    setShareLink();
    navigator.clipboard?.writeText(location.href);
  };

  root.querySelector("#btnTop").onclick = async () => {
    try {
      const api = window.Leaderboard?.selectBackend?.("sheets") || window.Leaderboard;
      const arr = (await api.fetchTop(seed, 10)) || [];
      alert(
        "Top 10 — " +
          seed +
          "\n\n" +
          arr
            .map((r, i) => `${i + 1}. ${r.name || "—"}  score:${r.score}  planets:${r.planets}`)
            .join("\n")
      );
    } catch (e) {
      alert("Failed to fetch Top 10.");
    }
  };

  root.querySelector("#btnPing").onclick = () => {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.001, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.2, audioCtx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.22);
      o.connect(g).connect(audioCtx.destination);
      o.start();
      o.stop(audioCtx.currentTime + 0.25);
    } catch {}
  };

  root.querySelector("#inpName").oninput = (e) => {
    playerName = e.target.value.slice(0, 24);
    localStorage.setItem("gravi_name", playerName);
  };
}

// ------------------------------ Planet placement
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

canvas.addEventListener("mousedown", (e) => {
  const pos = toWorld(e);
  if (e.button === 2) {
    // remove nearest
    if (!planets.length) return;
    let bi = 0,
      bd = 1e12;
    for (let i = 0; i < planets.length; i++) {
      const d = dist2(planets[i], pos);
      if (d < bd) (bd = d), (bi = i);
    }
    planets.splice(bi, 1);
    syncPlanetsToWorker();
    setShareLink();
  } else if (e.button === 0) {
    if (planets.length >= 6) return;
    planets.push({ x: pos.x, y: pos.y, r: 15, mass: 1.0 });
    syncPlanetsToWorker();
    setShareLink();
  }
});

// ------------------------------ Goal submit
async function onGoal(score) {
  try {
    const api = window.Leaderboard?.selectBackend?.("sheets") || window.Leaderboard;
    await api.submit({
      seed,
      score,
      planets: planets.length,
      uid,
      name: playerName || null,
      when: Date.now(),
    });
  } catch (e) {
    console.warn("submit failed", e);
  }
}

// ------------------------------ Main loop
function tick(ts) {
  if (!lastTs) lastTs = ts;
  const dt = Math.min(0.05, (ts - lastTs) / 1000);
  lastTs = ts;

  // step simulation
  if (running) sendStep(dt);

  // draw
  drawGrid();
  drawLevel();
  drawPlanets();

  // trail update
  if (running) {
    trail.push({ x: puck.x, y: puck.y });
    if (trail.length > TRAIL_MAX) trail.shift();
  } else if (trail.length) {
    // slowly fade trail when idle
    if (trail.length > 4) trail.shift();
  }
  drawPuckAndTrail();

  RAF(tick);
}

// ------------------------------ Init
function init() {
  rescaleCanvas();
  applyShareParam();
  starterLevel(); // in case no URL; starterLevel uses current canvas size
  setShareLink();

  setupUI();
  initWorker(); // worker AFTER canvas/UI set

  // initial sync
  syncLevelToWorker();
  syncPlanetsToWorker();

  // respond to resize
  window.addEventListener("resize", () => {
    rescaleCanvas();
    if (workerReady) {
      worker.postMessage({
        type: "init",
        opts: { W: canvas.width, H: canvas.height, G, ultraPhysics, wallsBounce, useTimeDilation },
        planets,
        level,
      });
      // don't auto-run on resize
    }
  });

  // daily seed default off; if you want default daily, set daily=true here.
  seed = daily ? todaySeed() : "level:0";

  RAF(tick);
}

init();
