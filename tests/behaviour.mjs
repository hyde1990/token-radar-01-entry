// Behaviour tests for the token-radar-01 entry (radar-3), at the program seam:
// run main.ts against the sealed snapshot and check the gate-shaped properties
// of the whole output tree. stdlib only. Run: node tests/behaviour.mjs
//
// Radar-3 notes (spec D8–D14):
// - The fitted model is hardcoded to the D8 quoted constants (intercept
//   8.028969, slope 0.463147, 9 category effects). The spec's worked example
//   $18,673,844 was computed from the same stated inputs with FULL-PRECISION
//   betas; the quoted constants give $18,673,967 for those inputs (+$123,
//   0.00066%). The check below asserts the quoted-constant value exactly
//   and the $123 gap is recorded in BUILD.md, not hidden.
// - The D1r median model survives only as the labelled d1r_multiple fallback
//   (Yield 0.191, Risk Curators 0.214); no row may carry base_multiple.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Kit fresh level 38 (snapshot byte-identical to the 21 Nov kit, sha 42a71213…).
const KIT = '/home/hatch/workspace/makefun/token-radar/kit-fresh/token-radar-01-kit';
const SNAP = join(KIT, 'input', 'snapshot.json');
const OUT = join(ROOT, '.test-out');

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const run = execFileSync('node', [join(ROOT, 'main.ts'), '--input', SNAP], {
  env: { ...process.env, MAKEFUN_OUTPUT_DIR: OUT },
  stdio: 'pipe',
});
const runStdout = run.toString('utf8');

const board = JSON.parse(readFileSync(join(OUT, 'board.json'), 'utf8'));
const rows = board.rows;
const snap = JSON.parse(readFileSync(SNAP, 'utf8'));
const wl = new Set(snap.watchlist);

check('board has 198 rows', rows.length === 198, `${rows.length} rows`);
check('ranks are exactly 1..198', rows.every((r, i) => r.rank === i + 1));
check('implied non-increasing', rows.every((r, i) => i === 0 || r.implied_value_usd <= rows[i - 1].implied_value_usd));
check('implied not all identical', new Set(rows.map((r) => r.implied_value_usd)).size > 1);
check('watchlist 40/40 covered', snap.watchlist.every((s) => rows.some((r) => r.slug === s)));
check('no fallback farm plans (18 families cover the board)', runStdout.includes('0 fallback farm plans'), runStdout.trim().split('\n')[0] ?? '');
check('every row 7 farm steps', rows.every((r) => r.farm_steps.length === 7));
check('every step 20-600 chars with Cost: and Time:', rows.every((r) =>
  r.farm_steps.every((s) => s.length >= 20 && s.length <= 600 && s.includes('Cost:') && s.includes('Time:'))));
check('no step promises airdrop/token/date or names a URL', rows.every((r) =>
  r.farm_steps.every((s) => !/airdrop|you will receive a token|http/i.test(s))));
check('fitted model breakdown present on every row', rows.every((r) =>
  r.model && typeof r.model.intercept === 'number' && typeof r.model.slope === 'number'
  && typeof r.model.fitted_multiple === 'number' && typeof r.model.fitted_multiple_raw === 'number'
  && typeof r.model.d1r_multiple === 'number' && typeof r.model.growth_multiplier === 'number'
  && typeof r.model.maturity_multiplier === 'number' && typeof r.model.at_clamp_bound === 'boolean'));
check('fitted constants used on every row (intercept 8.028969, slope 0.463147)', rows.every((r) =>
  r.model.intercept === 8.028969 && r.model.slope === 0.463147));
check('D1r multiple only as the labelled fallback (no base_multiple)', (() => {
  const y = rows.find((r) => r.category === 'Yield');
  const f = rows.find((r) => r.category === 'Risk Curators');
  return rows.every((r) => r.model.base_multiple === undefined)
    && y && y.model.d1r_multiple === 0.191 && f && f.model.d1r_multiple === 0.214;
})(), `Yield d1r ${rows.find((r) => r.category === 'Yield')?.model.d1r_multiple}, Risk Curators d1r ${rows.find((r) => r.category === 'Risk Curators')?.model.d1r_multiple}`);
check('no live-token slug in board', rows.every((r) => r.mcap_usd === null && r.gecko_id === null && r.symbol === null));

