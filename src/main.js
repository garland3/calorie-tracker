import './style.css';
import { label, parse, shift, ymd } from './dates.js';
import {
  DATA_KEY, DIRTY_KEY, dayTotal, displayName, emptyData, entriesForDay, foodIndex, makeEntry, merge, normalize, readJSON, writeJSON,
} from './data.js';
import * as dropbox from './dropbox.js';
import * as ai from './ai.js';
import { groupMeals, parseInput, suggest } from './parse.js';

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
function addEntries(list) {
  const added = list.map(({ name, kcal, protein }) => makeEntry({ date: cur, name, kcal, protein }));
  if (!added.length) return;
  for (const e of added) data.entries[e.id] = e;
  save();
  navigator.vibrate?.(10);
  const kcal = added.reduce((t, e) => t + e.kcal, 0);
  const text = added.length === 1 ? `Added ${displayName(added[0])} · ${kcal}` : `Added ${added.length} items · ${kcal} kcal`;
  toast(text, () => {
    const now = Date.now();
    for (const e of added) Object.assign(data.entries[e.id], { deleted: true, updated: now });
    save();
  });
}
const addEntry = (name, kcal, protein) => addEntries([{ name, kcal, protein }]);

function removeEntry(id) {
  const e = data.entries[id];
  if (!e) return;
  setDeleted(id, true);
  toast(`Deleted ${displayName(e)}`, () => setDeleted(id, false));
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
let editing = null; // id of the entry being edited in place

const fmtTime = ms => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function entryRow(e) {
  if (e.id === editing) {
    return `<li><form class="edit" data-edit="${esc(e.id)}">` +
      `<input class="n" name="name" value="${esc(e.name)}" placeholder="Food (optional)" aria-label="Food">` +
      `<label><input name="kcal" type="number" inputmode="numeric" min="0" value="${e.kcal}" aria-label="Calories" required>kcal</label>` +
      `<label><input name="protein" type="number" inputmode="decimal" min="0" step="any" value="${e.protein ?? ''}" aria-label="Protein grams">g prot</label>` +
      `<div class="actions"><button type="button" class="del" data-del="${esc(e.id)}">Delete</button><button class="primary">Done</button></div>` +
      '</form></li>';
  }
  return `<li><div class="swipe-bg" aria-hidden="true">Delete</div>` +
    `<div class="row-main" data-id="${esc(e.id)}" role="button" tabindex="0" aria-label="Edit ${esc(displayName(e))}, ${e.kcal} kcal">` +
    `<span class="name${e.name ? '' : ' quick'}">${esc(displayName(e))}</span>` +
    (e.protein ? `<span class="p">${e.protein}g P</span>` : '') +
    `<span class="kcal">${e.kcal}</span></div></li>`;
}

function render() {
  const today = ymd(new Date());
  $('dayName').textContent = label(cur);
  $('dayDate').textContent = parse(cur).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  $('dayDate').hidden = !/^(Today|Yesterday)$/.test(label(cur));
  $('dateLabel').disabled = cur === today;
  $('next').disabled = cur >= today;

  const goal = Number(data.settings.goal) || 0;
  const items = entriesForDay(data, cur);
  const total = dayTotal(data, cur);
  const protein = Math.round(items.reduce((t, e) => t + (e.protein || 0), 0));
  const left = goal - total;
  const over = goal > 0 && left < 0;
  $('left').textContent = (goal ? Math.abs(left) : total).toLocaleString();
  $('leftLabel').textContent = goal ? (over ? 'over' : 'left') : 'kcal';
  $('summary').textContent = (goal ? `${total.toLocaleString()} of ${goal.toLocaleString()} kcal` : 'Set a daily goal in Settings') +
    (protein ? ` · ${protein} g protein` : '');
  $('hero').classList.toggle('over', over);
  $('bar').classList.toggle('over', over);
  $('bar').firstElementChild.style.width = goal ? Math.min(100, (total / goal) * 100) + '%' : '0';

  $('meals').innerHTML = items.length
    ? groupMeals(items).map(m =>
      `<div class="meal"><div class="meal-head"><span>${m.name} <span class="t">· ${fmtTime(m.start)}</span></span>` +
      `<span class="k">${m.kcal.toLocaleString()}</span></div><ul class="entries">${m.entries.map(entryRow).join('')}</ul></div>`,
    ).join('')
    : '<p class="empty">Nothing logged yet</p>';

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

  updateDock();
  if (document.activeElement !== $('goal')) $('goal').value = goal || '';
  const connected = dropbox.isConnected();
  $('dbxOn').hidden = !connected;
  $('dbxOff').hidden = connected;
}

// ---------- the "What did you eat?" bar ----------
// One box does it all: a number adds calories, "name 300" adds a named food, a food you've had before
// adds its saved values, and anything else goes to the AI. The button and hint say which will happen.
function updateDock() {
  const text = $('entry').value;
  const foods = foodIndex(data);
  const p = parseInput(text, foods);

  // Your foods as one-tap chips: most logged first, filtered as you type.
  const list = suggest(text, foods).filter(f => f.name.toLowerCase() !== text.trim().toLowerCase());
  $('chips').innerHTML = list
    .map(f => `<button type="button" data-quick="${esc(f.name.toLowerCase())}">${esc(f.name)} <span class="sub">${f.kcal}</span></button>`)
    .join('');
  $('chips').hidden = !list.length;

  // The same spot holds Photo/Library when the box is empty and Add/Estimate once you type.
  $('tools').hidden = !!p;
  $('go').hidden = !p;
  if (!p) { $('hint').textContent = 'Type 280, "pizza 300", or describe what you ate'; return; }
  const prot = p.protein ? ` · ${p.protein} g protein` : '';
  if (p.kind === 'ai') {
    $('go').textContent = ai.hasApiKey() ? 'Estimate with AI' : 'Estimate';
    $('hint').textContent = ai.hasApiKey()
      ? 'AI will estimate it, or add calories: "pizza 300"'
      : 'Add calories at the end: "pizza 300"';
  } else {
    $('go').textContent = 'Add';
    $('hint').textContent = `Adds ${p.name || 'Quick add'} · ${p.kcal.toLocaleString()} kcal${prot}`;
  }
}

function clearEntry() {
  $('entry').value = '';
  $('entry').blur();
  updateDock();
}

// ---------- events ----------
$('prev').onclick = () => goTo(shift(cur, -1));
$('next').onclick = () => goTo(shift(cur, 1));
$('dateLabel').onclick = () => goTo(ymd(new Date()));
$('week').onclick = ev => {
  const col = ev.target.closest('[data-day]');
  if (col) goTo(col.dataset.day);
};
$('syncBox').onclick = () => {
  if (!dropbox.isConnected()) { $('settings').open = true; $('settings').scrollIntoView({ behavior: 'smooth' }); return; }
  toast($('syncBox').title || $('syncText').textContent);
  sync();
};

// Swipe left/right on the page to change day (right = earlier, like turning back a page).
// Swiping a food left deletes it instead.
let touch = null;
$('main').addEventListener('touchstart', ev => {
  const t = ev.touches[0];
  const row = ev.target.closest('.row-main');
  touch = ev.touches.length === 1 ? { x: t.clientX, y: t.clientY, at: Date.now(), row, dx: 0, horiz: null } : null;
}, { passive: true });
$('main').addEventListener('touchmove', ev => {
  if (!touch?.row) return;
  const t = ev.touches[0];
  const dx = t.clientX - touch.x;
  const dy = t.clientY - touch.y;
  touch.horiz ??= Math.abs(dx) > 8 || Math.abs(dy) > 8 ? Math.abs(dx) > Math.abs(dy) : null;
  if (!touch.horiz) return;
  touch.dx = Math.min(0, dx);
  touch.row.classList.add('dragging');
  touch.row.style.transform = `translateX(${touch.dx}px)`;
}, { passive: true });
$('main').addEventListener('touchend', ev => {
  if (!touch) return;
  const t = ev.changedTouches[0];
  const { row } = touch;
  if (row) {
    row.classList.remove('dragging');
    if (touch.horiz) {
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 50);
      if (touch.dx < -Math.min(120, row.offsetWidth * 0.3)) {
        row.style.transform = 'translateX(-100%)';
        const id = row.dataset.id;
        setTimeout(() => removeEntry(id), 150);
      } else {
        row.style.transform = '';
      }
    }
    touch = null;
    return;
  }
  const dx = t.clientX - touch.x;
  const dy = t.clientY - touch.y;
  const quick = Date.now() - touch.at < 600;
  touch = null;
  if (quick && Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy) && !ev.target.closest('input, .edit')) goTo(shift(cur, dx > 0 ? -1 : 1));
}, { passive: true });

