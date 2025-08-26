/* GraviScore — Compose with Gravity
   Main script, no build step. 2025 © @wiqile (AGPL-3.0-or-later)
   - Draggable control panel
   - Help modal (dibuka dari tombol id="btn-help" → index.html yang handle)
   - 5 levels, Daily seed, Share Link
   - Edit Mode (drag notes/goal), Undo, Export/Import JSON
   - Top 10 modal (Sheets), Ping louder
*/
"use strict";

/* ---------------- Canvas ---------------- */
const canvas = document.createElement("canvas");
canvas.id = "stage";
document.body.appendChild(canvas);
const ctx = canvas.getContext("2d", { alpha: false });

function fit() {
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  canvas.width = Math.floor(innerWidth * dpr);
  canvas.height = Math.floor(innerHeight * dpr);
  canvas.style.width = "100vw";
  canvas.style.height = "100vh";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
addEventListener("resize", fit);
fit();

/* --------------- World & state --------------- */
const WORLD = {
  W: () => canvas.width / (window.devicePixelRatio || 1),
  H: () => canvas.height / (window.devicePixelRatio || 1),
  maxPlanets: 6,
  G: 2300,
};

const puck = { x: 90, y: 0, vx: 130, vy: 0, r: 7 };
let planets = [];
let running = false;
let t = 0;
let trail = [];
const TRAIL_MAX = 160;

let level = { notes: [], goal: { x: 0, y: 0, r: 16 }, name: "Starter" };
let nextNoteIndex = 0;

function resetPuck() {
  puck.x = 90;
  puck.y = WORLD.H() * 0.5;
  puck.vx = 130;
  puck.vy = 0;
  t = 0;
  nextNoteIndex = 0;
  trail.length = 0;
}

/* ---------------- Levels ---------------- */
const LEVELS = [
  {
    name: "Starter — C E G c",
    notes: [
      { x: 520, y: 260, r: 11, pitch: 262 },
      { x: 660, y: 320, r: 11, pitch: 330 },
      { x: 820, y: 380, r: 11, pitch: 392 },
      { x: 960, y: 430, r: 11, pitch: 523 },
    ],
    goal: { x: 1020, y: 480, r: 18 },
  },
  {
    name: "Arc — A B d e",
    notes: [
      { x: 520, y: 220, r: 11, pitch: 440 },
      { x: 680, y: 260, r: 11, pitch: 494 },
      { x: 820, y: 300, r: 11, pitch: 587 },
      { x: 980, y: 340, r: 11, pitch: 659 },
    ],
    goal: { x: 1080, y: 420, r: 18 },
  },
  {
    name: "Sweep — G B d g",
    notes: [
      { x: 500, y: 400, r: 11, pitch: 392 },
      { x: 650, y: 360, r: 11, pitch: 494 },
      { x: 800, y: 320, r: 11, pitch: 587 },
      { x: 950, y: 280, r: 11, pitch: 784 },
    ],
    goal: { x: 1040, y: 250, r: 18 },
  },
  {
    name: "Cross — C D F A",
    notes: [
      { x: 520, y: 470, r: 11, pitch: 262 },
      { x: 660, y: 330, r: 11, pitch: 294 },
      { x: 820, y: 470, r: 11, pitch: 349 },
      { x: 960, y: 330, r: 11, pitch: 440 },
    ],
    goal: { x: 1040, y: 390, r: 18 },
  },
  {
    name: "Spiral — D F A c",
    notes: [
      { x: 520, y: 300, r: 11, pitch: 294 },
      { x: 650, y: 380, r: 11, pitch: 349 },
      { x: 780, y: 420, r: 11, pitch: 440 },
      { x: 920, y: 360, r: 11, pitch: 523 },
    ],
    goal: { x: 1060, y: 300, r: 18 },
  },
];

function applyLevel(i) {
  const L = LEVELS[i] || LEVELS[0];
  level = { name: L.name, notes: L.notes.map(n => ({ ...n })), goal: { ...L.goal } };
  nextNoteIndex = 0;
  t = 0;
}

/* --------------- Audio --------------- */
let AC, master;
function ensureAudio() {
  if (AC) return;
  AC = new (window.AudioContext || window.webkitAudioContext)();
  master = AC.createGain();
  master.gain.value = 0.25; // louder than before
  master.connect(AC.destination);
}
function beep(freq, dur = 0.12) {
  if (!ui.audio.checked) return;
  ensureAudio();
  const o = AC.createOscillator();
  const g = AC.createGain();
  o.type = "sine";
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, AC.currentTime);
  g.gain.linearRampToValueAtTime(0.8, AC.currentTime + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, AC.currentTime + dur);
  o.connect(g).connect(master);
  o.start();
  o.stop(AC.currentTime + dur + 0.02);
}

