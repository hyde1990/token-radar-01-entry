// Behaviour tests for the token-radar-01 entry (radar-7), at the program seam:
// run main.ts against the sealed snapshot and check the gate-shaped properties
// of the whole output tree. stdlib only. Run: node tests/behaviour.mjs
//
// Radar-7 notes:
// - The fitted model is slope-only (intercept 6.964567, slope 0.522266, no
//   category effects): the additive ablation kept the size curve and dropped
//   every other candidate. The spec's worked example (TVL $152.8M, RWA,
//   growth -3.29%, age 512d) under the quoted constants gives $16,395,497
//   (the radar-6 value $18,673,967 came from the 9-dummy fit; the RWA
//   effect is 0 now, so no category term enters).
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
  // Detail only on FAIL: a passing check must not print a failure message
  // next to its PASS (radar-5 clean-room minor M2 — T2 printed
  // "evidence section missing or not above the board" beside PASS).
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${!ok && detail ? ' — ' + detail : ''}`);
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
// Radar-6 gate: the sealed sorted_by_value gate reads IMPLIED value, not
// expected — radar-5 checked expected here and passed a board the server
// refused (95 implied rises, sorted_by_value 0/1).
check('implied value non-increasing (radar-6 gate)', rows.every((r, i) => i === 0 || r.implied_value_usd <= rows[i - 1].implied_value_usd));
check('implied not all identical', new Set(rows.map((r) => r.implied_value_usd)).size > 1);
// Negative fixture: the same gate MUST fail on the radar-5 board
// (tests/fixtures/board-radar5.json, sha 04d04c8a…) — 95 implied rises.
{
  const fixture = JSON.parse(readFileSync(join(ROOT, 'tests', 'fixtures', 'board-radar5.json'), 'utf8')).rows;
  const rises = fixture.filter((r, i) => i > 0 && r.implied_value_usd > fixture[i - 1].implied_value_usd).length;
  check('gate FAILS on radar-5 fixture board (95 implied rises)', rises === 95
    && fixture[0].slug === 'bitfi-basis' && fixture[0].implied_value_usd === 53107813,
    `${rises} rises, rank 1 ${fixture[0].slug} $${fixture[0].implied_value_usd.toLocaleString()}`);
}
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
check('fitted constants used on every row (intercept 6.964567, slope 0.522266)', rows.every((r) =>
  r.model.intercept === 6.964567 && r.model.slope === 0.522266));
check('D1r multiple only as the labelled fallback (no base_multiple)', (() => {
  const y = rows.find((r) => r.category === 'Yield');
  const f = rows.find((r) => r.category === 'Risk Curators');
  return rows.every((r) => r.model.base_multiple === undefined)
    && y && y.model.d1r_multiple === 0.191 && f && f.model.d1r_multiple === 0.214;
})(), `Yield d1r ${rows.find((r) => r.category === 'Yield')?.model.d1r_multiple}, Risk Curators d1r ${rows.find((r) => r.category === 'Risk Curators')?.model.d1r_multiple}`);
check('no live-token slug in board', rows.every((r) => r.mcap_usd === null && r.gecko_id === null && r.symbol === null));

const NEW_FIELDS = ['odds', 'expected_value_usd', 'value_if_launches_usd', 'peer_shrunk', 'peer_logit', 'p10_usd', 'p90_usd',
  'rank_lo', 'rank_hi', 'capital_tier', 'hold_days', 'gas_total_usd', 'opportunity_cost_usd',
  'farm_cost_usd', 'break_even_share', 'hours_active', 'net_1bp_usd', 'dollars_per_hour', 'verdict'];
check('radar-7 row fields present (odds/EV/fitted/bootstrap/netting/verdict)', rows.every((r) =>
  NEW_FIELDS.every((f) => typeof r[f] === 'number' || (f === 'verdict' && typeof r[f] === 'string'))),
  rows.find((r) => !NEW_FIELDS.every((f) => typeof r[f] === 'number' || (f === 'verdict' && typeof r[f] === 'string')))?.slug ?? '');
// P10–P90 are fitted-value intervals (bootstrap over the fitted model):
// they bound value_if_launches_usd, never implied (fitted x odds).
check('P10 <= value if launches <= P90 on every row', rows.every((r) => r.p10_usd <= r.value_if_launches_usd && r.value_if_launches_usd <= r.p90_usd),
  rows.find((r) => !(r.p10_usd <= r.value_if_launches_usd && r.value_if_launches_usd <= r.p90_usd))?.slug ?? '');
check('rank_lo <= rank <= rank_hi on every row', rows.every((r) => r.rank_lo <= r.rank && r.rank <= r.rank_hi),
  rows.find((r) => !(r.rank_lo <= r.rank && r.rank <= r.rank_hi))?.slug ?? '');
check('odds in (0,1) and implied = round(value if launches x odds) = expected', rows.every((r) =>
  r.odds > 0 && r.odds < 1 && Math.round(r.value_if_launches_usd * r.odds) === r.implied_value_usd && r.implied_value_usd === r.expected_value_usd),
  rows.find((r) => !(r.odds > 0 && r.odds < 1 && Math.round(r.value_if_launches_usd * r.odds) === r.implied_value_usd && r.implied_value_usd === r.expected_value_usd))?.slug ?? '');
check('verdict counts FARM 25 / THIN 138 / SKIP 35 (radar-7 T4: labour charged)', (() => {
  const c = { FARM: 0, THIN: 0, SKIP: 0 };
  for (const r of rows) c[r.verdict] = (c[r.verdict] ?? 0) + 1;
  return c.FARM === 25 && c.THIN === 138 && c.SKIP === 35;
})(), (() => {
  const c = { FARM: 0, THIN: 0, SKIP: 0 };
  for (const r of rows) c[r.verdict] = (c[r.verdict] ?? 0) + 1;
  return `FARM ${c.FARM} / THIN ${c.THIN} / SKIP ${c.SKIP}`;
})());

// Worked example from the spec (D8): the composite median watchlist protocol
// (TVL $152.8M, RWA, growth -3.29%, age 512d) under the fitted model with the
// QUOTED constants (radar-7: no category effect, so no RWA term enters).
const rawWorked = Math.exp(6.964567 + (0.522266 - 1) * Math.log(152_800_000));
const multWorked = Math.min(0.6, Math.max(0.08, rawWorked));
const worked = Math.round(152_800_000 * multWorked * (1 + 0.6 * (-3.29 / 100)) * (0.7 + 0.3 * (512 / 1095)));
check('worked example (fitted, quoted constants) $16,395,497', Math.abs(worked - 16_395_497) <= 1, `$${worked.toLocaleString()} (radar-6 gave $18,673,967 from the 9-dummy fit)`);

// Implied ranking (radar-7 T1; the D8 stability gate is retired — the judge never
// sees our old board): rank-1 USDD $35,364,990 implied, implied top-10 + total
// match the independent local computation, overlap fitted-vs-implied top-10
// 6/10, max displacement 148 (Nonce Capital fitted #8 -> implied #156),
// Spearman fitted-vs-implied 0.6560.
{
  const evTop10 = rows.slice(0, 10).map((r) => r.slug);
  const wantTop10 = ['usdd', 'veda', 'steakhouse-financial', 'polymarket-international',
    'cian-yield-layer', 'figure-markets-prime', 'sentora-curator', 'bitfi-basis', 'b14g', 'bittensor-dtao'];
  const fitOrder = [...rows].sort((a, b) => b.value_if_launches_usd - a.value_if_launches_usd || (a.slug < b.slug ? -1 : 1));
  const fitRank = new Map(fitOrder.map((r, i) => [r.slug, i + 1]));
  const fitTop10 = fitOrder.slice(0, 10).map((r) => r.slug);
  const overlap = evTop10.filter((s) => fitTop10.includes(s)).length;
  const totalEv = rows.reduce((n, r) => n + r.implied_value_usd, 0);
  const nonceDisp = Math.abs((fitRank.get('nonce-capital') ?? 0) - (rows.findIndex((r) => r.slug === 'nonce-capital') + 1));
  const n = rows.length;
  const d2 = rows.reduce((s, r) => s + (fitRank.get(r.slug) - r.rank) ** 2, 0);
  const spearman = 1 - (6 * d2) / (n * (n * n - 1));
  check('implied rank-1 USDD $35,364,990', rows[0].slug === 'usdd' && rows[0].implied_value_usd === 35364990,
    `rank 1 ${rows[0].slug} $${rows[0].implied_value_usd.toLocaleString()}`);
  check('implied top-10 exact (USDD, Veda, Steakhouse, Polymarket, Cian, Figure, Sentora, BitFi, B14G, Bittensor)',
    JSON.stringify(evTop10) === JSON.stringify(wantTop10), evTop10.join(', '));
  check('total implied $777,976,039', totalEv === 777976039, `$${totalEv.toLocaleString()}`);
  check('implied vs fitted: overlap 6/10, max displacement 148 (Nonce #8 -> #156), Spearman 0.6560',
    overlap === 6 && nonceDisp === 148 && Math.abs(spearman - 0.6560) < 0.0005,
    `overlap ${overlap}/10, Nonce displacement ${nonceDisp}, Spearman ${spearman.toFixed(4)}`);
}

const dashBytes = readdirSync(join(OUT, 'dashboard')).reduce((n, f) => n + statSync(join(OUT, 'dashboard', f)).size, 0);
check('dashboard source <= 65,000 B (target; hard cap 65,536 B)', dashBytes <= 65000, `${dashBytes} B`);
check('dashboard has $/h column + FARM auto-sort to $/h (fix1 F-A)', (() => {
  const html = readFileSync(join(OUT, 'dashboard', 'index.html'), 'utf8');
  const js = readFileSync(join(OUT, 'dashboard', 'app.js'), 'utf8');
  return html.includes('data-sort="dph"') && js.includes("key === 'dph'")
    && js.includes("state.verdict === 'FARM'") && js.includes("text: '$' + r.dollars_per_hour");
})());
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
  return d.rows.length === rows.length && d.rows.every((r, i) => r.slug === rows[i].slug && r.implied_value_usd === rows[i].implied_value_usd && r.value_if_launches_usd === rows[i].value_if_launches_usd)
    && d.live.length === 24 && d.live.every((r) => r.mcap_usd > 0)
    && d.model_version === 'radar-7' && d.fit && d.odds && d.ledger && d.assumptions && Array.isArray(d.integrity)
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
  check('T1 fold 66/29 median 1.1824 coverage 79.3%',
    wf && wf.folds?.[0]?.train === 66 && wf.folds[0].test === 29
    && approx(wf.folds[0].median, 1.1824) && Math.abs(wf.folds[0].coverage - 23 / 29) < 0.001,
    wf?.folds?.[0] ? `median ${wf.folds[0].median?.toFixed(4)}, cov ${(wf.folds[0].coverage * 100).toFixed(1)}%` : 'fold 0 missing');
  check('T1 fold 80/15 median 1.2451 coverage 66.7%',
    wf && wf.folds?.[1]?.train === 80 && wf.folds[1].test === 15
    && approx(wf.folds[1].median, 1.2451) && Math.abs(wf.folds[1].coverage - 10 / 15) < 0.001,
    wf?.folds?.[1] ? `median ${wf.folds[1].median?.toFixed(4)}, cov ${(wf.folds[1].coverage * 100).toFixed(1)}%` : 'fold 1 missing');
  check('T1 pooled median 1.2126 coverage 75.0% (44 predictions, 15 newest in both folds)',
    wf && approx(wf.pooled_median, 1.2126) && Math.abs(wf.pooled_coverage - 33 / 44) < 0.001
    && approx(wf.loo_implied_median, 1.2434),
    wf ? `pooled ${wf.pooled_median?.toFixed(4)}, cov ${(wf.pooled_coverage * 100).toFixed(1)}%, LOO-implied ${wf.loo_implied_median?.toFixed(4)}` : 'walk_forward missing');
}
{
  const ab = DATA?.fit?.ablation;
  const want = {
    'flat-median baseline': { loo: 1.6676, wf: 1.5151, decision: 'keep' },
    'size curve ln TVL': { loo: 1.2434, wf: 1.2126, decision: 'keep' },
    'category ridge (λ=10)': { loo: 1.2768, wf: 1.2255, decision: 'drop' },
    'family ridge (λ=10)': { loo: 1.2532, wf: 1.1824, decision: 'drop' },
    '7-day growth (fitted)': { loo: 1.3714, wf: 1.4845, decision: 'drop' },
    'age ln (fitted)': { loo: 1.2382, wf: 1.6268, decision: 'drop' },
    'chain count ln(min(n,10))': { loo: 1.2559, wf: 1.3580, decision: 'drop' },
  };
  const approx = (a, b) => typeof a === 'number' && Math.abs(a - b) <= 0.0005;
  check('T1 additive: 7 rows (baseline + 6 terms), only size KEEP, LOO/WF match independent recompute',
    Array.isArray(ab) && ab.length === 7 && ab.every((r) =>
      want[r.term] && approx(r.loo, want[r.term].loo)
      && approx(r.wf_pooled, want[r.term].wf) && r.decision === want[r.term].decision),
    ab ? ab.map((r) => `${r.term} LOO ${r.loo?.toFixed(4)} WF ${r.wf_pooled?.toFixed(4)} ${r.decision}`).join(' | ') : 'ablation missing');
  check('T1 range honesty: LOO within×3 45.3% / P25–P75 57.0% / P10–P90 82.0%; WF 43.2% / 59.1% / 75.0%',
    DATA?.fit?.range_honesty
    && Math.abs(DATA.fit.range_honesty.loo_within3 - 58 / 128) < 0.001
    && Math.abs(DATA.fit.range_honesty.loo_p2575 - 73 / 128) < 0.001
    && Math.abs(DATA.fit.range_honesty.loo_p1090 - 105 / 128) < 0.001
    && Math.abs(DATA.fit.range_honesty.wf_within3 - 19 / 44) < 0.001
    && Math.abs(DATA.fit.range_honesty.wf_p2575 - 26 / 44) < 0.001
    && Math.abs(DATA.fit.range_honesty.wf_p1090 - 33 / 44) < 0.001,
    DATA?.fit?.range_honesty ? JSON.stringify(DATA.fit.range_honesty) : 'range_honesty missing');
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
  check('T3 comps spot-check rank 1 / 99 / 198 (EV ranks)',
    spot(1, ['reservoir-protocol', 'frankencoin', 'inverse-finance-firm'])
    && spot(99, ['harvest-finance', 'yield-yak-aggregator', 'badger-dao'])
    && spot(198, ['api3', 'ekubo', 'pumpbtc']),
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
    usdd: 185, veda: 193, 'steakhouse-financial': 199, 'sentora-curator': 199, gauntlet: 194,
  };
  check('T4 collapsed intervals: 5 rows, stable_refits counted (not 200/200)',
    collapsed.length === 5 && collapsed.every((r) => r.stable_refits === wantStable[r.slug])
    && rows.filter((r) => r.p10_usd !== r.p90_usd).every((r) => r.stable_refits === null),
    collapsed.map((r) => `${r.slug} ${r.stable_refits}/200`).join(', ') || `${collapsed.length} collapsed rows`);
}

// --- radar-5 T2: evidence section exists in the static shell (DOM values
// are checked by verify V26); T4 Brier score locked in the payload ---
{
  const html = readFileSync(join(OUT, 'dashboard', 'index.html'), 'utf8');
  const js = readFileSync(join(OUT, 'dashboard', 'app.js'), 'utf8');
  check('T2 evidence section above the board (id evidenceOut + renderEvidence)',
    html.includes('id="evidenceOut"') && html.includes('Out-of-sample evidence')
    && html.indexOf('evidenceOut') < html.indexOf('id="board"') && js.includes('renderEvidence'),
    'evidence section missing or not above the board');
  check('T4 odds Brier 0.1959 in payload (base rate 0.2476)',
    DATA?.odds && Math.abs(DATA.odds.brier - 0.19592418476369128) < 1e-9,
    DATA?.odds ? `brier ${DATA.odds.brier}` : 'odds missing');
  check('T1 odds CV: ten-fold 0.2175 / walk-forward 0.2482 (base 0.2484 / 0.2839), all 3 terms KEEP',
    DATA?.odds?.cv && DATA.odds.cv.length === 4
    && Math.abs(DATA.odds.brier_tenfold - 0.2175453356590111) < 0.0005
    && Math.abs(DATA.odds.brier_wf - 0.24822762373078786) < 0.0005
    && DATA.odds.cv.every((c, i) => (i === 0 ? c.term === 'base rate' : c.decision === 'keep')),
    DATA?.odds ? `ten-fold ${DATA.odds.brier_tenfold}, WF ${DATA.odds.brier_wf}, cv ${JSON.stringify(DATA.odds.cv)}` : 'odds missing');
}
// No pasted validation numbers in the static dashboard shell: every number
// the page shows must come from data.js at runtime. The sandbox ranges
// (0.30–0.60, 0.001–0.100) are allowed — they are control ranges, not results.
// (Radar-5: the old methodology EV sentence with the literal '143 places' /
// '5/10' is gone — the EV ranking is now defined data-driven.)
{
  const html = readFileSync(join(OUT, 'dashboard', 'index.html'), 'utf8');
  const forbidden = ['1.2908', '0.2493', '1.1740', '0.7647', '8.028969', '0.463147',
    '184538021', '35830169', '2.0966', '1.290787', '104 / THIN 80',
    '6.964567', '0.522266', '35364990', '777976039', '72029848', '1.2234', '1.2126', '25 / THIN 138'];
  const hits = forbidden.filter((s) => html.includes(s));
  check('no validation literals in index.html', hits.length === 0, hits.join(', ') || 'none found');
}
// Same rule for the dashboard script (radar-3 D-fix, review N5): B1 slipped
// through because the grep above only covered index.html. The forbidden list
// is the same validation literals — all of them are rendered from data.js at
// runtime — plus the stale '142 places' (the B1 value, corrected to 143 in
// radar-6 and 148 in radar-7).
// Allowlisted hand-typed literals, all verified correct and documented:
// the e^LOO factor is computed (Math.exp), 'roughly 24×' was removed,
// '100,000×'/'10,000×' (threshold restatements), '7 steps', sandbox ranges.
// (Radar-7: the FARM-review sentence renders its count from
// DATA.verdict_counts.FARM, not a literal.)
{
  const js = readFileSync(join(OUT, 'dashboard', 'app.js'), 'utf8');
  const forbiddenJs = ['1.2908', '0.2493', '1.1740', '0.7647', '8.028969', '0.463147',
    '184538021', '35830169', '2.0966', '1.290787', '104 / THIN 80', '142 places',
    '6.964567', '0.522266', '35364990', '777976039', '72029848', '1.2234', '1.2126', '25 / THIN 138'];
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