const NEW_FIELDS = ['odds', 'expected_value_usd', 'peer_shrunk', 'peer_logit', 'p10_usd', 'p90_usd',
  'rank_lo', 'rank_hi', 'capital_tier', 'hold_days', 'gas_total_usd', 'opportunity_cost_usd',
  'farm_cost_usd', 'break_even_share', 'hours_active', 'net_1bp_usd', 'dollars_per_hour', 'verdict'];
check('radar-3 row fields present (odds/EV/bootstrap/netting/verdict)', rows.every((r) =>
  NEW_FIELDS.every((f) => typeof r[f] === 'number' || (f === 'verdict' && typeof r[f] === 'string'))),
  rows.find((r) => !NEW_FIELDS.every((f) => typeof r[f] === 'number' || (f === 'verdict' && typeof r[f] === 'string')))?.slug ?? '');
check('P10 <= implied <= P90 on every row', rows.every((r) => r.p10_usd <= r.implied_value_usd && r.implied_value_usd <= r.p90_usd),
  rows.find((r) => !(r.p10_usd <= r.implied_value_usd && r.implied_value_usd <= r.p90_usd))?.slug ?? '');
check('rank_lo <= rank <= rank_hi on every row', rows.every((r) => r.rank_lo <= r.rank && r.rank <= r.rank_hi),
  rows.find((r) => !(r.rank_lo <= r.rank && r.rank <= r.rank_hi))?.slug ?? '');
check('odds in (0,1) and EV = round(implied x odds)', rows.every((r) =>
  r.odds > 0 && r.odds < 1 && Math.round(r.implied_value_usd * r.odds) === r.expected_value_usd),
  rows.find((r) => !(r.odds > 0 && r.odds < 1 && Math.round(r.implied_value_usd * r.odds) === r.expected_value_usd))?.slug ?? '');
check('verdict counts FARM 104 / THIN 80 / SKIP 14', (() => {
  const c = { FARM: 0, THIN: 0, SKIP: 0 };
  for (const r of rows) c[r.verdict] = (c[r.verdict] ?? 0) + 1;
  return c.FARM === 104 && c.THIN === 80 && c.SKIP === 14;
})(), (() => {
  const c = { FARM: 0, THIN: 0, SKIP: 0 };
  for (const r of rows) c[r.verdict] = (c[r.verdict] ?? 0) + 1;
  return `FARM ${c.FARM} / THIN ${c.THIN} / SKIP ${c.SKIP}`;
})());

// Worked example from the spec (D8): the composite median watchlist protocol
// (TVL $152.8M, RWA, growth -3.29%, age 512d) under the fitted model with the
// QUOTED constants. The spec prints $18,673,844, which is the same inputs
// with full-precision betas; the quoted constants give $18,673,967 (+$123).
const rawWorked = Math.exp(8.028969 + (0.463147 - 1) * Math.log(152_800_000) + 0.179798);
const multWorked = Math.min(0.6, Math.max(0.08, rawWorked));
const worked = Math.round(152_800_000 * multWorked * (1 + 0.6 * (-3.29 / 100)) * (0.7 + 0.3 * (512 / 1095)));
check('worked example (fitted, quoted constants) $18,673,967', Math.abs(worked - 18_673_967) <= 1, `$${worked.toLocaleString()} (spec prints $18,673,844 from full-precision betas; +$123)`);