/* --------------- Helpers --------------- */
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function chk(label, checked, container) {
  const w = el("label", "check");
  const c = el("input");
  c.type = "checkbox";
  c.checked = !!checked;
  const s = el("span", null, label);
  w.append(c, s);
  (container || document.body).appendChild(w);
  return c;
}
function toDataURL(name, data) {
  const blob = new Blob([data], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
function fromFile(cb) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json,.json";
  input.onchange = () => {
    const f = input.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => cb(r.result);
    r.readAsText(f);
  };
  input.click();
}
function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, "0");
  const dd = d.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/* --------------- UI ---------------- */
const ui = {};
const panel = el("div", "panel");

/* Title / drag handle */
const title = el("div", "title");
title.innerHTML = `<strong>GraviScore</strong><span>Compose with Gravity</span>`;
const btnHelp = el("button", "chip", "Help");
btnHelp.id = "btn-help"; // biar terhubung ke modal di index.html
const btnHide = el("button", "chip", "Hide");
title.append(btnHelp, btnHide);
panel.append(title);

/* Row 1: main buttons + stats */
const row1 = el("div", "row");
ui.launch = el("button", "btn", "Launch");
ui.reset = el("button", "btn", "Reset");
ui.clear = el("button", "btn", "Clear Planets");
const stats = el("span", "stats", "");
row1.append(ui.launch, ui.reset, ui.clear, stats);
panel.append(row1);

/* Row 2: physics toggles */
const row2 = el("div", "row");
ui.trails = chk("Trails", true, row2);
ui.audio = chk("Audio", true, row2);
ui.ultra = chk("Ultra Physics", true, row2);
ui.walls = chk("Walls Bounce", true, row2);
ui.td = chk("Time Dilation", true, row2);
panel.append(row2);

/* Row 3: level/daily/share/name */
const row3 = el("div", "row");
const levelLabel = el("span", "label", "Level:");
ui.level = document.createElement("select");
ui.level.className = "select";
LEVELS.forEach((L, i) => {
  const opt = document.createElement("option");
  opt.value = i;
  opt.textContent = L.name;
  ui.level.appendChild(opt);
});
ui.daily = chk("Daily", false, row3);
const btnShare = el("button", "btn", "Share Link");
ui.playerName = document.createElement("input");
ui.playerName.type = "text";
ui.playerName.placeholder = "Name (optional)";
ui.playerName.className = "text";
row3.append(levelLabel, ui.level, ui.daily, btnShare, ui.playerName);
panel.append(row3);

/* Row 4: edit / undo / import-export / top10 / ping */
const row4 = el("div", "row");
ui.undo = el("button", "btn", "↑ Undo Planet");
ui.edit = chk("Edit Mode", false, row4);
const btnExport = el("button", "btn", "⇧ Export JSON");
const btnImport = el("button", "btn", "⇩ Import JSON");
ui.ping = el("button", "btn", "Ping");
const btnTop = el("button", "btn", "🏆 Top 10");
row4.append(ui.undo, ui.edit, btnExport, btnImport, ui.ping, btnTop);
panel.append(row4);

