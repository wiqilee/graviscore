# GraviScore — Compose with Gravity

A musical gravity puzzler by **@wiqile** (2025).  
Place up to six planets, launch the puck, collect the glowing notes **in order**, and reach the goal. Build a melody with physics.

- **Daily Challenge** (date‑based seeds)
- **Level Editor** (drag notes & goal; saved in the Share link)
- **Share Link** (packs level + planets into the URL)
- **Dual Leaderboard**: Google Sheets (free, default) or optional Firebase
- **Accessibility**: Reduced Motion, High Contrast, Haptics
- **PWA‑ready**: manifest + service worker

> **Required credit** by license: keep the on‑screen footer “**GraviScore — by @wiqile**” and retain author attribution in source headers and the README.

---

## Play

When GitHub Pages is enabled, the game will be available at:

```
https://<your-username>.github.io/graviscore/
```

---

## Quick Start (Local)

```bash
# From the project root
npx serve . -l 3000
# Then open http://localhost:3000
```

---

## Leaderboard (Google Sheets — default, free)

This repo uses a tiny **Google Apps Script** web app as the backend.

### 1) Create the web app (server)

1. Create/open a Google Sheet (any name).
2. In that Sheet: **Extensions → Apps Script** (container‑bound project).
3. Replace the file contents with `Code.gs` from this repo (rate‑limited version).
4. **Deploy → New deployment → Web app**  
   - **Execute as:** *Me*  
   - **Who has access:** *Anyone*  
   - Copy the URL that **ends with `/exec`**.

### 2) Point the client to your endpoint

In `leaderboard.js`, set:

```js
const SHEETS_ENDPOINT = "https://script.google.com/.../exec";
```

The client submits scores with `text/plain` (no CORS preflight) and falls back to JSONP for reads, so it works cleanly on GitHub Pages.

**Server behavior**

- Keeps the **best score per (seed, uid)**.  
- Allows **display‑name updates** even if the score doesn’t improve.  
- Includes a **rate limit**: one submission per (seed, uid) every **10 seconds**.

---

## Optional: Firebase Backend

Fill your Firebase config in `leaderboard.js`, then select **Firebase** from the in‑game dropdown. If the config is empty, the app stays on the Sheets backend.

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

3. (Recommended) Disable Jekyll so all files (e.g., `sw.js`) are served as‑is:

```bash
touch .nojekyll
git add .nojekyll
git commit -m "chore: disable Jekyll for Pages"
git push
```

---

## Controls & Tips

- **Left‑click** to place a gravity planet; **right‑click** removes the nearest one.  
- Press **Launch** to fire the puck. Touch the notes **in order** to unlock the goal.  
- **Edit Mode** lets you drag notes and the goal; your edits are embedded in the Share link.  
- Click **Ping** once if your browser requires a user gesture to unlock audio.  
- **H** toggles the UI; **J** toggles “How to play.”

---

## License

- Code: **AGPL‑3.0‑or‑later**  
- Assets (images/audio/fonts): **CC BY‑NC 4.0**  

You must keep the visible on‑screen credit **“GraviScore — by @wiqile.”**

© 2025 wiqile
