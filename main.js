/*
  GraviScore — Compose with Gravity
  Author: @wiqile • 2025 • AGPL-3.0-or-later
  Attribution required (see NOTICE). Keep the visible credit in the UI.

  Features: Daily Challenge, Level Editor, robust Share link, dual Leaderboard
  (Sheets/Firebase), Help panel (toggle & draggable), accessibility toggles,
  optional Worker physics, trails, harmonics, time dilation, haptics.
*/
console.log("GraviScore — by @wiqile");

/* ──────────────────────────────────────────────────────────────────────────
   Safety stub: if the leaderboard module hasn’t loaded yet, don’t crash.
   The real object from leaderboard.js will replace this when it loads.
────────────────────────────────────────────────────────────────────────── */
window.Leaderboard = window.Leaderboard || {
  selectBackend: () => ({ submit: async ()=>{}, fetchTop: async ()=>[] }),
  submit: async ()=>{}, fetchTop: async ()=>[]
};

/* ──────────────────────────────────────────────────────────────────────────
   Small helpers
────────────────────────────────────────────────────────────────────────── */
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const $ = (sel) => document.querySelector(sel);
const byId = (id) => document.getElementById(id);
const DPR = () => Math.min(2, window.devicePixelRatio || 1);

/* User ID kept locally for leaderboard de-dupe (best score per day/level) */
const uid = (() => {
  const k = "gravi_uid";
  let v = localStorage.getItem(k);
  if (!v) { v = crypto.randomUUID?.() || Math.random().toString(36).slice(2); localStorage.setItem(k, v); }
  return v;
})();

/* Canvas */
const canvas = byId("canvas");
const ctx = canvas.getContext("2d");
let W = 0, H = 0;
function resize() {
  W = innerWidth; H = innerHeight;
  const dpr = DPR();
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.width = W + "px"; canvas.style.height = H + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  reflowLevel();
  syncLevelToWorker();
}
addEventListener("resize", resize);

/* ──────────────────────────────────────────────────────────────────────────
   Audio: tiny, dependency-free
────────────────────────────────────────────────────────────────────────── */
class TinySynth {
  constructor(){ this.enabled = true; this.ctx = null; }
  ensure(){ if(!this.ctx){ this.ctx = new (window.AudioContext||window.webkitAudioContext)(); } }
  tone(freq=440, dur=0.18, vol=0.12){
    if(!this.enabled) return;
    this.ensure();
    if(this.ctx && this.ctx.state === "suspended"){ this.ctx.resume(); }
    const c = this.ctx, t0 = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = "sine"; o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(c.destination); o.start(t0); o.stop(t0 + dur + 0.05);
  }
  seq(notes){ notes.forEach((f,i)=> setTimeout(()=> this.tone(f, 0.15, 0.12), i*90)); }
}
const synth = new TinySynth();
const ensureAudioReady = () => { synth.ensure(); if (synth.ctx && synth.ctx.state === "suspended") synth.ctx.resume(); };

/* ──────────────────────────────────────────────────────────────────────────
   Game state
────────────────────────────────────────────────────────────────────────── */
const planets = [];                    // {x,y,mass,r}
const MAX_PLANETS = 6;
const puck = { x: 90, y: 0, vx: 130, vy: 0, r: 7, trail: [] };
const trailMax = 160;
const G = 2300;

let ultraPhysics = true;
let wallsBounce = true;
let useHarmonics = true;
let useTimeDilation = true;
let editMode = false;
let useHaptics = true;

const scaleHz = { C:261.63, D:293.66, E:329.63, F:349.23, G:392.00, A:440.00, B:493.88, c:523.25, d:587.33, e:659.25, g:784.00 };
const LEVELS = [
  { name:"Starter — C E G c",  notes:[{x:.42,y:.28,l:"C",f:scaleHz.C},{x:.65,y:.42,l:"E",f:scaleHz.E},{x:.52,y:.64,l:"G",f:scaleHz.G},{x:.77,y:.28,l:"c",f:scaleHz.c}], goal:{x:.90,y:.50} },
  { name:"Orbit Waltz — D F A d", notes:[{x:.35,y:.25,l:"D",f:scaleHz.D},{x:.58,y:.33,l:"F",f:scaleHz.F},{x:.68,y:.58,l:"A",f:scaleHz.A},{x:.82,y:.40,l:"d",f:scaleHz.d}], goal:{x:.90,y:.70} },
  { name:"Crossfire — E G B e", notes:[{x:.30,y:.60,l:"E",f:scaleHz.E},{x:.55,y:.30,l:"G",f:scaleHz.G},{x:.70,y:.55,l:"B",f:scaleHz.B},{x:.85,y:.25,l:"e",f:scaleHz.e}], goal:{x:.92,y:.50} },
  { name:"Spiral Minor — A C D E", notes:[{x:.40,y:.70,l:"A",f:scaleHz.A},{x:.48,y:.52,l:"C",f:scaleHz.C},{x:.60,y:.40,l:"D",f:scaleHz.D},{x:.78,y:.32,l:"E",f:scaleHz.E}], goal:{x:.90,y:.28} },
  { name:"Cascade — G B D g", notes:[{x:.38,y:.24,l:"G",f:scaleHz.G},{x:.50,y:.44,l:"B",f:scaleHz.B},{x:.62,y:.64,l:"D",f:scaleHz.D},{x:.80,y:.60,l:"g",f:scaleHz.g}], goal:{x:.92,y:.40} }
];