// Stability gate D8 (light version; verify.mjs V16 does the full check):
// D1r ranking over the same eligible set, top-10 overlap >= 7/10 and rank-1
// unchanged (steakhouse-financial).
{
  const D1R = {
    fallback: 0.214,
    multiples: {
      'Liquid Staking': 0.08, CEX: 0.08, Lending: 0.132, Yield: 0.191,
      RWA: 0.275, Dexs: 0.342, Bridge: 0.557, 'Basis Trading': 0.6, 'Canonical Bridge': 0.6,
    },
  };
  const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
  const EXCH = ['Binance', 'Coinbase', 'Kraken', 'Bybit', 'OKX', 'Bitget', 'KuCoin', 'Huobi', 'Gate', 'Gemini', 'Bitstamp', 'Bitfinex', 'Crypto.com', 'HTX', 'MEXC', 'Bithumb', 'Upbit', 'Deribit'];
  const EXCL = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);
  const isPre = (p) => p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
  const eligible = (p) => isPre(p) && p.category !== null && !EXCL.has(p.category) && !VERSIONED.test(p.name)
    && !p.name.toLowerCase().split(/[^a-z]+/).some((w) => w === 'wrapped' || w === 'staked' || w === 'staking')
    && !EXCH.some((e) => { const l = p.name.toLowerCase(); return l === e.toLowerCase() || l.startsWith(e.toLowerCase() + ' ') || l.startsWith(e.toLowerCase() + '.'); });
  const ageOf = (p) => p.listed_at === null ? null
    : Math.max(0, Math.floor((Date.parse(`${snap.as_of}T00:00:00Z`) - Date.parse(`${p.listed_at}T00:00:00Z`)) / 86_400_000));
  const d1r = (p) => {
    const base = D1R.multiples[p.category] ?? D1R.fallback;
    const size = Math.min(1.3, Math.max(0.7, (50_000_000 / p.tvl_usd) ** 0.1));
    const g = 1 + 0.6 * Math.min(60, Math.max(-40, p.change_7d ?? 0)) / 100;
    const a = ageOf(p) ?? 365;
    const mat = 0.7 + 0.3 * (Math.min(Math.max(a, 0), 1095) / 1095);
    return Math.max(1, Math.round(p.tvl_usd * base * size * g * mat));
  };
  const d1rTop10 = snap.protocols.filter(eligible)
    .map((p) => ({ slug: p.slug, v: d1r(p) }))
    .sort((a, b) => b.v - a.v || (a.slug < b.slug ? -1 : 1)).slice(0, 10).map((r) => r.slug);
  const fitTop10 = rows.slice(0, 10).map((r) => r.slug);
  const overlap = fitTop10.filter((s) => d1rTop10.includes(s)).length;
  check('stability gate: top-10 overlap >= 7/10 and rank-1 unchanged',
    overlap >= 7 && rows[0].slug === 'steakhouse-financial' && d1rTop10[0] === 'steakhouse-financial',
    `overlap ${overlap}/10, rank-1 fitted ${rows[0].slug} vs D1r ${d1rTop10[0]}`);
}

const dashBytes = readdirSync(join(OUT, 'dashboard')).reduce((n, f) => n + statSync(join(OUT, 'dashboard', f)).size, 0);
check('dashboard source <= 65,000 B (target; hard cap 65,536 B)', dashBytes <= 65000, `${dashBytes} B`);
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
    && d.live.length === 24 && d.live.every((r) => r.mcap_usd > 0)
    && d.model_version === 'radar-4' && d.fit && d.odds && d.ledger && d.assumptions && Array.isArray(d.integrity)
    && d.integrity.length === 5 && d.integrity.every((c) => c.pass === true);
})());

