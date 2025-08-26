/* GraviScore — Compose with Gravity
   Main script, no build step. 2025 © @wiqile (AGPL-3.0-or-later)
   - Draggable control panel
   - Help dock (right side), accessible toggles: Reduced Motion / High Contrast / Haptics
   - 5 levels, Top 10 modal, Ping louder
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
  G: 2300
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
  { name: "Starter — C E G c",
    notes: [
      { x: 520, y: 260, r: 11, pitch: 262 },
      { x: 660, y: 320, r: 11, pitch: 330 },
      { x: 820, y: 380, r: 11, pitch: 392 },
      { x: 960, y: 430, r: 11, pitch: 523 },
    ],
    goal: { x: 1020, y: 480, r: 18 },
  },
  { name: "Arc — A B d e",
    notes: [
      { x: 520, y: 220, r: 11, pitch: 440 },
      { x: 680, y: 260, r: 11, pitch: 494 },
      { x: 820, y: 300, r: 11, pitch: 587 },
      { x: 980, y: 340, r: 11, pitch: 659 },
    ],
    goal: { x: 1080, y: 420, r: 18 },
  },
  { name: "Sweep — G B d g",
    notes: [
      { x: 500, y: 400, r: 11, pitch: 392 },
      { x: 650, y: 360, r: 11, pitch: 494 },
      { x: 800, y: 320, r: 11, pitch: 587 },
      { x: 950, y: 280, r: 11, pitch: 784 },
    ],
    goal: { x: 1040, y: 250, r: 18 },
  },
  { name: "Cross — C D F A",
    notes: [
      { x: 520, y: 470, r: 11, pitch: 262 },
      { x: 660, y: 330, r: 11, pitch: 294 },
      { x: 820, y: 470, r: 11, pitch: 349 },
      { x: 960, y: 330, r: 11, pitch: 440 },
    ],
    goal: { x: 1040, y: 390, r: 18 },
  },
  { name: "Spiral — D F A c",
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
  level = { name: L.name, notes: L.notes.map(n => ({...n})), goal: {...L.goal} };
  nextNoteIndex = 0; t = 0;
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

/* --------------- UI ---------------- */
const ui = {};
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function chk(label, checked, container) {
  const w = el("label", "check");
  const c = el("input"); c.type = "checkbox"; c.checked = !!checked;
  const s = el("span", null, label);
  w.append(c, s);
  (container || document.body).appendChild(w);
  return c;
}

/* Panel */
const panel = el("div", "panel");
const title = el("div", "title");
title.innerHTML = `<strong>GraviScore</strong><span>Compose with Gravity</span>`;
const btnHelp = el("button", "chip", "Help");
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

/* Row 3: level select */
const row3 = el("div", "row");
const levelLabel = el("span", "label", "Level:");
ui.level = document.createElement("select");
ui.level.className = "select";
LEVELS.forEach((L, i) => {
  const opt = document.createElement("option");
  opt.value = i; opt.textContent = L.name;
  ui.level.appendChild(opt);
});
row3.append(levelLabel, ui.level);
panel.append(row3);

/* Row 4: actions */
const row4 = el("div", "row");
ui.ping = el("button", "btn", "Ping");
const btnTop = el("button", "btn", "🏆 Top 10");
row4.append(ui.ping, btnTop);
panel.append(row4);

/* Row 5: accessibility */
const row5 = el("div", "row");
ui.rm = chk("Reduced Motion", false, row5);
ui.hc = chk("High Contrast", false, row5);
ui.hap = chk("Haptics", true, row5);
const timeLbl = el("span", "label", "Time 0.00s");
const scoreLbl = el("span", "label", "Score —");
row5.append(timeLbl, scoreLbl);
panel.append(row5);

document.body.appendChild(panel);

/* Drag panel from title */
let drag = null;
title.addEventListener("pointerdown", (e) => {
  drag = { x0: e.clientX, y0: e.clientY, left0: panel.offsetLeft, top0: panel.offsetTop };
  title.setPointerCapture(e.pointerId);
});
title.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
  panel.style.left = Math.max(8, drag.left0 + dx) + "px";
  panel.style.top = Math.max(8, drag.top0 + dy) + "px";
});
title.addEventListener("pointerup", () => (drag = null));