const level = { notes: [], goal: { x: 0, y: 0, r: 16 } };
let levelIndex = 0;

/* Daily challenge */
function fmtDateJakarta(d=new Date()){
  return new Intl.DateTimeFormat("en-CA", { timeZone:"Asia/Jakarta", year:"numeric", month:"2-digit", day:"2-digit" }).format(d);
}
function hashStr32(s){ let h=2166136261>>>0; for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h = Math.imul(h,16777619); } return h>>>0; }
function rng(seed){ let x = seed>>>0; return ()=> ((x = Math.imul(1664525, x) + 1013904223) >>> 0) / 4294967296; }
function genDaily(seedStr){
  const r = rng(hashStr32(seedStr));
  const labels = ["C","D","E","G","A","B","c","d","e","g"];
  const pick = () => labels[Math.floor(r()*labels.length)];
  const notes = [];
  for(let i=0;i<4;i++){
    const l = pick(); const f = scaleHz[l];
    const x = 0.35 + r()*0.5, y = 0.22 + r()*0.56;
    notes.push({x,y,l,f});
  }
  const goal = { x: 0.78 + r()*0.16, y: 0.24 + r()*0.52 };
  return { name:`Daily ${seedStr}`, notes, goal };
}
let dailySeed = null;

/* Apply level/daily */
function applyDaily(seedStr){
  dailySeed = seedStr;
  const L = genDaily(seedStr);
  level.notes = L.notes.map(n => ({ x: n.x*W, y: n.y*H, r: 12, label: n.l, f: n.f }));
  level.goal.x = L.goal.x * W; level.goal.y = L.goal.y * H; level.goal.r = 16;
  byId("note-total").textContent = level.notes.length;
  resetPuck(); updateStatus(`Daily ${seedStr}`);
  syncLevelToWorker();
}
function applyLevel(idx){
  levelIndex = clamp(idx, 0, LEVELS.length-1);
  const L = LEVELS[levelIndex];
  level.notes = L.notes.map(n => ({ x: n.x*W, y: n.y*H, r: 12, label: n.l, f: n.f }));
  level.goal.x = L.goal.x * W; level.goal.y = L.goal.y * H; level.goal.r = 16;
  byId("note-total").textContent = level.notes.length;
  resetPuck(); dailySeed = null;
  syncLevelToWorker();
}
function reflowLevel(){
  if(dailySeed){ applyDaily(dailySeed); return; }
  const L = LEVELS[levelIndex];
  if(!L || !level.notes.length) return;
  level.notes.forEach((n,i)=>{ n.x = L.notes[i].x * W; n.y = L.notes[i].y * H; });
  level.goal.x = L.goal.x * W; level.goal.y = L.goal.y * H;
}

/* Runtime */
let nextNoteIndex = 0;
let running = false, t = 0, score = null;
let constellation = [];

/* UI refs */
const elPlanetCount = byId("planet-count");
const elPlanetMax   = byId("planet-max");
const elNoteProg    = byId("note-progress");
const elStatus      = byId("status");
const elTime        = byId("time");
const elScore       = byId("score");
elPlanetMax.textContent = MAX_PLANETS;

/* Toggle refs */
const chkTrails   = byId("chk-trails");
const chkAudio    = byId("chk-audio");
const chkPhys     = byId("chk-physics");
const chkCollide  = byId("chk-collide");
const chkHarm     = byId("chk-harmonics");
const chkTime     = byId("chk-time");
const chkEdit     = byId("chk-edit") || {checked:false};
const chkReduce   = byId("chk-reduce") || {checked:false};
const chkContrast = byId("chk-contrast") || {checked:false};
const chkHaptics  = byId("chk-haptics") || {checked:true};
const selBackend  = byId("sel-backend");
const inpName     = byId("inp-name");

/* Buttons & selects */
const selLevel = byId("sel-level");
const btnShare = byId("btn-share");
const btnPing  = byId("btn-ping");
const btnDaily = byId("btn-daily");
const btnTop   = byId("btn-top");
const btnLaunch= byId("btn-launch");
const btnReset = byId("btn-reset");
const btnClear = byId("btn-clear");
const btnUndo  = byId("btn-undo");

/* Help & panel */
const panelEl = byId("panel"), btnHideUI = byId("btn-hide-ui"), btnShowUI = byId("btn-show-ui");
const titleEl = document.querySelector(".title");
const helpWin = byId("help"), helpDrag = byId("help-drag"), btnHelpToggle = byId("btn-help-toggle"), btnHelpClose = byId("btn-help-close");

/* Leaderboard overlay */
const lbWin = byId("leaderboard"), lbDrag = byId("lb-drag"), btnLbClose=byId("btn-lb-close"), lbBody=byId("lb-body"), lbSeedLabel=byId("lb-seed");