// --- radar-4 (T1–T4): walk-forward, ablation, comps, stable intervals ---
// Numbers below are the independent recompute in
// ~/workspace/makefun/token-radar/verification/build-log-radar4.md §0
// (scripts /tmp/radar4-recompute.mjs + /tmp/radar4-recompute2.mjs); the
// verify suite (V22–V24) recomputes them again with its own code.
const DATA = (() => {
  const js = readFileSync(join(OUT, 'data.js'), 'utf8');
  const m = js.match(/^window\.RADAR=(\{.*\});\n$/s);
  return m ? JSON.parse(m[1]) : null;
})();
{
  const wf = DATA?.fit?.walk_forward;
  const approx = (a, b, tol = 0.0005) => typeof a === 'number' && Math.abs(a - b) <= tol;
  check('T1 walk-forward n=95 (33 null listed_at excluded, no imputation)',
    wf && wf.n === 95 && wf.n_null_excluded === 33,
    wf ? `n=${wf.n}, excluded=${wf.n_null_excluded}` : 'walk_forward missing');
  check('T1 fold 66/29 median 1.2004 coverage 79.3%',
    wf && wf.folds?.[0]?.train === 66 && wf.folds[0].test === 29
    && approx(wf.folds[0].median, 1.2004) && Math.abs(wf.folds[0].coverage - 23 / 29) < 0.001,
    wf?.folds?.[0] ? `median ${wf.folds[0].median?.toFixed(4)}, cov ${(wf.folds[0].coverage * 100).toFixed(1)}%` : 'fold 0 missing');
  check('T1 fold 80/15 median 2.2077 coverage 73.3%',
    wf && wf.folds?.[1]?.train === 80 && wf.folds[1].test === 15
    && approx(wf.folds[1].median, 2.2077) && Math.abs(wf.folds[1].coverage - 11 / 15) < 0.001,
    wf?.folds?.[1] ? `median ${wf.folds[1].median?.toFixed(4)}, cov ${(wf.folds[1].coverage * 100).toFixed(1)}%` : 'fold 1 missing');
  check('T1 pooled median 1.2509 coverage 77.3% (44 predictions, 15 newest in both folds)',
    wf && approx(wf.pooled_median, 1.2509) && Math.abs(wf.pooled_coverage - 34 / 44) < 0.001
    && approx(wf.loo_implied_median, 1.2490),
    wf ? `pooled ${wf.pooled_median?.toFixed(4)}, cov ${(wf.pooled_coverage * 100).toFixed(1)}%, LOO-implied ${wf.loo_implied_median?.toFixed(4)}` : 'walk_forward missing');
}
{
  const ab = DATA?.fit?.ablation;
  const want = {
    'slope/size': { loo: 1.2006, wf: 1.3403 },
    growth: { loo: 1.3106, wf: 1.3183 },
    maturity: { loo: 1.2387, wf: 1.3542 },
    'category effects': { loo: 1.2434, wf: 1.2126 },
  };
  const approx = (a, b) => typeof a === 'number' && Math.abs(a - b) <= 0.0005;
  check('T2 ablation: 4 terms, all KEEP, LOO/WF match independent recompute',
    Array.isArray(ab) && ab.length === 4 && ab.every((r) =>
      want[r.term] && approx(r.loo_without, want[r.term].loo)
      && approx(r.wf_pooled_without, want[r.term].wf) && r.decision === 'keep'),
    ab ? ab.map((r) => `${r.term} LOO ${r.loo_without?.toFixed(4)} WF ${r.wf_pooled_without?.toFixed(4)} ${r.decision}`).join(' | ') : 'ablation missing');
  check('T2 ablation movement recorded (no-cat re-ranks 193/198, max 90)',
    Array.isArray(ab) && ab.find((r) => r.term === 'category effects')?.rows_moved === 193
    && ab.find((r) => r.term === 'category effects')?.max_displacement === 90,
    ab ? JSON.stringify(ab.find((r) => r.term === 'category effects')) : 'ablation missing');
}
{
  const bySlug = new Map(snap.protocols.map((p) => [p.slug, p]));
  const livePos = new Set(snap.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0).map((p) => p.slug));
  const approx6 = (a, b) => Math.abs(a - b) <= 1e-6;
  let bad = '';
  let fallbackRows = 0;
  for (const r of rows) {
    if (!Array.isArray(r.comps) || r.comps.length !== 3) { bad = `${r.slug}: comps not 3`; break; }
    if (r.comps_same_category !== r.comps.filter((c) => c.same_category).length) { bad = `${r.slug}: comps_same_category mismatch`; break; }
    if (r.comps_same_category < 3) fallbackRows++;
    for (const c of r.comps) {
      const p = bySlug.get(c.slug);
      if (!p || !livePos.has(c.slug)) { bad = `${r.slug}: comp ${c.slug} not a live positive-mcap token`; break; }
      if (c.name !== p.name || c.tvl_usd !== p.tvl_usd || !approx6(c.multiple, Math.round((p.mcap_usd / p.tvl_usd) * 1e6) / 1e6)) {
        bad = `${r.slug}: comp ${c.slug} fields mismatch`; break;
      }
      if (c.same_category !== (p.category === r.category)) { bad = `${r.slug}: comp ${c.slug} same_category wrong`; break; }
    }
    if (bad) break;
  }
  check('T3 comps: 3 live traded tokens per row, fields match snapshot', bad === '', bad || 'all 198 rows x 3 comps');
  check('T3 fallback rows: 102/198 need cross-category comps', fallbackRows === 102, `${fallbackRows} rows`);
  const spot = (rank, slugs) => {
    const r = rows[rank - 1];
    return r && Array.isArray(r.comps) && JSON.stringify(r.comps.map((c) => c.slug)) === JSON.stringify(slugs);
  };
  check('T3 comps spot-check rank 1 / 99 / 198',
    spot(1, ['api3', 'babylon-protocol', 'polygon-bridge'])
    && spot(99, ['veranta', 'gains-network', 'ekubo'])
    && spot(198, ['harmonix-finance', 'looped-hype', 'aura']),
    `r1 ${rows[0]?.comps?.map((c) => c.slug).join(',')}; r99 ${rows[98]?.comps?.map((c) => c.slug).join(',')}; r198 ${rows[197]?.comps?.map((c) => c.slug).join(',')}`);
  const sym = rows.find((r) => r.slug === 'symbiotic');
  check('T3 comps spot-check 0-live category row (symbiotic: 0 same-category)',
    sym && sym.comps_same_category === 0
    && JSON.stringify(sym.comps.map((c) => c.slug)) === JSON.stringify(['xdai-stake-bridge', 'starknet-bridge', 'solstice']),
    sym ? sym.comps.map((c) => c.slug).join(',') : 'symbiotic not on board');
}
{
  const collapsed = rows.filter((r) => r.p10_usd === r.p90_usd);
  const wantStable = {
    'steakhouse-financial': 198, 'sentora-curator': 198, gauntlet: 197, veda: 196, usdd: 188,
  };
  check('T4 collapsed intervals: 5 rows, stable_refits counted (not 200/200)',
    collapsed.length === 5 && collapsed.every((r) => r.stable_refits === wantStable[r.slug])
    && rows.filter((r) => r.p10_usd !== r.p90_usd).every((r) => r.stable_refits === null),
    collapsed.map((r) => `${r.slug} ${r.stable_refits}/200`).join(', ') || `${collapsed.length} collapsed rows`);
}

