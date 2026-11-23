// Verification suite for the token-radar-01 entry (radar-7) — ticket 14, spec D14.
// Radar-7: the fitted model is slope-only (additive ablation kept the size
// curve, dropped category/family/growth/age/chain); farm netting charges
// $25/h labour (FARM 25); the dashboard has three evidence tables above
// the board and a dark theme. V15/V22/V23/V26 rewritten for the new model;
// V28 locks the odds CV + range honesty. V4/V27 keep the sealed dev-gate
// rollup plus the radar-5 board as a negative fixture (the gate MUST fail
// on it — it failed sorted_by_value 0/1 on the server).
//
// Checks V1–V24, V26–V27, all local, no network, stdlib only (Node 22). V13/V20 render
// the dashboard headlessly by spawning the system Python Playwright (the same
// method as the pre-build screenshot run); the script itself imports nothing
// but node: builtins. V12′/V15/V16/V17/V21 recompute the fitted model, the
// odds, the bootstrap and the held-out metrics from the snapshot with
// independent re-implementations written here — they never import
// lib/model.ts, lib/ols.ts or lib/bootstrap.ts, so a bug shared with the
// entry cannot hide.
//
// Run from the entry repo root:
//   node scripts/verify.mjs [--snapshot <file>] [--keep <dir>]
// Exit 0 only when every V-check passes. A failure names the check and the
// offending row/file. What this suite cannot verify (there is no local grade
// for this bounty — the AI judge is pairwise only, server-side) is stated in
// the closing section, not claimed.
//
// The suite runs main.ts itself, twice, into two fresh scratch dirs under a
// temp dir (deleted afterwards unless --keep is given); it never trusts a
// previous run's output.
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync,
  statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'));
const KIT_SNAPSHOT = '/home/hatch/workspace/makefun/token-radar/kit-fresh/token-radar-01-kit/input/snapshot.json';
const MAIN = join(ROOT, 'main.ts');
const VENDOR = join(ROOT, 'vendor', 'makefun-board.ts');

// --- spec D1r constants, copied from the spec table (NOT read from lib/model.ts) ---
const SPEC = {
  fallback: 0.214,
  multiples: {
    'Liquid Staking': 0.08, CEX: 0.08, Lending: 0.132, Yield: 0.191,
    RWA: 0.275, Dexs: 0.342, Bridge: 0.557, 'Basis Trading': 0.6,
    'Canonical Bridge': 0.6,
  },
  sizeRef: 50_000_000, sizeExp: 0.1, sizeLo: 0.7, sizeHi: 1.3,
  growthWeight: 0.6, growthLo: -40, growthHi: 60,
  maturityFloor: 0.7, maturityRange: 0.3, maturityDays: 1095, unknownAge: 365,
};

// --- spec D8 fitted-model constants (radar-7: slope-only, quoted 6 dp) ---
const FIT = {
  intercept: 6.964567, slope: 0.522266,
  effects: {},
  floor: 0.08, cap: 0.6,
};
// --- spec D9 odds coefficients (quoted 6 dp) + exact peer share 416/758 ---
const ODDS_Q = [-3.040781, 0.446892, -3.061039, 1.329665];
const ODDS_PRIOR = 5;
const LIVE_SHARE_EXACT = 416 / 758;
const EXCLUDED_CATEGORIES = new Set([
  'CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC',
]);
const EXCHANGE_NAMES = [
  'Binance', 'Coinbase', 'Kraken', 'Bybit', 'OKX', 'Bitget', 'KuCoin',
  'Huobi', 'Gate', 'Gemini', 'Bitstamp', 'Bitfinex', 'Crypto.com',
  'HTX', 'MEXC', 'Bithumb', 'Upbit', 'Deribit',
];
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const Z_90 = 1.2816;
const SPLIT_SEED = 20261122;
const BOOTSTRAP_B = 200;
const BOOTSTRAP_SEED = 20261122;

const PLAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i === -1) return fallback;
  const a = argv[i];
  return a.includes('=') ? a.slice(a.indexOf('=') + 1) : argv[i + 1] ?? fallback;
};
const SNAPSHOT = opt('snapshot', KIT_SNAPSHOT);
const KEEP = opt('keep', null);

const results = [];
function record(id, pass, detail) {
  results.push({ id, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id} — ${detail}`);
}
const fail = (id, detail) => record(id, false, detail);
const ok = (id, detail) => record(id, true, detail);
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};
const DAY_MS = 86_400_000;
const round2 = (x) => Math.round(x * 100) / 100;

/** The sealed dev gate sorted_by_value (RULES.txt baris 25/31), mirrored
 *  here so the radar-5 failure can never pass locally again: ranks exactly
 *  1..N once each, implied_value_usd never rises as rank ascends, and the
 *  rows do not all carry one value. Returns the first violation, or null
 *  when the board passes. V4 runs it on the fresh board; V27 runs the
 *  SAME function on the radar-5 board fixture, which MUST fail. */
function sortedByValueGate(boardRows) {
  const ranks = boardRows.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  }
  for (let i = 1; i < boardRows.length; i++) {
    if (boardRows[i].implied_value_usd > boardRows[i - 1].implied_value_usd) {
      return `row ${i + 1} ${boardRows[i].slug} implied $${boardRows[i].implied_value_usd.toLocaleString()} rises above row ${i} $${boardRows[i - 1].implied_value_usd.toLocaleString()}`;
    }
  }
  if (boardRows.length >= 2 && boardRows[0].implied_value_usd === boardRows[boardRows.length - 1].implied_value_usd) {
    return `all ${boardRows.length} rows share the same implied value $${boardRows[0].implied_value_usd.toLocaleString()}`;
  }
  return null;
}

// --- independent numerics (written here; never imported from lib/) ---
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function solveV(A, b) {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c][c];
    if (d === 0) throw new Error('singular matrix');
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / d;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / M[i][i]);
}
function olsV(X, y) {
  const k = X[0].length;
  const XtX = Array.from({ length: k }, () => new Array(k).fill(0));
  const Xty = new Array(k).fill(0);
  for (let i = 0; i < X.length; i++) {
    for (let a = 0; a < k; a++) {
      Xty[a] += X[i][a] * y[i];
      for (let b = 0; b < k; b++) XtX[a][b] += X[i][a] * X[i][b];
    }
  }
  return solveV(XtX, Xty);
}
// Bootstrap OLS: drop an all-zero dummy column (unidentified in that
// resample) and return effect 0 for it — the honest rule, not the NaN
// artifact of the spec-time script (see BUILD.md radar-3, deviation 4).
function olsBootstrapV(X, y) {
  const k = X[0].length;
  const keep = [];
  for (let a = 0; a < k; a++) {
    let nz = false;
    for (let i = 0; i < X.length; i++) if (X[i][a] !== 0) { nz = true; break; }
    if (nz) keep.push(a);
  }
  const br = olsV(X.map((r) => keep.map((a) => r[a])), y);
  const out = new Array(k).fill(0);
  keep.forEach((a, i) => { out[a] = br[i]; });
  return out;
}
const dotV = (r, b) => r.reduce((s, v, i) => s + v * b[i], 0);
// Ridge (radar-7 T1): (X'X + diag(pen))^-1 X'y, dropping all-zero columns
// (effect 0) like olsBootstrapV. Independent copy of lib/ols.ts ridge().
function ridgeV(X, y, pen) {
  const k = X[0].length;
  const keep = [];
  for (let a = 0; a < k; a++) {
    let nz = false;
    for (let i = 0; i < X.length; i++) if (X[i][a] !== 0) { nz = true; break; }
    if (nz) keep.push(a);
  }
  const Xr = X.map((r) => keep.map((a) => r[a]));
  const kk = keep.length;
  const XtX = Array.from({ length: kk }, () => new Array(kk).fill(0));
  const Xty = new Array(kk).fill(0);
  for (let i = 0; i < Xr.length; i++) {
    for (let a = 0; a < kk; a++) {
      Xty[a] += Xr[i][a] * y[i];
      for (let b = 0; b < kk; b++) XtX[a][b] += Xr[i][a] * Xr[i][b];
    }
  }
  for (let a = 0; a < kk; a++) XtX[a][a] += pen[keep[a]];
  const br = solveV(XtX, Xty);
  const out = new Array(k).fill(0);
  keep.forEach((a, i) => { out[a] = br[i]; });
  return out;
}
// Category family (radar-7 T1): category words only, never a name —
// independent copy of lib/model.ts familyOf, returning the family id.
function familyOfV(category) {
  const c = (category ?? '').toLowerCase();
  const has = (...words) => words.some((w) => c.includes(w));
  if (has('lend', 'cdp', 'collateral')) return 'lending';
  if (has('dex', 'liquidity manager', 'amm')) return 'dexs';
  if (has('yield', 'leveraged farm', 'farm')) return 'yield';
  if (has('curator', 'allocator')) return 'risk-curators';
  if (has('rwa')) return 'rwa';
  if (has('bridge', 'cross chain')) return 'bridge';
  if (has('staking', 'restak')) return 'staking';
  if (has('derivative', 'basis', 'perpetual', 'options', 'futures')) return 'derivatives';
  if (has('stable')) return 'stablecoin';
  if (has('insurance')) return 'insurance';
  if (has('payment')) return 'payments';
  if (has('prediction')) return 'prediction-market';
  if (has('cedefi')) return 'cedefi';
  if (has('anchor btc')) return 'anchor-btc';
  if (has('decentralized btc')) return 'decentralized-btc';
  if (has('otc')) return 'otc';
  if (has('card')) return 'crypto-card';
  if (has('chain', 'governance')) return 'chain-governance';
  return 'fallback';
}
function irlsV(X, y) {
  let w = new Array(X[0].length).fill(0);
  let iters = 0;
  for (let it = 0; it < 100; it++) {
    iters = it + 1;
    const W = [];
    const z = [];
    for (let i = 0; i < X.length; i++) {
      const eta = dotV(X[i], w);
      const mu = 1 / (1 + Math.exp(-clamp(eta, -30, 30)));
      const v = Math.max(mu * (1 - mu), 1e-9);
      W.push(v);
      z.push(eta + (y[i] - mu) / v);
    }
    const k = X[0].length;
    const XtWX = Array.from({ length: k }, () => new Array(k).fill(0));
    const XtWz = new Array(k).fill(0);
    for (let i = 0; i < X.length; i++) {
      for (let a = 0; a < k; a++) {
        XtWz[a] += W[i] * X[i][a] * z[i];
        for (let b = 0; b < k; b++) XtWX[a][b] += W[i] * X[i][a] * X[i][b];
      }
    }
    const nw = solveV(XtWX, XtWz);
    const delta = Math.max(...nw.map((v, i) => Math.abs(v - w[i])));
    w = nw;
    if (delta < 1e-10) break;
  }
  return { beta: w, iters };
}

/** Independent radar-2 recompute from one snapshot row (spec D1r, written here). */
function impliedIndependent(p, asOf) {
  const age = p.listed_at === null ? null
    : Math.max(0, Math.floor((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${p.listed_at}T00:00:00Z`)) / DAY_MS));
  const base = SPEC.multiples[p.category] ?? SPEC.fallback;
  const size = clamp((SPEC.sizeRef / p.tvl_usd) ** SPEC.sizeExp, SPEC.sizeLo, SPEC.sizeHi);
  const growthPct = clamp(p.change_7d ?? 0, SPEC.growthLo, SPEC.growthHi);
  const growth = 1 + (SPEC.growthWeight * growthPct) / 100;
  const ageForModel = age ?? SPEC.unknownAge;
  const maturity = SPEC.maturityFloor + (Math.min(Math.max(ageForModel, 0), SPEC.maturityDays) / SPEC.maturityDays) * SPEC.maturityRange;
  return { implied: Math.max(1, Math.round(p.tvl_usd * base * size * growth * maturity)), base, size, growthPct, growth, maturity, age };
}

