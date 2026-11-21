// Days are stored as local-time "YYYY-MM-DD" strings, which also sort correctly as plain strings.

export const pad = n => String(n).padStart(2, '0');

export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const parse = s => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export const shift = (s, n) => {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
};

export function label(s, now = new Date()) {
  const today = ymd(now);
  if (s === today) return 'Today';
  if (s === shift(today, -1)) return 'Yesterday';
  return parse(s).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
