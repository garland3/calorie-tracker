import { describe, expect, it } from 'vitest';
import { groupMeals, mealName, parseInput, suggest } from '../src/parse.js';

const foods = new Map([
  ['omelet', { name: 'Omelet', kcal: 350, protein: 18, count: 5 }],
  ['oatmeal', { name: 'Oatmeal', kcal: 150, protein: 5, count: 9 }],
  ['iced coffee', { name: 'Iced coffee', kcal: 80, protein: null, count: 2 }],
]);

describe('parseInput', () => {
  it('ignores empty input', () => {
    expect(parseInput('  ', foods)).toBeNull();
  });

  it('treats a bare number as a calorie-only quick add', () => {
    expect(parseInput('280', foods)).toEqual({ kind: 'quick', name: '', kcal: 280, protein: null });
    expect(parseInput('280 kcal 20g', foods)).toEqual({ kind: 'quick', name: '', kcal: 280, protein: 20 });
  });

  it('treats a trailing number as calories, with an optional protein after it', () => {
    expect(parseInput('2 eggs 140', foods)).toEqual({ kind: 'manual', name: '2 eggs', kcal: 140, protein: null });
    expect(parseInput('chicken 300 35g', foods)).toMatchObject({ name: 'chicken', kcal: 300, protein: 35 });
    expect(parseInput('pizza 300 12', foods)).toMatchObject({ name: 'pizza', kcal: 300, protein: 12 });
    expect(parseInput('latte, 190 cal', foods)).toMatchObject({ name: 'latte', kcal: 190 });
  });

  it('reuses the spelling and protein of a known food when calories are given', () => {
    expect(parseInput('omelet 400', foods)).toEqual({ kind: 'manual', name: 'Omelet', kcal: 400, protein: 18 });
  });

  it('recognises a known food by name, ignoring case', () => {
    expect(parseInput('OMELET', foods)).toEqual({ kind: 'known', name: 'Omelet', kcal: 350, protein: 18 });
  });

  it('sends anything else to the AI', () => {
    expect(parseInput('2 eggs and toast', foods)).toEqual({ kind: 'ai', text: '2 eggs and toast' });
    expect(parseInput('latte 16 oz', foods).kind).toBe('ai');
  });
});

describe('suggest', () => {
  it('lists the most logged foods when nothing is typed', () => {
    expect(suggest('', foods).map(f => f.name)).toEqual(['Oatmeal', 'Omelet', 'Iced coffee']);
  });

  it('puts names starting with the text first, then word matches', () => {
    expect(suggest('o', foods).map(f => f.name)).toEqual(['Oatmeal', 'Omelet']);
    expect(suggest('cof', foods).map(f => f.name)).toEqual(['Iced coffee']);
  });
});

describe('meals', () => {
  it('names meals by time of day', () => {
    expect(mealName(new Date(2026, 0, 1, 8, 10))).toBe('Breakfast');
    expect(mealName(new Date(2026, 0, 1, 12, 40))).toBe('Lunch');
    expect(mealName(new Date(2026, 0, 1, 15, 30))).toBe('Snack');
    expect(mealName(new Date(2026, 0, 1, 19))).toBe('Dinner');
  });

  it('groups entries logged close together', () => {
    const at = (h, m) => new Date(2026, 0, 1, h, m).getTime();
    const e = (id, h, m, kcal) => ({ id, created: at(h, m), kcal });
    const meals = groupMeals([e('a', 8, 10, 350), e('b', 12, 40, 320), e('c', 12, 41, 220), e('d', 13, 20, 60)]);
    expect(meals.map(g => [g.name, g.entries.length, g.kcal])).toEqual([['Breakfast', 1, 350], ['Lunch', 3, 600]]);
  });
});