// --- independent radar-3 model (spec D8/D9/D11, written here) ---
function ageDaysV(asOf, listedAt) {
  if (listedAt === null) return null;
  return Math.max(0, Math.floor((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${listedAt}T00:00:00Z`)) / DAY_MS));
}
function growthMaturityV(p, asOf) {
  const age = ageDaysV(asOf, p.listed_at);
  const growthPct = clamp(p.change_7d ?? 0, SPEC.growthLo, SPEC.growthHi);
  const growthMult = 1 + (SPEC.growthWeight * growthPct) / 100;
  const ageForModel = age ?? SPEC.unknownAge;
  const maturityMult = SPEC.maturityFloor
    + (Math.min(Math.max(ageForModel, 0), SPEC.maturityDays) / SPEC.maturityDays) * SPEC.maturityRange;
  return { growthPct, growthMult, maturityMult, age };
}
function fittedImpliedV(p, asOf) {
  const effect = p.category !== null ? (FIT.effects[p.category] ?? 0) : 0;
  const raw = Math.exp(FIT.intercept + (FIT.slope - 1) * Math.log(p.tvl_usd) + effect);
  const multiple = clamp(raw, FIT.floor, FIT.cap);
  const gm = growthMaturityV(p, asOf);
  return {
    implied: Math.max(1, Math.round(p.tvl_usd * multiple * gm.growthMult * gm.maturityMult)),
    raw, multiple, effect, atClampBound: raw < FIT.floor || raw > FIT.cap, ...gm,
  };
}
function liveDesignV(snapshot) {
  const live = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const catN = {};
  for (const p of live) catN[p.category ?? ''] = (catN[p.category ?? ''] ?? 0) + 1;
  const big = Object.entries(catN).filter(([, n]) => n >= 5).map(([c]) => c).sort();
  // Radar-7 shipped design: intercept + ln(TVL) only. `big` is still
  // returned for the horse race and the additive category design.
  const design = (p) => [1, Math.log(p.tvl_usd)];
  return { live, big, X: live.map(design), y: live.map((p) => Math.log(p.mcap_usd)) };
}
function splitIndicesV(n) {
  const rng = mulberry32(SPLIT_SEED);
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return { test: idx.slice(0, 38), train: idx.slice(38) };
}
function peerStatsV(snapshot) {
  const catTot = {};
  const catLive = {};
  for (const p of snapshot.protocols) {
    const c = p.category ?? '';
    catTot[c] = (catTot[c] ?? 0) + 1;
    if (p.symbol !== null) catLive[c] = (catLive[c] ?? 0) + 1;
  }
  return { catTot, catLive, liveShare: LIVE_SHARE_EXACT };
}
function oddsQuotedV(p, asOf, peers) {
  const age = ageDaysV(asOf, p.listed_at) ?? SPEC.unknownAge;
  const growthTerm = clamp(p.change_7d ?? 0, SPEC.growthLo, SPEC.growthHi) / 100;
  const c = p.category ?? '';
  const peerShrunk = ((peers.catLive[c] ?? 0) + ODDS_PRIOR * peers.liveShare)
    / ((peers.catTot[c] ?? 0) + ODDS_PRIOR);
  const peerLogit = Math.log(peerShrunk / (1 - peerShrunk));
  const logit = ODDS_Q[0] + ODDS_Q[1] * Math.log(age) + ODDS_Q[2] * growthTerm + ODDS_Q[3] * peerLogit;
  return { odds: 1 / (1 + Math.exp(-logit)), peerShrunk, peerLogit };
}
function farmNettingV(p, asOf, expectedValueUsd) {
  const age = ageDaysV(asOf, p.listed_at);
  const capitalTier = p.tvl_usd >= 1_000_000_000 ? 250 : p.tvl_usd >= 100_000_000 ? 150 : p.tvl_usd >= 50_000_000 ? 100 : 50;
  const holdDays = age === null ? 30 : age < 180 ? 60 : age < 365 ? 45 : 30;
  const weeks = Math.ceil(holdDays / 7);
  const gasCore = capitalTier >= 150 ? 8 : 4;
  const gasTotal = 3 + 2 * gasCore + 2 * weeks;
  const hoursActive = (60 + 10 * weeks) / 60;
  // Radar-7 T4: opportunity cost = T-bill on locked capital + $25/h labour.
  const laborCost = round2(25 * hoursActive);
  const opportunity = round2((capitalTier * 0.05 * holdDays) / 365 + laborCost);
  const totalCost = round2(gasTotal + opportunity);
  const breakEvenShare = totalCost / expectedValueUsd;
  const verdict = breakEvenShare <= 0.00001 ? 'FARM' : breakEvenShare <= 0.0001 ? 'THIN' : 'SKIP';
  const net1bp = round2(expectedValueUsd * 0.0001 - totalCost);
  const dollarsPerHour = round2(net1bp / hoursActive);
  return { capitalTier, holdDays, weeks, gasTotal, opportunity, totalCost, breakEvenShare, hoursActive, net1bp, dollarsPerHour, verdict };
}
const isPreTokenV = (p) => p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
function isBoardEligibleV(p) {
  return isPreTokenV(p) && p.category !== null && !EXCLUDED_CATEGORIES.has(p.category)
    && !VERSIONED.test(p.name)
    && !p.name.toLowerCase().split(/[^a-z]+/).some((w) => w === 'wrapped' || w === 'staked' || w === 'staking')
    && !EXCHANGE_NAMES.some((e) => {
      const l = p.name.toLowerCase();
      return l === e.toLowerCase() || l.startsWith(`${e.toLowerCase()} `) || l.startsWith(`${e.toLowerCase()}.`);
    });
}

/** PNG/JPEG dimensions from the file header (no decoder). */
function imageDims(buf, name) {
  if (PNG_MAGIC.every((b, i) => buf[i] === b)) {
    if (buf.length < 33 || buf.readUInt32BE(12) !== 0x49484452) throw new Error(`${name}: PNG without IHDR`);
    return { type: 'PNG', w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  if (JPEG_MAGIC.every((b, i) => buf[i] === b)) {
    let off = 2;
    while (off + 9 < buf.length) {
      if (buf[off] !== 0xff) throw new Error(`${name}: bad JPEG marker`);
      const marker = buf[off + 1];
      const len = buf.readUInt16BE(off + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { type: 'JPEG', w: buf.readUInt16BE(off + 7), h: buf.readUInt16BE(off + 5) };
      }
      off += 2 + len;
    }
    throw new Error(`${name}: JPEG with no SOF marker`);
  }
  throw new Error(`${name}: neither PNG nor JPEG magic`);
}

/** Walk a directory tree (sorted, regular files only) as {rel: size}. */
function walkFiles(dir, base = dir) {
  const out = {};
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const p = join(dir, e.name);
    const rel = p.slice(base.length + 1);
    if (e.isDirectory()) Object.assign(out, walkFiles(p, base));
    else if (e.isFile()) out[rel] = statSync(p).size;
    else out[rel] = -1; // not a regular file: flagged by callers
  }
  return out;
}

console.log('token-radar verify: entry ' + ROOT);
console.log('token-radar verify: snapshot ' + SNAPSHOT);
if (!existsSync(MAIN)) { console.error('FAIL setup — main.ts missing at ' + MAIN); process.exit(2); }
if (!existsSync(SNAPSHOT)) { console.error('FAIL setup — snapshot missing at ' + SNAPSHOT); process.exit(2); }
const snapshot = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
const snapBySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
const watchlist = snapshot.watchlist;

const scratch = mkdtempSync(join(tmpdir(), 'radar-verify-'));
const outA = join(scratch, 'runA');
const outB = join(scratch, 'runB');
const timed = join(scratch, 'runTimed');

function runEntry(outDir) {
  const start = Date.now();
  const r = spawnSync('node', [MAIN, '--input', SNAPSHOT], {
    env: { ...process.env, MAKEFUN_OUTPUT_DIR: outDir },
    encoding: 'utf8',
  });
  const ms = Date.now() - start;
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', ms };
}

/** A timed run that also samples the child's peak RSS (VmHWM) from /proc. */
async function runTimed(outDir) {
  const start = Date.now();
  const child = spawn('node', [MAIN, '--input', SNAPSHOT], {
    env: { ...process.env, MAKEFUN_OUTPUT_DIR: outDir },
    stdio: 'pipe',
  });
  let peakKb = 0;
  const sample = () => {
    try {
      const st = readFileSync(`/proc/${child.pid}/status`, 'utf8');
      const m = st.match(/VmHWM:\s*(\d+)\s*kB/);
      if (m) peakKb = Math.max(peakKb, Number(m[1]));
    } catch { /* child already gone */ }
  };
  const timer = setInterval(sample, 5);
  const code = await new Promise((res) => child.on('close', res));
  clearInterval(timer);
  sample();
  return { status: code, ms: Date.now() - start, peakKb };
}

// ---------------------------------------------------------------- V1 + V14
const runA = runEntry(outA);
const runB = runEntry(outB);
if (runA.status !== 0 || runB.status !== 0) {
  fail('V1 double-run determinism', `exit ${runA.status}/${runB.status}; stderr: ${(runA.stderr || runB.stderr).trim().split('\n').slice(-2).join(' | ')}`);
} else {
  const d = spawnSync('diff', ['-r', outA, outB], { encoding: 'utf8' });
  if (d.status === 0) ok('V1 double-run determinism', `two fresh runs exit 0 (${runA.ms} ms, ${runB.ms} ms); diff -r clean — byte-identical trees`);
  else fail('V1 double-run determinism', `diff -r exit ${d.status}: ${(d.stdout || '').split('\n').slice(0, 5).join(' | ')}`);
}
const runT = await runTimed(timed);
if (runT.status !== 0) {
  fail('V14 runtime budget', `timed run exit ${runT.status}`);
} else {
  const rssMb = (runT.peakKb / 1024).toFixed(1) + ' MB';
  const pass = runT.ms < 120_000 && runT.peakKb < 1024 * 1024;
  record('V14 runtime budget', pass, `timed run ${runT.ms} ms wall, peak RSS ${rssMb} (VmHWM ${runT.peakKb} KiB, sampled every 5 ms) — budget 120 s / 1024 MB`);
}

const OUT = outA; // the verified tree (byte-identical to runB per V1)
const boardPath = join(OUT, 'board.json');
const dataPath = join(OUT, 'data.js');
const dossierPath = join(OUT, 'dossier.json');
const dashDir = join(OUT, 'dashboard');
const shotsDir = join(OUT, 'screenshots');
const board = JSON.parse(readFileSync(boardPath, 'utf8'));
const rows = board.rows;
const boardBytes = statSync(boardPath).size;
let DATA = null; // parsed data.js payload (set by V10)

// ---------------------------------------------------------------- V2
{
  const files = walkFiles(dashDir);
  const names = Object.keys(files);
  const total = names.reduce((n, f) => n + files[f], 0);
  const badName = names.filter((f) => !PLAIN_NAME.test(f.split('/').pop()));
  const nonFile = names.filter((f) => files[f] === -1);
  const hasHtml = names.includes('index.html');
  const css = names.filter((f) => f.endsWith('.css'));
  const js = names.filter((f) => f.endsWith('.js'));
  // Network-address scan: any http(s):// inside an HTML attribute value, a
  // CSS url()/import, or a JS import/export/require/dynamic-import specifier.
  // (Visible text and comments may carry URLs per the gate; the entry avoids
  // them entirely, so any hit is reported here as a failure.)
  const hits = [];
  for (const f of names) {
    const text = readFileSync(join(dashDir, f), 'utf8');
    if (f.endsWith('.html')) {
      for (const m of text.matchAll(/(?:href|src|action)\s*=\s*["'][^"']*https?:\/\/[^"']*["']/gi)) hits.push(`${f}: ${m[0].slice(0, 80)}`);
    }
    if (f.endsWith('.css')) {
      for (const m of text.matchAll(/(?:@import|url\()\s*["']?https?:\/\/[^"')]+/gi)) hits.push(`${f}: ${m[0].slice(0, 80)}`);
    }
    if (f.endsWith('.js')) {
      for (const m of text.matchAll(/(?:import|export|require|from)\s*\(?\s*["']https?:\/\/[^"']+["']/gi)) hits.push(`${f}: ${m[0].slice(0, 80)}`);
      for (const m of text.matchAll(/import\(\s*["']https?:\/\/[^"']+["']\)/gi)) hits.push(`${f}: ${m[0].slice(0, 80)}`);
    }
  }
  const pass = hasHtml && css.length >= 1 && js.length >= 1 && names.length <= 400 && total <= 4_194_304
    && badName.length === 0 && nonFile.length === 0 && hits.length === 0;
  record('V2 dashboard_files', pass,
    `${names.length} files (${names.join(', ')}), ${total} B total (cap 400 files / 4 MiB); index.html ${hasHtml ? 'present' : 'MISSING'}, css ${css.length}, js ${js.length}; bad names: ${badName.join(', ') || 'none'}; non-files: ${nonFile.join(', ') || 'none'}; network-address hits: ${hits.join(' | ') || 'none'}`);
}

// ---------------------------------------------------------------- V3
{
  const problems = [];
  if (!Array.isArray(rows)) problems.push('board.json rows is not an array');
  if (rows.length < 100 || rows.length > 4000) problems.push(`${rows.length} rows outside 100–4000`);
  if (boardBytes > 8 * 1024 * 1024) problems.push(`board.json ${boardBytes} B over 8 MiB`);
  const seen = new Set();
  const NEW_FIELDS = ['odds', 'expected_value_usd', 'value_if_launches_usd', 'peer_shrunk', 'peer_logit', 'p10_usd', 'p90_usd',
    'rank_lo', 'rank_hi', 'capital_tier', 'hold_days', 'gas_total_usd', 'opportunity_cost_usd',
    'farm_cost_usd', 'break_even_share', 'hours_active', 'net_1bp_usd', 'dollars_per_hour'];
  for (const r of rows) {
    if (!snapBySlug.has(r.slug)) problems.push(`${r.slug}: slug not in snapshot`);
    if (seen.has(r.slug)) problems.push(`${r.slug}: duplicate slug`);
    seen.add(r.slug);
    if (typeof r.name !== 'string' || r.name.trim() === '') problems.push(`${r.slug}: empty name`);
    if (!Number.isSafeInteger(r.rank) || r.rank <= 0) problems.push(`${r.slug}: rank ${r.rank}`);
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) problems.push(`${r.slug}: implied ${r.implied_value_usd}`);
    if (!Array.isArray(r.farm_steps)) problems.push(`${r.slug}: farm_steps missing`);
    // radar-3 fitted breakdown (D8); the D1r multiple may appear ONLY as
    // the labelled d1r_multiple — never as base_multiple.
    if (!r.model || typeof r.model.fitted_multiple !== 'number' || typeof r.model.fitted_multiple_raw !== 'number'
      || typeof r.model.d1r_multiple !== 'number' || typeof r.model.growth_multiplier !== 'number'
      || typeof r.model.maturity_multiplier !== 'number' || r.model.intercept !== FIT.intercept
      || r.model.slope !== FIT.slope) problems.push(`${r.slug}: fitted model breakdown missing or constants wrong`);
    if (r.model && r.model.base_multiple !== undefined) problems.push(`${r.slug}: D1r base_multiple leaked into the fitted breakdown`);
    for (const f of NEW_FIELDS) if (typeof r[f] !== 'number') problems.push(`${r.slug}: radar-3 field ${f} missing`);
    if (!Array.isArray(r.comps) || r.comps.length !== 3) problems.push(`${r.slug}: comps not exactly 3`);
    if (typeof r.comps_same_category !== 'number' || r.comps_same_category < 0 || r.comps_same_category > 3) problems.push(`${r.slug}: comps_same_category ${r.comps_same_category}`);
    if (!(r.stable_refits === null || (typeof r.stable_refits === 'number' && r.stable_refits >= 0 && r.stable_refits <= 200))) problems.push(`${r.slug}: stable_refits ${r.stable_refits}`);
    if (typeof r.verdict !== 'string' || !['FARM', 'THIN', 'SKIP'].includes(r.verdict)) problems.push(`${r.slug}: verdict ${r.verdict}`);
    if (typeof r.odds === 'number' && !(r.odds > 0 && r.odds < 1)) problems.push(`${r.slug}: odds ${r.odds} outside (0,1)`);
    // Radar-6: implied = round(fitted x odds); P10–P90 are fitted-value
    // intervals, so they bound value_if_launches_usd, never implied.
    if (typeof r.value_if_launches_usd === 'number' && typeof r.odds === 'number'
      && Math.round(r.value_if_launches_usd * r.odds) !== r.implied_value_usd) problems.push(`${r.slug}: implied $${r.implied_value_usd.toLocaleString()} != round(fitted $${r.value_if_launches_usd.toLocaleString()} x odds ${r.odds})`);
    if (typeof r.p10_usd === 'number' && typeof r.p90_usd === 'number'
      && !(r.p10_usd <= r.value_if_launches_usd && r.value_if_launches_usd <= r.p90_usd)) problems.push(`${r.slug}: P10/fitted/P90 order broken`);
    if (typeof r.rank_lo === 'number' && typeof r.rank_hi === 'number'
      && !(r.rank_lo <= r.rank && r.rank <= r.rank_hi)) problems.push(`${r.slug}: rank outside its rank range`);
  }
  record('V3 board_file', problems.length === 0,
    `${rows.length} rows (expect 198), board.json ${boardBytes} B (cap 8 MiB), sha256 ${sha256(readFileSync(boardPath)).slice(0, 16)}…; problems: ${problems.slice(0, 5).join(' | ') || 'none'}`);
}

// ---------------------------------------------------------------- V4
{
  const issue = sortedByValueGate(rows);
  const distinct = new Set(rows.map((r) => r.implied_value_usd)).size;
  record('V4 sorted_by_value', issue === null && distinct > 1,
    `ranks exactly 1..${rows.length} once each, implied value non-increasing (radar-7 ranking key): ${issue === null ? 'yes' : 'NO — ' + issue}; distinct implied values ${distinct}; top $${rows[0].implied_value_usd.toLocaleString()} (${rows[0].slug}), bottom $${rows[rows.length - 1].implied_value_usd.toLocaleString()} (${rows[rows.length - 1].slug})`);
}

// ---------------------------------------------------------------- V5
{
  const inBoard = new Set(rows.map((r) => r.slug));
  const missing = watchlist.filter((s) => !inBoard.has(s));
  const covered = watchlist.length - missing.length;
  record('V5 coverage', missing.length === 0,
    `watchlist ${covered}/${watchlist.length} on board (${((covered / watchlist.length) * 100).toFixed(0)}%); missing: ${missing.join(', ') || 'none'}`);
}

// ---------------------------------------------------------------- V6
{
  let minLen = Infinity, maxLen = 0, total = 0;
  const problems = [];
  for (const r of rows) {
    if (r.farm_steps.length !== 7) problems.push(`${r.slug}: ${r.farm_steps.length} steps, expect 7`);
    for (const s of r.farm_steps) {
      const t = s.trim();
      total++;
      minLen = Math.min(minLen, t.length);
      maxLen = Math.max(maxLen, t.length);
      if (t.length < 20 || t.length > 600) problems.push(`${r.slug}: step ${t.length} chars`);
      if (!t.includes('Cost:') || !t.includes('Time:')) problems.push(`${r.slug}: step without Cost:/Time: (${t.slice(0, 60)}…)`);
    }
  }
  record('V6 farm_steps', problems.length === 0,
    `${total} steps across ${rows.length} rows, every row exactly 7; length min ${minLen}, max ${maxLen} chars (gate 20–600); every step carries Cost: and Time:; problems: ${problems.slice(0, 5).join(' | ') || 'none'}`);
}

// ---------------------------------------------------------------- V7
{
  const names = readdirSync(shotsDir).filter((f) => !f.startsWith('.')).sort();
  const problems = [];
  const details = [];
  for (const f of names) {
    const buf = readFileSync(join(shotsDir, f));
    try {
      const d = imageDims(buf, f);
      const long = Math.max(d.w, d.h), short = Math.min(d.w, d.h);
      details.push(`${f}: ${d.type} ${d.w}x${d.h}, ${buf.length} B (${(buf.length / 1024).toFixed(0)} KiB)`);
      if (buf.length > 524_288) problems.push(`${f}: ${buf.length} B over 512 KiB`);
      if (long > 1440) problems.push(`${f}: long side ${long} over 1440`);
      if (short < 800) problems.push(`${f}: short side ${short} under 800`);
    } catch (e) { problems.push(e.message); }
  }
  if (names.length < 3 || names.length > 4) problems.push(`${names.length} screenshots, expect 3–4`);
  record('V7 screenshots', problems.length === 0,
    `${names.length} images — ${details.join('; ')}; cap 512 KiB each, long side ≤1440, short side ≥800; problems: ${problems.join(' | ') || 'none'}`);
}

// ---------------------------------------------------------------- V8
{
  let rebuilt = null, err = null;
  try {
    const { buildDossier } = await import(VENDOR);
    rebuilt = buildDossier(OUT, {
      text_max_bytes: 65536,
      screenshots: { max: 4, max_bytes: 524288 },
      dashboard: { max_files: 400, max_bytes: 4194304 },
    });
  } catch (e) { err = e; }
  const actual = readFileSync(dossierPath);
  const identical = rebuilt !== null && Buffer.from(rebuilt).equals(actual);
  const dossier = JSON.parse(actual.toString('utf8'));
  const truncated = typeof dossier.text === 'string' && /\[Cut at/.test(dossier.text);
  record('V8 dossier_matches', identical && actual.length <= 1_572_864,
    `dossier.json ${actual.length} B (cap 1.5 MiB = 1,572,864), sha256 ${sha256(actual)}; independent rebuild ${err ? 'THREW: ' + err.message : identical ? 'byte-identical' : 'DIFFERS (rebuilt sha256 ' + sha256(Buffer.from(rebuilt)).slice(0, 16) + '…)'}; text truncated by cap: ${truncated ? 'YES — see report' : 'no'}`);
}

// ---------------------------------------------------------------- V9
{
  const files = walkFiles(dashDir);
  const total = Object.values(files).reduce((n, s) => n + (s > 0 ? s : 0), 0);
  const parts = Object.entries(files).map(([f, s]) => `${f} ${s} B`).join(', ');
  record('V9 dashboard source size', total <= 65_000,
    `${total} B total (${parts}); target ≤65,000 B, hard cap 65,536 B — ${total <= 65_000 ? 'within target' : total <= 65536 ? 'OVER TARGET but within hard cap' : 'OVER HARD CAP'}`);
}

// ---------------------------------------------------------------- V10
{
  const js = readFileSync(dataPath, 'utf8');
  const m = js.match(/^window\.RADAR=(\{.*\});\n$/s);
  let detail = '';
  let pass = false;
  if (!m) detail = 'data.js does not match /^window.RADAR={...};\\n$/';
  else {
    const d = JSON.parse(m[1]);
    DATA = d;
    const mism = [];
    if (d.rows.length !== rows.length) mism.push(`row count data.js ${d.rows.length} vs board ${rows.length}`);
    d.rows.forEach((r, i) => {
      if (rows[i] && (r.slug !== rows[i].slug || r.rank !== rows[i].rank || r.implied_value_usd !== rows[i].implied_value_usd)) mism.push(`row ${i + 1}: ${r.slug}/${r.implied_value_usd} vs ${rows[i].slug}/${rows[i].implied_value_usd}`);
    });
    if (d.model_version !== 'radar-7') mism.push(`model_version ${d.model_version}, expect radar-7`);
    for (const k of ['fit', 'odds', 'ledger', 'assumptions', 'verdict_counts', 'median_odds', 'max_ev']) {
      if (d[k] === undefined) mism.push(`data.js missing ${k}`);
    }
    if (!Array.isArray(d.integrity) || d.integrity.length !== 5 || !d.integrity.every((c) => c.pass === true)) {
      mism.push(`integrity strip not 5/5 PASS (${JSON.stringify(d.integrity)})`);
    }
    pass = mism.length === 0;
    detail = `data.js ${statSync(dataPath).size} B, ${d.rows.length} rows, live ${d.live.length} rows; mismatches: ${mism.slice(0, 5).join(' | ') || 'none'}`;
  }
  record('V10 data.js / board agreement', pass, detail);
}

// ---------------------------------------------------------------- V11
{
  const liveInBoard = rows.filter((r) => r.mcap_usd !== null || r.gecko_id !== null || r.symbol !== null);
  const liveSlugs = new Set(DATA.live.map((r) => r.slug));
  const boardSlugs = new Set(rows.map((r) => r.slug));
  const overlap = [...liveSlugs].filter((s) => boardSlugs.has(s));
  const liveNoMcap = DATA.live.filter((r) => !(typeof r.mcap_usd === 'number' && r.mcap_usd > 0));
  const liveSorted = DATA.live.every((r, i) => i === 0 || r.mcap_usd <= DATA.live[i - 1].mcap_usd);
  const top24 = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0)
    .sort((a, b) => b.mcap_usd - a.mcap_usd || (a.slug < b.slug ? -1 : 1)).slice(0, 24).map((p) => p.slug);
  const liveIsTop24 = JSON.stringify(DATA.live.map((r) => r.slug)) === JSON.stringify(top24);
  record('V11 live separation', liveInBoard.length === 0 && overlap.length === 0 && liveNoMcap.length === 0 && DATA.live.length === 24 && liveIsTop24,
    `board rows carrying a token marker: ${liveInBoard.length}; live slugs also on board: ${overlap.join(', ') || 'none'}; live rows ${DATA.live.length} (expect 24), all positive mcap: ${liveNoMcap.length === 0 ? 'yes' : 'NO — ' + liveNoMcap.map((r) => r.slug).join(', ')}; live sorted by mcap desc: ${liveSorted ? 'yes' : 'no'}; live set is exactly the top 24 by mcap: ${liveIsTop24 ? 'yes' : 'NO'}; live categories include CEX: ${DATA.live.filter((r) => r.category === 'CEX').map((r) => r.slug).join(', ') || 'none'}`);
}

// ---------------------------------------------------------------- V12′ (radar-3 fitted spot-check)
{
  const peers = peerStatsV(snapshot);
  const mid = Math.floor(rows.length / 2); // rank 99 of 198
  const picks = [rows[0], rows[mid - 1], rows[rows.length - 1]];
  const problems = [];
  const details = [];
  for (const r of picks) {
    const p = snapBySlug.get(r.slug);
    const v = fittedImpliedV(p, snapshot.as_of);
    const o = oddsQuotedV(p, snapshot.as_of, peers);
    const ev = Math.round(v.implied * o.odds);
    const impOk = v.implied === r.value_if_launches_usd;
    const oddsOk = Math.abs(o.odds - r.odds) < 1e-9;
    const evOk = ev === r.implied_value_usd && ev === r.expected_value_usd;
    if (!impOk || !oddsOk || !evOk) {
      problems.push(`rank ${r.rank} ${r.slug}: fitted $${v.implied.toLocaleString()} (board value-if-launches $${r.value_if_launches_usd.toLocaleString()}) odds ${o.odds.toFixed(6)} (board ${r.odds.toFixed(6)}) implied $${ev.toLocaleString()} (board $${r.implied_value_usd.toLocaleString()})`);
    }
    details.push(`rank ${r.rank} ${r.slug}: fitted $${v.implied.toLocaleString()} (raw mult ${v.raw.toFixed(4)}→${v.multiple.toFixed(4)}, growth ${v.growthMult.toFixed(4)}, maturity ${v.maturityMult.toFixed(4)}) odds ${o.odds.toFixed(6)} EV $${ev.toLocaleString()} — ${impOk && oddsOk && evOk ? 'match' : 'MISMATCH'}`);
  }
  // Note (not a failure): the spec prose prints rank-198 mezzanine
  // $1,492,134, computed with full-precision betas; the quoted 6-dp
  // constants the entry ships give $1,492,142 (+$8). Same cause as the
  // worked-example $123 gap — see BUILD.md deviation 7.
  record('V12 fitted spot-check', problems.length === 0, details.join(' || '));
}

// ---------------------------------------------------------------- V13
const V13_PY = `
import json, sys
from pathlib import Path
from playwright.sync_api import sync_playwright
out = Path(sys.argv[1]); rank1_slug, rank1_name, board_n, filt_cat, filt_n = sys.argv[2], sys.argv[3], int(sys.argv[4]), sys.argv[5], int(sys.argv[6])
res = {}
try:
    from PIL import Image, ImageStat
    pix = {}
    for f in sorted((out / 'screenshots').glob('*.png')):
        im = Image.open(f).convert('L')
        st = ImageStat.Stat(im)
        levels = sum(1 for v in im.histogram() if v)
        pix[f.name] = {'mean': round(st.mean[0], 1), 'stdev': round(st.stddev[0], 1), 'levels': levels}
    res['pixels'] = pix
except Exception as e:
    res['pixels_error'] = str(e)
with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page(viewport={'width': 1440, 'height': 900})
    pg.goto((out / 'dashboard' / 'index.html').as_uri())
    pg.wait_for_selector('#rows tr')
    res['board'] = {'rows': pg.locator('#rows tr').count(), 'count_text': pg.locator('#count').inner_text()}
    pg.goto((out / 'dashboard' / 'index.html').as_uri() + '#p=' + rank1_slug)
    pg.wait_for_selector('#detail[open]')
    dlg = pg.locator('#detail').inner_text()
    res['detail'] = {'open': pg.evaluate("document.querySelector('#detail').open"), 'has_rank1_name': rank1_name in dlg, 'has_cost': 'Cost:' in dlg, 'has_time': 'Time:' in dlg, 'has_farm_plan': 'Farm plan' in dlg or 'farm' in dlg.lower()}
    pg.goto((out / 'dashboard' / 'index.html').as_uri() + '#category=' + filt_cat.replace(' ', '%20'))
    pg.wait_for_selector('#rows tr')
    pg.wait_for_function("document.querySelector('#count').textContent.length > 0")
    cats = pg.locator('#rows tr td:nth-child(3)').all_inner_texts()
    res['filtered'] = {'rows': pg.locator('#rows tr').count(), 'count_text': pg.locator('#count').inner_text(), 'select_value': pg.locator('#category').input_value(), 'all_category': all(c.strip() == filt_cat for c in cats), 'first_rows': cats[:3]}
    b.close()
print(json.dumps(res))
`;
{
  const rank1 = rows[0];
  const filtCat = 'Risk Curators';
  const filtN = rows.filter((r) => r.category === filtCat).length;
  const pyFile = join(scratch, 'v13.py');
  writeFileSync(pyFile, V13_PY);
  const r = spawnSync('python3', [pyFile, OUT, rank1.slug, rank1.name, String(rows.length), filtCat, String(filtN)], { encoding: 'utf8', timeout: 120_000 });
  if (r.status !== 0) {
    fail('V13 screenshot content', `playwright script exit ${r.status}: ${(r.stderr || '').trim().split('\n').slice(-3).join(' | ') || r.stdout}`);
  } else {
    let v13;
    try { v13 = JSON.parse(r.stdout.trim().split('\n').pop()); } catch { v13 = null; }
    if (!v13) fail('V13 screenshot content', 'playwright output was not JSON: ' + r.stdout.slice(0, 200));
    else {
      const pix = v13.pixels || {};
      const pixDetail = Object.entries(pix).map(([f, s]) => `${f} grey mean ${s.mean}/stdev ${s.stdev}/${s.levels} levels`).join('; ') || ('pixels: ' + (v13.pixels_error || 'n/a'));
      const nonBlank = Object.values(pix).every((s) => s.stdev > 5 && s.levels > 50);
      const pass = v13.board.rows === rows.length && v13.board.count_text.includes(String(rows.length))
        && v13.detail.open && v13.detail.has_rank1_name && v13.detail.has_cost && v13.detail.has_time
        && v13.filtered.rows === filtN && v13.filtered.select_value === filtCat && v13.filtered.all_category && nonBlank;
      record('V13 screenshot content', pass,
        `board view: ${v13.board.rows} DOM rows, count "${v13.board.count_text}" (expect ${rows.length}); detail #p=${rank1.slug}: dialog open=${v13.detail.open}, name=${v13.detail.has_rank1_name}, Cost=${v13.detail.has_cost}, Time=${v13.detail.has_time}; filtered #category=${filtCat}: ${v13.filtered.rows} DOM rows (expect ${filtN}), count "${v13.filtered.count_text}", select="${v13.filtered.select_value}", all rows ${filtCat}=${v13.filtered.all_category}; ${pixDetail}`);
    }
  }
}

// ---------------------------------------------------------------- V15 (independent OLS)
{
  const { live, big, X, y } = liveDesignV(snapshot);
  const n = live.length;
  const k = X[0].length;
  const beta = olsV(X, y);
  const pred = X.map((r) => dotV(r, beta));
  const resid = y.map((v, i) => v - pred[i]);
  const yMean = y.reduce((a, b) => a + b, 0) / n;
  const ssTot = y.reduce((s, v) => s + (v - yMean) ** 2, 0);
  const ssRes = resid.reduce((s, v) => s + v * v, 0);
  const r2 = 1 - ssRes / ssTot;
  const residSd = Math.sqrt(ssRes / (n - k));
  const problems = [];
  if (beta[0].toFixed(6) !== DATA.fit.intercept.toFixed(6)) problems.push(`intercept ${beta[0].toFixed(6)} vs payload ${DATA.fit.intercept.toFixed(6)}`);
  if (beta[1].toFixed(6) !== DATA.fit.slope.toFixed(6)) problems.push(`slope ${beta[1].toFixed(6)} vs payload ${DATA.fit.slope.toFixed(6)}`);
  // Radar-7: no category effects survive the additive test (FIT.effects is
  // empty); the horse race's fixed-slope variants still use `big`.
  if (Object.keys(DATA.fit.effects).length !== 0) problems.push(`effects not empty: ${JSON.stringify(DATA.fit.effects)}`);
  if (Math.abs(r2 - DATA.fit.r2) > 0.0005) problems.push(`R² ${r2.toFixed(4)} vs payload ${DATA.fit.r2.toFixed(4)}`);
  if (Math.abs(residSd - DATA.fit.resid_sd) > 0.005) problems.push(`resid SD ${residSd.toFixed(4)} vs payload ${DATA.fit.resid_sd.toFixed(4)}`);
  record('V15 independent OLS recompute', problems.length === 0,
    `n=${n}, k=${k} (intercept + slope only, radar-7 — no dummies; BIG categories for the horse race: ${big.join(', ')}); intercept ${beta[0].toFixed(6)}, slope ${beta[1].toFixed(6)}, R² ${r2.toFixed(4)} (±0.0005), resid SD ${residSd.toFixed(4)} (±0.005); problems: ${problems.join(' | ') || 'none'}`);
}

// ---------------------------------------------------------------- V16 (independent IRLS + implied ranking + Brier; D8 gate retired radar-5)
{
  const peers = peerStatsV(snapshot);
  const X = snapshot.protocols.map((p) => {
    const age = ageDaysV(snapshot.as_of, p.listed_at) ?? SPEC.unknownAge;
    const growthTerm = clamp(p.change_7d ?? 0, SPEC.growthLo, SPEC.growthHi) / 100;
    const c = p.category ?? '';
    const ps = ((peers.catLive[c] ?? 0) + ODDS_PRIOR * peers.liveShare) / ((peers.catTot[c] ?? 0) + ODDS_PRIOR);
    return [1, Math.log(age), growthTerm, Math.log(ps / (1 - ps))];
  });
  const y = snapshot.protocols.map((p) => (p.symbol !== null ? 1 : 0));
  const { beta, iters } = irlsV(X, y);
  const problems = [];
  const fields = ['intercept', 'age', 'growth', 'peer'];
  beta.forEach((v, i) => {
    if (v.toFixed(6) !== Number(DATA.odds[fields[i]]).toFixed(6)) {
      problems.push(`${fields[i]} ${v.toFixed(6)} vs payload ${Number(DATA.odds[fields[i]]).toFixed(6)}`);
    }
  });
  // Implied exact on every row, from the quoted constants: implied =
  // round(fitted x odds), fitted read from value_if_launches_usd.
  let evBad = 0;
  let evFirst = '';
  for (const r of rows) {
    const p = snapBySlug.get(r.slug);
    const o = oddsQuotedV(p, snapshot.as_of, peers);
    const ev = Math.round(r.value_if_launches_usd * o.odds);
    if (ev !== r.implied_value_usd || ev !== r.expected_value_usd) {
      evBad++;
      if (!evFirst) evFirst = `${r.slug}: recomputed $${ev.toLocaleString()} vs board implied $${r.implied_value_usd.toLocaleString()}`;
    }
  }
  if (evBad > 0) problems.push(`implied mismatch on ${evBad} rows (first: ${evFirst})`);
  // Brier score (radar-5 odds review): mean (odds − outcome)² over all 758.
  let brierSum = 0;
  for (const p of snapshot.protocols) {
    const o = oddsQuotedV(p, snapshot.as_of, peers).odds;
    const yy = p.symbol !== null ? 1 : 0;
    brierSum += (o - yy) * (o - yy);
  }
  const brier = brierSum / snapshot.protocols.length;
  if (Math.abs(brier - DATA.odds.brier) > 1e-9) problems.push(`Brier ${brier.toFixed(6)} vs payload ${DATA.odds.brier}`);
  // Implied ranking (radar-7 T1): rank-1, top-10, total, overlap,
  // displacement, Spearman vs the fitted ranking — the D8 gate is retired,
  // these are locks against the independent local computation, not a gate.
  const evTop10 = rows.slice(0, 10).map((r) => r.slug);
  const wantTop10 = ['usdd', 'veda', 'steakhouse-financial', 'polymarket-international',
    'cian-yield-layer', 'figure-markets-prime', 'sentora-curator', 'bitfi-basis', 'b14g', 'bittensor-dtao'];
  if (JSON.stringify(evTop10) !== JSON.stringify(wantTop10)) problems.push(`implied top-10 ${evTop10.join(',')}`);
  if (rows[0].slug !== 'usdd' || rows[0].implied_value_usd !== 35364990) {
    problems.push(`rank-1 ${rows[0].slug} $${rows[0].implied_value_usd.toLocaleString()}, expect usdd $35,364,990`);
  }
  const totalEv = rows.reduce((n, r) => n + r.implied_value_usd, 0);
  if (totalEv !== 777976039) problems.push(`total implied $${totalEv.toLocaleString()}, expect $777,976,039`);
  const fitOrder = [...rows].sort((a, b) => b.value_if_launches_usd - a.value_if_launches_usd || (a.slug < b.slug ? -1 : 1));
  const fitRank = new Map(fitOrder.map((r, i) => [r.slug, i + 1]));
  const overlap = evTop10.filter((s) => fitOrder.slice(0, 10).map((r) => r.slug).includes(s)).length;
  const nonceDisp = Math.abs((fitRank.get('nonce-capital') ?? 0) - (rows.findIndex((r) => r.slug === 'nonce-capital') + 1));
  const n = rows.length;
  const d2 = rows.reduce((s, r) => s + (fitRank.get(r.slug) - r.rank) ** 2, 0);
  const spearman = 1 - (6 * d2) / (n * (n * n - 1));
  if (overlap !== 6) problems.push(`fitted-vs-implied top-10 overlap ${overlap}/10, expect 6/10`);
  if (nonceDisp !== 148) problems.push(`Nonce displacement ${nonceDisp}, expect 148`);
  if (Math.abs(spearman - 0.6560) > 0.0005) problems.push(`Spearman ${spearman.toFixed(4)}, expect 0.6560`);
  record('V16 independent odds + implied ranking + Brier', problems.length === 0,
    `IRLS ${iters} iters (exact peer share 416/758); coefs [${beta.map((v) => v.toFixed(6)).join(', ')}] vs payload; implied exact on ${rows.length - evBad}/${rows.length} rows; Brier ${brier.toFixed(4)} (base rate ${(peers.liveShare * (1 - peers.liveShare)).toFixed(4)}); implied rank-1 ${rows[0].slug} $35,364,990, total implied $777,976,039, overlap ${overlap}/10, Nonce displacement ${nonceDisp}, Spearman ${spearman.toFixed(4)} (D8 gate retired radar-5); problems: ${problems.join(' | ') || 'none'}`);
}

// ---------------------------------------------------------------- V17 (independent bootstrap spot recompute)
{
  const { live, big, X, y } = liveDesignV(snapshot);
  const peers = peerStatsV(snapshot);
  const t0 = Date.now();
  const rng = mulberry32(BOOTSTRAP_SEED);
  const bootRows = rows.map((r) => {
    const p = snapBySlug.get(r.slug);
    const gm = growthMaturityV(p, snapshot.as_of);
    return { slug: r.slug, tvl: p.tvl_usd, category: p.category, growthMult: gm.growthMult, maturityMult: gm.maturityMult, odds: r.odds };
  });
  const vals = bootRows.map(() => []);
  const ranks = bootRows.map(() => []);
  for (let b = 0; b < BOOTSTRAP_B; b++) {
    const sample = [];
    for (let i = 0; i < X.length; i++) sample.push(Math.floor(rng() * X.length));
    const beta = olsBootstrapV(sample.map((i) => X[i]), sample.map((i) => y[i]));
    const preds = bootRows.map((r) => {
      const eff = 0; // radar-7: slope-only design, no category effects
      const raw = Math.exp(beta[0] + (beta[1] - 1) * Math.log(r.tvl) + eff);
      return Math.max(1, Math.round(r.tvl * clamp(raw, FIT.floor, FIT.cap) * r.growthMult * r.maturityMult));
    });
    // Radar-5: re-rank by predicted expected value (implied × fixed odds).
    const evs = preds.map((v, i) => v * bootRows[i].odds);
    const order = evs.map((v, i) => i)
      .sort((i, j) => evs[j] - evs[i] || (bootRows[i].slug < bootRows[j].slug ? -1 : 1));
    order.forEach((ri, pos) => { vals[ri].push(preds[ri]); ranks[ri].push(pos + 1); });
  }
  const problems = [];
  const details = [];
  for (const rank of [1, 99, 198]) {
    const i = rank - 1;
    const vs = [...vals[i]].sort((a, b) => a - b);
    const p10 = vs[19];
    const p90 = vs[179];
    const lo = Math.min(...ranks[i]);
    const hi = Math.max(...ranks[i]);
    const r = rows[i];
    const match = p10 === r.p10_usd && p90 === r.p90_usd && lo === r.rank_lo && hi === r.rank_hi;
    if (!match) problems.push(`rank ${rank} ${r.slug}: recomputed P10 $${p10.toLocaleString()} P90 $${p90.toLocaleString()} [${lo},${hi}] vs board $${r.p10_usd.toLocaleString()} $${r.p90_usd.toLocaleString()} [${r.rank_lo},${r.rank_hi}]`);
    details.push(`rank ${rank} ${r.slug}: P10 $${p10.toLocaleString()} P90 $${p90.toLocaleString()} [${lo},${hi}] — ${match ? 'match' : 'MISMATCH'}`);
  }
  // Whole-board bootstrap agreement is implied by V1 (both runs byte-identical,
  // including every row's bootstrap fields) plus this independent spot recompute.
  record('V17 bootstrap spot recompute', problems.length === 0,
    `B=${BOOTSTRAP_B} seed ${BOOTSTRAP_SEED}, honest rule (drop unidentified dummy, effect 0), ${Date.now() - t0} ms; ${details.join(' || ')}; problems: ${problems.join(' | ') || 'none'}`);
}

// ---------------------------------------------------------------- V18 (netting recompute + verdict counts)
{
  const problems = [];
  const counts = { FARM: 0, THIN: 0, SKIP: 0 };
  for (const r of rows) {
    const p = snapBySlug.get(r.slug);
    const v = farmNettingV(p, snapshot.as_of, r.expected_value_usd);
    counts[v.verdict]++;
    const fieldProblems = [];
    if (v.capitalTier !== r.capital_tier) fieldProblems.push(`tier ${v.capitalTier} vs ${r.capital_tier}`);
    if (v.holdDays !== r.hold_days) fieldProblems.push(`hold ${v.holdDays} vs ${r.hold_days}`);
    if (v.gasTotal !== r.gas_total_usd) fieldProblems.push(`gas ${v.gasTotal} vs ${r.gas_total_usd}`);
    if (v.opportunity !== r.opportunity_cost_usd) fieldProblems.push(`opp ${v.opportunity} vs ${r.opportunity_cost_usd}`);
    if (v.totalCost !== r.farm_cost_usd) fieldProblems.push(`cost ${v.totalCost} vs ${r.farm_cost_usd}`);
    if (v.breakEvenShare !== r.break_even_share) fieldProblems.push(`be ${v.breakEvenShare} vs ${r.break_even_share}`);
    if (v.hoursActive !== r.hours_active) fieldProblems.push(`hours ${v.hoursActive} vs ${r.hours_active}`);
    if (v.net1bp !== r.net_1bp_usd) fieldProblems.push(`net1bp ${v.net1bp} vs ${r.net_1bp_usd}`);
    if (v.dollarsPerHour !== r.dollars_per_hour) fieldProblems.push(`$/h ${v.dollarsPerHour} vs ${r.dollars_per_hour}`);
    if (v.verdict !== r.verdict) fieldProblems.push(`verdict ${v.verdict} vs ${r.verdict}`);
    if (fieldProblems.length > 0) problems.push(`${r.slug}: ${fieldProblems.join(', ')}`);
  }
  const vc = DATA.verdict_counts;
  if (!(counts.FARM === 25 && counts.THIN === 138 && counts.SKIP === 35)) {
    problems.push(`counts FARM ${counts.FARM} / THIN ${counts.THIN} / SKIP ${counts.SKIP}, expect 25/138/35 (radar-7 T4: $25/h labour charged)`);
  }
  if (!(vc.FARM === 25 && vc.THIN === 138 && vc.SKIP === 35)) {
    problems.push(`payload verdict_counts ${JSON.stringify(vc)}, expect 25/138/35`);
  }
  record('V18 farm netting recompute', problems.length === 0,
    `all ${rows.length} rows recomputed from tier/hold/EV (gas $3 + 2×core + $2/week, opportunity 5%/yr + $25/h labour, 1 bp allocation); counts FARM ${counts.FARM} / THIN ${counts.THIN} / SKIP ${counts.SKIP}; problems: ${problems.slice(0, 3).join(' | ') || 'none'}`);
}

// ---------------------------------------------------------------- V19 (ledger recompute)
{
  const pre = snapshot.protocols.filter(isPreTokenV);
  const liveTok = snapshot.protocols.filter((p) => !isPreTokenV(p));
  const boardSlugs = new Set(rows.map((r) => r.slug));
  const excluded = pre.filter((p) => !boardSlugs.has(p.slug));
  const byCat = {};
  for (const p of excluded) byCat[p.category ?? ''] = (byCat[p.category ?? ''] ?? 0) + 1;
  const excludedByCategory = Object.entries(byCat)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const reasons = { category: 0, versioned: 0, wrapped: 0, exchange: 0, category_null: 0 };
  for (const p of excluded) {
    if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) reasons.category++;
    if (VERSIONED.test(p.name)) reasons.versioned++;
    if (p.name.toLowerCase().split(/[^a-z]+/).some((w) => w === 'wrapped' || w === 'staked' || w === 'staking')) reasons.wrapped++;
    if (EXCHANGE_NAMES.some((e) => {
      const l = p.name.toLowerCase();
      return l === e.toLowerCase() || l.startsWith(`${e.toLowerCase()} `) || l.startsWith(`${e.toLowerCase()}.`);
    })) reasons.exchange++;
    if (p.category === null) reasons.category_null++;
  }
  const L = DATA.ledger;
  const problems = [];
  const expect = {
    total: snapshot.protocols.length,
    ranked: rows.length,
    watchlist: rows.filter((r) => watchlist.includes(r.slug)).length,
    early: rows.filter((r) => !watchlist.includes(r.slug)).length,
    excluded_pre: excluded.length,
    live: liveTok.length,
    live_mcap_pos: liveTok.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0).length,
    live_mcap_zero: liveTok.filter((p) => p.mcap_usd === 0).length,
    live_mcap_neg: liveTok.filter((p) => p.mcap_usd !== null && p.mcap_usd < 0).length,
    live_mcap_null: liveTok.filter((p) => p.mcap_usd === null).length,
    live_shown: 24,
    live_not_shown: liveTok.length - 24,
  };
  for (const [k, v] of Object.entries(expect)) {
    if (L[k] !== v) problems.push(`${k} payload ${L[k]} vs recomputed ${v}`);
  }
  if (JSON.stringify(L.excluded_by_category) !== JSON.stringify(excludedByCategory)) {
    problems.push(`excluded_by_category differs: payload ${JSON.stringify(L.excluded_by_category)} vs recomputed ${JSON.stringify(excludedByCategory)}`);
  }
  for (const [k, v] of Object.entries(reasons)) {
    if (L.reasons[k] !== v) problems.push(`reason ${k} payload ${L.reasons[k]} vs recomputed ${v} (entry's 18-name exchange list)`);
  }
  record('V19 ledger recompute', problems.length === 0,
    `758 = ${expect.ranked} ranked + ${expect.excluded_pre} excluded + ${expect.live} live; reasons category ${reasons.category} / versioned ${reasons.versioned} / wrapped ${reasons.wrapped} / exchange ${reasons.exchange} (entry list, spec-time list gave 14) / category_null ${reasons.category_null}; live ${expect.live_mcap_pos}/${expect.live_mcap_zero}/${expect.live_mcap_neg}/${expect.live_mcap_null}; problems: ${problems.join(' | ') || 'none'}`);
}

