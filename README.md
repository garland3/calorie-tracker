# Calories

### ▶ Live app: **https://garland3.github.io/calorie-tracker/**

[![CI](https://github.com/garland3/calorie-tracker/actions/workflows/ci.yml/badge.svg)](https://github.com/garland3/calorie-tracker/actions/workflows/ci.yml)

A small calorie tracker for your phone. It installs to the home screen, works offline, and can
optionally sync to your own Dropbox. No server and no account: data lives on the device (and in your
Dropbox, if you connect it).

Built to be used **one-handed and fast**: the food name is optional, so tap kcal, type 280, tap +. Everything you tap often sits in a bottom bar within thumb
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
and each estimate is billed to your Anthropic account. Pick the model under
Settings: **Claude Haiku 5.5** (default, fastest and cheapest, about $0.001 per estimate), Sonnet 5.5 or
Opus 5.5. All run at low effort for speed; Sonnet and Opus automatically retry on a fallback model if a
request is declined.

## Connect Dropbox
Settings & sync → **Connect Dropbox** → sign in and tap **Allow**.
- In a normal browser tab you come straight back, connected.
- In the home-screen app, Dropbox shows a code instead: copy it, switch back, and tap **Paste code & finish**.
  (Home-screen apps can't receive the redirect, because they keep separate storage from the browser.)

It then syncs on its own: after every change, when you open the app, and when you get back online.
Data lives in `Dropbox/Apps/<app name>/calories.json`; the app can't see anything else in your Dropbox.
Connect a second device the same way and both stay in sync. Changes merge per entry (newest edit wins).

Prefer your own Dropbox app? Settings → *Advanced: use your own Dropbox app* takes its App key.

### Maintainer: the built-in Dropbox app
`src/config.js` holds the public Dropbox App key (no secret is needed with PKCE). The Dropbox app is set up with
Scoped access → App folder, permissions `files.content.read` + `files.content.write`, "Allow public clients"
on, and redirect URIs `https://garland3.github.io/calorie-tracker/` and `http://localhost:5173/`.
While the app is in Dropbox's *development* status, up to 500 users can connect; apply for production
in the Dropbox app console before going past that.

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