/* Persisted UI preferences */
(function(){
  const pos = JSON.parse(localStorage.getItem("gravi_panel_pos")||"null");
  if(pos){ panelEl.style.left = pos.left + "px"; panelEl.style.top = pos.top + "px"; }
  if(localStorage.getItem("gravi_ui_hidden")==="1"){ hideUI(true); }
  if(localStorage.getItem("gravi_reduce")==="1"){ chkReduce.checked=true; document.body.classList.add("reduced-motion"); }
  if(localStorage.getItem("gravi_contrast")==="1"){ chkContrast.checked=true; document.body.classList.add("high-contrast"); }
  if(localStorage.getItem("gravi_haptics")==="0"){ chkHaptics.checked=false; useHaptics=false; }
  const b = localStorage.getItem("gravi_backend") || "sheets";
  selBackend.value = b;
})();

/* Drag the main panel */
let dragging=false, dx=0, dy=0;
titleEl.addEventListener("mousedown", (e)=>{
  dragging = true; panelEl.classList.add("dragging");
  const rect = panelEl.getBoundingClientRect(); dx = e.clientX - rect.left; dy = e.clientY - rect.top;
  window.addEventListener("mousemove", onDrag);
  window.addEventListener("mouseup", onUp, { once: true });
});
function onDrag(e){
  if(!dragging) return;
  const L = Math.max(8, Math.min(innerWidth  - panelEl.offsetWidth  - 8, e.clientX - dx));
  const T = Math.max(8, Math.min(innerHeight - panelEl.offsetHeight - 8, e.clientY - dy));
  panelEl.style.left = L + "px"; panelEl.style.top = T + "px";
}
function onUp(){
  dragging = false; panelEl.classList.remove("dragging");
  window.removeEventListener("mousemove", onDrag);
  const rect = panelEl.getBoundingClientRect();
  localStorage.setItem("gravi_panel_pos", JSON.stringify({ left: rect.left, top: rect.top }));
}
function hideUI(silent=false){
  panelEl.style.display = "none"; btnShowUI.style.display = "inline-flex";
  localStorage.setItem("gravi_ui_hidden","1");
  if(!silent) flashStatus("UI hidden (press H to show)","warn");
}
function showUI(){ panelEl.style.display = ""; btnShowUI.style.display = "none"; localStorage.removeItem("gravi_ui_hidden"); }
btnHideUI?.addEventListener("click", ()=> hideUI());
btnShowUI?.addEventListener("click", ()=> showUI());

/* Help: show/hide + draggable */
(function(){
  const vis = localStorage.getItem("gravi_help_hidden") === "1" ? false : true;
  helpWin.hidden = !vis;
  const pos = JSON.parse(localStorage.getItem("gravi_help_pos")||"null");
  if(pos){ helpWin.style.left = pos.left + "px"; helpWin.style.top = pos.top + "px"; helpWin.style.right="auto"; helpWin.style.bottom="auto"; }
})();
function setHelpVisible(v){ helpWin.hidden = !v; localStorage.setItem("gravi_help_hidden", v? "0":"1"); }
btnHelpToggle.addEventListener("click", ()=> setHelpVisible(helpWin.hidden));
btnHelpClose.addEventListener("click", ()=> setHelpVisible(false));
let hdrag=false, hx=0, hy=0;
helpDrag.addEventListener("mousedown", (e)=>{
  hdrag=true; const r=helpWin.getBoundingClientRect(); hx=e.clientX - r.left; hy=e.clientY - r.top;
  window.addEventListener("mousemove", onHelpDrag); window.addEventListener("mouseup", onHelpUp, { once:true });
});
function onHelpDrag(e){
  if(!hdrag) return;
  const L=Math.max(8, Math.min(innerWidth - helpWin.offsetWidth  - 8, e.clientX - hx));
  const T=Math.max(8, Math.min(innerHeight- helpWin.offsetHeight - 8, e.clientY - hy));
  helpWin.style.left=L+"px"; helpWin.style.top=T+"px"; helpWin.style.right="auto"; helpWin.style.bottom="auto";
}
function onHelpUp(){
  hdrag=false; window.removeEventListener("mousemove", onHelpDrag);
  const r=helpWin.getBoundingClientRect(); localStorage.setItem("gravi_help_pos", JSON.stringify({left:r.left, top:r.top}));
}
addEventListener("keydown", (e)=>{ if(e.key==="j"||e.key==="J"){ setHelpVisible(helpWin.hidden); }});

/* Leaderboard overlay */
function toggleLeaderboard(v){ lbWin.hidden = (v===undefined)? !lbWin.hidden : !v; }
btnLbClose.addEventListener("click", ()=> toggleLeaderboard(false));
let lbdrag=false, lbx=0,lby=0;
lbDrag.addEventListener("mousedown", (e)=>{
  lbdrag=true; const r=lbWin.getBoundingClientRect(); lbx=e.clientX - r.left; lby=e.clientY - r.top;
  window.addEventListener("mousemove", onLbDrag); window.addEventListener("mouseup", onLbUp, {once:true});
});
function onLbDrag(e){
  if(!lbdrag) return;
  const L=Math.max(8, Math.min(innerWidth - lbWin.offsetWidth  - 8, e.clientX - lbx));
  const T=Math.max(8, Math.min(innerHeight- lbWin.offsetHeight - 8, e.clientY - lby));
  lbWin.style.left=L+"px"; lbWin.style.top=T+"px"; lbWin.style.right="auto"; lbWin.style.bottom="auto";
}
function onLbUp(){ lbdrag=false; window.removeEventListener("mousemove", onLbDrag); }
btnTop.addEventListener("click", async ()=>{
  lbSeedLabel.textContent = "· " + currentSeedKey();
  toggleLeaderboard(true);
  await renderTop();
});