// ---------------------------------------------------------------- V20 (headless DOM: KPI / integrity / sandbox / verdict filter)
const V20_PY = `
import json, sys
from pathlib import Path
from playwright.sync_api import sync_playwright
out = Path(sys.argv[1]); med_odds = sys.argv[2]
res = {}
with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page(viewport={'width': 1440, 'height': 900})
    pg.goto((out / 'dashboard' / 'index.html').as_uri())
    pg.wait_for_selector('#rows tr')
    pg.wait_for_selector('#kpiStrip div')
    kpi = {}
    for div in pg.locator('#kpiStrip div').all():
        kpi[div.locator('dt').inner_text()] = div.locator('dd').inner_text()
    res['kpi'] = kpi
    res['integrity'] = pg.locator('#integrityStrip li b').all_inner_texts()
    first_before = pg.locator('#rows tr').first.inner_text()
    top_before = pg.locator('#sandboxTop10 li').first.inner_text()
    stats_before = pg.locator('#sandboxStats').inner_text()
    pg.evaluate("var el=document.querySelector('#slopeSlider'); el.value='0.30'; el.dispatchEvent(new Event('input',{bubbles:true}));")
    top_after = pg.locator('#sandboxTop10 li').first.inner_text()
    stats_after = pg.locator('#sandboxStats').inner_text()
    first_after_slope = pg.locator('#rows tr').first.inner_text()
    pg.evaluate("var el=document.querySelector('#allocSlider'); el.value='0'; el.dispatchEvent(new Event('input',{bubbles:true}));")
    stats_alloc = pg.locator('#sandboxStats').inner_text()
    first_after_alloc = pg.locator('#rows tr').first.inner_text()
    res['sandbox'] = {'top_before': top_before, 'top_after': top_after, 'stats_before': stats_before, 'stats_after': stats_after, 'stats_alloc': stats_alloc, 'board_first_before': first_before, 'board_first_after_slope': first_after_slope, 'board_first_after_alloc': first_after_alloc}
    pg.locator('#verdict').select_option('FARM')
    pg.wait_for_function("document.querySelectorAll('#rows tr').length === 25")
    verdicts = pg.locator('#rows tr .verdict').all_inner_texts()
    res['verdict_filter'] = {'rows': pg.locator('#rows tr').count(), 'count_text': pg.locator('#count').inner_text(), 'all_farm': all(v == 'FARM' for v in verdicts), 'n_spans': len(verdicts)}
    # fix1 F-A: the FARM view must be sorted by net/hour high->low, and the
    # $/h column (12th td) must carry those values in DOM order.
    dph = [float(t.replace('$', '').replace(',', '')) for t in pg.locator('#rows tr td:nth-child(12)').all_inner_texts()]
    res['verdict_filter']['dph'] = dph
    res['verdict_filter']['dph_desc'] = all(dph[i] > dph[i+1] for i in range(len(dph) - 1))
    res['verdict_filter']['first_name'] = pg.locator('#rows tr').first.locator('.name b').inner_text()
    # fix1 F-B: the board table must fit its wrap at 1440px with the Verdict
    # column (last th) inside the viewport — no horizontal scroll needed.
    res['table_fit'] = pg.evaluate("() => { const t = document.querySelector('#board'); const w = t.closest('.table-wrap'); const ths = [...document.querySelectorAll('#board thead th')]; const last = ths[ths.length - 1].getBoundingClientRect(); return { scroll: t.scrollWidth, wrap: w.clientWidth, verdict_right: Math.round(last.right), viewport: window.innerWidth }; }")
    b.close()
print(json.dumps(res))
`;
{
  const pyFile = join(scratch, 'v20.py');
  writeFileSync(pyFile, V20_PY);
  const medOdds = DATA.median_odds.toFixed(3);
  const r = spawnSync('python3', [pyFile, OUT, medOdds], { encoding: 'utf8', timeout: 120_000 });
  if (r.status !== 0) {
    fail('V20 KPI / sandbox DOM', `playwright script exit ${r.status}: ${(r.stderr || '').trim().split('\n').slice(-3).join(' | ') || r.stdout}`);
  } else {
    let v20;
    try { v20 = JSON.parse(r.stdout.trim().split('\n').pop()); } catch { v20 = null; }
    if (!v20) fail('V20 KPI / sandbox DOM', 'playwright output was not JSON: ' + r.stdout.slice(0, 200));
    else {
      const problems = [];
      const k = v20.kpi || {};
      if (k['Snapshot total'] !== '758') problems.push(`KPI Snapshot total "${k['Snapshot total']}"`);
      if (!String(k.Ranked || '').startsWith('198')) problems.push(`KPI Ranked "${k.Ranked}"`);
      if (k['Median odds'] !== medOdds) problems.push(`KPI Median odds "${k['Median odds']}" vs payload ${medOdds}`);
      if (!String(k.Verdicts || '').includes('FARM 25')) problems.push(`KPI Verdicts "${k.Verdicts}"`);
      if (!Array.isArray(v20.integrity) || v20.integrity.length !== 5 || !v20.integrity.every((s) => s === 'PASS')) {
        problems.push(`integrity strip ${JSON.stringify(v20.integrity)}`);
      }
      const sb = v20.sandbox || {};
      if (sb.stats_after === sb.stats_before) problems.push('sandbox: moving slope 0.463→0.30 did not move the stats text');
      if (sb.top_after === sb.top_before && sb.stats_after === sb.stats_before) problems.push('sandbox: top-10 and stats both unchanged at slope 0.30');
      if (sb.stats_alloc === sb.stats_after) problems.push('sandbox: moving allocation to 0.001% did not move the stats text');
      if (sb.board_first_after_slope !== sb.board_first_before) problems.push('sandbox: slope move changed the locked board first row');
      if (sb.board_first_after_alloc !== sb.board_first_before) problems.push('sandbox: allocation move changed the locked board first row');
      const vf = v20.verdict_filter || {};
      if (vf.rows !== 25) problems.push(`verdict filter FARM: ${vf.rows} rows, expect 25`);
      if (!String(vf.count_text || '').includes('25')) problems.push(`verdict filter count "${vf.count_text}"`);
      if (!vf.all_farm) problems.push(`verdict filter: not all visible rows are FARM (${vf.n_spans} verdict spans)`);
      if (!vf.dph_desc) problems.push(`verdict filter FARM: $/h not descending (${(vf.dph || []).slice(0, 6).join(', ')}…)`);
      if (!vf.dph || Math.abs(vf.dph[0] - 1887.62) > 0.005) problems.push(`verdict filter FARM: first $/h ${vf.dph && vf.dph[0]}, expect 1887.62 (USDD)`);
      if (vf.first_name !== 'USDD') problems.push(`verdict filter FARM: first row "${vf.first_name}", expect USDD (highest $/h)`);
      const tf = v20.table_fit || {};
      if (!(tf.scroll <= tf.wrap)) problems.push(`board table overflows wrap: scrollWidth ${tf.scroll} > wrap clientWidth ${tf.wrap}`);
      if (!(tf.verdict_right <= 1440)) problems.push(`Verdict column right edge ${tf.verdict_right}px beyond the 1440px viewport`);
      record('V20 KPI / sandbox DOM', problems.length === 0,
        `KPI Snapshot total ${k['Snapshot total']}, Ranked "${k.Ranked}", Median odds ${k['Median odds']}, Verdicts "${k.Verdicts}"; integrity ${JSON.stringify(v20.integrity)}; sandbox top-10 first "${(sb.top_before || '').slice(0, 60)}" → "${(sb.top_after || '').slice(0, 60)}", stats moved on slope ${sb.stats_after !== sb.stats_before} and on allocation ${sb.stats_alloc !== sb.stats_after}, locked board first row unchanged ${sb.board_first_after_slope === sb.board_first_before && sb.board_first_after_alloc === sb.board_first_before}; verdict filter FARM ${vf.rows} rows, count "${vf.count_text}", all FARM ${vf.all_farm}, $/h ${(vf.dph || [])[0]} → ${(vf.dph || []).slice(-1)[0]} descending ${vf.dph_desc}, first ${vf.first_name}; table scrollWidth ${tf.scroll} / wrap ${tf.wrap}, Verdict right ${tf.verdict_right}px (viewport ${tf.viewport}); problems: ${problems.join(' | ') || 'none'}`);
    }
  }
}

