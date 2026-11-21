import './style.css';
import { label, parse, shift, ymd } from './dates.js';
import {
  DATA_KEY, DIRTY_KEY, dayTotal, emptyData, entriesForDay, foodIndex, makeEntry, merge, normalize, readJSON, writeJSON,
} from './data.js';
import * as dropbox from './dropbox.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---------- state ----------
let data = normalize(readJSON(DATA_KEY, null)) || emptyData();
let cur = ymd(new Date());
let lastToday = cur; // lets the view follow "today" across midnight
let rev = 0; // bumped on every local edit, so a sync can tell whether edits happened while it ran

const setDirty = v => { try { v ? localStorage.setItem(DIRTY_KEY, '1') : localStorage.removeItem(DIRTY_KEY); } catch { /* storage unavailable */ } };

function save() {
  rev++;
  writeJSON(DATA_KEY, data);
  setDirty(true);
  render();
  scheduleSync();
}

navigator.storage?.persist?.().catch(() => {});

// ---------- actions ----------
function setDeleted(id, deleted) {
  const e = data.entries[id];
  if (!e) return;
  e.deleted = deleted;
  e.updated = Date.now();
  save();
}

// No confirm dialogs: every add/delete is one tap and can be undone from the toast.
function addEntry(name, kcal, protein) {
  const e = makeEntry({ date: cur, name, kcal, protein });
  data.entries[e.id] = e;
  save();
  navigator.vibrate?.(10);
  toast(`Added ${e.name} · ${e.kcal}`, () => setDeleted(e.id, true));
}

function removeEntry(id) {
  const e = data.entries[id];
  if (!e) return;
  setDeleted(id, true);
  toast(`Deleted ${e.name}`, () => setDeleted(id, false));
}

let toastTimer = null;
let undoFn = null;
function toast(text, undo) {
  $('toastText').textContent = text;
  undoFn = undo;
  $('toastUndo').hidden = !undo;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; undoFn = null; }, 4000);
}
$('toastUndo').onclick = () => {
  const fn = undoFn;
  $('toast').hidden = true;
  undoFn = null;
  fn?.();
};

function goTo(day) {
  const today = ymd(new Date());
  cur = day > today ? today : day;
  render();
}

// ---------- render ----------
const CHART_H = 110 - 16; // .week height minus the day-label row

function render() {
  const today = ymd(new Date());
  $('dateLabel').textContent = label(cur);
  $('dateLabel').disabled = cur === today;
  $('next').disabled = cur >= today;

  const goal = Number(data.settings.goal) || 0;
  const items = entriesForDay(data, cur);
  const total = dayTotal(data, cur);
  const protein = items.reduce((t, e) => t + (e.protein || 0), 0);
  const left = goal - total;
  $('total').textContent = total.toLocaleString();
  $('remaining').textContent = goal
    ? `of ${goal.toLocaleString()} kcal · ${left >= 0 ? left.toLocaleString() + ' left' : (-left).toLocaleString() + ' over'}` +
      (protein ? ` · ${Math.round(protein)} g protein` : '')
    : 'kcal' + (protein ? ` · ${Math.round(protein)} g protein` : '');
  $('bar').classList.toggle('over', goal > 0 && total > goal);
  $('bar').firstElementChild.style.width = goal ? Math.min(100, (total / goal) * 100) + '%' : '0';

  $('list').innerHTML = items.length
    ? items.map(e =>
      `<li><span class="name">${esc(e.name)}</span>` +
      (e.protein ? `<span class="p">${e.protein} g</span>` : '') +
      `<span class="kcal">${e.kcal}</span><button data-del="${esc(e.id)}" aria-label="Delete ${esc(e.name)}">×</button></li>`,
    ).join('')
    : '<li class="empty">Nothing logged yet</li>';

  const foods = [...foodIndex(data).values()];
  $('foods').innerHTML = foods.map(f => `<option value="${esc(f.name)}">`).join('');
  $('chips').innerHTML = foods.length
    ? foods
      .sort((a, b) => b.count - a.count)
      .slice(0, 12)
      .map(f => `<button type="button" data-quick="${esc(f.name.toLowerCase())}">+ ${esc(f.name)} <span class="sub">${f.kcal}</span></button>`)
      .join('')
    : '<span class="empty">Foods you log show up here for one-tap adding</span>';

  const days = Array.from({ length: 7 }, (_, i) => shift(cur, i - 6));
  const totals = days.map(d => dayTotal(data, d));
  const max = Math.max(goal, ...totals, 1) * 1.1;
  $('week').innerHTML =
    (goal ? `<div class="goalline" style="bottom:${16 + (goal / max) * CHART_H}px"></div>` : '') +
    days.map((d, i) =>
      `<div class="col${d === cur ? ' cur' : ''}" data-day="${d}" title="${totals[i]} kcal">` +
      `<div class="b${goal && totals[i] > goal ? ' over' : ''}" style="height:${(totals[i] / max) * CHART_H}px"></div>` +
      `<span>${parse(d).toLocaleDateString(undefined, { weekday: 'narrow' })}</span></div>`,
    ).join('');

  if (document.activeElement !== $('goal')) $('goal').value = goal || '';
  const connected = dropbox.isConnected();
  $('dbxOn').hidden = !connected;
  $('dbxOff').hidden = connected;
}

