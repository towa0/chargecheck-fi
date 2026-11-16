// Prints the contrast of every colour pair in both themes. Exits 1 if any pair fails.
// Usage: npm run contrast
import { readFile } from 'node:fs/promises';
import { checkTheme, readThemes } from './lib/contrast.ts';

const css = await readFile('src/styles/tokens.css', 'utf8');
const { light, dark } = readThemes(css);
let failed = 0;
for (const [name, theme] of [
  ['light', light],
  ['dark', dark],
] as const) {
  console.log(`\n${name}`);
  for (const r of checkTheme(theme)) {
    if (!r.ok) failed++;
    const mark = r.ok ? 'ok  ' : 'FAIL';
    console.log(`  ${mark} ${r.ratio.toFixed(2).padStart(5)} >= ${r.min}  ${r.fg} on ${r.bg}  (${r.what})`);
  }
}
if (failed > 0) {
  console.error(`\n${failed} pairs below the minimum`);
  process.exit(1);
}