// ---------------------------------------------------------------- V21 (LOO / split / coverage recompute)
{
  const { live, big, X, y } = liveDesignV(snapshot);
  const n = live.length;
  const looErr = [];
  for (let h = 0; h < n; h++) {
    const bh = olsV(X.filter((_, i) => i !== h), y.filter((_, i) => i !== h));
    looErr.push(Math.abs(y[h] - dotV(X[h], bh)));
  }
  const looMedian = median(looErr);
  const looRmse = Math.sqrt(looErr.reduce((s, e) => s + e * e, 0) / n);
  const looCoverage = looErr.filter((e) => e <= Z_90 * looRmse).length / n;
  const { train, test } = splitIndicesV(n);
  const bSplit = olsV(train.map((i) => X[i]), train.map((i) => y[i]));
  const splitErr = test.map((i) => Math.abs(y[i] - dotV(X[i], bSplit)));
  const splitMedian = median(splitErr);
  const splitCoverage = splitErr.filter((e) => e <= Z_90 * looRmse).length / test.length;
  const problems = [];
  if (Math.abs(looMedian - DATA.fit.loo_median) > 0.0005) problems.push(`LOO median ${looMedian.toFixed(4)} vs payload ${DATA.fit.loo_median.toFixed(4)}`);
  if (Math.abs(looRmse - DATA.fit.loo_rmse) > 0.0005) problems.push(`LOO RMSE ${looRmse.toFixed(4)} vs payload ${DATA.fit.loo_rmse.toFixed(4)}`);
  if (looCoverage !== DATA.fit.loo_coverage) problems.push(`LOO coverage ${looCoverage} vs payload ${DATA.fit.loo_coverage}`);
  if (Math.abs(splitMedian - DATA.fit.split_median) > 0.0005) problems.push(`split median ${splitMedian.toFixed(4)} vs payload ${DATA.fit.split_median.toFixed(4)}`);
  if (splitCoverage !== DATA.fit.split_coverage) problems.push(`split coverage ${splitCoverage} vs payload ${DATA.fit.split_coverage}`);
  record('V21 LOO / split / coverage recompute', problems.length === 0,
    `LOO median ${looMedian.toFixed(4)} RMSE ${looRmse.toFixed(4)} coverage ${(looCoverage * 100).toFixed(1)}%; split (seed ${SPLIT_SEED}, test = first 38) median ${splitMedian.toFixed(4)} coverage ${(splitCoverage * 100).toFixed(1)}%; problems: ${problems.join(' | ') || 'none'}`);
}

