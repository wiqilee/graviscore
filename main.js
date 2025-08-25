/* GraviScore — Main (full UI)
   © 2025 @wiqile | Code: AGPL-3.0-or-later | Assets: CC BY-NC 4.0
   Visible credit required: “GraviScore — by @wiqile”
*/

// -------- Worker & flags first (avoid TDZ)
let worker = null;
let workerReady = false;

// -------- Canvas
const canvas =
  document.getElementById("canvas") ||
  document.querySelector("canvas");
if (!canvas) throw new Error("Canvas element not found.");
const ctx = canvas.getContext("2d", { alpha: false });

// -------- Options / state
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
let editMode = false;
let drag = null; // {type:'note'|'goal', index?, dx,dy}

const uid =
  localStorage.getItem("gravi_uid") ||
  (localStorage.setItem("gravi_uid", crypto.randomUUID()), localStorage.getItem("gravi_uid"));
let playerName = localStorage.getItem("gravi_name") || "";
let seed = "level:0";
let daily = false;

let audioCtx = null;

// -------- Utils
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dpr = () => Math.min(window.devicePixelRatio || 1, 2);
function rescaleCanvas() {
  const DPR = dpr();
  canvas.width  = Math.max(1, Math.floor(window.innerWidth  * DPR));
  canvas.height = Math.max(1, Math.floor(window.innerHeight * DPR));
  canvas.style.width  = "100vw";
  canvas.style.height = "100vh";
}
function toWorld(ev){
  const r = canvas.getBoundingClientRect();
  const DPR = dpr();
  return { x:(ev.clientX - r.left)*DPR, y:(ev.clientY - r.top)*DPR };
}
function b64u(s){ return btoa(unescape(encodeURIComponent(s))).replace(/=+$/g,'').replace(/\+/g,'-').replace(/\//g,'_'); }
function ub64u(s){ s=s.replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4) s+='='; return decodeURIComponent(escape(atob(s))); }
function todaySeed(){ const d=new Date(); const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,'0'); const dd=String(d.getDate()).padStart(2,'0'); return `daily:${y}-${m}-${dd}`; }

// -------- Level load/share
function starterLevel(){
  const W=canvas.width, H=canvas.height, cx=W*0.55, cy=H*0.5, r=Math.min(W,H)*0.2;
  level = {
    notes:[
      {x:cx-r,      y:cy,        r:10},
      {x:cx-r*0.2,  y:cy-r*0.9,  r:10},
      {x:cx+r*0.45, y:cy-r*0.5,  r:10},
      {x:cx+r*0.8,  y:cy+r*0.2,  r:10},
    ],
    goal:{x:cx+r*1.2,y:cy+r*0.5,r:16}
  };
}
function applyShareParam(){
  const url = new URL(location.href);
  const g = url.hash.slice(3) || url.searchParams.get("g");
  if(!g){ starterLevel(); return; }
  try{
    const obj = JSON.parse(ub64u(g));
    if(obj.level) level = obj.level;
    if(Array.isArray(obj.planets)) planets = obj.planets;
    if(obj.opts){
      ({ G = G, ultraPhysics = ultraPhysics, wallsBounce = wallsBounce, useTimeDilation = useTimeDilation } = obj.opts);
    }
  }catch{ starterLevel(); }
}
function buildShareObject(){
  return { level, planets, opts:{ G, ultraPhysics, wallsBounce, useTimeDilation } };
}
function setShareLink(){
  const packed = b64u(JSON.stringify(buildShareObject()));
  history.replaceState(null, "", "#g="+packed);
}