/* Help dock (right, like your previous UI) */
const helpDock = el("div", "helpdock");
helpDock.innerHTML = `
  <div class="helphead"><strong>How to play</strong> <button class="chip" data-x>✕</button></div>
  <ol>
    <li>Place up to 6 planets.</li>
    <li>Press <em>Launch</em>.</li>
    <li>Touch notes in order to unlock the goal.</li>
    <li>Reach the goal.</li>
  </ol>
  <p>New: Daily seed, Level editor basics, Web Share Target, Badging/Haptics, Accessibility toggles.</p>
`;
document.body.appendChild(helpDock);
helpDock.querySelector("[data-x]").onclick = () => (helpDock.style.display = "none");
btnHelp.onclick = () => (helpDock.style.display = "block");
btnHide.onclick = () => (panel.style.display = "none");

/* Top 10 modal */
const top10 = el("div", "modal");
top10.innerHTML = `
  <div class="card">
    <div class="card-head"><strong>Top 10</strong><button class="chip" data-x>✕</button></div>
    <div class="list" data-body>Loading…</div>
  </div>`;
document.body.appendChild(top10);
top10.querySelector("[data-x]").onclick = () => (top10.style.display = "none");

btnTop.onclick = async () => {
  const body = top10.querySelector("[data-body]");
  if (!window.Leaderboard) {
    body.textContent = "Leaderboard module not found.";
  } else {
    try {
      const api = window.Leaderboard.selectBackend?.("sheets") || window.Leaderboard;
      const rows = await api.fetchTop(`level:${ui.level.value}`, 10);
      body.innerHTML = rows.map((r,i)=>(
        `<div class="rowline"><span>${i+1}.</span><span>${r.name??"anon"}</span><span>${r.score}</span></div>`
      )).join("") || "No scores yet.";
    } catch(e) {
      console.warn(e);
      body.textContent = "Failed to load scores.";
    }
  }
  top10.style.display = "block";
};

/* UI events */
ui.level.onchange = () => { applyLevel(+ui.level.value); resetPuck(); };
ui.launch.onclick = () => { ensureAudio(); running = true; };
ui.reset.onclick  = () => { running = false; resetPuck(); };
ui.clear.onclick  = () => { planets = []; };
ui.ping.onclick   = () => { ensureAudio(); beep(660, 0.15); if (ui.hap.checked && navigator.vibrate) navigator.vibrate(30); };
ui.hc.onchange    = () => { document.body.classList.toggle("hc", ui.hc.checked); };
ui.rm.onchange    = () => { /* Reduced motion => just hide trails */ };
ui.hap.onchange   = () => { /* nothing to do here */ };

/* Input: place / remove planets */
canvas.addEventListener("contextmenu", (e)=>e.preventDefault());
canvas.addEventListener("pointerdown", (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left, y = e.clientY - rect.top;
  if (e.button === 2) {
    if (!planets.length) return;
    let k = 0, best = 1e9;
    planets.forEach((p,i)=>{ const d=(p.x-x)**2+(p.y-y)**2; if (d<best){best=d;k=i;} });
    planets.splice(k,1);
    return;
  }
  if (planets.length < WORLD.maxPlanets) planets.push({ x, y, r: 18, mass: 1.0 });
});

