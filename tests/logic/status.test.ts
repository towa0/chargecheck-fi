import { describe, expect, it } from 'vitest';
import type { Availability } from '../../src/logic/results.ts';
import { availabilityKind, availabilityText, freshness } from '../../src/logic/status.ts';

function av(byStatus: Record<string, number>, total: number, oldestUpdate: string | null = '2026-11-16T09:00:00Z'): Availability {
  const map = new Map(Object.entries(byStatus));
  const known = [...map.values()].reduce((a, b) => a + b, 0);
  return { available: map.get('AVAILABLE') ?? 0, total, unknown: total - known, oldestUpdate, byStatus: map };
}

describe('availabilityKind and text', () => {
  it('free when any EVSE is free', () => {
    const a = av({ AVAILABLE: 3, CHARGING: 1 }, 4);
    expect(availabilityKind(a)).toBe('free');
    expect(availabilityText(a)).toBe('3 of 4 free');
  });

  it('busy when none free but some in use', () => {
    expect(availabilityText(av({ CHARGING: 2 }, 2))).toBe('All 2 in use');
    expect(availabilityText(av({ BLOCKED: 1 }, 1))).toBe('In use');
    expect(availabilityKind(av({ CHARGING: 1, OUTOFORDER: 1 }, 2))).toBe('busy');
  });

  it('down when nothing is usable', () => {
    expect(availabilityKind(av({ OUTOFORDER: 2 }, 2))).toBe('down');
    expect(availabilityText(av({ INOPERATIVE: 1 }, 1))).toBe('Out of order');
    expect(availabilityText(av({ OUTOFORDER: 3 }, 3))).toBe('None working');
  });

  it('unknown without statuses', () => {
    expect(availabilityKind(null)).toBe('unknown');
    expect(availabilityKind(av({}, 2, null))).toBe('unknown');
    expect(availabilityText(null)).toBe('No live status');
  });
});

describe('freshness', () => {
  const now = Date.parse('2026-11-16T12:00:00Z');
  it('says how old the status is and flags over 24 h', () => {
    expect(freshness(av({ AVAILABLE: 1 }, 1, '2026-11-16T09:00:00Z'), now)).toEqual({ text: 'status 3 h ago', stale: false });
    expect(freshness(av({ AVAILABLE: 1 }, 1, '2026-11-15T11:00:00Z'), now)).toEqual({ text: 'status 25 h ago', stale: true });
    expect(freshness(av({ AVAILABLE: 1 }, 1, '2026-11-12T12:00:00Z'), now)?.text).toBe('status 4 days ago');
    expect(freshness(av({ AVAILABLE: 1 }, 1, '2026-11-16T11:59:40Z'), now)?.text).toBe('status just now');
    expect(freshness(null, now)).toBeNull();
  });
});