// -------- Worker
function initWorker(){
  try{
    worker = new Worker("./worker.js", { type:"module" });
  }catch(err){
    console.warn("[worker] module failed, fallback classic", err);
    worker = new Worker("./worker.js");
  }
  worker.onmessage = (e)=>{
    const msg = e.data;
    if(msg.type==='state'){
      if(msg.puck) puck = msg.puck;
      running = !!msg.running;
      simTime = msg.t ?? simTime;
      nextNoteIndex = msg.nextNoteIndex ?? nextNoteIndex;
    }else if(msg.type==='event'){
      if(msg.name==='goal'){ running=false; onGoal(msg.data?.score ?? 0); }
      if(msg.name==='crash' || msg.name==='oob'){ running=false; }
      // 'note' event could trigger tiny haptic/sound here
    }
  };
  worker.postMessage({
    type:'init',
    opts:{ W:canvas.width, H:canvas.height, G, ultraPhysics, wallsBounce, useTimeDilation },
    planets, level
  });
  workerReady = true;
}
function syncLevelToWorker(){ if(workerReady && worker) worker.postMessage({type:'updateLevel', level}); }
function syncPlanetsToWorker(){ if(workerReady && worker) worker.postMessage({type:'updatePlanets', planets}); }
function setRunning(flag){ if(workerReady && worker) worker.postMessage({type:'setRunning', running:!!flag}); }
function resetSim(){ if(workerReady && worker) worker.postMessage({type:'reset'}); running=false; trail.length=0; }

// -------- Drawing
function drawGrid(){
  const W=canvas.width, H=canvas.height, step=40*dpr();
  ctx.fillStyle="#0b1016"; ctx.fillRect(0,0,W,H);
  ctx.strokeStyle="rgba(255,255,255,0.05)"; ctx.lineWidth=1;
  ctx.beginPath();
  for(let x=(W%step); x<W; x+=step){ ctx.moveTo(x+0.5,0); ctx.lineTo(x+0.5,H); }
  for(let y=(H%step); y<H; y+=step){ ctx.moveTo(0,y+0.5); ctx.lineTo(W,y+0.5); }
  ctx.stroke();
}
function drawPlanets(){
  for(const p of planets){
    ctx.strokeStyle="rgba(180,170,255,0.15)"; ctx.lineWidth=1;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r*1.4, 0, Math.PI*2); ctx.stroke();
    const grd=ctx.createRadialGradient(p.x-p.r*0.4,p.y-p.r*0.4,2,p.x,p.y,p.r);
    grd.addColorStop(0,"#a88cff"); grd.addColorStop(1,"#5d42b9");
    ctx.fillStyle=grd; ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill();
  }
}
function drawLevel(){
  level.notes.forEach((n,i)=>{
    const on = i < nextNoteIndex;
    ctx.fillStyle = on ? "#68ffc0" : "#91f0ff";
    ctx.globalAlpha = on ? 0.55 : 0.9;
    ctx.beginPath(); ctx.arc(n.x,n.y,n.r,0,Math.PI*2); ctx.fill();
    ctx.globalAlpha = 1;
  });
  ctx.strokeStyle="#7cf9a0"; ctx.lineWidth=2;
  ctx.beginPath(); ctx.arc(level.goal.x, level.goal.y, level.goal.r, 0, Math.PI*2); ctx.stroke();
}
function drawPuckTrail(){
  if(trailsEnabled && trail.length>1){
    ctx.strokeStyle="rgba(120,180,255,0.35)"; ctx.lineWidth=2;
    ctx.beginPath(); ctx.moveTo(trail[0].x, trail[0].y);
    for(let i=1;i<trail.length;i++) ctx.lineTo(trail[i].x, trail[i].y);
    ctx.stroke();
  }
  const r=puck.r;
  const g=ctx.createRadialGradient(puck.x-r*0.4, puck.y-r*0.4, 2, puck.x, puck.y, r);
  g.addColorStop(0,"#ffe7a8"); g.addColorStop(1,"#c48a2d");
  ctx.fillStyle=g; ctx.beginPath(); ctx.arc(puck.x,puck.y,r,0,Math.PI*2); ctx.fill();
}

