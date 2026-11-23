// Token Radar, entry program (Node 22, standard library only).
//
// Reads the sealed snapshot, scores every board-eligible pre-token protocol
// with the radar-5 model in lib/model.ts, and writes the ranked board, the
// dashboard payload, the dashboard and screenshots, and finally the dossier
// the judge reads. Deterministic: pure functions, fixed sort tiebreaks, fixed
// key order in JSON, no clocks, no unseeded randomness, directory listings
// sorted before copying. The only randomness is the bootstrap's mulberry32
// with fixed seed 20261122.
//
// The build checks itself before shipping (spec D12/D14): the board is built
// twice in-process and byte-compared; the fitted and odds coefficients are
// refit from the snapshot and compared to the hardcoded constants at 6
// decimals; the ledger is reconciled; and the dossier is rebuilt twice and
// byte-compared. Any failed check exits 1 with the reason — there is no
// silent fallback to D1r under radar-5 branding. The D8 stability gate is
// RETIRED in radar-5 (spec T1): the board is ranked by expected value, so
// its top 10 legitimately differs from the D1r fitted top 10; the gate is
// still computed and reported in the integrity strip, but no longer fails
// the build.
//
// Layout, local and in the grader alike:
//   node main.ts --input <snapshot.json | directory> [--output <dir>]
//   MAKEFUN_OUTPUT_DIR=<dir> node main.ts --input <snapshot.json>
// Defaults: input /input/snapshot.json, output /output (or MAKEFUN_OUTPUT_DIR).

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import type { IntegrityCheck } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps: the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Read `--name value` or `--name=value` from argv, else the fallback. */
function option(name: string, fallback: string): string {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === `--${name}` && i + 1 < argv.length) return argv[i + 1]!;
    if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3);
  }
  return fallback;
}

function fail(message: string, code = 1): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(code);
}

const inputArg = option('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  fail(`no snapshot at ${inputFile}: pass --input <snapshot.json | directory> or mount the sealed /input`, 2);
}

const outDir = option('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));

// --- integrity (1): the whole pipeline built twice in-process must agree ---
const first = buildRadar(snapshot);
const second = buildRadar(snapshot);
const firstJson = JSON.stringify({ board: first.board, radar: first.radar });
const secondJson = JSON.stringify({ board: second.board, radar: second.radar });
const determinismOk = firstJson === secondJson;
if (!determinismOk) fail('integrity: two in-process builds differ — the pipeline is not deterministic');

const { board, radar, fallbackRows, validation } = first;
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);

// --- integrity (3)(4)(5): refit + gate + ledger, all computed from the snapshot ---
const integrity: IntegrityCheck[] = [];
integrity.push({
  id: 'determinism',
  label: 'Double build byte-identical',
  pass: determinismOk,
  value: 'identical (2 builds)',
});
if (!validation.fitMatches6dp) {
  fail(`integrity: refit OLS coefficients differ from the hardcoded D8 constants (max delta ${validation.fitMaxDelta.toExponential(2)}) — refusing to ship radar-5 branding on a mismatched fit`);
}
integrity.push({
  id: 'fit-recompute',
  label: 'Fitted coefficients recomputed',
  pass: true,
  value: `match to 6 dp (max Δ ${validation.fitMaxDelta.toExponential(1)})`,
});
if (!validation.oddsMatches6dp) {
  fail(`integrity: refit odds coefficients differ from the hardcoded D9 constants (max delta ${validation.oddsMaxDelta.toExponential(2)}) — refusing to ship radar-5 branding on a mismatched fit`);
}
// D8 gate retired in radar-5 (spec T1): reported, never fatal.
integrity.push({
  id: 'odds-recompute',
  label: 'Odds recomputed (D8 gate retired radar-5)',
  pass: true,
  value: `match to 6 dp (max Δ ${validation.oddsMaxDelta.toExponential(1)}, IRLS ${validation.oddsIters} iters); overlap vs D1r top-10: ${validation.stability.overlap}/10, rank-1 ${validation.stability.rank1}`,
});
if (!validation.ledgerOk) {
  fail('integrity: ledger does not reconcile (ranked + excluded + live != 758)');
}
integrity.push({
  id: 'ledger',
  label: 'Ledger 758 reconciles',
  pass: true,
  value: `${radar.ledger.total} = ${radar.ledger.ranked} ranked + ${radar.ledger.excluded_pre} excluded + ${radar.ledger.live} live`,
});

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);

/** Copy a directory's regular files into `to`, in sorted name order, skipping
 *  dot-names. Returns the copied names. */
function copyDir(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dashboardFiles = copyDir(join(HERE, 'dashboard'), join(outDir, 'dashboard'));
const shotFiles = copyDir(join(HERE, 'screenshots'), join(outDir, 'screenshots'));
if (shotFiles.length < 3) {
  fail(`screenshots/ holds ${shotFiles.length} image${shotFiles.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`);
}
for (const name of shotFiles) {
  if (!IMAGE_NAME.test(name)) {
    fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
  }
}

// --- integrity (2): the dossier rebuilt twice from the written tree agrees ---
// buildDossier covers dashboard/ + screenshots/ only, so data.js (written
// next) cannot change its result.
const dossierA = buildDossier(outDir, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS });
const dossierB = buildDossier(outDir, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS });
if (Buffer.from(dossierA).toString('utf8') !== Buffer.from(dossierB).toString('utf8')) {
  fail('integrity: two dossier rebuilds differ — the dossier is not deterministic');
}
// The strip shows the dossier size rounded DOWN to whole KB (decimal,
// 1 KB = 1000 B) — NOT the exact byte count. Reason (radar-5 F1 fix):
// the exact byte count oscillates ±~600 B across retake+rebuild cycles
// because the PNG bytes depend on the digits rendered in the strip
// itself, so an exact-byte fixed point never settles (5 cycles in the
// radar-5 build, 2 more in the F1 fix, best residual 192 B). A whole-KB
// figure is stable across cycles and true: it is the floor of the
// dossier size of the rebuild that produced this strip.
integrity.push({
  id: 'dossier-rebuild',
  label: 'Dossier rebuild byte-identical',
  pass: true,
  value: `identical (2 rebuilds, ${Math.floor(Buffer.from(dossierA).length / 1000)} KB)`,
});

radar.integrity = integrity;
writeFileSync(join(outDir, 'data.js'), dataScript(radar));

// The dossier is written last: the scorer rebuilds it from this output and
// compares the bytes, so nothing may change after this line.
writeFileSync(join(outDir, 'dossier.json'), dossierA);

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside, ${fallbackRows} fallback farm plans)\n` +
    `token radar: rank 1 ${board[0]!.slug} $${board[0]!.expected_value_usd.toLocaleString()} expected value (radar-5, implied $${board[0]!.implied_value_usd.toLocaleString()}); overlap vs D1r top-10: ${validation.stability.overlap}/10; verdicts FARM ${radar.verdict_counts.FARM} / THIN ${radar.verdict_counts.THIN} / SKIP ${radar.verdict_counts.SKIP}\n` +
    `token radar: LOO median |ln err| ${radar.fit.loo_median.toFixed(4)}, split ${radar.fit.split_median.toFixed(4)}, R² ${radar.fit.r2.toFixed(4)}; odds AUC ${radar.odds.auc.toFixed(4)}\n` +
    `token radar: wrote ${join(outDir, 'board.json')}, ${join(outDir, 'data.js')}, ${join(outDir, 'dashboard')} (${dashboardFiles.length} files), ${join(outDir, 'screenshots')} (${shotFiles.length} images) and ${join(outDir, 'dossier.json')}\n`,
);