/* Physics */
function step(dt) {
  if (ui.td.checked) {
    for (const p of planets) {
      const d = Math.hypot(p.x - puck.x, p.y - puck.y);
      if (d < p.r * 1.8) dt *= 0.85;
    }
  }

  let ax=0, ay=0;
  for (const p of planets) {
    const dx=p.x-puck.x, dy=p.y-puck.y;
    const d2=dx*dx+dy*dy, d=Math.sqrt(d2)+1e-6;
    const f=(WORLD.G*p.mass)/(d2+200);
    ax+=(dx/d)*f; ay+=(dy/d)*f;

    if (d < p.r + puck.r) { running=false; beep(120,0.12); if (ui.hap.checked && navigator.vibrate) navigator.vibrate([20,30,20]); return; }
  }
  const maxA=4000, mag=Math.hypot(ax,ay);
  if (mag>maxA){ ax*=maxA/mag; ay*=maxA/mag; }
  puck.vx+=ax*dt; puck.vy+=ay*dt;
  puck.x+=puck.vx*dt; puck.y+=puck.vy*dt;

  if (ui.walls.checked){
    if (puck.x < puck.r){ puck.x=puck.r; puck.vx=Math.abs(puck.vx)*0.9; }
    if (puck.x > WORLD.W()-puck.r){ puck.x=WORLD.W()-puck.r; puck.vx=-Math.abs(puck.vx)*0.9; }
    if (puck.y < puck.r){ puck.y=puck.r; puck.vy=Math.abs(puck.vy)*0.9; }
    if (puck.y > WORLD.H()-puck.r){ puck.y=WORLD.H()-puck.r; puck.vy=-Math.abs(puck.vy)*0.9; }
  } else {
    if (puck.x<-50||puck.x>WORLD.W()+50||puck.y<-50||puck.y>WORLD.H()+50){ running=false; beep(180,0.1); return; }
  }

  // note
  const glow = level.notes[nextNoteIndex];
  if (glow){
    const d = Math.hypot(glow.x - puck.x, glow.y - puck.y);
    if (d < glow.r + puck.r){ beep(glow.pitch||660,0.12); nextNoteIndex++; }
  }

  // goal
  if (nextNoteIndex===level.notes.length && level.notes.length){
    const d=Math.hypot(level.goal.x-puck.x, level.goal.y-puck.y);
    if (d < level.goal.r + puck.r){
      running=false; const timeBonus=Math.max(0,12-t); const penalty=planets.length*1.2;
      const score=Math.max(1, Math.round(100 + timeBonus*8 - penalty));
      beep(880,0.18); if (ui.hap.checked && navigator.vibrate) navigator.vibrate([30,40,30]);

      // submit
      try{
        if (window.Leaderboard){
          const api = window.Leaderboard.selectBackend?.("sheets") || window.Leaderboard;
          const uid = localStorage.getItem("gravi_uid") || (localStorage.setItem("gravi_uid", crypto.randomUUID()), localStorage.getItem("gravi_uid"));
          const name = (localStorage.getItem("gravi_name")||"").trim() || "anon";
          api.submit({ seed:`level:${ui.level.value}`, score, planets:planets.length, uid, name, when:Date.now() });
        }
      }catch(e){ console.warn("[submit]", e); }

      scoreLbl.textContent = "Score " + score;
    }
  }

  // trail
  if (!ui.rm.checked && ui.trails.checked){
    trail.push({x:puck.x,y:puck.y});
    if (trail.length>TRAIL_MAX) trail.shift();
  }
  t += dt;
  timeLbl.textContent = "Time " + t.toFixed(2) + "s";
}