// -------- UI (full)
function setupUI(){
  const root=document.getElementById("ui-root");
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
        <span class="badge" id="badgeCounts">Planets: 0/6 &nbsp;&nbsp; Notes: 0/4</span>
        <span class="badge right" id="badgeTimer" title="Simulation time">Idle</span>
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

  // HELP
  const helpBox = document.getElementById("helpBox");
  root.querySelector("#btnHelp").onclick = ()=> helpBox.classList.toggle("hidden");
  document.getElementById("btnHelpClose").onclick = ()=> helpBox.classList.add("hidden");
  root.querySelector("#btnHide").onclick = ()=>{
    document.getElementById("panel").classList.toggle("hidden");
  };

  // Actions
  root.querySelector("#btnLaunch").onclick = ()=>{ running=true; setRunning(true); };
  root.querySelector("#btnReset").onclick  = ()=>{ resetSim(); };
  root.querySelector("#btnClear").onclick  = ()=>{
    lastRemoved=null; planets=[]; syncPlanetsToWorker(); setShareLink(); updateBadges();
  };
  root.querySelector("#btnUndo").onclick   = ()=>{
    if(lastRemoved){ planets.push(lastRemoved); lastRemoved=null; syncPlanetsToWorker(); setShareLink(); updateBadges(); }
  };

  root.querySelector("#chkTrails").onchange = e => trailsEnabled = !!e.target.checked;
  root.querySelector("#chkAudio").onchange  = e => audioEnabled   = !!e.target.checked;
  root.querySelector("#chkUltra").onchange  = e => { ultraPhysics = !!e.target.checked; if(workerReady) worker.postMessage({type:'setOptions',opts:{ultraPhysics}}); };
  root.querySelector("#chkWalls").onchange  = e => { wallsBounce  = !!e.target.checked; if(workerReady) worker.postMessage({type:'setOptions',opts:{wallsBounce}}); };
  root.querySelector("#chkTime").onchange   = e => { useTimeDilation=!!e.target.checked; if(workerReady) worker.postMessage({type:'setOptions',opts:{useTimeDilation}}); };
  root.querySelector("#chkEdit").onchange   = e => editMode = !!e.target.checked;

  root.querySelector("#btnExport").onclick = ()=>{
    const blob = new Blob([JSON.stringify(buildShareObject(),null,2)], {type:"application/json"});
    const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="graviscore-level.json"; a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href), 2000);
  };
  root.querySelector("#btnImport").onclick = ()=>{
    const inp=document.createElement("input"); inp.type="file"; inp.accept="application/json";
    inp.onchange = ()=>{
      const f=inp.files?.[0]; if(!f) return;
      f.text().then(t=>{
        try{
          const obj=JSON.parse(t);
          if(obj.level) level=obj.level;
          if(Array.isArray(obj.planets)) planets=obj.planets;
          if(obj.opts){ ({ G = G, ultraPhysics = ultraPhysics, wallsBounce = wallsBounce, useTimeDilation = useTimeDilation } = obj.opts); }
          syncLevelToWorker(); syncPlanetsToWorker(); setShareLink(); updateBadges();
        }catch{ alert("Invalid JSON"); }
      });
    };
    inp.click();
  };

  root.querySelector("#chkDaily").onchange = e=>{
    daily = !!e.target.checked;
    seed  = daily ? todaySeed() : "level:0";
  };

  root.querySelector("#btnShare").onclick = ()=>{
    setShareLink();
    navigator.clipboard?.writeText(location.href);
  };

  root.querySelector("#btnTop").onclick = async ()=>{
    try{
      const api = window.Leaderboard?.selectBackend?.('sheets') || window.Leaderboard;
      const arr = await api.fetchTop(seed, 10);
      alert("Top 10 — "+seed+"\n\n"+arr.map((r,i)=>`${i+1}. ${r.name||"—"}  score:${r.score}  planets:${r.planets}`).join("\n"));
    }catch{ alert("Failed to fetch Top 10."); }
  };

  root.querySelector("#btnPing").onclick = ()=>{
    if(!audioEnabled) return;
    try{
      if(!audioCtx) audioCtx = new (window.AudioContext||window.webkitAudioContext)();
      const o=audioCtx.createOscillator(), g=audioCtx.createGain();
      o.frequency.value=880;
      g.gain.setValueAtTime(0.001, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.2, audioCtx.currentTime+0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime+0.22);
      o.connect(g).connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime+0.25);
    }catch{}
  };

  const nameInp = root.querySelector("#inpName");
  nameInp.oninput = (e)=>{ playerName = e.target.value.slice(0,24); localStorage.setItem("gravi_name", playerName); };

  updateBadges();
}

