import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkTheme, ratio, readThemes } from '../../scripts/lib/contrast.ts';

const css = readFileSync('src/styles/tokens.css', 'utf8');
const themes = readThemes(css);

describe('colour tokens', () => {
  it('computes WCAG ratios', () => {
    expect(ratio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(ratio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });

  it.each(['light', 'dark'] as const)('every pair passes in %s', (name) => {
    const failures = checkTheme(themes[name]).filter((r) => !r.ok);
    expect(failures.map((f) => `${f.fg} on ${f.bg}: ${f.ratio.toFixed(2)} < ${f.min}`)).toEqual([]);
  });

  it('keeps the media-query dark theme and the data-theme dark theme identical', () => {
    expect(themes.darkMedia).toEqual(themes.dark);
  });
});
