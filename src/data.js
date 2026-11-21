// Data model, local persistence and merging. No DOM access here, so it can be unit tested.
//
// Shape: { entries: { [id]: Entry }, settings: { goal, updated } }
// Entry: { id, date: 'YYYY-MM-DD', name, kcal, protein|null, created, updated, deleted? }
// Deleted entries are kept as tombstones so a deletion syncs to other devices.

export const DATA_KEY = 'cal.data.v1';
export const DIRTY_KEY = 'cal.dirty.v1';

export const emptyData = () => ({ entries: {}, settings: { goal: 2000, updated: 0 } });

export function readJSON(key, fallback, storage = globalThis.localStorage) {
  try {
    const v = JSON.parse(storage.getItem(key));
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeJSON(key, value, storage = globalThis.localStorage) {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error(e);
  }
}

/** Coerce anything (old localStorage, an imported file, a remote copy) into a valid data object, or null. */
export function normalize(raw) {
  if (!raw || typeof raw !== 'object' || !raw.entries || typeof raw.entries !== 'object') return null;
  const entries = {};
  for (const [id, e] of Object.entries(raw.entries)) {
    if (!e || typeof e !== 'object' || typeof e.date !== 'string' || typeof e.name !== 'string') continue;
    entries[id] = { ...e, id, kcal: Number(e.kcal) || 0, updated: Number(e.updated) || 0, created: Number(e.created) || 0 };
  }
  const s = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
  return { entries, settings: { goal: Number(s.goal) || 0, updated: Number(s.updated) || 0 } };
}

export const uid = () =>
  globalThis.crypto?.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);

export const liveEntries = data => Object.values(data.entries).filter(e => !e.deleted);

export const entriesForDay = (data, day) =>
  liveEntries(data).filter(e => e.date === day).sort((a, b) => a.created - b.created);

export const dayTotal = (data, day) => entriesForDay(data, day).reduce((t, e) => t + (e.kcal || 0), 0);

export function makeEntry({ date, name, kcal, protein }, now = Date.now()) {
  const p = protein === '' || protein == null || Number.isNaN(Number(protein)) ? null : Number(protein);
  return { id: uid(), date, name, kcal: Math.round(kcal), protein: p, created: now, updated: now };
}

/** Foods seen so far, keyed by lowercase name. The most recent entry wins; `count` is how often it was logged. */
export function foodIndex(data) {
  const map = new Map();
  for (const e of liveEntries(data).sort((a, b) => a.created - b.created)) {
    const k = e.name.trim().toLowerCase();
    const count = (map.get(k)?.count || 0) + 1;
    map.set(k, { name: e.name, kcal: e.kcal, protein: e.protein, count });
  }
  return map;
}

/**
 * Merge two copies: each entry (and the settings) keeps whichever version was edited last.
 * `localChanged`: the result differs from `local`. `remoteNeedsUpdate`: the result differs from `remote`.
 */
export function merge(local, remote) {
  const out = { entries: { ...local.entries }, settings: local.settings };
  let localChanged = false;
  let remoteNeedsUpdate = !remote;
  if (remote) {
    const remoteEntries = remote.entries || {};
    for (const [id, e] of Object.entries(remoteEntries)) {
      const m = out.entries[id];
      if (!m || (e.updated || 0) > (m.updated || 0)) {
        out.entries[id] = e;
        localChanged = true;
      }
    }
    for (const [id, e] of Object.entries(out.entries)) {
      const r = remoteEntries[id];
      if (!r || (e.updated || 0) > (r.updated || 0)) {
        remoteNeedsUpdate = true;
        break;
      }
    }
    const rs = remote.settings || {};
    if ((rs.updated || 0) > (out.settings.updated || 0)) {
      out.settings = rs;
      localChanged = true;
    } else if ((out.settings.updated || 0) > (rs.updated || 0)) {
      remoteNeedsUpdate = true;
    }
  }
  return { out, localChanged, remoteNeedsUpdate };
}
