// What the single "What did you eat?" box should do with what was typed. Pure, so it can be unit tested.
//
//   "280"               → quick add: 280 kcal, no name
//   "pizza 300"         → that name with 300 kcal (a trailing number is always calories, never sent to AI)
//   "chicken 300 35g"   → also 35 g protein (a second number is protein; "g" is optional)
//   "omelet"            → a food you've logged before: its saved calories and protein
//   "2 eggs and toast"  → anything else is sent to the AI for an estimate

const NUM = String.raw`(\d+(?:[.,]\d+)?)`;
const KCAL = String.raw`\s*(?:kcal|cals?|calories)?`;
const PROTEIN = String.raw`(?:\s+${NUM}\s*(?:g\s*p(?:rotein)?|g|p|protein)?)?`;

const QUICK = new RegExp(`^${NUM}${KCAL}${PROTEIN}$`, 'i');
const MANUAL = new RegExp(`^(.+?)[\\s,:-]+${NUM}${KCAL}${PROTEIN}$`, 'i');

const num = s => (s == null ? null : Number(s.replace(',', '.')));

/**
 * @param {string} text what was typed
 * @param {Map<string, {name, kcal, protein}>} foods foodIndex(data)
 * @returns {null | {kind: 'quick'|'manual'|'known', name, kcal, protein} | {kind: 'ai', text}}
 */
export function parseInput(text, foods = new Map()) {
  const t = String(text || '').trim().replace(/\s+/g, ' ');
  if (!t) return null;
  let m = t.match(QUICK);
  if (m) return { kind: 'quick', name: '', kcal: Math.round(num(m[1])), protein: num(m[2]) };
  m = t.match(MANUAL);
  if (m) {
    const name = m[1].trim();
    // Reuse the existing spelling of a known food, so "oatmeal" and "Oatmeal" don't become two foods.
    const known = foods.get(name.toLowerCase());
    return { kind: 'manual', name: known?.name ?? name, kcal: Math.round(num(m[2])), protein: num(m[3]) ?? known?.protein ?? null };
  }
  const f = foods.get(t.toLowerCase());
  if (f) return { kind: 'known', name: f.name, kcal: f.kcal, protein: f.protein ?? null };
  return { kind: 'ai', text: t };
}

/** Foods to suggest for what's typed so far: names starting with it first, then containing it; most logged first. */
export function suggest(text, foods, limit = 8) {
  const all = [...foods.values()].sort((a, b) => b.count - a.count);
  const q = String(text || '').trim().toLowerCase();
  if (!q) return all.slice(0, limit);
  const starts = all.filter(f => f.name.toLowerCase().startsWith(q));
  const words = all.filter(f => !starts.includes(f) && f.name.toLowerCase().split(/[^a-z0-9]+/).some(w => w.startsWith(q)));
  return [...starts, ...words].slice(0, limit);
}

/** A meal name for a time of day. */
export function mealName(date) {
  const h = date.getHours() + date.getMinutes() / 60;
  if (h >= 4 && h < 10.5) return 'Breakfast';
  if (h >= 11 && h < 15) return 'Lunch';
  if (h >= 17 && h < 22) return 'Dinner';
  return 'Snack';
}

/**
 * Group a day's entries (sorted by `created`) into meals: entries logged within `gapMin` minutes of the
 * previous one belong together, so an AI estimate's items or a few quick adds read as one meal.
 */
export function groupMeals(entries, gapMin = 45) {
  const groups = [];
  for (const e of entries) {
    const last = groups[groups.length - 1];
    if (last && e.created - last.entries[last.entries.length - 1].created <= gapMin * 60_000) last.entries.push(e);
    else groups.push({ start: e.created, entries: [e] });
  }
  return groups.map(g => ({
    ...g,
    name: mealName(new Date(g.start)),
    kcal: g.entries.reduce((t, e) => t + (e.kcal || 0), 0),
  }));
}
