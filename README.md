# GraviScore — Compose with Gravity

A musical gravity puzzler by **@wiqile** (2025).  
Place up to six mini-planets, launch the puck, hit the glowing notes **in order**, then reach the goal. Build a melody with physics.

- **NEW:** Puck color feedback (yellow → red on hit), light **vibration**, **GAME OVER** overlay + screen shake  
- **NEW:** **Planet Bounce** (toggle) — bounce off planets instead of crashing  
- **NEW:** **Auto Reset on Crash** (toggle) — auto relaunch after a crash  
- **Daily Challenge** (date-based seeds)  
- **Level Editor** (drag notes & goal; saved into the Share link)  
- **Share Link** (packs level + edits into the URL)  
- **Dual Leaderboard:** Google Sheets (free, default) or optional Firebase  
- **Accessibility:** Reduced Motion, High Contrast, Haptics  
- **PWA-ready:** manifest + service worker

> **Required credit (license):** keep the on-screen footer **“GraviScore — by @wiqile”** and retain author attribution in source headers and the README.

---

## Live Demo

When GitHub Pages is enabled, the game will be available at:

```
https://<your-username>.github.io/graviscore/
```

(Your repo: `https://wiqilee.github.io/graviscore/`)

---

## How to Play

1) **Left-click** to place a gravity planet (max 6).  
2) Press **Launch** to fire the puck.  
3) Touch the glowing notes **in order** to unlock the goal.  
4) Reach the goal to finish and score.  
5) Toggle **Edit Mode** to drag notes/goal; your edits are embedded in the **Share Link**.  
6) Click **Ping** once if your browser needs a user gesture to unlock audio.

**Toggles to try:**
- **Planet Bounce** — puck bounces on planets (no instant game over)  
- **Auto Reset on Crash** — if crash occurs (with Planet Bounce off), auto-relaunch after ~0.5s  
- **Trails / Ultra Physics / Walls / Time Dilation**  
- **Reduced Motion / High Contrast / Haptics**

---

## Quick Start (Local)

```bash
# From the project root
npx serve . -l 3000
# Then open http://localhost:3000
```

---

## Leaderboard (Google Sheets — default, free)

This project uses a tiny **Google Apps Script** Web App as the backend.

### 1) Create the Web App (server)

1. Create/open a Google Sheet (any name).  
2. In that Sheet: **Extensions → Apps Script** (container-bound project).  
3. Replace the file contents with `Code.gs` from this repo (rate-limited version).  
4. **Deploy → New deployment → Web app**  
   - **Execute as:** *Me*  
   - **Who has access:** *Anyone*  
   - Copy the URL that **ends with `/exec`**.

### 2) Point the client to your endpoint

In `leaderboard.js`, set:

```js
const SHEETS_ENDPOINT = "https://script.google.com/.../exec";
```

Reads use `?action=top` (no auth) and submissions are `POST` (no CORS preflight needed on Pages).

**Server behavior**

- Stores the **best score per (seed, uid)**  
- Lets players **update display name** without improving the score  
- **Rate limit:** one submission per (seed, uid) every **10 seconds**

---

## Optional: Firebase Backend

Fill your Firebase config in `leaderboard.js`:

```js
const FIREBASE_CONFIG = {
  apiKey:     "…",
  authDomain: "…",
  projectId:  "…",
  appId:      "…"
};
```

Then pick **Firebase** from the in-game backend dropdown. If config is empty, the app stays on **Sheets**.

---

## Deploy to GitHub Pages

1. Commit and push:

```bash
git add -A
git commit -m "chore: publish to GitHub Pages"
git push
```

2. GitHub → **Settings → Pages**  
   - **Build and deployment:** *Deploy from a branch*  
   - **Branch:** `main` • **Folder:** `/` (root)

3. (Recommended) Disable Jekyll so all files (e.g., `sw.js`) are served as-is:

```bash
touch .nojekyll
git add .nojekyll
git commit -m "chore: disable Jekyll for Pages"
git push
```

**Tip (cache busting):**  
Append a query or bump the version param when testing:

```
https://<user>.github.io/graviscore/?cb=2
<!-- or -->
<script src="./main.js?v=14" defer></script>
```

---

## File Structure

```
graviscore/
├─ index.html
├─ main.js                 # game, UI, editor, sharing (with bounce/auto-reset/game-over)
├─ leaderboard.js          # Sheets + Firebase adapters
├─ worker-path-fix.js      # (optional) worker path helper
├─ manifest.webmanifest
├─ icons/
│  ├─ icon-192.png
│  ├─ icon-512.png
│  └─ og.png               # 1200x630 Open Graph preview
├─ sw.js                   # (optional) service worker
└─ .nojekyll               # recommended for GitHub Pages
```

---

## Controls & Tips

- **Left-click** place planet; **right-click** removes the nearest planet  
- **↑ Undo Planet** removes the last placed planet  
- **Walls** keep the puck in bounds; **Time Dilation** slows near gravity wells  
- **Haptics** adds subtle vibration on supported devices  
- Puck turns **red** briefly on impact; if **Planet Bounce** is off, a crash shows **GAME OVER** (press **Reset** or **Launch**)

Scoring combines base points, a **time bonus**, and a small **planet penalty**.

---

## License

- Code: **AGPL-3.0-or-later**  
- Assets (images/audio/fonts): **CC BY-NC 4.0**

You must keep the visible on-screen credit **“GraviScore — by @wiqile.”**

© 2025 wiqile

--- 

**Topics (suggested, ≤5):** `javascript-game, canvas, web-audio, gravity, puzzle-game`