// ---------------------------------------------------------------- V22–V23 (radar-7: additive selection)
// Independent recompute of the radar-7 additive evidence, written here
// from the spec — never imported from lib/. The implied basis applies
// the shipped 0.08–0.60 clamp to the fitted multiple; a fitted
// growth/age term REPLACES the radar-2 growth/maturity multiplier, a
// dropped one leaves it in place.
const RIDGE_LAMBDA_V = 10;
function bigFamV(snapshot) {
  const { live } = liveDesignV(snapshot);
  const famN = {};
  for (const p of live) { const f = familyOfV(p.category); famN[f] = (famN[f] ?? 0) + 1; }
  return Object.entries(famN).filter(([, n]) => n >= 5).map(([f]) => f).sort();
}
function additiveDesignV(p, terms, big, bigFam, asOf) {
  const row = [1];
  const pen = [0];
  if (terms.has('size')) { row.push(Math.log(p.tvl_usd)); pen.push(0); }
  if (terms.has('cat')) { for (const c of big) { row.push(p.category === c ? 1 : 0); pen.push(RIDGE_LAMBDA_V); } }
  if (terms.has('fam')) { for (const f of bigFam) { row.push(familyOfV(p.category) === f ? 1 : 0); pen.push(RIDGE_LAMBDA_V); } }
  let growthFit = false, ageFit = false, chainFit = false;
  if (terms.has('growth')) { row.push(clamp(p.change_7d ?? 0, SPEC.growthLo, SPEC.growthHi) / 100); pen.push(0); growthFit = true; }
  if (terms.has('age')) {
    const age = ageDaysV(asOf, p.listed_at) ?? SPEC.unknownAge;
    row.push(Math.log(age) - Math.log(SPEC.unknownAge)); pen.push(0); ageFit = true;
  }
  if (terms.has('chain')) { row.push(Math.log(Math.min(p.chains.length, 10)) - Math.log(2)); pen.push(0); chainFit = true; }
  return { row, pen, growthFit, ageFit, chainFit };
}
function logImpliedPredAddV(beta, p, terms, big, bigFam, asOf) {
  const { row, growthFit, ageFit, chainFit } = additiveDesignV(p, terms, big, bigFam, asOf);
  const nOls = row.length - (growthFit ? 1 : 0) - (ageFit ? 1 : 0) - (chainFit ? 1 : 0);
  const olsPart = dotV(row.slice(0, nOls), beta.slice(0, nOls));
  const mult = clamp(Math.exp(olsPart - Math.log(p.tvl_usd)), FIT.floor, FIT.cap);
  let lp = Math.log(p.tvl_usd) + Math.log(mult);
  let idx = nOls;
  const gm = growthMaturityV(p, asOf);
  if (growthFit) { lp += beta[idx] * row[idx]; idx++; } else lp += Math.log(gm.growthMult);
  if (ageFit) { lp += beta[idx] * row[idx]; idx++; } else lp += Math.log(gm.maturityMult);
  if (chainFit) { lp += beta[idx] * row[idx]; idx++; }
  return lp;
}
function flatLogImpliedV(train, p, asOf) {
  const mult = clamp(median(train.map((q) => q.mcap_usd / q.tvl_usd)), FIT.floor, FIT.cap);
  const gm = growthMaturityV(p, asOf);
  return Math.log(p.tvl_usd) + Math.log(mult) + Math.log(gm.growthMult) + Math.log(gm.maturityMult);
}
function evalTermsV(snapshot, terms) {
  const { live, big, y } = liveDesignV(snapshot);
  const bigFam = bigFamV(snapshot);
  const looErrs = [];
  for (let h = 0; h < live.length; h++) {
    const train = live.filter((_, i) => i !== h);
    if (terms.size === 0) { looErrs.push(Math.abs(y[h] - flatLogImpliedV(train, live[h], snapshot.as_of))); continue; }
    const beta = ridgeV(
      train.map((p) => additiveDesignV(p, terms, big, bigFam, snapshot.as_of).row),
      train.map((p) => Math.log(p.mcap_usd)),
      additiveDesignV(live[0], terms, big, bigFam, snapshot.as_of).pen,
    );
    looErrs.push(Math.abs(y[h] - logImpliedPredAddV(beta, live[h], terms, big, bigFam, snapshot.as_of)));
  }
  const looMedian = median(looErrs);
  const looRmse = Math.sqrt(looErrs.reduce((s, e) => s + e * e, 0) / looErrs.length);
  const dated = live.map((p, i) => ({ p, i })).filter((o) => o.p.listed_at !== null)
    .sort((a, b) => Date.parse(a.p.listed_at) - Date.parse(b.p.listed_at));
  const folds = [];
  const wfErrs = [];
  for (const trainN of [66, 80]) {
    const train = dated.slice(0, trainN);
    const test = dated.slice(trainN);
    let errs;
    if (terms.size === 0) {
      errs = test.map((o) => Math.abs(y[o.i] - flatLogImpliedV(train.map((t) => t.p), o.p, snapshot.as_of)));
    } else {
      const beta = ridgeV(
        train.map((o) => additiveDesignV(o.p, terms, big, bigFam, snapshot.as_of).row),
        train.map((o) => y[o.i]),
        additiveDesignV(live[0], terms, big, bigFam, snapshot.as_of).pen,
      );
      errs = test.map((o) => Math.abs(y[o.i] - logImpliedPredAddV(beta, o.p, terms, big, bigFam, snapshot.as_of)));
    }
    folds.push({ train: trainN, test: test.length, median: median(errs), coverage: errs.filter((e) => e <= Z_90 * looRmse).length / errs.length });
    wfErrs.push(...errs);
  }
  return {
    looMedian, looRmse, looErrs, folds,
    pooledMedian: median(wfErrs),
    pooledCoverage: wfErrs.filter((e) => e <= Z_90 * looRmse).length / wfErrs.length,
    wfErrs,
  };
}