// No pasted validation numbers in the static dashboard shell: every number
// the page shows must come from data.js at runtime. The sandbox ranges
// (0.30–0.60, 0.001–0.100) are allowed — they are control ranges, not results.
{
  const html = readFileSync(join(OUT, 'dashboard', 'index.html'), 'utf8');
  const forbidden = ['1.2908', '0.2493', '1.1740', '0.7647', '8.028969', '0.463147',
    '184538021', '35830169', '2.0966', '1.290787', '104 / THIN 80'];
  const hits = forbidden.filter((s) => html.includes(s));
  check('no validation literals in index.html', hits.length === 0, hits.join(', ') || 'none found');
}
// Same rule for the dashboard script (radar-3 D-fix, review N5): B1 slipped
// through because the grep above only covered index.html. The forbidden list
// is the same validation literals — all of them are rendered from data.js at
// runtime — plus the stale '142 places' (the B1 value, corrected to 143).
// Allowlisted hand-typed literals, all verified correct and documented:
// '143 places' + '5/10' in the methodology EV sentence (spec §C4; data.js
// carries no EV-displacement/overlap field, so the sentence stays a literal
// — see verification/radar3-dfix-report.md), '≈ 3.6' (e^1.29), 'roughly 24×',
// '100,000×'/'10,000×' (threshold restatements), '7 steps', sandbox ranges.
{
  const js = readFileSync(join(OUT, 'dashboard', 'app.js'), 'utf8');
  const forbiddenJs = ['1.2908', '0.2493', '1.1740', '0.7647', '8.028969', '0.463147',
    '184538021', '35830169', '2.0966', '1.290787', '104 / THIN 80', '142 places'];
  const hitsJs = forbiddenJs.filter((s) => js.includes(s));
  check('no validation literals in app.js', hitsJs.length === 0, hitsJs.join(', ') || 'none found');
}
{
  const html = readFileSync(join(OUT, 'dashboard', 'index.html'), 'utf8');
  const js = readFileSync(join(OUT, 'dashboard', 'app.js'), 'utf8');
  const slopeOk = /id="slopeSlider"[^>]*min="0\.30"[^>]*max="0\.60"[^>]*step="0\.01"/.test(html)
    || /id="slopeSlider"[^>]*min="0\.3"[^>]*max="0\.6"[^>]*step="0\.01"/.test(html);
  const allocOk = /id="allocSlider"[^>]*min="0"[^>]*max="6"[^>]*step="1"/.test(html);
  const stepsOk = /ALLOC_STEPS = \[0\.001, 0\.002, 0\.005, 0\.01, 0\.02, 0\.05, 0\.1\]/.test(js);
  check('sandbox sliders exist with D13 ranges (slope 0.30-0.60, alloc 7 log steps)', slopeOk && allocOk && stepsOk,
    `slope ${slopeOk}, alloc slider ${allocOk}, ALLOC_STEPS ${stepsOk}`);
}

if (failures > 0) { console.error(`${failures} behaviour check(s) failed`); process.exit(1); }
console.log('all behaviour checks passed');