/* Render */
function drawGrid() {
  const w=WORLD.W(), h=WORLD.H();
  ctx.fillStyle = "#0b1217";
  ctx.fillRect(0,0,w,h);
  const gridCol = document.body.classList.contains("hc") ? "rgba(255,255,255,.12)" : "rgba(255,255,255,.05)";
  ctx.strokeStyle = gridCol; ctx.lineWidth=1; const g=40;
  for (let x=(w%g); x<w; x+=g){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke(); }
  for (let y=(h%g); y<h; y+=g){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }
}
function draw(){
  drawGrid();

  // planets
  for (const p of planets){
    ctx.fillStyle = "#7a6df6";
    ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle = "rgba(122,109,246,.25)";
    ctx.beginPath(); ctx.arc(p.x,p.y,p.r*1.6,0,Math.PI*2); ctx.stroke();
  }

  // notes
  level.notes.forEach((n,i)=>{
    ctx.fillStyle = i<nextNoteIndex ? "#66e3c4" : "#8ad8ff";
    ctx.beginPath(); ctx.arc(n.x,n.y,n.r,0,Math.PI*2); ctx.fill();
  });

  // goal
  ctx.strokeStyle = "#8fffb1"; ctx.lineWidth=2;
  ctx.beginPath(); ctx.arc(level.goal.x, level.goal.y, level.goal.r, 0, Math.PI*2); ctx.stroke();

  // trail
  if (!ui.rm.checked && ui.trails.checked){
    ctx.strokeStyle = "rgba(255,255,255,.18)";
    ctx.beginPath();
    trail.forEach((p,i)=> i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));
    ctx.stroke();
  }

  // puck
  ctx.fillStyle = "#b8dbff";
  ctx.beginPath(); ctx.arc(puck.x,puck.y,puck.r,0,Math.PI*2); ctx.fill();

  stats.textContent = `Planets: ${planets.length}/${WORLD.maxPlanets}   Notes: ${level.notes.length}`;
}

/* Loop */
let last = performance.now();
function tick(now){
  const dt = Math.min(0.05, (now-last)/1000); last=now;
  if (running){
    const sub = ui.ultra.checked ? 3 : 1, sdt = dt/sub;
    for (let i=0;i<sub;i++) step(sdt);
  }
  draw();
  requestAnimationFrame(tick);
}

/* Styles */
const style = document.createElement("style");
style.textContent = `
  html,body{margin:0;height:100%;background:#0b1217;color:#dde7f2;font-family:system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial,sans-serif;overflow:hidden}
  .panel{position:fixed;left:16px;top:16px;max-width:760px;background:rgba(18,28,36,.9);border:1px solid rgba(255,255,255,.08);border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.35);padding:12px 12px 14px;backdrop-filter: blur(6px)}
  .title{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:6px;cursor:grab}
  .title strong{font-weight:700}
  .title span{opacity:.75;font-size:.9rem;margin-left:8px}
  .row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:8px 0}
  .btn,.chip{background:#1a2631;border:1px solid rgba(255,255,255,.12);color:#eaf4ff;border-radius:10px;padding:8px 10px;font-weight:600}
  .btn:hover,.chip:hover{background:#223141}
  .check{display:inline-flex;align-items:center;gap:6px;user-select:none}
  .check input{width:16px;height:16px}
  .select{background:#0f1720;color:#fff;border:1px solid rgba(255,255,255,.16);border-radius:8px;padding:6px 8px}
  .label{opacity:.75}
  .stats{opacity:.75;margin-left:6px}
  .modal{position:fixed;inset:0;display:none;place-items:center;background:rgba(0,0,0,.45);z-index:30}
  .modal .card{min-width:360px;max-width:560px;background:#0f1720;border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:14px}
  .card-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
  .list .rowline{display:grid;grid-template-columns:2ch 1fr auto;gap:10px;padding:6px 0;border-bottom:1px dashed rgba(255,255,255,.08)}
  .helpdock{position:fixed;right:16px;top:16px;width:340px;background:rgba(18,28,36,.92);border:1px solid rgba(255,255,255,.08);border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.35);padding:12px;display:block;z-index:20}
  .helphead{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
  body.hc .panel, body.hc .helpdock{border-color:rgba(255,255,255,.20)}
`;
document.head.appendChild(style);

/* Init */
applyLevel(0);
resetPuck();
requestAnimationFrame(tick);

/* Footer credit (single, avoid duplicates) */
if (!document.querySelector('#credit')) {
    const credit = document.createElement('div');
    credit.id = 'credit';
    credit.style.position = 'fixed';
    credit.style.left = '10px';
    credit.style.bottom = '10px';
    credit.style.opacity = '.6';
    credit.style.fontSize = '.9rem';
    credit.innerHTML = `GraviScore — by <a href="https://github.com/wiqile" target="_blank" rel="noopener" style="color:#8ad8ff">@wiqile</a>`;
    document.body.appendChild(credit);
  }
  