/* Toggle wiring */
chkPhys.addEventListener("change", e=> { ultraPhysics = !!e.target.checked; syncOptionsToWorker(); });
chkCollide.addEventListener("change", e=> { wallsBounce   = !!e.target.checked; syncOptionsToWorker(); });
chkAudio.addEventListener("change", e=> synth.enabled   = !!e.target.checked);
chkHarm.addEventListener("change",  e=> useHarmonics   = !!e.target.checked);
chkTime.addEventListener("change",  e=> { useTimeDilation = !!e.target.checked; syncOptionsToWorker(); });

chkEdit?.addEventListener("change", e=> editMode = !!e.target.checked);
chkReduce?.addEventListener("change", e=>{
  document.body.classList.toggle("reduced-motion", e.target.checked);
  localStorage.setItem("gravi_reduce", e.target.checked? "1":"0");
});
chkContrast?.addEventListener("change", e=>{
  document.body.classList.toggle("high-contrast", e.target.checked);
  localStorage.setItem("gravi_contrast", e.target.checked? "1":"0");
});
chkHaptics?.addEventListener("change", e=>{
  useHaptics = !!e.target.checked;
  localStorage.setItem("gravi_haptics", useHaptics? "1":"0");
});
selBackend.addEventListener("change", (e)=>{
  const val = e.target.value; localStorage.setItem("gravi_backend", val);
  window.Leaderboard?.selectBackend(val);
});
selLevel?.addEventListener("change", ()=> { applyLevel(+selLevel.value); });

/* Buttons */
btnLaunch?.addEventListener("click", ()=> launch());
btnReset ?.addEventListener("click", ()=> resetPuck());
btnClear ?.addEventListener("click", ()=> { planets.length=0; updatePlanetCount(); syncPlanetsToWorker(); });
btnUndo  ?.addEventListener("click", ()=> { planets.pop(); updatePlanetCount(); syncPlanetsToWorker(); });

btnPing?.addEventListener("click", ()=>{
  ensureAudioReady();
  if(chkAudio.checked){ synth.seq([440, 660, 880]); flashStatus("Audio unlocked ✓","good"); }
  else { flashStatus("Audio is off (toggle Audio)","warn"); }
});
btnPing?.addEventListener("contextmenu", (e)=>{ e.preventDefault(); ensureAudioReady(); flashStatus("Audio unlocked silently ✓","good"); });
btnDaily?.addEventListener("click", ()=> applyDaily(fmtDateJakarta()));

/* Canvas interactions (place/remove planets or drag notes/goal) */
canvas.addEventListener("contextmenu", e=> e.preventDefault());
let dragTarget = null;
canvas.addEventListener("mousedown", (e)=>{
  ensureAudioReady();
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left, y = e.clientY - rect.top;

  if(editMode){
    const dg = Math.hypot(level.goal.x - x, level.goal.y - y);
    if(dg < level.goal.r + 14){ dragTarget = { type:"goal", offx: level.goal.x - x, offy: level.goal.y - y }; return; }
    for(let i=0;i<level.notes.length;i++){
      const n = level.notes[i];
      const d = Math.hypot(n.x - x, n.y - y);
      if(d < n.r + 14){ dragTarget = { type:"note", idx:i, offx: n.x - x, offy: n.y - y }; return; }
    }
    return;
  }

  if(e.button === 2){
    if(!planets.length) return;
    let best=-1, bd=1e9;
    for(let i=0;i<planets.length;i++){
      const p=planets[i]; const d=(p.x-x)**2 + (p.y-y)**2;
      if(d<bd){ bd=d; best=i; }
    }
    if(best>=0) planets.splice(best,1);
    updatePlanetCount(); syncPlanetsToWorker(); return;
  }
  if(planets.length>=MAX_PLANETS) return flashStatus("Planet limit reached","warn");
  const mass = 4 + Math.random()*10; const r = 10 + mass*1.4;
  planets.push({x,y,mass,r});
  synth.tone(180+Math.random()*120, 0.12, 0.10);
  updatePlanetCount(); syncPlanetsToWorker();
});
addEventListener("mousemove", (e)=>{
  if(!dragTarget) return;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left, y = e.clientY - rect.top;
  if(dragTarget.type==="goal"){
    level.goal.x = clamp(x + dragTarget.offx, 20, W-20);
    level.goal.y = clamp(y + dragTarget.offy, 20, H-20);
  } else {
    const n = level.notes[dragTarget.idx];
    n.x = clamp(x + dragTarget.offx, 20, W-20);
    n.y = clamp(y + dragTarget.offy, 20, H-20);
  }
});
addEventListener("mouseup", ()=>{ if(dragTarget){ dragTarget=null; syncLevelToWorker(); }});