/* Row 5: accessibility */
const row5 = el("div", "row");
ui.rm = chk("Reduced Motion", false, row5);
ui.hc = chk("High Contrast", false, row5);
ui.hap = chk("Haptics", true, row5);
const timeLbl = el("span", "label", "Time 0.00s");
const scoreLbl = el("span", "label", "Score —");
row5.append(ui.rm, ui.hc, ui.hap, timeLbl, scoreLbl);
panel.append(row5);

document.body.appendChild(panel);

/* ---------- HELP OPEN/CLOSE (fix) ---------- */
const helpEl = document.getElementById("helpBox");
const helpClose = document.getElementById("btnHelpClose");
function openHelp(){ if (helpEl){ helpEl.classList.remove("hidden"); helpEl.style.zIndex = "30"; } }
function closeHelp(){ if (helpEl){ helpEl.classList.add("hidden"); } }
btnHelp.addEventListener("click", (e)=>{ e.stopPropagation(); openHelp(); });
helpClose?.addEventListener("click", (e)=>{ e.stopPropagation(); closeHelp(); });

/* Drag panel dari title — JANGAN drag kalau klik tombol */
let drag = null;
title.addEventListener("pointerdown", (e) => {
  if (e.target.closest && e.target.closest("button")) return; // penting: klik tombol tidak memicu drag
  drag = { x0: e.clientX, y0: e.clientY, left0: panel.offsetLeft, top0: panel.offsetTop };
  title.setPointerCapture(e.pointerId);
});
title.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x0,
        dy = e.clientY - drag.y0;
  panel.style.left = Math.max(8, drag.left0 + dx) + "px";
  panel.style.top  = Math.max(8, drag.top0  + dy) + "px";
});
title.addEventListener("pointerup", () => (drag = null));

/* Hide / Show panel */
const showBtn = el("button", "chip showbtn", "Show");
showBtn.style.display = "none";
document.body.appendChild(showBtn);
btnHide.onclick = () => {
  panel.style.display = "none";
  showBtn.style.display = "block";
};
showBtn.onclick = () => {
  panel.style.display = "block";
  showBtn.style.display = "none";
};

/* Top 10 modal */
const top10 = el("div", "modal");
top10.innerHTML = `
  <div class="card">
    <div class="card-head"><strong>Top 10</strong><button class="chip" data-x>✕</button></div>
    <div class="list" data-body>Loading…</div>
  </div>`;
document.body.appendChild(top10);
top10.querySelector("[data-x]").onclick = () => (top10.style.display = "none");

/* --------- Share / Seed --------- */
function seedKey() {
  return ui.daily.checked ? `daily:${todayStr()}` : `level:${ui.level.value}`;
}
function encodeShare() {
  const payload = {
    s: seedKey(),
    L: +ui.level.value,
    lvl: { notes: level.notes, goal: level.goal, name: level.name },
  };
  const json = JSON.stringify(payload);
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return `${location.origin}${location.pathname}#g=${b64}`;
}
btnShare.onclick = async () => {
  const url = encodeShare();
  try {
    await navigator.clipboard.writeText(url);
    btnShare.textContent = "Copied!";
    setTimeout(() => (btnShare.textContent = "Share Link"), 1200);
  } catch {
    location.hash = "g=" + url.split("#g=")[1];
  }
};

/* --------- Import / Export --------- */
btnExport.onclick = () => {
  const data = JSON.stringify({ name: level.name, notes: level.notes, goal: level.goal }, null, 2);
  toDataURL("graviscore-level.json", data);
};
btnImport.onclick = () =>
  fromFile((txt) => {
    try {
      const obj = JSON.parse(txt);
      if (!obj || !obj.notes || !obj.goal) throw new Error("bad json");
      level = { name: obj.name || "Custom", notes: obj.notes, goal: obj.goal };
      nextNoteIndex = 0;
      t = 0;
    } catch (e) {
      alert("Invalid JSON.");
    }
  });