// ---------- events ----------
$('prev').onclick = () => goTo(shift(cur, -1));
$('next').onclick = () => goTo(shift(cur, 1));
$('dateLabel').onclick = () => goTo(ymd(new Date()));
$('week').onclick = ev => {
  const col = ev.target.closest('[data-day]');
  if (col) goTo(col.dataset.day);
};

// Swipe left/right anywhere on the page to change day (right = earlier, like turning back a page).
let touch = null;
$('main').addEventListener('touchstart', ev => {
  const t = ev.touches[0];
  touch = ev.touches.length === 1 ? { x: t.clientX, y: t.clientY, at: Date.now() } : null;
}, { passive: true });
$('main').addEventListener('touchend', ev => {
  if (!touch) return;
  const t = ev.changedTouches[0];
  const dx = t.clientX - touch.x;
  const dy = t.clientY - touch.y;
  const quick = Date.now() - touch.at < 600;
  touch = null;
  if (quick && Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)) goTo(shift(cur, dx > 0 ? -1 : 1));
}, { passive: true });

$('addForm').onsubmit = ev => {
  ev.preventDefault();
  const typed = $('food').value.trim();
  // Reuse the existing spelling of a known food, so "oatmeal" and "Oatmeal" don't become two foods.
  const name = foodIndex(data).get(typed.toLowerCase())?.name ?? typed;
  const kcal = Number($('kcal').value);
  if (!name || !Number.isFinite(kcal)) return;
  addEntry(name, kcal, $('protein').value === '' ? null : Number($('protein').value));
  $('addForm').reset();
  $('food').blur();
};

// Picking a food you've logged before fills in its calories and protein.
// Enter in the food field: add right away if calories are already filled in, else jump to calories.
$('food').addEventListener('keydown', ev => {
  if (ev.key !== 'Enter') return;
  ev.preventDefault();
  if ($('food').value.trim() && $('kcal').value !== '') $('addForm').requestSubmit();
  else $('kcal').focus();
});

$('food').addEventListener('input', () => {
  const f = foodIndex(data).get($('food').value.trim().toLowerCase());
  if (f) {
    $('kcal').value = f.kcal;
    $('protein').value = f.protein ?? '';
  }
});

$('chips').onclick = ev => {
  const b = ev.target.closest('[data-quick]');
  const f = b && foodIndex(data).get(b.dataset.quick);
  if (f) addEntry(f.name, f.kcal, f.protein);
};

$('list').onclick = ev => {
  const b = ev.target.closest('[data-del]');
  const e = b && data.entries[b.dataset.del];
  if (e) removeEntry(e.id);
};

$('goal').onchange = () => {
  data.settings = { goal: Number($('goal').value) || 0, updated: Date.now() };
  save();
};

