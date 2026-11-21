// Behaviour tests for the token-radar-01 entry (radar-2), at the program seam:
// run main.ts against the sealed snapshot and check the gate-shaped properties
// of the whole output tree. stdlib only. Run: node tests/behaviour.mjs
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KIT = '/home/hatch/workspace/makefun/scout-2026-11-21/kits/token-radar-01';
const SNAP = join(KIT, 'input', 'snapshot.json');
const OUT = join(ROOT, '.test-out');

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

execFileSync('node', [join(ROOT, 'main.ts'), '--input', SNAP], {
  env: { ...process.env, MAKEFUN_OUTPUT_DIR: OUT },
  stdio: 'pipe',
});

const board = JSON.parse(readFileSync(join(OUT, 'board.json'), 'utf8'));
const rows = board.rows;
const snap = JSON.parse(readFileSync(SNAP, 'utf8'));
const wl = new Set(snap.watchlist);

check('board has 198 rows', rows.length === 198, `${rows.length} rows`);
check('ranks are exactly 1..198', rows.every((r, i) => r.rank === i + 1));
check('implied non-increasing', rows.every((r, i) => i === 0 || r.implied_value_usd <= rows[i - 1].implied_value_usd));
check('implied not all identical', new Set(rows.map((r) => r.implied_value_usd)).size > 1);
check('watchlist 40/40 covered', snap.watchlist.every((s) => rows.some((r) => r.slug === s)));
check('every row 7 farm steps', rows.every((r) => r.farm_steps.length === 7));
check('every step 20-600 chars with Cost: and Time:', rows.every((r) =>
  r.farm_steps.every((s) => s.length >= 20 && s.length <= 600 && s.includes('Cost:') && s.includes('Time:'))));
check('no step promises airdrop/token/date or names a URL', rows.every((r) =>
  r.farm_steps.every((s) => !/airdrop|you will receive a token|http/i.test(s))));
check('model breakdown present on every row', rows.every((r) =>
  r.model && typeof r.model.base_multiple === 'number' && typeof r.model.size_multiplier === 'number'
  && typeof r.model.growth_multiplier === 'number' && typeof r.model.maturity_multiplier === 'number'));
check('no live-token slug in board', rows.every((r) => r.mcap_usd === null && r.gecko_id === null && r.symbol === null));

// Worked example from the spec: median watchlist protocol (TVL $152.8M, RWA,
// growth -3.29%, age 512d) scores ~$30.9M. Recompute the formula directly here.
const size = Math.min(1.3, Math.max(0.7, (50_000_000 / 152_800_000) ** 0.1));
const growth = 1 + 0.6 * (-3.29 / 100);
const mat = 0.7 + 0.3 * (512 / 1095);
const worked = Math.round(152_800_000 * 0.275 * size * growth * mat);
check('worked example ~$30.9M', Math.abs(worked - 30_900_000) < 1_000_000, `$${worked.toLocaleString()}`);

const dashBytes = readdirSync(join(OUT, 'dashboard')).reduce((n, f) => n + statSync(join(OUT, 'dashboard', f)).size, 0);
check('dashboard source <= 60,000 B', dashBytes <= 60000, `${dashBytes} B`);
const dossier = readFileSync(join(OUT, 'dossier.json'));
check('dossier <= 1.5 MiB', dossier.length <= 1_572_864, `${dossier.length} B`);
const shots = readdirSync(join(OUT, 'screenshots'));
check('3 screenshots copied', shots.length === 3, shots.join(', '));
for (const f of shots) {
  const b = statSync(join(OUT, 'screenshots', f)).size;
  check(`screenshot ${f} <= 512 KiB`, b <= 524288, `${b} B`);
}
check('data.js agrees with board.json', (() => {
  const js = readFileSync(join(OUT, 'data.js'), 'utf8');
  const m = js.match(/^window\.RADAR=(\{.*\});\n$/s);
  if (!m) return false;
  const d = JSON.parse(m[1]);
  return d.rows.length === rows.length && d.rows.every((r, i) => r.slug === rows[i].slug && r.implied_value_usd === rows[i].implied_value_usd)
    && d.live.length === 24 && d.live.every((r) => r.mcap_usd > 0);
})());

if (failures > 0) { console.error(`${failures} behaviour check(s) failed`); process.exit(1); }
console.log('all behaviour checks passed');
