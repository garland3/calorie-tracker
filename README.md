# Calories

### ▶ Live app: **https://garland3.github.io/calorie-tracker/**

[![CI](https://github.com/garland3/calorie-tracker/actions/workflows/ci.yml/badge.svg)](https://github.com/garland3/calorie-tracker/actions/workflows/ci.yml)

A small calorie tracker for your phone. It installs to the home screen, works offline, and can
optionally sync to your own Dropbox. No server and no account: data lives on the device (and in your
Dropbox, if you connect it).

Built to be used **one-handed and fast**: everything you tap often sits in a bottom bar within thumb
reach. Your most-logged foods are one-tap buttons there, and every add or delete shows an Undo message
instead of a confirm dialog. Swipe left/right (or tap a bar in the 7-day chart) to change day; tap the
date to jump back to today. Picking a food you've logged before fills in its calories, so Enter adds it.

Also: optional protein tracking, a daily goal with progress bar, a 7-day chart, Dropbox auto-sync
across devices, and backup export/import.

## Install on your phone
- **iPhone:** open the live URL in Safari → Share → "Add to Home Screen".
- **Android:** open it in Chrome → ⋮ → "Install app" or "Add to Home screen".

Always open it from the home screen icon. On iPhone the home-screen app stores its data separately from Safari.

## AI estimates (optional)
- **📷 Photo:** snap your plate. Claude lists each food with estimated calories and protein.
- **✨ Describe:** type what you ate ("2 eggs, toast with butter, latte") and tap ✨.

You review and adjust the estimate in a panel at the bottom, then add everything with one tap (Undo works too).
Anything typed in the food box is sent along with a photo as extra detail.

Setup: create an API key at [console.anthropic.com](https://console.anthropic.com) and paste it under
Settings & sync. The key stays on that device (it is not synced or uploaded anywhere except to Anthropic),
and each estimate is billed to your Anthropic account, typically about a cent or less. The app uses
`claude-opus-5-5` at low effort for speed, with automatic fallback if a request is declined.

## Connect Dropbox (one time per device)
1. On [dropbox.com/developers/apps](https://www.dropbox.com/developers/apps), click "Create app" → Scoped access → App folder → give it a name (e.g. `my-calories`).
2. Permissions tab: tick `files.content.read` and `files.content.write` → Submit.
3. Settings tab: copy the **App key**. You don't need the secret or a redirect URI.
4. In the app: Settings & sync → paste the App key → "Open Dropbox to authorize" → Allow
   → copy the code Dropbox shows → switch back to the app → paste it → "Finish connecting".

After that it syncs on its own: after every change, when you open the app, and when you get back online.
Data is saved to `Dropbox/Apps/<your app>/calories.json`. Use the same App key on a second device and both
stay in sync. Changes merge per entry (the newest edit wins), so nothing is lost.

## Development
Requires Node 20+.

```sh
npm install
npm run dev      # local dev server with hot reload
npm test         # unit tests (vitest)
npm run lint     # eslint
npm run build    # production build into dist/
npm run preview  # serve dist/ locally (the service worker only runs in builds)
npm run check    # lint + test + build, same as CI
```

### Layout
```
index.html          page markup (Vite entry)
src/main.js         UI: rendering, events, sync loop
src/data.js         data model, localStorage, merge logic (pure, unit tested)
src/dates.js        date helpers (pure, unit tested)
src/dropbox.js      Dropbox OAuth (PKCE) and file download/upload
src/ai.js           Claude photo/text calorie estimates (SDK lazy-loaded on first use)
src/sw.js           service worker template; the build fills in the file list and cache version
src/style.css       styles (light and dark)
public/             manifest and icons, copied as-is
tests/              vitest unit tests
```

### CI/CD
`.github/workflows/ci.yml` runs lint, tests and the build on every push and pull request. Pushes to
`main` also deploy `dist/` to GitHub Pages (Settings → Pages → Source: **GitHub Actions**).

The Vite build step means the UI can move to React, TypeScript, etc. later without changing the
deploy: `npm create vite` templates plug into the same `vite.config.js`. Keep `src/data.js` and `src/dropbox.js`
as they are; they have no UI dependencies.
