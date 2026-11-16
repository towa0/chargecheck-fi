import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  parseEnergy,
  resolveStart,
  saveSettings,
  timeLabel,
  tonight,
} from '../../src/logic/settings.ts';
import { zonedToUtc } from '../../src/tariff/time.ts';

const at = (d: number, h: number, m = 0) => zonedToUtc(2026, 11, d, h * 60 + m);

function memory(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size;
    },
  };
}

describe('settings storage', () => {
  it('round-trips valid settings', () => {
    const s = memory();
    const settings = { ...DEFAULT_SETTINGS, energyKWh: 50, fastOnly: true, connector: 'CHADEMO', region: 'finland', sort: 'power' as const };
    saveSettings(s, settings);
    expect(loadSettings(s)).toEqual(settings);
  });

  it('falls back to defaults for junk, bad values and broken storage', () => {
    const s = memory();
    s.setItem('chargecheck-settings-v1', '{not json');
    expect(loadSettings(s)).toEqual(DEFAULT_SETTINGS);
    s.setItem('chargecheck-settings-v1', JSON.stringify({ energyKWh: 9999, region: 'mars', connector: 'X', timeMode: 'custom', customStart: 'soon' }));
    expect(loadSettings(s)).toEqual(DEFAULT_SETTINGS);
    const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(loadSettings(throwing)).toEqual(DEFAULT_SETTINGS);
    expect(() => saveSettings(throwing, DEFAULT_SETTINGS)).not.toThrow();
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('parses energy input', () => {
    expect(parseEnergy('42')).toBe(42);
    expect(parseEnergy('12,5')).toBe(12.5);
    expect(parseEnergy('')).toBeNull();
    expect(parseEnergy('0')).toBeNull();
    expect(parseEnergy('201')).toBeNull();
  });
});

describe('start time', () => {
  it('tonight is today 22:00 before 22:00 and tomorrow after', () => {
    expect(tonight(at(16, 18)).getTime()).toBe(at(16, 22));
    expect(tonight(at(16, 22, 30)).getTime()).toBe(at(17, 22));
  });

  it('now rounds down to the minute; custom parses Finnish time', () => {
    expect(resolveStart({ timeMode: 'now', customStart: '' }, at(16, 18, 7) + 31_000).getTime()).toBe(at(16, 18, 7));
    expect(resolveStart({ timeMode: 'custom', customStart: '2026-11-20T06:15' }, at(16, 18)).getTime()).toBe(at(20, 6, 15));
  });

  it('labels the chosen time', () => {
    const now = at(16, 18);
    expect(timeLabel({ timeMode: 'now', customStart: '' }, now)).toBe('Now');
    expect(timeLabel({ timeMode: 'tonight', customStart: '' }, now)).toBe('Tonight 22:00');
    expect(timeLabel({ timeMode: 'tonight', customStart: '' }, at(16, 23))).toBe('Tomorrow 22:00');
    expect(timeLabel({ timeMode: 'custom', customStart: '2026-11-16T20:30' }, now)).toBe('Today 20:30');
    expect(timeLabel({ timeMode: 'custom', customStart: '2026-11-20T06:15' }, now)).toBe('20.11. 06:15');
  });
});
