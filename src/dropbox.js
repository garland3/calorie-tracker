// Dropbox client: OAuth PKCE with the "paste the code" flow (works inside home-screen apps, where
// redirects back to the app are unreliable), plus download/upload of one JSON file in the app folder.
import { readJSON, writeJSON } from './data.js';

const TOK_KEY = 'cal.dropbox.v1';
const APPKEY_KEY = 'cal.appkey';
const VERIFIER_KEY = 'cal.verifier';
const REMOTE_PATH = '/calories.json';
const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';

export class RevokedError extends Error {}

export const getToken = () => readJSON(TOK_KEY, null);
export const isConnected = () => !!getToken();
export const savedAppKey = () => readJSON(APPKEY_KEY, '') || '';
export const disconnect = () => localStorage.removeItem(TOK_KEY);

const b64url = bytes =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Step 1: returns the Dropbox authorize URL to open. Remembers the key and PKCE verifier for step 2. */
export async function authorizeUrl(appKey) {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  writeJSON(APPKEY_KEY, appKey);
  writeJSON(VERIFIER_KEY, verifier);
  return 'https://www.dropbox.com/oauth2/authorize?' + new URLSearchParams({
    client_id: appKey,
    response_type: 'code',
    code_challenge: b64url(new Uint8Array(digest)),
    code_challenge_method: 'S256',
    token_access_type: 'offline',
  });
}

/** Step 2: exchange the pasted code for a refresh token. */
export async function finishAuth(code) {
  const key = savedAppKey();
  const verifier = readJSON(VERIFIER_KEY, '');
  if (!key || !verifier) throw new Error('Do step 1 first, then paste the code Dropbox shows you.');
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: key }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error_description || j.error || String(r.status));
  writeJSON(TOK_KEY, { key, refresh: j.refresh_token, access: j.access_token, exp: Date.now() + j.expires_in * 1000 });
  localStorage.removeItem(VERIFIER_KEY);
}

async function accessToken() {
  const t = getToken();
  if (!t) return null;
  if (t.access && t.exp > Date.now() + 60_000) return t.access;
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refresh, client_id: t.key }),
  });
  if (r.status === 400 || r.status === 401) {
    disconnect();
    throw new RevokedError('Dropbox access revoked. Reconnect in Settings.');
  }
  if (!r.ok) throw new Error('token refresh ' + r.status);
  const j = await r.json();
  t.access = j.access_token;
  t.exp = Date.now() + j.expires_in * 1000;
  writeJSON(TOK_KEY, t);
  return t.access;
}

/** Returns the remote data object, or null if the file doesn't exist yet. */
export async function download() {
  const token = await accessToken();
  const r = await fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Dropbox-API-Arg': JSON.stringify({ path: REMOTE_PATH }) },
  });
  if (r.status === 409) {
    const t = await r.text();
    if (t.includes('not_found')) return null;
    throw new Error('download: ' + t);
  }
  if (!r.ok) throw new Error('download ' + r.status);
  return r.json();
}

export async function upload(obj) {
  const token = await accessToken();
  const r = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify({ path: REMOTE_PATH, mode: 'overwrite', mute: true }),
    },
    body: JSON.stringify(obj),
  });
  if (!r.ok) throw new Error('upload ' + r.status + ' ' + (await r.text()));
}