$('export').onclick = async () => {
  const name = `calories-${ymd(new Date())}.json`;
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const file = new File([blob], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
};

// Importing merges the file into what's here (newest edit per entry wins), so nothing is overwritten blindly.
$('import').onclick = () => $('importFile').click();
$('importFile').onchange = async () => {
  const file = $('importFile').files[0];
  $('importFile').value = '';
  if (!file) return;
  let imported;
  try {
    imported = normalize(JSON.parse(await file.text()));
  } catch {
    imported = null;
  }
  if (!imported) { alert("That file doesn't look like a Calories backup."); return; }
  const { out, localChanged } = merge(data, imported);
  if (!localChanged) { alert('Nothing new in that file.'); return; }
  data = out;
  save();
  alert('Backup imported.');
};

// ---------- Dropbox ----------
$('appKey').value = dropbox.savedAppKey();

$('connect').onclick = async () => {
  const key = $('appKey').value.trim();
  if (!key) { alert('Paste your Dropbox App key first.'); return; }
  window.open(await dropbox.authorizeUrl(key), '_blank');
};

$('finish').onclick = async () => {
  const code = $('authCode').value.trim();
  if (!code) { alert('Paste the code Dropbox shows you.'); return; }
  try {
    await dropbox.finishAuth(code);
    $('authCode').value = '';
    render();
    sync();
  } catch (e) {
    alert('Could not connect: ' + e.message);
  }
};

$('disconnect').onclick = () => {
  if (!confirm('Stop syncing on this device? Your data stays on the phone and in Dropbox.')) return;
  dropbox.disconnect();
  status('', 'Not synced');
  render();
};

$('syncNow').onclick = () => sync();

// ---------- sync ----------
function status(kind, text, detail = '') {
  $('syncDot').className = 'dot ' + kind;
  $('syncText').textContent = text;
  $('syncBox').title = detail;
}

let syncing = false;
let again = false;
let timer = null;

function scheduleSync() {
  clearTimeout(timer);
  timer = setTimeout(sync, 1500);
}

async function sync() {
  if (!dropbox.isConnected()) { status('', 'Not synced'); return; }
  if (syncing) { again = true; return; }
  if (!navigator.onLine) { status('busy', 'Offline – will sync'); return; }
  syncing = true;
  status('busy', 'Syncing…');
  const startRev = rev;
  try {
    const raw = await dropbox.download();
    const remote = raw === null ? null : normalize(raw);
    // Never overwrite a remote file we can't read: that could wipe another device's data.
    if (raw !== null && !remote) throw new Error('calories.json in Dropbox is not valid. Fix or delete it.');
    const { out, remoteNeedsUpdate } = merge(data, remote);
    if (remoteNeedsUpdate) await dropbox.upload(out);
    // Merge again against the *current* data: edits made while we were awaiting must not be lost.
    const result = merge(data, out);
    if (result.localChanged) {
      data = result.out;
      writeJSON(DATA_KEY, data);
      render();
    }
    if (rev === startRev) setDirty(false);
    else again = true;
    status('ok', 'Synced ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
  } catch (e) {
    console.error(e);
    if (e instanceof dropbox.RevokedError) render();
    status('err', navigator.onLine ? 'Sync error' : 'Offline – will sync', e.message);
  } finally {
    syncing = false;
    if (again) { again = false; scheduleSync(); }
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const today = ymd(new Date());
  // If you were looking at "today" and the date rolled over, move to the new today.
  if (cur === lastToday || cur > today) cur = today;
  lastToday = today;
  render();
  sync();
});
window.addEventListener('online', sync);
window.addEventListener('focus', () => { if (dropbox.isConnected()) sync(); });

// Keep body padding in step with the dock, and lift the dock above the on-screen keyboard
// (iOS doesn't shrink the layout viewport, so a plain bottom:0 bar would hide behind it).
new ResizeObserver(([e]) => {
  document.documentElement.style.setProperty('--dock-h', Math.ceil(e.borderBoxSize?.[0]?.blockSize ?? e.target.offsetHeight) + 'px');
}).observe($('dock'));
if (window.visualViewport) {
  const vv = window.visualViewport;
  const lift = () => {
    const hidden = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    $('dock').style.transform = hidden ? `translateY(${-hidden}px)` : '';
    $('toast').style.transform = $('dock').style.transform;
  };
  vv.addEventListener('resize', lift);
  vv.addEventListener('scroll', lift);
}

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

render();
sync();