// ---------------------------------------------------------------- V22 (walk-forward recompute, kept model = size only)
{
  const wf = DATA.fit.walk_forward;
  const ev = evalTermsV(snapshot, new Set(['size']));
  const problems = [];
  if (wf.n !== 95) problems.push(`n ${wf.n}, expect 95`);
  if (wf.n_null_excluded !== 33) problems.push(`null-excluded ${wf.n_null_excluded}, expect 33`);
  if (wf.earliest !== '2021-10-21' || wf.latest !== '2026-08-26') problems.push(`range ${wf.earliest}→${wf.latest}, expect 2021-10-21→2026-08-26`);
  ev.folds.forEach((f, i) => {
    const w = wf.folds[i];
    if (!w || w.train !== f.train || w.test !== f.test) problems.push(`fold ${i + 1} train/test ${w?.train}/${w?.test} vs ${f.train}/${f.test}`);
    if (Math.abs(w.median - f.median) > 0.0005) problems.push(`fold ${i + 1} median ${w.median.toFixed(4)} vs recomputed ${f.median.toFixed(4)}`);
    if (Math.abs(w.coverage - f.coverage) > 1e-9) problems.push(`fold ${i + 1} coverage ${w.coverage} vs recomputed ${f.coverage}`);
  });
  if (Math.abs(wf.pooled_median - ev.pooledMedian) > 0.0005) problems.push(`pooled median ${wf.pooled_median.toFixed(4)} vs recomputed ${ev.pooledMedian.toFixed(4)}`);
  if (Math.abs(wf.pooled_coverage - ev.pooledCoverage) > 1e-9) problems.push(`pooled coverage ${wf.pooled_coverage} vs recomputed ${ev.pooledCoverage}`);
  if (Math.abs(wf.loo_implied_median - ev.looMedian) > 0.0005) problems.push(`LOO-implied median ${wf.loo_implied_median.toFixed(4)} vs recomputed ${ev.looMedian.toFixed(4)}`);
  if (Math.abs(wf.loo_implied_rmse - ev.looRmse) > 0.0005) problems.push(`LOO-implied RMSE ${wf.loo_implied_rmse.toFixed(4)} vs recomputed ${ev.looRmse.toFixed(4)}`);
  record('V22 walk-forward recompute', problems.length === 0,
    `n=${wf.n} dated live (33 null excluded), range ${wf.earliest}→${wf.latest}; fold 66/29 median ${ev.folds[0].median.toFixed(4)} cov ${(ev.folds[0].coverage * 100).toFixed(1)}%, fold 80/15 median ${ev.folds[1].median.toFixed(4)} cov ${(ev.folds[1].coverage * 100).toFixed(1)}%, pooled ${ev.pooledMedian.toFixed(4)} cov ${(ev.pooledCoverage * 100).toFixed(1)}%, LOO-implied ${ev.looMedian.toFixed(4)}; problems: ${problems.join(' | ') || 'none'}`);
}

