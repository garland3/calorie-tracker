// Dropbox client: OAuth 2 with PKCE (no app secret), plus download/upload of one JSON file in the
// app's own folder (Dropbox/Apps/<app name>/calories.json).
//
// Two ways to sign in:
// - Redirect: Dropbox sends the browser back here with ?code=…. One tap, used in a normal browser tab.
// - Paste code: Dropbox shows a code to copy back into the app. Used in home-screen (standalone) apps,
//   where a redirect would land in the browser instead of the app (they keep separate storage),
//   and for a user's own Dropbox app, whose redirect URIs we don't control.
import { DROPBOX_APP_KEY } from './config.js';
import { readJSON, writeJSON } from './data.js';

const TOK_KEY = 'cal.dropbox.v1';
const CUSTOM_KEY_KEY = 'cal.appkey'; // user's own app key (advanced)
const PENDING_KEY = 'cal.dropbox.pending'; // { key, verifier, state, redirectUri } while signing in
const REMOTE_PATH = '/calories.json';
const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';

export class RevokedError extends Error {}

export const getToken = () => readJSON(TOK_KEY, null);
export const isConnected = () => !!getToken();
export const disconnect = () => localStorage.removeItem(TOK_KEY);

export const customAppKey = () => readJSON(CUSTOM_KEY_KEY, '') || '';
export const setCustomAppKey = key => (key ? writeJSON(CUSTOM_KEY_KEY, key) : localStorage.removeItem(CUSTOM_KEY_KEY));
export const hasBuiltInKey = () => !!DROPBOX_APP_KEY;
const appKey = () => customAppKey() || DROPBOX_APP_KEY;

export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;

/** The page URL without query/hash: must match a redirect URI registered on the Dropbox app. */
const redirectUri = () => location.origin + location.pathname;

const b64url = bytes =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = n => b64url(crypto.getRandomValues(new Uint8Array(n)));

/**
 * Start signing in. Returns { url, mode }: open `url`; with mode 'paste' the user brings back a code
 * for finishWithCode(), with mode 'redirect' Dropbox returns to this page and handleRedirect() finishes.
 */
export async function startAuth() {
  const key = appKey();
  if (!key) throw new Error('No Dropbox app key. Add yours under Advanced.');
  // Redirects only work with our own app (whose redirect URIs we registered) and outside home-screen mode.
  const mode = !customAppKey() && !isStandalone() ? 'redirect' : 'paste';
  const verifier = random(48);
  const state = random(16);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const params = {
    client_id: key,
    response_type: 'code',
    code_challenge: b64url(new Uint8Array(digest)),
    code_challenge_method: 'S256',
    token_access_type: 'offline',
  };
  const pending = { key, verifier, state };
  if (mode === 'redirect') {
    pending.redirectUri = redirectUri();
    Object.assign(params, { redirect_uri: pending.redirectUri, state });
  }
  writeJSON(PENDING_KEY, pending);
  return { url: 'https://www.dropbox.com/oauth2/authorize?' + new URLSearchParams(params), mode };
}

async function exchange(code, pending) {
  const body = { grant_type: 'authorization_code', code, code_verifier: pending.verifier, client_id: pending.key };
  if (pending.redirectUri) body.redirect_uri = pending.redirectUri;
  const r = await fetch(TOKEN_URL, { method: 'POST', body: new URLSearchParams(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error_description || j.error || String(r.status));
  writeJSON(TOK_KEY, { key: pending.key, refresh: j.refresh_token, access: j.access_token, exp: Date.now() + j.expires_in * 1000 });
  localStorage.removeItem(PENDING_KEY);
}

/** Paste-code flow: exchange the code the user copied from Dropbox. */
export async function finishWithCode(code) {
  const pending = readJSON(PENDING_KEY, null);
  if (!pending || pending.redirectUri) throw new Error('Tap "Connect Dropbox" first, then paste the code Dropbox shows you.');
  await exchange(code.trim(), pending);
}

/**
 * Redirect flow: call on page load. Returns null if this isn't a Dropbox redirect,
 * otherwise { ok: true } or { ok: false, message }. Cleans the code out of the URL either way.
 */
export async function handleRedirect() {
  const q = new URLSearchParams(location.search);
  if (!q.has('code') && !q.has('error')) return null;
  const pending = readJSON(PENDING_KEY, null);
  if (!pending?.redirectUri || q.get('state') !== pending.state) return null; // not ours
  history.replaceState(null, '', location.pathname + location.hash);
  if (q.has('error')) {
    localStorage.removeItem(PENDING_KEY);
    return { ok: false, message: q.get('error') === 'access_denied' ? 'Dropbox access was not allowed.' : q.get('error_description') || q.get('error') };
  }
  try {
    await exchange(q.get('code'), pending);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e.message };
  }
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