/* Export/Import JSON */
byId("btn-export")?.addEventListener("click", ()=>{
  const str = JSON.stringify(makeSharePayload(), null, 2);
  navigator.clipboard?.writeText(str);
  flashStatus("JSON copied ✓","good");
  alert("Setup copied to clipboard as JSON.\nUse Import JSON to load it back.");
});
byId("btn-import")?.addEventListener("click", ()=>{
  const str = prompt("Paste JSON payload:");
  if(!str) return;
  let obj=null; try{ obj = JSON.parse(str); }catch{ return alert("Invalid JSON"); }
  applySharePayload(obj); flashStatus("Imported ✓","good");
});

/* Share link (hash or query) */
const toB64 = (s)=> btoa(encodeURIComponent(s).replace(/%([0-9A-F]{2})/g, (_ ,p)=>String.fromCharCode("0x"+p)));
const fromB64 = (b64)=> decodeURIComponent(Array.from(atob(b64), c=> "%"+c.charCodeAt(0).toString(16).padStart(2,"0")).join(""));

function makeSharePayload(){
  return {
    v: 2,
    mode: dailySeed? "daily" : "classic",
    seed: dailySeed || null,
    lvl:  dailySeed? null : levelIndex,
    notes: level.notes.map(n=>({x:+(n.x/W).toFixed(4), y:+(n.y/H).toFixed(4), l:n.label})),
    goal:  { x:+(level.goal.x/W).toFixed(4), y:+(level.goal.y/H).toFixed(4) },
    planets: planets.map(p=>({x:+p.x.toFixed(1), y:+p.y.toFixed(1), mass:+p.mass.toFixed(2)})),
    opts: { trails: chkTrails.checked, audio: chkAudio.checked, ultra: chkPhys.checked, bounce: chkCollide.checked, harm: chkHarm.checked, time: chkTime.checked }
  };
}
function applySharePayload(obj){
  try{
    if(obj.mode==="daily" && obj.seed){ applyDaily(obj.seed); }
    else if(typeof obj.lvl==="number"){ selLevel.value = String(obj.lvl); applyLevel(obj.lvl); }
    if(obj.notes && obj.goal){
      level.notes = obj.notes.map(n => ({ x: n.x*W, y: n.y*H, r: 12, label: n.l, f: scaleHz[n.l] || scaleHz.C }));
      level.goal.x = obj.goal.x * W; level.goal.y = obj.goal.y * H; level.goal.r = 16;
      byId("note-total").textContent = level.notes.length;
    }
    planets.length = 0;
    (obj.planets||[]).forEach(p=> planets.push({x:+p.x, y:+p.y, mass:+p.mass, r: 10 + (+p.mass)*1.4}));
    if(obj.opts){
      chkTrails.checked=!!obj.opts.trails; chkAudio.checked=!!obj.opts.audio; synth.enabled = chkAudio.checked;
      chkPhys.checked  =!!obj.opts.ultra;  ultraPhysics  = chkPhys.checked;
      chkCollide.checked=!!obj.opts.bounce; wallsBounce  = chkCollide.checked;
      chkHarm.checked  =!!obj.opts.harm;   useHarmonics  = chkHarm.checked;
      chkTime.checked  =!!obj.opts.time;   useTimeDilation = chkTime.checked;
    }
    updatePlanetCount(); resetPuck(); syncAllToWorker();
  }catch(e){ console.warn("applySharePayload error", e); }
}
function updateHashFromState(){ const b64 = toB64(JSON.stringify(makeSharePayload())); location.hash = "g=" + b64; }
function loadStateFromUrl(){
  let b64 = null;
  const hm = (location.hash||"").match(/#g=([^&]+)/); if (hm && hm[1]) b64 = hm[1];
  if (!b64) { const q = new URLSearchParams(location.search); if (q.has("g")) b64 = q.get("g"); }
  if (!b64) return false;
  try{ applySharePayload(JSON.parse(fromB64(b64))); flashStatus("Loaded from URL ✓","good"); return true; }
  catch(e){ console.warn("Invalid share payload", e); return false; }
}
btnShare?.addEventListener("click", async ()=>{
  updateHashFromState();
  const url = location.origin + location.pathname + location.search + location.hash;
  const title = "GraviScore — by @wiqile";
  const text  = dailySeed? `Daily ${dailySeed}` : "Play my gravity song!";
  try{
    if (navigator.canShare?.({ url }) || navigator.share) { await navigator.share({ title, text, url }); flashStatus("Shared via native sheet ✓","good"); return; }
  }catch{}
  try{ await navigator.clipboard.writeText(url); flashStatus("Link copied ✓","good"); }
  catch{ window.prompt("Copy this link:", url); flashStatus("Copy from dialog ✓","good"); }
});

/* Status helpers */
function updatePlanetCount(){ elPlanetCount.textContent = planets.length; }
function updateStatus(msg, type){ elStatus.textContent = msg; elStatus.className = "pill" + (type? " "+type : ""); }
function flashStatus(msg, type="warn"){ updateStatus(msg, type); setTimeout(()=> updateStatus(running? "Flying…" : "Idle"), 900); }

/* Launch & reset */
function resetPuck(){
  puck.x = 90; puck.y = H*0.5; puck.vx = 130; puck.vy = 0; puck.trail.length = 0;
  t = 0; score = null; nextNoteIndex = 0; elNoteProg.textContent = 0;
  constellation = []; updateStatus("Idle"); elScore.textContent = "Score —";
  if("clearAppBadge" in navigator){ navigator.clearAppBadge().catch(()=>{}); }
  worker?.postMessage({ type:"reset" });
}
function launch(){ ensureAudioReady(); running = true; updateStatus("Flying…"); synth.seq([600,700,800]); worker?.postMessage({ type:"setRunning", running:true }); }
function stop(){ running = false; worker?.postMessage({ type:"setRunning", running:false }); }

/* Keyboard */
addEventListener("keydown", (e)=>{
  ensureAudioReady();
  if(e.key===" "){ e.preventDefault(); launch(); }
  if(e.key==="r"||e.key==="R"){ resetPuck(); }
  if(e.key==="u"||e.key==="U"){ planets.pop(); updatePlanetCount(); syncPlanetsToWorker(); }
  if(e.key==="h"||e.key==="H"){ panelEl.style.display==="none"? showUI(): hideUI(); }
  if(e.key==="p"||e.key==="P"){ btnPing?.click(); }
  if(e.key==="j"||e.key==="J"){ btnHelpToggle.click(); }
});

/* Physics (main-thread fallback when worker isn’t available) */
function nearestPlanetInfo(px, py){
  if(!planets.length) return null;
  let best=null, bd=1e9; for(const p of planets){ const dx=p.x-px, dy=p.y-py, d=Math.hypot(dx,dy); if(d<bd){ bd=d; best={p,d}; } }
  return best;
}
function stepLocal(dt){
  if(useTimeDilation){ for(const p of planets){ const d = Math.hypot(p.x - puck.x, p.y - puck.y); if(d < p.r*1.8){ dt*=0.85; } } }
  let ax=0, ay=0;
  for(const p of planets){
    const dx=p.x-puck.x, dy=p.y-puck.y; const d2 = dx*dx+dy*dy; const d = Math.sqrt(d2)+1e-6;
    const force = G * p.mass / (d2 + 200);
    ax += (dx/d) * force; ay += (dy/d) * force;
    if(d < p.r + puck.r){ running=false; updateStatus("Crashed into a planet ☄️","bad"); synth.seq([180,120,90]); if(useHaptics && navigator.vibrate) navigator.vibrate(20); return; }
  }
  const maxAcc = 4000; const mag = Math.hypot(ax, ay); if(mag>maxAcc){ ax*=maxAcc/mag; ay*=maxAcc/mag; }
  puck.vx += ax*dt; puck.vy += ay*dt; puck.x += puck.vx*dt; puck.y += puck.vy*dt;
  if(wallsBounce){
    if(puck.x < puck.r){ puck.x=puck.r; puck.vx = Math.abs(puck.vx)*0.9; }
    if(puck.x > W-puck.r){ puck.x=W-puck.r; puck.vx = -Math.abs(puck.vx)*0.9; }
    if(puck.y < puck.r){ puck.y=puck.r; puck.vy = Math.abs(puck.vy)*0.9; }
    if(puck.y > H-puck.r){ puck.y=H-puck.r; puck.vy = -Math.abs(puck.vy)*0.9; }
  } else if(puck.x<-50||puck.x>W+50||puck.y<-50||puck.y>H+50){ running=false; updateStatus("Out of bounds 🛰️","bad"); synth.seq([220,170,120]); }

  const glow = level.notes[nextNoteIndex];
  if(glow){
    const d = Math.hypot(glow.x-puck.x, glow.y-puck.y);
    if(d < glow.r + puck.r){
      nextNoteIndex++; elNoteProg.textContent = nextNoteIndex;
      let f = glow.f || scaleHz[glow.label] || 440;
      if(useHarmonics){ const info = nearestPlanetInfo(puck.x, puck.y); if(info){ const shift = clamp(Math.round((info.p.mass/Math.max(30,info.d))*3), -2, 2); f*=Math.pow(2, shift/12); } }
      if(chkAudio.checked) synth.tone(f, 0.22, 0.12);
      if(useHaptics && navigator.vibrate) navigator.vibrate(8);
      if(nextNoteIndex>1){ const prev = level.notes[nextNoteIndex-2]; constellation.push({x1:prev.x,y1:prev.y,x2:glow.x,y2:glow.y}); }
    }
  }
  if(nextNoteIndex === level.notes.length && level.notes.length){
    const d = Math.hypot(level.goal.x-puck.x, level.goal.y-puck.y);
    if(d < level.goal.r + puck.r){
      running=false; const timeBonus=Math.max(0,12 - t); const planetPenalty=planets.length*1.2;
      score = Math.max(1, Math.round(100 + timeBonus*8 - planetPenalty));
      updateStatus("Goal! ✨","good"); if(chkAudio.checked) synth.seq([523.25,659.25,783.99,1046.5]); elScore.textContent = `Score ${score}`;
      if("setAppBadge" in navigator){ navigator.setAppBadge(score).catch(()=>{}); }
      if(useHaptics && navigator.vibrate) navigator.vibrate([10,60,15]);
      submitScore();
    }
  }
}

/* Render */
function draw(){
  ctx.clearRect(0,0,W,H);
  const grd = ctx.createLinearGradient(0,0,W,H); grd.addColorStop(0,"#0a1220"); grd.addColorStop(1,"#0b0f14"); ctx.fillStyle=grd; ctx.fillRect(0,0,W,H);

  // grid
  ctx.strokeStyle="rgba(255,255,255,0.04)"; ctx.lineWidth=1;
  const gs=40; ctx.beginPath(); for(let x=0;x<W;x+=gs){ ctx.moveTo(x,0); ctx.lineTo(x,H); } for(let y=0;y<H;y+=gs){ ctx.moveTo(0,y); ctx.lineTo(W,y);} ctx.stroke();

  // constellation
  if(constellation.length){
    ctx.lineWidth=2;
    for(const seg of constellation){
      const g2 = ctx.createLinearGradient(seg.x1,seg.y1,seg.x2,seg.y2);
      g2.addColorStop(0,"rgba(125,211,252,0.35)"); g2.addColorStop(1,"rgba(192,132,252,0.35)");
      ctx.strokeStyle=g2; ctx.beginPath(); ctx.moveTo(seg.x1,seg.y1); ctx.lineTo(seg.x2,seg.y2); ctx.stroke();
    }
  }

  // notes
  for(let i=0;i<level.notes.length;i++){
    const n=level.notes[i]; const isNext=i===nextNoteIndex;
    const col = isNext? "#7dd3fc" : "rgba(125,211,252,0.4)";
    if(isNext && !document.body.classList.contains("reduced-motion")){ ctx.beginPath(); ctx.arc(n.x,n.y,n.r+10+Math.sin(performance.now()*0.006)*2,0,TAU); ctx.fillStyle="rgba(125,211,252,0.12)"; ctx.fill(); }
    ctx.beginPath(); ctx.arc(n.x,n.y,n.r,0,TAU); ctx.fillStyle=col; ctx.fill(); ctx.strokeStyle="rgba(255,255,255,0.2)"; ctx.stroke();
    ctx.fillStyle="#0b1020"; ctx.font="bold 12px system-ui,Segoe UI,Inter"; ctx.textAlign="center"; ctx.textBaseline="middle"; ctx.fillText(n.label,n.x,n.y);
  }

  // goal
  if(nextNoteIndex === level.notes.length && level.notes.length){
    const g=level.goal;
    if(!document.body.classList.contains("reduced-motion")){ ctx.beginPath(); ctx.arc(g.x,g.y,g.r+8+Math.sin(performance.now()*0.006)*2,0,TAU); ctx.fillStyle="rgba(52,211,153,0.12)"; ctx.fill(); }
    ctx.beginPath(); ctx.arc(g.x,g.y,g.r,0,TAU); ctx.fillStyle="#34d399"; ctx.fill(); ctx.strokeStyle="rgba(255,255,255,0.25)"; ctx.stroke();
  }

  // planets & rings
  planets.forEach(p=>{
    ctx.beginPath(); ctx.arc(p.x,p.y,p.r*1.8,0,TAU); ctx.strokeStyle="rgba(148,163,184,0.10)"; ctx.stroke();
    ctx.beginPath(); ctx.arc(p.x,p.y,p.r*2.2,0,TAU); ctx.strokeStyle="rgba(192,132,252,0.12)"; ctx.stroke();
    const grad = ctx.createRadialGradient(p.x-4,p.y-6,p.r*0.2,p.x,p.y,p.r);
    grad.addColorStop(0,"#c084fc"); grad.addColorStop(1,"#5b21b6");
    ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,TAU); ctx.fillStyle=grad; ctx.fill(); ctx.strokeStyle="rgba(255,255,255,0.25)"; ctx.stroke();
  });

  // trail
  if(chkTrails.checked){
    ctx.beginPath();
    for(let i=0;i<puck.trail.length;i++){ const pt=puck.trail[i]; if(i===0) ctx.moveTo(pt.x,pt.y); else ctx.lineTo(pt.x,pt.y); }
    ctx.strokeStyle="rgba(125,211,252,0.3)"; ctx.lineWidth=2; ctx.stroke();
  }

  // puck + emitter
  ctx.beginPath(); ctx.arc(puck.x,puck.y,puck.r,0,TAU); ctx.fillStyle="#e6f0ff"; ctx.fill(); ctx.strokeStyle="rgba(255,255,255,0.35)"; ctx.stroke();
  ctx.beginPath(); ctx.arc(90, H*0.5, 10, 0, TAU); ctx.fillStyle="#94a3b8"; ctx.fill();
}

