import { describe, expect, it } from 'vitest';
import { label, parse, shift, ymd } from '../src/dates.js';

describe('dates', () => {
  it('formats local dates as YYYY-MM-DD', () => {
    expect(ymd(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('round-trips through parse', () => {
    expect(ymd(parse('2026-11-20'))).toBe('2026-11-20');
  });

  it('shifts across month and year boundaries', () => {
    expect(shift('2026-12-31', 1)).toBe('2027-01-01');
    expect(shift('2026-03-01', -1)).toBe('2026-02-28');
    expect(shift('2028-03-01', -1)).toBe('2028-02-29');
  });

  it('labels today and yesterday', () => {
    const now = new Date(2026, 10, 20, 9);
    expect(label('2026-11-20', now)).toBe('Today');
    expect(label('2026-11-19', now)).toBe('Yesterday');
    expect(label('2026-11-10', now)).not.toMatch(/Today|Yesterday/);
  });
});