/* --------- Top 10 --------- */
btnTop.onclick = async () => {
  const body = top10.querySelector("[data-body]");
  if (!window.Leaderboard) {
    body.textContent = "Leaderboard module not found.";
  } else {
    try {
      const api = window.Leaderboard.selectBackend?.("sheets") || window.Leaderboard;
      const rows = await api.fetchTop(seedKey(), 10);
      body.innerHTML =
        rows
          .map(
            (r, i) =>
              `<div class="rowline"><span>${i + 1}.</span><span>${(r.name || "anon")
              .toString()
              .slice(0, 18)}</span><span>${r.score}</span></div>`
          )
          .join("") || "No scores yet.";
    } catch (e) {
      console.warn(e);
      body.textContent = "Failed to load scores.";
    }
  }
  top10.style.display = "grid";
};

/* --------- UI events --------- */
ui.level.onchange = () => {
  applyLevel(+ui.level.value);
  resetPuck();
};
ui.launch.onclick = () => {
  ensureAudio();
  running = true;
};
ui.reset.onclick = () => {
  running = false;
  resetPuck();
};
ui.clear.onclick = () => {
  planets = [];
};
ui.undo.onclick = () => {
  planets.pop();
};
ui.ping.onclick = () => {
  ensureAudio();
  beep(660, 0.15);
  if (ui.hap.checked && navigator.vibrate) navigator.vibrate(30);
};
ui.hc.onchange = () => {
  document.body.classList.toggle("hc", ui.hc.checked);
};
ui.rm.onchange = () => {
  /* Reduced motion => hide trails (ditangani di draw) */
};

/* --------- Input: place planets / edit mode --------- */
let dragThing = null; // {type:'note'|'goal', idx?, dx, dy}
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener("pointerdown", (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left,
    y = e.clientY - rect.top;

  // Right click → remove planet nearest
  if (e.button === 2) {
    if (!planets.length) return;
    let k = 0,
      best = 1e9;
    planets.forEach((p, i) => {
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < best) {
        best = d;
        k = i;
      }
    });
    planets.splice(k, 1);
    return;
  }

  // Edit mode: drag note/goal bila dekat
  if (ui.edit.checked) {
    // cek note
    for (let i = 0; i < level.notes.length; i++) {
      const n = level.notes[i];
      const d = Math.hypot(n.x - x, n.y - y);
      if (d <= n.r + 8) {
        dragThing = { type: "note", idx: i, dx: x - n.x, dy: y - n.y };
        return;
      }
    }
    // cek goal
    const g = level.goal;
    if (Math.hypot(g.x - x, g.y - y) <= g.r + 10) {
      dragThing = { type: "goal", dx: x - g.x, dy: y - g.y };
      return;
    }
  }

  // Otherwise place planet
  if (planets.length < WORLD.maxPlanets) planets.push({ x, y, r: 18, mass: 1.0 });
});
canvas.addEventListener("pointermove", (e) => {
  if (!dragThing) return;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left,
    y = e.clientY - rect.top;
  if (dragThing.type === "note") {
    const n = level.notes[dragThing.idx];
    n.x = Math.max(0, Math.min(WORLD.W(), x - dragThing.dx));
    n.y = Math.max(0, Math.min(WORLD.H(), y - dragThing.dy));
  } else if (dragThing.type === "goal") {
    level.goal.x = Math.max(0, Math.min(WORLD.W(), x - dragThing.dx));
    level.goal.y = Math.max(0, Math.min(WORLD.H(), y - dragThing.dy));
  }
});
addEventListener("pointerup", () => (dragThing = null));