/* Worker wiring (optional) */
let worker = null;
const hasWorker = !!window.Worker;
function toWorkerLevel(){ return { notes: level.notes.map(n => ({ x:n.x, y:n.y, r:n.r, label:n.label })), goal: { x: level.goal.x, y: level.goal.y, r: level.goal.r } }; }
function syncOptionsToWorker(){ worker?.postMessage({ type:"setOptions", opts:{ ultraPhysics, wallsBounce, useTimeDilation } }); }
function syncPlanetsToWorker(){ worker?.postMessage({ type:"updatePlanets", planets }); }
function syncLevelToWorker(){ worker?.postMessage({ type:"updateLevel", level: toWorkerLevel(), opts:{ W,H } }); }
function syncAllToWorker(){ syncOptionsToWorker(); syncPlanetsToWorker(); syncLevelToWorker(); }

function initWorker(){
  if(!hasWorker) return;
  try{
    worker = new Worker("./worker.js");
    worker.onmessage = (e)=>{
      const m = e.data;
      if(m.type === "state"){
        puck.x = m.puck.x; puck.y = m.puck.y; puck.vx = m.puck.vx; puck.vy = m.puck.vy;
        running = m.running; t = m.t; nextNoteIndex = m.nextNoteIndex;
        elTime.textContent = `Time ${t.toFixed(2)}s`;
      } else if(m.type === "event"){
        if(m.name === "note"){
          const idx = m.data.index; elNoteProg.textContent = idx;
          const captured = level.notes[idx-1];
          if(captured){
            let f = captured.f || scaleHz[captured.label] || 440;
            if(useHarmonics){
              const info = nearestPlanetInfo(puck.x, puck.y);
              if(info){ const shift = clamp(Math.round((info.p.mass/Math.max(30,info.d))*3), -2, 2); f *= Math.pow(2, shift/12); }
            }
            if(chkAudio.checked) synth.tone(f, 0.22, 0.12);
            if(useHaptics && navigator.vibrate) navigator.vibrate(8);
            if(idx>1){ const prev = level.notes[idx-2]; constellation.push({x1:prev.x,y1:prev.y,x2:captured.x,y2:captured.y}); }
          }
        } else if(m.name === "goal"){
          score = m.data.score; updateStatus("Goal! ✨","good"); elScore.textContent = `Score ${score}`;
          if(chkAudio.checked) synth.seq([523.25,659.25,783.99,1046.5]);
          if("setAppBadge" in navigator){ navigator.setAppBadge(score).catch(()=>{}); }
          if(useHaptics && navigator.vibrate) navigator.vibrate([10,60,15]);
          submitScore();
        } else if(m.name === "crash"){
          updateStatus("Crashed into a planet ☄️","bad"); synth.seq([180,120,90]); if(useHaptics && navigator.vibrate) navigator.vibrate(20);
        } else if(m.name === "oob"){
          updateStatus("Out of bounds 🛰️","bad"); synth.seq([220,170,120]);
        }
      }
    };
    worker.postMessage({ type:"init", opts: { W,H,G, ultraPhysics, wallsBounce, useTimeDilation }, level: toWorkerLevel(), planets });
  }catch(err){ console.warn("Worker init failed, fallback main thread", err); worker = null; }
}