let suppressClick = false;
$('meals').addEventListener('click', ev => {
  if (suppressClick) return;
  const del = ev.target.closest('[data-del]');
  if (del) { editing = null; removeEntry(del.dataset.del); return; }
  const row = ev.target.closest('.row-main');
  if (row) { editing = row.dataset.id; render(); }
});
$('meals').addEventListener('keydown', ev => {
  const row = ev.target.closest('.row-main');
  if (row && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); editing = row.dataset.id; render(); }
  if (ev.key === 'Escape' && editing) { editing = null; render(); }
});
$('meals').addEventListener('submit', ev => {
  ev.preventDefault();
  const f = ev.target;
  const e = data.entries[f.dataset.edit];
  editing = null;
  const kcal = Number(f.elements.kcal.value);
  if (e && f.elements.kcal.value !== '' && Number.isFinite(kcal)) {
    const protein = f.elements.protein.value === '' ? null : Number(f.elements.protein.value);
    const name = f.elements.name.value.trim();
    if (name !== e.name || Math.round(kcal) !== e.kcal || protein !== (e.protein ?? null)) {
      Object.assign(e, { name, kcal: Math.round(kcal), protein, updated: Date.now() });
      save();
      return;
    }
  }
  render();
});
// Tapping anywhere else closes the editor without saving.
document.addEventListener('pointerdown', ev => {
  if (editing && !ev.target.closest('.edit')) { editing = null; render(); }
}, true);