/* --------- Physics --------- */
function step(dt) {
  // time dilation
  if (ui.td.checked) {
    for (const p of planets) {
      const d = Math.hypot(p.x - puck.x, p.y - puck.y);
      if (d < p.r * 1.8) dt *= 0.85;
    }
  }

  let ax = 0,
    ay = 0;
  for (const p of planets) {
    const dx = p.x - puck.x,
      dy = p.y - puck.y;
    const d2 = dx * dx + dy * dy,
      d = Math.sqrt(d2) + 1e-6;
    const f = (WORLD.G * p.mass) / (d2 + 200);
    ax += (dx / d) * f;
    ay += (dy / d) * f;

    if (d < p.r + puck.r) {
      running = false;
      beep(120, 0.12);
      if (ui.hap.checked && navigator.vibrate) navigator.vibrate([20, 30, 20]);
      return;
    }
  }
  const maxA = 4000,
    mag = Math.hypot(ax, ay);
  if (mag > maxA) {
    ax *= maxA / mag;
    ay *= maxA / mag;
  }
  puck.vx += ax * dt;
  puck.vy += ay * dt;
  puck.x += puck.vx * dt;
  puck.y += puck.vy * dt;

  if (ui.walls.checked) {
    if (puck.x < puck.r) {
      puck.x = puck.r;
      puck.vx = Math.abs(puck.vx) * 0.9;
    }
    if (puck.x > WORLD.W() - puck.r) {
      puck.x = WORLD.W() - puck.r;
      puck.vx = -Math.abs(puck.vx) * 0.9;
    }
    if (puck.y < puck.r) {
      puck.y = puck.r;
      puck.vy = Math.abs(puck.vy) * 0.9;
    }
    if (puck.y > WORLD.H() - puck.r) {
      puck.y = WORLD.H() - puck.r;
      puck.vy = -Math.abs(puck.vy) * 0.9;
    }
  } else {
    if (puck.x < -50 || puck.x > WORLD.W() + 50 || puck.y < -50 || puck.y > WORLD.H() + 50) {
      running = false;
      beep(180, 0.1);
      return;
    }
  }

  // note
  const glow = level.notes[nextNoteIndex];
  if (glow) {
    const d = Math.hypot(glow.x - puck.x, glow.y - puck.y);
    if (d < glow.r + puck.r) {
      beep(glow.pitch || 660, 0.12);
      nextNoteIndex++;
    }
  }

  // goal
  if (nextNoteIndex === level.notes.length && level.notes.length) {
    const d = Math.hypot(level.goal.x - puck.x, level.goal.y - puck.y);
    if (d < level.goal.r + puck.r) {
      running = false;
      const timeBonus = Math.max(0, 12 - t);
      const penalty = planets.length * 1.2;
      const score = Math.max(1, Math.round(100 + timeBonus * 8 - penalty));
      beep(880, 0.18);
      if (ui.hap.checked && navigator.vibrate) navigator.vibrate([30, 40, 30]);
      scoreLbl.textContent = "Score " + score;

      // submit
      try {
        if (window.Leaderboard) {
          const api = window.Leaderboard.selectBackend?.("sheets") || window.Leaderboard;
          const uid =
            localStorage.getItem("gravi_uid") ||
            (localStorage.setItem("gravi_uid", crypto.randomUUID()), localStorage.getItem("gravi_uid"));
          const name = (ui.playerName.value || localStorage.getItem("gravi_name") || "anon").trim().slice(0, 24);
          localStorage.setItem("gravi_name", name);
          api.submit({ seed: seedKey(), score, planets: planets.length, uid, name, when: Date.now() });
        }
      } catch (e) {
        console.warn("[submit]", e);
      }
    }
  }

  // trail
  if (!ui.rm.checked && ui.trails.checked) {
    trail.push({ x: puck.x, y: puck.y });
    if (trail.length > TRAIL_MAX) trail.shift();
  }
  t += dt;
  timeLbl.textContent = "Time " + t.toFixed(2) + "s";
}

