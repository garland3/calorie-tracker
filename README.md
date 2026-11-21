# Calories: a phone calorie tracker with Dropbox auto-sync

Files: index.html, sw.js, manifest.json, icon-192.png, icon-512.png

## 1. Host it (free, about 5 minutes)
1. Create a new GitHub repository, e.g. `calories`, and upload these 5 files.
2. Repo → Settings → Pages → "Deploy from a branch" → `main` / root → Save.
3. After about a minute it's live at `https://<your-username>.github.io/calories/`.

## 2. Install on your phone
- iPhone: open the URL in Safari → Share → "Add to Home Screen".
- Android: open it in Chrome → ⋮ → "Install app" or "Add to Home screen".
Always open it from the home screen icon. On iPhone, the home screen app stores its data separately from Safari.

## 3. Connect Dropbox (one time per device)
1. On dropbox.com/developers/apps, click "Create app" → Scoped access → App folder → name it (e.g. `my-calories`).
2. Permissions tab: tick `files.content.read` and `files.content.write` → Submit.
3. Settings tab: copy the **App key**. You don't need the secret or a redirect URI.
4. In the app: Settings & sync → paste the App key → "Open Dropbox to authorize" → Allow
   → copy the code Dropbox shows → switch back to the app → paste it → "Finish connecting".

After that it syncs on its own: after every change, when you open the app, and when you get back online.
The data is saved to `Dropbox/Apps/my-calories/calories.json`. Use the same App key on a second
device and both will stay in sync. Changes are merged per entry, so nothing is lost.
