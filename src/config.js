// Public app settings. Nothing here is secret.

// Dropbox app key for this app (dropbox.com/developers/apps). It's a public client ID: Dropbox's PKCE
// flow needs no app secret, so it's safe to commit. With it set, users just tap "Connect Dropbox";
// without it, they have to create their own Dropbox app under Settings → Advanced.
// The app's OAuth redirect URIs must include the deployed URL (and http://localhost:5173/ for dev).
export const DROPBOX_APP_KEY = '';