/* Leaderboard helpers */
function currentSeedKey(){ return dailySeed ? `daily:${dailySeed}` : `level:${levelIndex}`; }
function getPlayerName(){ return (inpName.value || "").trim().slice(0,16); }
async function submitScore(){
  try{
    const payload = { seed: currentSeedKey(), score, planets: planets.length, uid, name: getPlayerName() || null, when: Date.now() };
    const backend = selBackend.value;
    await window.Leaderboard?.selectBackend(backend).submit(payload);
    if(!lbWin.hidden) await renderTop();
  }catch(e){ console.warn("submitScore failed", e); }
}
async function renderTop(){
  lbBody.innerHTML = `<tr><td colspan="5">Loading…</td></tr>`;
  try{
    const list = await window.Leaderboard?.selectBackend(selBackend.value).fetchTop(currentSeedKey(), 10);
    lbBody.innerHTML = "";
    (list || []).forEach((r,i)=>{
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${i+1}</td><td>${(r.name||"—")}</td><td>${r.score}</td><td>${r.planets||"-"}</td><td>${new Date(r.when||Date.now()).toLocaleString()}</td>`;
      lbBody.appendChild(tr);
    });
    if(!list || !list.length){ lbBody.innerHTML = `<tr><td colspan="5">No scores yet.</td></tr>`; }
  }catch(e){
    lbBody.innerHTML = `<tr><td colspan="5">Error loading leaderboard.</td></tr>`;
  }
}

/* Main loop */
let last = performance.now();
function loop(){
  const now = performance.now();
  let dt = Math.min(0.05, (now - last)/1000); last = now;

  if(running){
    const sub = ultraPhysics? 3 : 1; const sdt = dt/sub;
    if(worker){ worker.postMessage({ type:"step", dt }); }
    else { for(let i=0;i<sub;i++) stepLocal(sdt); t += dt; elTime.textContent = `Time ${t.toFixed(2)}s`; }
  }

  if(chkTrails.checked){
    puck.trail.push({x:puck.x,y:puck.y}); while(puck.trail.length>trailMax) puck.trail.shift();
  }

  draw();
  requestAnimationFrame(loop);
}

/* Boot */
resize();
applyLevel(0);
byId("note-total").textContent = level.notes.length;
elScore.textContent = "Score —";
updatePlanetCount();
updateStatus("Idle");
loadStateFromUrl();
initWorker();
window.Leaderboard?.selectBackend(selBackend.value); // init adapter
loop();

/* PWA SW (safe to keep; disable if it confuses dev caching) */
if ("serviceWorker" in navigator) {
  addEventListener("load", () => { navigator.serviceWorker.register("./sw.js").catch(()=>{}); });
}