$('entry').addEventListener('input', updateDock);
// Keep the keyboard up while tapping a suggestion or the button.
for (const id of ['chips', 'go']) $(id).addEventListener('pointerdown', ev => ev.preventDefault());

$('addForm').onsubmit = ev => {
  ev.preventDefault();
  const p = parseInput($('entry').value, foodIndex(data));
  if (!p) return;
  if (p.kind === 'ai') {
    if (!ai.hasApiKey()) { toast('Add calories at the end, like "pizza 300". Or add an AI key in Settings to get estimates.'); return; }
    runEstimate({ text: p.text, btn: $('go') });
    return;
  }
  addEntry(p.name, p.kcal, p.protein);
  clearEntry();
};

$('chips').onclick = ev => {
  const b = ev.target.closest('[data-quick]');
  const f = b && foodIndex(data).get(b.dataset.quick);
  if (!f) return;
  addEntry(f.name, f.kcal, f.protein);
  clearEntry();
};

function saveGoal() {
  const goal = Number($('goal').value) || 0;
  if (goal === (Number(data.settings.goal) || 0)) return;
  data.settings = { goal, updated: Date.now() };
  save();
}
$('goal').onchange = saveGoal;

// Fields also save on their own when you leave them; this makes it explicit and gets settings out of the way.
$('settingsDone').onclick = () => {
  saveGoal();
  ai.setApiKey($('anthropicKey').value.trim());
  ai.setModel($('aiModel').value);
  dropbox.setCustomAppKey($('appKey').value.trim());
  document.activeElement?.blur();
  $('settings').open = false;
  $('main').scrollTo({ top: 0, behavior: 'smooth' });
  toast('Settings saved');
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

// ---------- AI estimates ----------
$('anthropicKey').value = ai.getApiKey();
$('aiModel').innerHTML = ai.MODELS.map(m => `<option value="${m.id}">${esc(m.label)}</option>`).join('');
$('aiModel').value = ai.getModel();
$('aiModel').onchange = () => ai.setModel($('aiModel').value);
$('anthropicKey').onchange = () => { ai.setApiKey($('anthropicKey').value.trim()); };

function needKey() {
  $('settings').open = true;
  $('anthropicKey').scrollIntoView({ block: 'center', behavior: 'smooth' });
  $('anthropicKey').focus();
  toast('Add your Anthropic API key to use AI estimates');
}

let aiDraft = [];
let aiRun = 0; // bumped on cancel/new run, so a late answer for a closed sheet is ignored
let aiPhotoUrl = null;

function closeSheet() {
  aiRun++;
  $('aiSheet').hidden = true;
  $('go').classList.remove('busy');
  $('aiPhotoBtn').classList.remove('busy');
  $('aiLibBtn').classList.remove('busy');
  if (aiPhotoUrl) URL.revokeObjectURL(aiPhotoUrl);
  aiPhotoUrl = null;
}

function renderDraft() {
  $('aiItems').innerHTML = aiDraft.map((it, i) =>
    `<li><input class="n" data-i="${i}" data-f="name" value="${esc(it.name)}" aria-label="Food">` +
    `<input class="k" data-i="${i}" data-f="kcal" type="number" inputmode="numeric" min="0" value="${it.kcal}" aria-label="Calories"><span class="u">kcal</span>` +
    `<input class="pr" data-i="${i}" data-f="protein" type="number" inputmode="decimal" min="0" step="any" value="${it.protein ?? ''}" aria-label="Protein g"><span class="u">g protein</span>` +
    `<button data-rm="${i}" aria-label="Remove ${esc(it.name)}">×</button></li>`,
  ).join('');
  updateAddButton();
}

function updateAddButton() {
  const ok = aiDraft.filter(it => it.name.trim() && Number.isFinite(it.kcal));
  const kcal = ok.reduce((t, it) => t + it.kcal, 0);
  $('aiAdd').disabled = !ok.length;
  $('aiAdd').textContent = ok.length ? `Add ${ok.length === 1 ? '' : ok.length + ' · '}${kcal.toLocaleString()} kcal` : 'Add';
}

$('aiItems').addEventListener('input', ev => {
  const { i, f } = ev.target.dataset;
  if (i == null) return;
  const v = ev.target.value;
  aiDraft[i][f] = f === 'name' ? v : v === '' ? (f === 'kcal' ? NaN : null) : Number(v);
  updateAddButton();
});
$('aiItems').addEventListener('click', ev => {
  const b = ev.target.closest('[data-rm]');
  if (!b) return;
  aiDraft.splice(Number(b.dataset.rm), 1);
  renderDraft();
});

async function runEstimate({ text = '', file = null, btn }) {
  if (!ai.hasApiKey()) { needKey(); return; }
  closeSheet();
  const run = aiRun;
  btn.classList.add('busy');
  aiDraft = [];
  $('aiItems').innerHTML = '';
  $('aiNotes').textContent = '';
  $('aiPhoto').hidden = true;
  $('aiStatus').textContent = file ? 'Looking at your photo…' : 'Estimating…';
  updateAddButton();
  $('aiSheet').hidden = false;
  try {
    let image = null;
    if (file) {
      image = await ai.photoToJpeg(file);
      aiPhotoUrl = image.url;
      $('aiPhoto').src = image.url;
      $('aiPhoto').hidden = false;
    }
    const result = await ai.estimate({ text, image });
    if (run !== aiRun) return;
    aiDraft = result.items;
    $('aiStatus').textContent = aiDraft.length ? 'Check and adjust, then add.' : 'No food found.';
    $('aiNotes').textContent = result.notes;
    renderDraft();
  } catch (e) {
    if (run !== aiRun) return;
    console.error(e);
    $('aiStatus').textContent = e instanceof ai.AiError ? e.message : 'Something went wrong: ' + e.message;
  } finally {
    btn.classList.remove('busy');
  }
}

// 📷 opens the camera directly; 🖼️ picks an existing picture from the photo library.
for (const [btnId, inputId] of [['aiPhotoBtn', 'aiFile'], ['aiLibBtn', 'aiLibFile']]) {
  $(btnId).onclick = () => { if (ai.hasApiKey()) $(inputId).click(); else needKey(); };
  $(inputId).onchange = () => {
    const file = $(inputId).files[0];
    $(inputId).value = '';
    if (file) runEstimate({ file, btn: $(btnId) });
  };
}
$('aiCancel').onclick = closeSheet;
$('aiSheet').onclick = ev => { if (ev.target === $('aiSheet')) closeSheet(); };
$('aiAdd').onclick = () => {
  const list = aiDraft.filter(it => it.name.trim() && Number.isFinite(it.kcal)).map(it => ({ ...it, name: it.name.trim() }));
  closeSheet();
  clearEntry();
  addEntries(list);
};

// ---------- Dropbox ----------
$('appKey').value = dropbox.customAppKey();
$('appKey').onchange = () => dropbox.setCustomAppKey($('appKey').value.trim());
if (!dropbox.hasBuiltInKey()) $('dbxAdvanced').open = true;

$('connect').onclick = async () => {
  try {
    const { url, mode } = await dropbox.startAuth();
    if (mode === 'redirect') { location.assign(url); return; }
    $('dbxPaste').hidden = false;
    window.open(url, '_blank');
  } catch (e) {
    $('dbxAdvanced').open = true;
    alert(e.message);
  }
};

async function finishConnect(code) {
  if (!code) { alert('Copy the code Dropbox shows, then try again.'); return; }
  try {
    await dropbox.finishWithCode(code);
    $('authCode').value = '';
    $('dbxPaste').hidden = true;
    toast('Dropbox connected');
    render();
    sync();
  } catch (e) {
    alert('Could not connect: ' + e.message);
  }
}
$('finish').onclick = () => finishConnect($('authCode').value.trim());
$('pasteFinish').onclick = async () => {
  let code = '';
  try { code = (await navigator.clipboard.readText()).trim(); } catch { /* no clipboard access */ }
  if (code) finishConnect(code);
  else { $('authCode').focus(); toast('Paste the code into the box, then tap Finish'); }
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

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

render();
// Coming back from Dropbox's sign-in page (redirect flow)?
dropbox.handleRedirect().then(r => {
  if (r?.ok) { toast('Dropbox connected'); render(); }
  else if (r) { $('settings').open = true; alert('Could not connect Dropbox: ' + r.message); }
  sync();
});
