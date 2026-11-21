import { describe, expect, it } from 'vitest';
import { dayTotal, displayName, emptyData, foodIndex, makeEntry, merge, normalize } from '../src/data.js';

const entry = (id, over = {}) => ({ id, date: '2026-11-20', name: 'Apple', kcal: 95, protein: null, created: 1, updated: 1, ...over });
const doc = (entries, settings = { goal: 2000, updated: 0 }) => ({
  entries: Object.fromEntries(entries.map(e => [e.id, e])),
  settings,
});

describe('merge', () => {
  it('uploads everything when there is no remote file yet', () => {
    const local = doc([entry('a')]);
    const { out, localChanged, remoteNeedsUpdate } = merge(local, null);
    expect(out.entries.a).toEqual(local.entries.a);
    expect(localChanged).toBe(false);
    expect(remoteNeedsUpdate).toBe(true);
  });

  it('reports nothing to do when both sides match', () => {
    const r = merge(doc([entry('a')]), doc([entry('a')]));
    expect(r.localChanged).toBe(false);
    expect(r.remoteNeedsUpdate).toBe(false);
  });

  it('combines entries that only exist on one side', () => {
    const { out, localChanged, remoteNeedsUpdate } = merge(doc([entry('a')]), doc([entry('b')]));
    expect(Object.keys(out.entries).sort()).toEqual(['a', 'b']);
    expect(localChanged).toBe(true);
    expect(remoteNeedsUpdate).toBe(true);
  });

  it('keeps the most recently edited version of an entry', () => {
    const newerRemote = merge(doc([entry('a', { kcal: 1 })]), doc([entry('a', { kcal: 2, updated: 5 })]));
    expect(newerRemote.out.entries.a.kcal).toBe(2);
    expect(newerRemote.remoteNeedsUpdate).toBe(false);

    const newerLocal = merge(doc([entry('a', { kcal: 1, updated: 9 })]), doc([entry('a', { kcal: 2, updated: 5 })]));
    expect(newerLocal.out.entries.a.kcal).toBe(1);
    expect(newerLocal.localChanged).toBe(false);
    expect(newerLocal.remoteNeedsUpdate).toBe(true);
  });

  it('propagates deletions (tombstones)', () => {
    const { out } = merge(doc([entry('a')]), doc([entry('a', { deleted: true, updated: 3 })]));
    expect(out.entries.a.deleted).toBe(true);
  });

  it('takes the newer settings', () => {
    const local = doc([], { goal: 1800, updated: 10 });
    const remote = doc([], { goal: 2200, updated: 20 });
    expect(merge(local, remote).out.settings.goal).toBe(2200);
    expect(merge(remote, local).out.settings.goal).toBe(2200);
  });

  it('does not mutate its inputs', () => {
    const local = doc([entry('a')]);
    merge(local, doc([entry('b')]));
    expect(Object.keys(local.entries)).toEqual(['a']);
  });
});

describe('normalize', () => {
  it('rejects things that are not backups', () => {
    expect(normalize(null)).toBeNull();
    expect(normalize({})).toBeNull();
    expect(normalize([1, 2])).toBeNull();
  });

  it('drops malformed entries and coerces numbers', () => {
    const n = normalize({ entries: { a: entry('a', { kcal: '120' }), bad: { name: 1 } }, settings: { goal: '1500' } });
    expect(Object.keys(n.entries)).toEqual(['a']);
    expect(n.entries.a.kcal).toBe(120);
    expect(n.settings).toEqual({ goal: 1500, updated: 0 });
  });
});

describe('helpers', () => {
  it('totals only live entries for the day', () => {
    const d = doc([entry('a'), entry('b', { kcal: 5 }), entry('c', { deleted: true }), entry('d', { date: '2026-11-19' })]);
    expect(dayTotal(d, '2026-11-20')).toBe(100);
  });

  it('indexes foods case-insensitively using the latest values', () => {
    const d = doc([entry('a', { name: 'Apple', kcal: 90, created: 1 }), entry('b', { name: 'apple ', kcal: 100, created: 2 })]);
    expect(foodIndex(d).get('apple')).toMatchObject({ kcal: 100, count: 2 });
  });

  it('supports calorie-only quick adds', () => {
    const d = doc([entry('a', { name: '' }), entry('b', { name: 'Apple' })]);
    expect(displayName(d.entries.a)).toBe('Quick add');
    expect(displayName(d.entries.b)).toBe('Apple');
    expect([...foodIndex(d).keys()]).toEqual(['apple']);
    expect(dayTotal(d, '2026-11-20')).toBe(190);
  });

  it('makes entries with rounded kcal and optional protein', () => {
    const e = makeEntry({ date: '2026-11-20', name: 'Toast', kcal: 80.6, protein: '' }, 42);
    expect(e).toMatchObject({ kcal: 81, protein: null, created: 42, updated: 42 });
    expect(makeEntry({ date: 'x', name: 'y', kcal: 1, protein: 3.5 }).protein).toBe(3.5);
  });

  it('starts with a sensible empty document', () => {
    expect(emptyData()).toEqual({ entries: {}, settings: { goal: 2000, updated: 0 } });
  });
});

describe('ai.toEntries', async () => {
  const { toEntries } = await import('../src/ai.js');
  it('rounds, clamps and drops nameless items', () => {
    expect(toEntries([
      { name: ' Eggs (2) ', kcal: 143.6, protein_g: 12.04 },
      { name: '', kcal: 10, protein_g: 0 },
      { name: 'Water', kcal: -5, protein_g: -1 },
    ])).toEqual([
      { name: 'Eggs (2)', kcal: 144, protein: 12 },
      { name: 'Water', kcal: 0, protein: 0 },
    ]);
    expect(toEntries(undefined)).toEqual([]);
  });
});
