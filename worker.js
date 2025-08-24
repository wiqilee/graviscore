/* GraviScore Worker Physics | 2025 | by @wiqile
   Handles the physics simulation in a dedicated worker thread. No audio/DOM here. */

   let W = 0, H = 0;
   let G = 2300;
   let ultraPhysics = true;
   let wallsBounce = true;
   let useTimeDilation = true;
   
   const puck = { x: 90, y: 0, vx: 130, vy: 0, r: 7 };
   const trailMax = 160; // trail is rendered on the main thread (visual only), not used in the worker
   let planets = [];     // {x,y,mass,r}
   let level = { notes: [], goal: {x:0,y:0,r:16} };
   let running = false;
   let nextNoteIndex = 0;
   let t = 0;
   
   const DT_MAX = 0.05;
   
   const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
   
   function resetPuck() {
     puck.x = 90;
     puck.y = H * 0.5;
     puck.vx = 130;
     puck.vy = 0;
     t = 0;
     nextNoteIndex = 0;
   }
   
   function stepOnce(dt){
     // Time Dilation near planets
     if(useTimeDilation){
       for(const p of planets){
         const d = Math.hypot(p.x - puck.x, p.y - puck.y);
         if(d < p.r * 1.8){ dt *= 0.85; }
       }
     }
   
     // Gravity
     let ax=0, ay=0;
     for(const p of planets){
       const dx = p.x - puck.x, dy = p.y - puck.y;
       const d2 = dx*dx + dy*dy; const d = Math.sqrt(d2) + 1e-6;
       const force = G * p.mass / (d2 + 200); // softened
       ax += (dx/d) * force; ay += (dy/d) * force;
   
       // Planet collision
       if(d < p.r + puck.r){
         running = false;
         postMessage({ type:'event', name:'crash' });
         return;
       }
     }
   
     // Clamp acceleration
     const maxAcc = 4000; const mag = Math.hypot(ax, ay);
     if(mag > maxAcc){ ax *= maxAcc/mag; ay *= maxAcc/mag; }
   
     puck.vx += ax*dt; puck.vy += ay*dt;
     puck.x  += puck.vx*dt; puck.y  += puck.vy*dt;
   
     // Walls
     if(wallsBounce){
       if(puck.x < puck.r){ puck.x = puck.r; puck.vx = Math.abs(puck.vx)*0.9; }
       if(puck.x > W - puck.r){ puck.x = W - puck.r; puck.vx = -Math.abs(puck.vx)*0.9; }
       if(puck.y < puck.r){ puck.y = puck.r; puck.vy = Math.abs(puck.vy)*0.9; }
       if(puck.y > H - puck.r){ puck.y = H - puck.r; puck.vy = -Math.abs(puck.vy)*0.9; }
     } else {
       // Out-of-bounds if walls are disabled
       if(puck.x < -50 || puck.x > W+50 || puck.y < -50 || puck.y > H+50){
         running=false;
         postMessage({ type:'event', name:'oob' });
         return;
       }
     }
   
     // Note capture (must be in order)
     const glow = level.notes[nextNoteIndex];
     if(glow){
       const d = Math.hypot(glow.x - puck.x, glow.y - puck.y);
       if(d < glow.r + puck.r){
         nextNoteIndex++;
         postMessage({ type:'event', name:'note', data:{ index: nextNoteIndex } });
       }
     }
   
     // Goal (only after all notes are collected)
     if(nextNoteIndex === level.notes.length && level.notes.length){
       const d = Math.hypot(level.goal.x - puck.x, level.goal.y - puck.y);
       if(d < level.goal.r + puck.r){
         running = false;
         const timeBonus = Math.max(0, 12 - t);
         const planetPenalty = planets.length*1.2;
         const score = Math.max(1, Math.round(100 + timeBonus*8 - planetPenalty));
         postMessage({ type:'event', name:'goal', data:{ score } });
       }
     }
   }
   
   onmessage = (e)=>{
     const msg = e.data;
     switch(msg.type){
       case 'init': {
         ({W,H,G, ultraPhysics, wallsBounce, useTimeDilation} = msg.opts);
         planets = msg.planets || [];
         level = msg.level || level;
         resetPuck(); // initial sync
         postMessage({ type:'state', puck, running, t, nextNoteIndex });
         break;
       }
       case 'updatePlanets': {
         planets = msg.planets || [];
         break;
       }
       case 'updateLevel': {
         level = msg.level || level;
         nextNoteIndex = 0;
         break;
       }
       case 'setOptions': {
         ({ ultraPhysics = ultraPhysics, wallsBounce = wallsBounce, useTimeDilation = useTimeDilation } = msg.opts || {});
         break;
       }
       case 'setRunning': {
         running = !!msg.running;
         break;
       }
       case 'reset': {
         resetPuck();
         postMessage({ type:'state', puck, running, t, nextNoteIndex });
         break;
       }
       case 'step': {
         if(!running) {
           postMessage({ type:'state', puck, running, t, nextNoteIndex });
           break;
         }
         let dt = Math.min(DT_MAX, msg.dt || 0.016);
         const sub = ultraPhysics ? 3 : 1;
         const sdt = dt / sub;
         for(let i=0;i<sub;i++){
           stepOnce(sdt);
           if(!running) break;
         }
         t += dt;
         postMessage({ type:'state', puck, running, t, nextNoteIndex });
         break;
       }
     }
   };
   