function updateBadges(){
  const badge = document.getElementById("badgeCounts");
  if(badge) badge.textContent = `Planets: ${planets.length}/6   Notes: ${level.notes.length}/4`;
}

// -------- Canvas interactions
canvas.addEventListener("contextmenu", e=>e.preventDefault());

canvas.addEventListener("mousedown", (e)=>{
  const pos = toWorld(e);
  if(editMode){
    // try grab a note or goal
    const hitNote = level.notes.findIndex(n=>Math.hypot(n.x-pos.x, n.y-pos.y) <= n.r+6);
    if(hitNote>=0){
      const n=level.notes[hitNote];
      drag={type:'note', index:hitNote, dx:pos.x-n.x, dy:pos.y-n.y};
      return;
    }
    const dg = Math.hypot(level.goal.x-pos.x, level.goal.y-pos.y);
    if(dg <= level.goal.r+8){
      drag={type:'goal', dx:pos.x-level.goal.x, dy:pos.y-level.goal.y};
      return;
    }
    return; // edit mode: no planet placement
  }

  if(e.button===2){
    if(!planets.length) return;
    // remove nearest
    let bi=0, bd=1e12;
    for(let i=0;i<planets.length;i++){
      const d=(planets[i].x-pos.x)**2+(planets[i].y-pos.y)**2;
      if(d<bd){ bd=d; bi=i; }
    }
    lastRemoved = planets.splice(bi,1)[0] || null;
    syncPlanetsToWorker(); setShareLink(); updateBadges();
  }else if(e.button===0){
    if(planets.length>=6) return;
    planets.push({x:pos.x,y:pos.y,r:15,mass:1});
    syncPlanetsToWorker(); setShareLink(); updateBadges();
  }
});

canvas.addEventListener("mousemove",(e)=>{
  if(!drag) return;
  const pos = toWorld(e);
  if(drag.type==='note'){
    const n = level.notes[drag.index];
    n.x = pos.x - drag.dx; n.y = pos.y - drag.dy;
    syncLevelToWorker(); setShareLink();
  }else if(drag.type==='goal'){
    level.goal.x = pos.x - drag.dx; level.goal.y = pos.y - drag.dy;
    syncLevelToWorker(); setShareLink();
  }
});
window.addEventListener("mouseup", ()=> drag=null);

// -------- Goal submit
async function onGoal(score){
  try{
    const api = window.Leaderboard?.selectBackend?.('sheets') || window.Leaderboard;
    await api.submit({ seed, score, planets:planets.length, uid, name:playerName||null, when:Date.now() });
    alert(`Goal! Score: ${score}`);
  }catch(e){ console.warn("submit failed", e); }
}

// -------- Main loop
let lastTs=0;
function loop(ts){
  if(!lastTs) lastTs=ts;
  const dt = Math.min(0.05, (ts-lastTs)/1000);
  lastTs = ts;

  if(running && workerReady) worker.postMessage({type:'step', dt});

  drawGrid(); drawLevel(); drawPlanets();

  if(running){
    trail.push({x:puck.x,y:puck.y});
    if(trail.length>TRAIL_MAX) trail.shift();
  }else if(trail.length){
    if(trail.length>4) trail.shift();
  }
  drawPuckTrail();

  const timer=document.getElementById("badgeTimer");
  if(timer) timer.textContent = running ? `${simTime.toFixed(2)}s` : "Idle";

  requestAnimationFrame(loop);
}

// -------- Init
function init(){
  rescaleCanvas();
  applyShareParam();
  if(!level?.notes?.length) starterLevel();
  setShareLink();

  setupUI();
  initWorker();
  syncLevelToWorker(); syncPlanetsToWorker();

  window.addEventListener("resize", ()=>{
    rescaleCanvas();
    if(workerReady) worker.postMessage({type:'init', opts:{W:canvas.width,H:canvas.height,G,ultraPhysics,wallsBounce,useTimeDilation}, planets, level});
  });

  seed = daily ? todaySeed() : "level:0";
  requestAnimationFrame(loop);
}

init();
