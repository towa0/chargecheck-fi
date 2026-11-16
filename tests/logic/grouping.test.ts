import { describe, expect, it } from 'vitest';
import { groupPoints, pinPrice } from '../../src/logic/grouping.ts';

const pt = (id: string, x: number, y: number) => ({ id, x, y });

describe('groupPoints', () => {
  it('keeps far-apart pins separate', () => {
    const g = groupPoints([pt('a', 0, 0), pt('b', 100, 0), pt('c', 0, 100)]);
    expect(g.map((x) => x.ids)).toEqual([['a'], ['b'], ['c']]);
  });

  it('groups pins closer than the radius around the first one', () => {
    const g = groupPoints([pt('a', 0, 0), pt('b', 10, 10), pt('c', 25, 0), pt('d', 200, 200)], 30);
    expect(g).toEqual([
      { ids: ['a', 'b', 'c'], x: 35 / 3, y: 10 / 3 },
      { ids: ['d'], x: 200, y: 200 },
    ]);
  });

  it('treats the radius as exclusive', () => {
    expect(groupPoints([pt('a', 0, 0), pt('b', 30, 0)], 30)).toHaveLength(2);
    expect(groupPoints([pt('a', 0, 0), pt('b', 29.9, 0)], 30)).toHaveLength(1);
  });

  it('never groups pins listed as alone', () => {
    const g = groupPoints([pt('a', 0, 0), pt('sel', 5, 5), pt('b', 8, 0)], 30, new Set(['sel']));
    expect(g.map((x) => x.ids)).toEqual([['a', 'b'], ['sel']]);
  });

  it('does not chain: a pin is only compared with the group seed', () => {
    const g = groupPoints([pt('a', 0, 0), pt('b', 25, 0), pt('c', 50, 0)], 30);
    expect(g.map((x) => x.ids)).toEqual([['a', 'b'], ['c']]);
  });

  it('handles no points', () => {
    expect(groupPoints([])).toEqual([]);
  });
});

describe('pinPrice', () => {
  it('rounds to whole euros', () => {
    expect(pinPrice(8.4)).toBe('€8');
    expect(pinPrice(12.55)).toBe('€13');
    expect(pinPrice(0)).toBe('€0');
  });
});