// ---------------------------------------------------------------- V23 (additive ablation recompute)
{
  const ab = DATA.fit.ablation;
  const order = [
    { id: 'size', term: 'size curve ln TVL' },
    { id: 'cat', term: 'category ridge (λ=10)' },
    { id: 'fam', term: 'family ridge (λ=10)' },
    { id: 'growth', term: '7-day growth (fitted)' },
    { id: 'age', term: 'age ln (fitted)' },
    { id: 'chain', term: 'chain count ln(min(n,10))' },
  ];
  const problems = [];
  const details = [];
  const kept = new Set();
  let cur = evalTermsV(snapshot, kept);
  const baseRow = ab.find((r) => r.term === 'flat-median baseline');
  if (!baseRow) problems.push('baseline row missing');
  else {
    if (Math.abs(baseRow.loo - cur.looMedian) > 0.0005) problems.push(`baseline LOO ${baseRow.loo.toFixed(4)} vs recomputed ${cur.looMedian.toFixed(4)}`);
    if (Math.abs(baseRow.wf_pooled - cur.pooledMedian) > 0.0005) problems.push(`baseline WF ${baseRow.wf_pooled.toFixed(4)} vs recomputed ${cur.pooledMedian.toFixed(4)}`);
    if (baseRow.decision !== 'keep') problems.push(`baseline decision ${baseRow.decision}, expect keep`);
  }
  details.push(`baseline: LOO ${cur.looMedian.toFixed(4)}, WF ${cur.pooledMedian.toFixed(4)}`);
  for (const { id, term } of order) {
    const row = ab.find((r) => r.term === term);
    if (!row) { problems.push(`additive row missing for ${term}`); continue; }
    const trial = new Set([...kept, id]);
    const t = evalTermsV(snapshot, trial);
    const looDelta = t.looMedian - cur.looMedian;
    const wfDelta = t.pooledMedian - cur.pooledMedian;
    const decision = looDelta < 0 && wfDelta < 0 ? 'keep' : 'drop';
    if (Math.abs(row.loo - t.looMedian) > 0.0005) problems.push(`${term}: LOO ${row.loo.toFixed(4)} vs recomputed ${t.looMedian.toFixed(4)}`);
    if (Math.abs(row.loo_delta - looDelta) > 0.0005) problems.push(`${term}: ΔLOO ${row.loo_delta.toFixed(4)} vs recomputed ${looDelta.toFixed(4)}`);
    if (Math.abs(row.wf_pooled - t.pooledMedian) > 0.0005) problems.push(`${term}: WF ${row.wf_pooled.toFixed(4)} vs recomputed ${t.pooledMedian.toFixed(4)}`);
    if (Math.abs(row.wf_pooled_delta - wfDelta) > 0.0005) problems.push(`${term}: ΔWF ${row.wf_pooled_delta.toFixed(4)} vs recomputed ${wfDelta.toFixed(4)}`);
    if (row.decision !== decision) problems.push(`${term}: decision ${row.decision} vs rule ${decision}`);
    details.push(`${term}: LOO ${t.looMedian.toFixed(4)} (Δ ${looDelta >= 0 ? '+' : ''}${looDelta.toFixed(4)}), WF ${t.pooledMedian.toFixed(4)} (Δ ${wfDelta >= 0 ? '+' : ''}${wfDelta.toFixed(4)}), ${row.decision}`);
    if (decision === 'keep') { kept.add(id); cur = t; }
  }
  if (ab.length !== 7) problems.push(`ablation has ${ab.length} rows, expect 7 (baseline + 6)`);
  if (JSON.stringify([...kept].sort()) !== JSON.stringify(['size'])) problems.push(`kept set ${[...kept].join(',')}, expect size only`);
  record('V23 additive ablation recompute', problems.length === 0,
    `${details.join(' || ')}; kept: ${[...kept].join(', ') || 'none'}; problems: ${problems.join(' | ') || 'none'}`);
}

// ---------------------------------------------------------------- V24 (comps recompute)
{
  const livePos = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0);
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const problems = [];
  let fallbackRows = 0;
  const dist = (tvl, p) => Math.abs(Math.log(tvl / p.tvl_usd));
  for (const r of rows) {
    const same = livePos.filter((p) => p.category === r.category).sort((a, b) => dist(r.tvl_usd, a) - dist(r.tvl_usd, b));
    const cross = livePos.filter((p) => p.category !== r.category).sort((a, b) => dist(r.tvl_usd, a) - dist(r.tvl_usd, b));
    const want = [...same.slice(0, 3)];
    let i = 0;
    while (want.length < 3) want.push(cross[i++]);
    if (r.comps_same_category !== Math.min(3, same.length)) problems.push(`${r.slug}: comps_same_category ${r.comps_same_category} vs recomputed ${Math.min(3, same.length)}`);
    if (r.comps_same_category < 3) fallbackRows++;
    want.forEach((p, j) => {
      const c = r.comps[j];
      const mult = Math.round((p.mcap_usd / p.tvl_usd) * 1e6) / 1e6;
      if (!c || c.slug !== p.slug || c.name !== p.name || c.tvl_usd !== p.tvl_usd
        || Math.abs(c.multiple - mult) > 1e-9 || c.same_category !== (p.category === r.category)) {
        problems.push(`${r.slug}: comp ${j} ${c?.slug} vs recomputed ${p.slug} (mult ${c?.multiple} vs ${mult})`);
      }
    });
    if (problems.length > 5) break;
  }
  const r1 = rows[0];
  const r99 = rows[98];
  const r198 = rows[197];
  const sym = rows.find((r) => r.slug === 'symbiotic');
  const spotOk = JSON.stringify(r1.comps.map((c) => c.slug)) === JSON.stringify(['reservoir-protocol', 'frankencoin', 'inverse-finance-firm'])
    && JSON.stringify(r99.comps.map((c) => c.slug)) === JSON.stringify(['harvest-finance', 'yield-yak-aggregator', 'badger-dao'])
    && JSON.stringify(r198.comps.map((c) => c.slug)) === JSON.stringify(['api3', 'ekubo', 'pumpbtc'])
    && sym && sym.comps_same_category === 0
    && JSON.stringify(sym.comps.map((c) => c.slug)) === JSON.stringify(['xdai-stake-bridge', 'starknet-bridge', 'solstice']);
  if (!spotOk) problems.push('spot-check ranks 1/99/198 + symbiotic mismatch');
  if (fallbackRows !== 102) problems.push(`fallback rows ${fallbackRows}, expect 102`);
  record('V24 comps recompute', problems.length === 0,
    `all 198 rows × 3 comps recomputed from the 128 live positive-mcap tokens (|ln TVL ratio|, same-category first); fallback rows ${fallbackRows}/198 (expect 102); spot rank 1 ${r1.comps.map((c) => c.slug).join(',')}, rank 99 ${r99.comps.map((c) => c.slug).join(',')}, rank 198 ${r198.comps.map((c) => c.slug).join(',')}, symbiotic ${sym?.comps.map((c) => c.slug).join(',')} (0 same-category); problems: ${problems.slice(0, 5).join(' | ') || 'none'}`);
}

// ---------------------------------------------------------------- V26 (radar-7 dashboard DOM: evidence + implied rank-1 + definition)
const V26_PY = `
import json, sys
from pathlib import Path
from playwright.sync_api import sync_playwright
out = Path(sys.argv[1])
board = json.loads((out / 'board.json').read_text())['rows']
r1 = board[0]
data = json.loads((out / 'data.js').read_text()[len('window.RADAR='):-2])
def fmt_usd(n):
    if abs(n) >= 1e9: return '$' + f'{n/1e9:.2f}B'
    if abs(n) >= 1e6: return '$' + f'{n/1e6:.1f}M'
    if abs(n) >= 1e3: return '$' + str(round(n/1e3)) + 'K'
    return '$' + str(round(n))
res = {}
with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page(viewport={'width': 1440, 'height': 900})
    pg.goto((out / 'dashboard' / 'index.html').as_uri())
    pg.wait_for_selector('#rows tr')
    pg.wait_for_selector('#kpiStrip div')
    pg.wait_for_selector('#evidenceOut table.mini')
    kpi = {}
    for div in pg.locator('#kpiStrip div').all():
        kpi[div.locator('dt').inner_text()] = div.locator('dd').inner_text()
    res['kpi_wf'] = kpi.get('Walk-forward median |ln err|')
    res['kpi_rank1_implied'] = kpi.get('Rank-1 implied value')
    res['first_row'] = pg.locator('#rows tr').first.inner_text()
    res['board_interval_r1'] = pg.locator('#rows tr').first.locator('td:nth-child(10)').inner_text()
    # Radar-7: a collapsed interval (P10 = P90, clamp-bound in nearly every
    # refit) renders as "stable in N/200 refits", not the $ range.
    res['board_rank1_interval_want'] = ('stable in ' + str(r1['stable_refits']) + '/200 refits'
        if r1['p10_usd'] == r1['p90_usd'] else fmt_usd(r1['p10_usd']) + '\\u2013' + fmt_usd(r1['p90_usd']))
    res['board_fitted_r1'] = pg.locator('#rows tr').first.locator('td:nth-child(9)').inner_text()
    res['board_fitted_r1_want'] = fmt_usd(r1['value_if_launches_usd'])
    ev = pg.locator('#evidenceOut').inner_text()
    res['evidence_text'] = ev
    res['evidence_tables'] = [t.locator('tbody tr').all_inner_texts() for t in pg.locator('#evidenceOut table.mini').all()]
    rh = data['fit']['range_honesty']
    res['evidence_want'] = [
      [[a['term'], f"{a['loo']:.2f}", ('+' if a['loo_delta']>=0 else '')+f"{a['loo_delta']:.2f}", f"{a['wf_pooled']:.2f}", ('+' if a['wf_pooled_delta']>=0 else '')+f"{a['wf_pooled_delta']:.2f}", a['decision']] for a in data['fit']['ablation']],
      [[c['term'], f"{c['brier_tenfold']:.3f}", f"{c['brier_wf']:.3f}", c['decision']] for c in data['odds']['cv']],
      [['Leave-one-out', f"{rh['loo_within3']*100:.1f}%", f"{rh['loo_p2575']*100:.1f}%", f"{rh['loo_p1090']*100:.1f}%"],
       ['Walk-forward', f"{rh['wf_within3']*100:.1f}%", f"{rh['wf_p2575']*100:.1f}%", f"{rh['wf_p1090']*100:.1f}%"]],
    ]
    method = pg.locator('#methodFit').inner_text()
    res['method_wf'] = 'Walk-forward: the 95 live-token' in method
    res['method_pointer'] = 'The per-term additive table is above the board' in method
    res['method_keep'] = 'kept no category term' in method
    odds = pg.locator('#methodOdds').inner_text()
    res['method_def'] = 'Implied value = fitted value' in odds and "the entry\u2019s own claim" in odds
    pg.goto((out / 'dashboard' / 'index.html').as_uri() + '#p=usdd')
    pg.wait_for_selector('#detail[open]')
    dlg = pg.locator('#detail').inner_text()
    res['detail_anchored'] = 'Anchored by' in dlg
    res['detail_reservoir'] = 'Reservoir Protocol' in dlg
    res['detail_usdd'] = 'USDD' in dlg
    res['detail_def'] = 'Implied value = fitted value' in dlg and "the entry\u2019s own claim" in dlg
    res['detail_vfl'] = 'value if launches' in dlg.lower()
    b.close()
print(json.dumps(res))
`;
{
  const pyFile = join(scratch, 'v26.py');
  writeFileSync(pyFile, V26_PY);
  const r = spawnSync('python3', [pyFile, OUT], { encoding: 'utf8', timeout: 120_000 });
  if (r.status !== 0) {
    fail('V26 radar-7 dashboard DOM', `playwright script exit ${r.status}: ${(r.stderr || '').trim().split('\n').slice(-3).join(' | ') || r.stdout}`);
  } else {
    let v26;
    try { v26 = JSON.parse(r.stdout.trim().split('\n').pop()); } catch { v26 = null; }
    if (!v26) fail('V26 radar-7 dashboard DOM', 'playwright output was not JSON: ' + r.stdout.slice(0, 200));
    else {
      const problems = [];
      if (!String(v26.kpi_wf || '').startsWith('1.21')) problems.push(`KPI walk-forward "${v26.kpi_wf}", expect 1.21… (n=95, 2 folds)`);
      if (!String(v26.kpi_rank1_implied || '').includes('USDD') || !String(v26.kpi_rank1_implied || '').includes('$35,364,990')
        || !String(v26.kpi_rank1_implied || '').includes('$72,029,848') || !String(v26.kpi_rank1_implied || '').includes('0.491')) {
        problems.push(`KPI rank-1 implied "${v26.kpi_rank1_implied}", expect USDD $35,364,990 (value if launches $72,029,848, odds 0.491)`);
      }
      if (!String(v26.first_row || '').includes('USDD')) problems.push(`board first row "${String(v26.first_row || '').slice(0, 80)}", expect USDD (implied rank 1)`);
      if (String(v26.board_interval_r1 || '') !== String(v26.board_rank1_interval_want || '')) problems.push(`board rank-1 interval cell "${v26.board_interval_r1}", expect "${v26.board_rank1_interval_want}"`);
      if (String(v26.board_fitted_r1 || '') !== String(v26.board_fitted_r1_want || '')) problems.push(`board rank-1 fitted cell "${v26.board_fitted_r1}", expect "${v26.board_fitted_r1_want}"`);
      const evText = String(v26.evidence_text || '');
      if (!evText.includes('Walk-forward')) problems.push('evidence section lacks the walk-forward line');
      if (!evText.includes('Brier 0.20')) problems.push(`evidence text lacks "Brier 0.20": ${evText.slice(0, 200)}`);
      const gotTables = (v26.evidence_tables || []).map((tbl) => tbl.map((t) => t.split('\t')));
      const wantTables = v26.evidence_want || [];
      if (gotTables.length !== 3 || JSON.stringify(gotTables) !== JSON.stringify(wantTables)) {
        problems.push(`evidence tables ${JSON.stringify(gotTables)} vs data.js ${JSON.stringify(wantTables)}`);
      }
      if (!v26.method_wf) problems.push('methodology lacks the walk-forward paragraph');
      if (!v26.method_pointer) problems.push('methodology lacks the pointer to the additive table above the board (C3 de-dup)');
      if (!v26.method_keep) problems.push('methodology lacks the "kept no category term" verdict');
      if (!v26.method_def) problems.push('methodology odds section lacks the implied definition ("Implied value = fitted value … the entry\u2019s own claim")');
      if (!v26.detail_anchored) problems.push('detail dialog lacks "Anchored by"');
      if (!v26.detail_reservoir) problems.push('detail dialog lacks comp Reservoir Protocol');
      if (!v26.detail_usdd) problems.push('detail dialog lacks "USDD"');
      if (!v26.detail_def) problems.push('detail dialog lacks the implied definition');
      if (!v26.detail_vfl) problems.push('detail dialog lacks "value if launches"');
      record('V26 radar-7 dashboard DOM', problems.length === 0,
        `KPI walk-forward "${v26.kpi_wf}", rank-1 implied "${v26.kpi_rank1_implied}"; board rank-1 interval "${v26.board_interval_r1}", fitted "${v26.board_fitted_r1}"; evidence tables ${gotTables.length}/3 match data.js (additive 7 rows, odds 4 rows, honesty 2 rows); methodology WF ${v26.method_wf}, pointer ${v26.method_pointer}, keep ${v26.method_keep}, definition ${v26.method_def}; detail anchored ${v26.detail_anchored}, Reservoir ${v26.detail_reservoir}, USDD ${v26.detail_usdd}, definition ${v26.detail_def}, value-if-launches ${v26.detail_vfl}; problems: ${problems.join(' | ') || 'none'}`);
    }
  }
}

