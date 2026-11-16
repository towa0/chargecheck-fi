// WCAG contrast checks for the colour tokens in src/styles/tokens.css.

export type Theme = Record<string, string>;

/** Reads `--name: #hex;` declarations from the first block whose selector matches. */
export function readBlock(css: string, selector: RegExp): Theme {
  const start = css.search(selector);
  if (start < 0) throw new Error(`No block matching ${selector}`);
  const open = css.indexOf('{', start);
  let depth = 0;
  let end = open;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}') depth--;
    if (depth === 0) {
      end = i;
      break;
    }
  }
  const body = css.slice(open + 1, end);
  const theme: Theme = {};
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    if (m[1] && m[2]) theme[m[1]] = m[2].toLowerCase();
  }
  return theme;
}

export function readThemes(css: string): { light: Theme; dark: Theme; darkMedia: Theme } {
  const light = readBlock(css, /^:root\s*\{/m);
  const darkMedia = readBlock(css, /:root:not\(\[data-theme='light'\]\)\s*\{/);
  const darkOnly = readBlock(css, /:root\[data-theme='dark'\]\s*\{/);
  // Dark overrides only the colours it lists; everything else comes from light.
  return { light, dark: { ...light, ...darkOnly }, darkMedia: { ...light, ...darkMedia } };
}

function luminance(hex: string): number {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = ch.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (lin[0] ?? 0) + 0.7152 * (lin[1] ?? 0) + 0.0722 * (lin[2] ?? 0);
}

export function ratio(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** [foreground token, background token, minimum ratio, what it is] */
export const PAIRS: [string, string, number, string][] = [
  ['ink', 'bg', 4.5, 'body text on page'],
  ['ink', 'surface', 4.5, 'body text on cards'],
  ['ink', 'surface-2', 4.5, 'text on raised chips'],
  ['ink-2', 'surface', 4.5, 'secondary text'],
  ['ink-2', 'bg', 4.5, 'secondary text on page'],
  ['ink-2', 'surface-2', 4.5, 'secondary text on chips'],
  ['ink-3', 'surface', 4.5, 'small muted text'],
  ['ink-3', 'bg', 4.5, 'small muted text on page'],
  ['line-strong', 'surface', 3, 'input and chip borders'],
  ['line-strong', 'bg', 3, 'borders on page'],
  ['accent', 'surface', 4.5, 'accent text and links'],
  ['accent', 'bg', 4.5, 'links on page'],
  ['accent-ink', 'accent', 4.5, 'text on accent fill'],
  ['accent-soft-ink', 'accent-soft', 4.5, 'text on soft accent'],
  ['accent', 'accent-soft', 3, 'accent outline on soft accent'],
  ['focus', 'surface', 3, 'focus ring on cards'],
  ['focus', 'bg', 3, 'focus ring on page'],
  ['free', 'free-bg', 4.5, 'free pill text'],
  ['free', 'surface', 4.5, 'free text on card'],
  ['busy', 'busy-bg', 4.5, 'busy pill text'],
  ['busy', 'surface', 4.5, 'busy text on card'],
  ['down', 'down-bg', 4.5, 'out of order pill text'],
  ['down', 'surface', 4.5, 'out of order text on card'],
  ['unknown', 'unknown-bg', 4.5, 'no live status pill text'],
  ['unknown', 'surface', 4.5, 'no live status text on card'],
  ['warn', 'surface', 4.5, 'outdated status text'],
  ['pin-ink', 'pin-bg', 4.5, 'price on map pin'],
  ['pin-ring', 'pin-bg', 3, 'map pin outline'],
  ['free', 'pin-bg', 3, 'free shape on pin'],
  ['busy', 'pin-bg', 3, 'busy shape on pin'],
  ['down', 'pin-bg', 3, 'down shape on pin'],
  ['unknown', 'pin-bg', 3, 'unknown shape on pin'],
];

export interface PairResult {
  fg: string;
  bg: string;
  min: number;
  ratio: number;
  ok: boolean;
  what: string;
}

export function checkTheme(theme: Theme): PairResult[] {
  return PAIRS.map(([fg, bg, min, what]) => {
    const a = theme[fg];
    const b = theme[bg];
    if (!a || !b) return { fg, bg, min, ratio: 0, ok: false, what: `${what} (missing token)` };
    const r = ratio(a, b);
    return { fg, bg, min, ratio: r, ok: r >= min, what };
  });
}