/* --------- Render --------- */
function drawGrid() {
  const w = WORLD.W(),
    h = WORLD.H();
  ctx.fillStyle = "#0b1217";
  ctx.fillRect(0, 0, w, h);
  const gridCol = document.body.classList.contains("hc") ? "rgba(255,255,255,.12)" : "rgba(255,255,255,.05)";
  ctx.strokeStyle = gridCol;
  ctx.lineWidth = 1;
  const g = 40;
  for (let x = w % g; x < w; x += g) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = h % g; y < h; y += g) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
}
function draw() {
  drawGrid();

  // planets
  for (const p of planets) {
    ctx.fillStyle = "#7a6df6";
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(122,109,246,.25)";
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * 1.6, 0, Math.PI * 2);
    ctx.stroke();
  }

  // notes
  level.notes.forEach((n, i) => {
    ctx.fillStyle = i < nextNoteIndex ? "#66e3c4" : "#8ad8ff";
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
    ctx.fill();
  });

  // goal
  ctx.strokeStyle = "#8fffb1";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(level.goal.x, level.goal.y, level.goal.r, 0, Math.PI * 2);
  ctx.stroke();

  // trail
  if (!ui.rm.checked && ui.trails.checked) {
    ctx.strokeStyle = "rgba(255,255,255,.18)";
    ctx.beginPath();
    trail.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
  }

  // puck
  ctx.fillStyle = "#b8dbff";
  ctx.beginPath();
  ctx.arc(puck.x, puck.y, puck.r, 0, Math.PI * 2);
  ctx.fill();

  stats.textContent = `Planets: ${planets.length}/${WORLD.maxPlanets}   Notes: ${level.notes.length}`;
}

/* --------- Loop --------- */
let last = performance.now();
function tick(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (running) {
    const sub = ui.ultra.checked ? 3 : 1,
      sdt = dt / sub;
    for (let i = 0; i < sub; i++) step(sdt);
  }
  draw();
  requestAnimationFrame(tick);
}

/* --------- Styles --------- */
const style = document.createElement("style");
style.textContent = `
  html,body{margin:0;height:100%;background:#0b1217;color:#dde7f2;font-family:system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial,sans-serif;overflow:hidden}
  .panel{position:fixed;left:16px;top:16px;max-width:820px;background:rgba(18,28,36,.9);border:1px solid rgba(255,255,255,.08);border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.35);padding:12px 12px 14px;backdrop-filter: blur(6px);z-index:20}
  .title{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:6px;cursor:grab}
  .title strong{font-weight:700}
  .title span{opacity:.75;font-size:.9rem;margin-left:8px}
  .row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:8px 0}
  .btn,.chip{background:#1a2631;border:1px solid rgba(255,255,255,.12);color:#eaf4ff;border-radius:10px;padding:8px 10px;font-weight:600}
  .btn:hover,.chip:hover{background:#223141}
  .check{display:inline-flex;align-items:center;gap:6px;user-select:none}
  .check input{width:16px;height:16px}
  .select,.text{background:#0f1720;color:#fff;border:1px solid rgba(255,255,255,.16);border-radius:8px;padding:6px 8px}
  .text{min-width:160px}
  .label{opacity:.75}
  .stats{opacity:.75;margin-left:6px}
  .modal{position:fixed;inset:0;display:none;place-items:center;background:rgba(0,0,0,.45);z-index:30}
  .modal .card{min-width:360px;max-width:560px;background:#0f1720;border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:14px}
  .card-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
  .list .rowline{display:grid;grid-template-columns:2ch 1fr auto;gap:10px;padding:6px 0;border-bottom:1px dashed rgba(255,255,255,.08)}
  .showbtn{position:fixed;left:12px;top:12px;z-index:25}
  #helpBox{z-index:30} /* ensure help stays above */
  body.hc .panel{border-color:rgba(255,255,255,.20)}
`;
document.head.appendChild(style);

/* --------- Startup --------- */
applyLevel(0);
resetPuck();
requestAnimationFrame(tick);

/* --------- Load from #g (share link) --------- */
(function loadFromHash() {
  const m = location.hash.match(/[#&]g=([^&]+)/);
  if (!m) return;
  try {
    const json = decodeURIComponent(escape(atob(m[1])));
    const data = JSON.parse(json);
    if (data.L != null) ui.level.value = String(data.L);
    applyLevel(+ui.level.value);
    if (data.lvl && data.lvl.notes && data.lvl.goal) {
      level = { name: data.lvl.name || level.name, notes: data.lvl.notes, goal: data.lvl.goal };
    }
    resetPuck();
  } catch (e) {
    console.warn("Bad share payload", e);
  }
})();