// ---------------------------------------------------------------- V27 (radar-7 dev-gate rollup + radar-5 negative fixture)
{
  const problems = [];
  // (a) The seven sealed gate rows (RULES.txt baris 27–35) must all pass
  // on this build: dashboard_files, board_file, sorted_by_value,
  // coverage, farm_steps, screenshots, dossier_matches.
  const gateIds = ['V2 dashboard_files', 'V3 board_file', 'V4 sorted_by_value', 'V5 coverage',
    'V6 farm_steps', 'V7 screenshots', 'V8 dossier_matches'];
  for (const id of gateIds) {
    const hit = results.find((r) => r.id === id);
    if (!hit || !hit.pass) problems.push(`gate row ${id} did not pass`);
  }
  // (b) The SAME gate function must FAIL on the radar-5 board fixture
  // (tests/fixtures/board-radar5.json, sha 04d04c8a… — the board the
  // server refused with sorted_by_value 0/1). If it passed here, the
  // gate would be too weak to catch the real defect.
  const fixturePath = join(ROOT, 'tests', 'fixtures', 'board-radar5.json');
  let fixtureIssue = null;
  let fixtureRises = -1;
  let fixtureSha = '';
  try {
    const fixtureBytes = readFileSync(fixturePath);
    fixtureSha = sha256(fixtureBytes).slice(0, 8);
    const fixtureRows = JSON.parse(fixtureBytes.toString('utf8')).rows;
    fixtureIssue = sortedByValueGate(fixtureRows);
    fixtureRises = fixtureRows.filter((r, i) => i > 0 && r.implied_value_usd > fixtureRows[i - 1].implied_value_usd).length;
  } catch (e) {
    problems.push(`radar-5 fixture unreadable: ${e.message}`);
  }
  if (fixtureSha !== '04d04c8a') problems.push(`radar-5 fixture sha ${fixtureSha}, expect 04d04c8a…`);
  if (fixtureIssue === null) problems.push('radar-5 fixture PASSED the gate — the gate cannot catch the real defect');
  if (fixtureRises !== 95) problems.push(`radar-5 fixture has ${fixtureRises} implied rises, expect 95`);
  record('V27 dev-gate + radar-5 negative fixture', problems.length === 0,
    `gate rows ${gateIds.map((id) => id.slice(0, 2)).join('/')}: ${gateIds.every((id) => results.find((r) => r.id === id)?.pass) ? 'all PASS' : 'NOT all pass'}; radar-5 fixture sha ${fixtureSha}…, gate issue: ${fixtureIssue ?? 'none (BAD)'}, implied rises ${fixtureRises} (expect 95); problems: ${problems.join(' | ') || 'none'}`);
}

// ---------------------------------------------------------------- V28 (radar-7: odds CV + range honesty recompute)
{
  const problems = [];
  // --- odds CV (independent): ten-fold + walk-forward per term set,
  // train-only peer prior (live share from the TRAINING rows only),
  // same keep rule as model.ts oddsCv (both Briers must improve).
  // NOTE: peerStatsV hard-codes the global live share, so the train-local
  // stats are computed here instead — using the global share inside a
  // fold would leak the test rows' outcomes into the prior.
  const peerStatsTrainV = (train) => {
    const catTot = {};
    const catLive = {};
    for (const p of train) {
      const c = p.category ?? '';
      catTot[c] = (catTot[c] ?? 0) + 1;
      if (p.symbol !== null) catLive[c] = (catLive[c] ?? 0) + 1;
    }
    const liveCount = train.filter((p) => p.symbol !== null).length;
    return { catTot, catLive, liveShare: liveCount / train.length };
  };
  const peerShrunkV = (p, peers) => {
    const c = p.category ?? '';
    return ((peers.catLive[c] ?? 0) + ODDS_PRIOR * peers.liveShare) / ((peers.catTot[c] ?? 0) + ODDS_PRIOR);
  };
  const irlsOddsForV = (train, terms) => {
    const peers = peerStatsTrainV(train);
    const cols = [() => 1];
    if (terms.has('peer')) cols.push((p) => { const ps = peerShrunkV(p, peers); return Math.log(ps / (1 - ps)); });
    if (terms.has('age')) cols.push((p) => Math.log(ageDaysV(snapshot.as_of, p.listed_at) ?? SPEC.unknownAge));
    if (terms.has('growth')) cols.push((p) => clamp(p.change_7d ?? 0, SPEC.growthLo, SPEC.growthHi) / 100);
    const X = train.map((p) => cols.map((f) => f(p)));
    const y = train.map((p) => (p.symbol !== null ? 1 : 0));
    return irlsV(X, y);
  };
  const oddsBrierForV = (train, test, terms) => {
    const peers = peerStatsTrainV(train);
    const { beta } = irlsOddsForV(train, terms);
    let sum = 0;
    for (const p of test) {
      let eta = beta[0];
      let i = 1;
      if (terms.has('peer')) { const ps = peerShrunkV(p, peers); eta += beta[i++] * Math.log(ps / (1 - ps)); }
      if (terms.has('age')) eta += beta[i++] * Math.log(ageDaysV(snapshot.as_of, p.listed_at) ?? SPEC.unknownAge);
      if (terms.has('growth')) eta += beta[i++] * (clamp(p.change_7d ?? 0, SPEC.growthLo, SPEC.growthHi) / 100);
      const o = 1 / (1 + Math.exp(-clamp(eta, -30, 30)));
      const yy = p.symbol !== null ? 1 : 0;
      sum += (o - yy) * (o - yy);
    }
    return sum / test.length;
  };
  const evalOddsV = (terms) => {
    const all = snapshot.protocols;
    const rng = mulberry32(SPLIT_SEED);
    const idx = all.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    let sq = 0;
    for (let f = 0; f < 10; f++) {
      const test = idx.filter((_, k) => k % 10 === f).map((i) => all[i]);
      const train = idx.filter((_, k) => k % 10 !== f).map((i) => all[i]);
      sq += oddsBrierForV(train, test, terms) * test.length;
    }
    const tenFold = sq / all.length;
    const dated = all.filter((p) => p.listed_at !== null)
      .sort((a, b) => Date.parse(a.listed_at) - Date.parse(b.listed_at));
    let sqW = 0;
    let nW = 0;
    for (const trainN of [430, 516]) {
      const train = dated.slice(0, trainN);
      const test = dated.slice(trainN);
      sqW += oddsBrierForV(train, test, terms) * test.length;
      nW += test.length;
    }
    return { tenFold, wf: sqW / nW };
  };
  const cv = DATA.odds.cv;
  const order = [
    { id: 'peer', term: 'peer logit' },
    { id: 'age', term: 'ln age' },
    { id: 'growth', term: 'growth' },
  ];
  const kept = new Set();
  let cur = evalOddsV(kept);
  const cvDetails = [`base rate: 10-fold ${cur.tenFold.toFixed(4)}, WF ${cur.wf.toFixed(4)}`];
  const baseRow = cv[0];
  if (!baseRow || baseRow.term !== 'base rate' || Math.abs(baseRow.brier_tenfold - cur.tenFold) > 0.0005
    || Math.abs(baseRow.brier_wf - cur.wf) > 0.0005 || baseRow.decision !== 'keep') {
    problems.push(`base rate CV ${JSON.stringify(baseRow)} vs recomputed ${cur.tenFold.toFixed(4)}/${cur.wf.toFixed(4)}`);
  }
  for (const { id, term } of order) {
    const row = cv.find((c) => c.term === term);
    const t = evalOddsV(new Set([...kept, id]));
    const keep = t.tenFold < cur.tenFold && t.wf < cur.wf;
    cvDetails.push(`${term}: 10-fold ${t.tenFold.toFixed(4)}, WF ${t.wf.toFixed(4)}, ${keep ? 'keep' : 'drop'}`);
    if (!row) problems.push(`odds CV row missing for ${term}`);
    else {
      if (Math.abs(row.brier_tenfold - t.tenFold) > 0.0005) problems.push(`${term}: ten-fold ${row.brier_tenfold.toFixed(4)} vs recomputed ${t.tenFold.toFixed(4)}`);
      if (Math.abs(row.brier_wf - t.wf) > 0.0005) problems.push(`${term}: WF ${row.brier_wf.toFixed(4)} vs recomputed ${t.wf.toFixed(4)}`);
      if (row.decision !== (keep ? 'keep' : 'drop')) problems.push(`${term}: decision ${row.decision} vs rule ${keep ? 'keep' : 'drop'}`);
    }
    if (keep) { kept.add(id); cur = t; }
  }
  if (cv.length !== 4) problems.push(`odds CV has ${cv.length} rows, expect 4`);
  if (Math.abs(DATA.odds.brier_tenfold - cur.tenFold) > 0.0005) problems.push(`payload brier_tenfold ${DATA.odds.brier_tenfold} vs final ${cur.tenFold}`);
  if (Math.abs(DATA.odds.brier_wf - cur.wf) > 0.0005) problems.push(`payload brier_wf ${DATA.odds.brier_wf} vs final ${cur.wf}`);
  // --- range honesty (independent): thresholds ln 3 / 0.6745×RMSE /
  // Z_90×RMSE on the kept-model LOO + WF |ln err| lists (model.ts
  // rangeHonesty — the printed range is lognormal with the LOO RMSE).
  const ev = evalTermsV(snapshot, new Set(['size']));
  const rh = DATA.fit.range_honesty;
  const wantRh = {
    loo_within3: ev.looErrs.filter((e) => e <= Math.log(3)).length / ev.looErrs.length,
    loo_p2575: ev.looErrs.filter((e) => e <= 0.6745 * ev.looRmse).length / ev.looErrs.length,
    loo_p1090: ev.looErrs.filter((e) => e <= Z_90 * ev.looRmse).length / ev.looErrs.length,
    wf_within3: ev.wfErrs.filter((e) => e <= Math.log(3)).length / ev.wfErrs.length,
    wf_p2575: ev.wfErrs.filter((e) => e <= 0.6745 * ev.looRmse).length / ev.wfErrs.length,
    wf_p1090: ev.wfErrs.filter((e) => e <= Z_90 * ev.looRmse).length / ev.wfErrs.length,
  };
  for (const [k, v] of Object.entries(wantRh)) {
    if (Math.abs(rh[k] - v) > 1e-9) problems.push(`range honesty ${k} ${rh[k]} vs recomputed ${v}`);
  }
  record('V28 odds CV + range honesty recompute', problems.length === 0,
    `${cvDetails.join(' || ')}; kept odds terms: ${[...kept].join(', ')}; final 10-fold ${cur.tenFold.toFixed(4)}, WF ${cur.wf.toFixed(4)} (base 0.2484 / 0.2839); range honesty LOO within×3 ${(wantRh.loo_within3 * 100).toFixed(1)}% / P25–P75 ${(wantRh.loo_p2575 * 100).toFixed(1)}% / P10–P90 ${(wantRh.loo_p1090 * 100).toFixed(1)}%, WF ${(wantRh.wf_within3 * 100).toFixed(1)}% / ${(wantRh.wf_p2575 * 100).toFixed(1)}% / ${(wantRh.wf_p1090 * 100).toFixed(1)}%; problems: ${problems.join(' | ') || 'none'}`);
}

// ---------------------------------------------------------------- S1 (info): radar-7 constants recompute
{
  const livePos = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0);
  const overall = median(livePos.map((p) => p.mcap_usd / p.tvl_usd));
  const modelText = readFileSync(join(ROOT, 'lib', 'model.ts'), 'utf8');
  const constantsMatchD8 = ['intercept: 6.964567', 'slope: 0.522266']
    .every((s) => modelText.includes(s));
  const oddsMatchD9 = ['intercept: -3.040781', 'age: 0.446892', 'growth: -3.061039', 'peer: 1.329665']
    .every((s) => modelText.includes(s));
  console.log(`INFO S1 radar-7 constants — live positive-mcap count ${livePos.length} (D8: 128); overall median mcap/TVL ${overall.toFixed(3)} (D1r fallback 0.214); fitted constants in lib/model.ts match the D8 table: ${constantsMatchD8 ? 'yes' : 'NO'}; odds constants match the D9 table: ${oddsMatchD9 ? 'yes' : 'NO'}.`);
  console.log('INFO S1 note — the D8/D9 quoted (6-dp) constants are normative; full-precision refits differ by <0.001% on individual values (radar-6 worked example +$123, rank-198 +$8 vs the spec prose, which was computed with full-precision betas; radar-7 worked example $16,395,497 with the quoted slope-only constants). See entry/BUILD.md radar-3 deviations.');
}

// ---------------------------------------------------------------- summary
const failed = results.filter((r) => !r.pass);
console.log('---');
console.log(`verify: ${results.length - failed.length}/${results.length} checks passed${failed.length ? '; FAILED: ' + failed.map((r) => r.id).join(', ') : ''}`);
console.log('What this suite CANNOT verify (no local grade exists for token-radar-01): the AI judge\'s pairwise verdicts, the Bradley–Terry win rate / dev rate, strength vs the four house anchors (1-weak 0.014, 2-plain 0.593, 3-mid 0.782, 4-strong 1.081) and three rungs, the top-40 final screen, and any prize. The judge (no fixed temperature) may answer the same pair differently if re-asked; verdicts are final. A local "looks better" judgement is not a grade.');
if (KEEP) console.log('verify: scratch kept at ' + scratch);
else rmSync(scratch, { recursive: true, force: true });
process.exit(failed.length ? 1 : 0);
