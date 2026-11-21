// Token Radar, model radar-3 (spec D8–D12; D1/D1r retained as the fallback).
//
// One sealed snapshot in, one ranked board out. The primary model is a pooled
// log-log OLS fitted to the 128 live-token protocols with a positive market
// cap (spec D8); its coefficients are hardcoded constants, and main.ts does
// NOT refit them at runtime — the fit, the leave-one-out and split
// held-out numbers, the horse race and the bootstrap are computed by this
// file from the snapshot for validation and reporting, and the verify suite
// recomputes them independently. D1r (median multiples) stays in the code
// as the documented fallback and as the stability-gate comparator.
//
//   fitted:  log_mcap_hat = a + b * ln(tvl_usd) + eff_cat
//            fitted_multiple_raw = exp(a + (b-1) * ln TVL + eff_cat)
//            fitted_multiple = clamp(raw, 0.08, 0.60)
//            implied_fit = max(1, round(tvl * fitted_multiple * growth_mult * maturity_mult))
//   odds:    logit = c0 + c1 * ln(age) + c2 * growth_c + c3 * peer_logit
//            expected = implied_fit * odds
//   growth_mult / maturity_mult are unchanged from D1r.
//
// Evidence (spec D8/D9, recomputed independently in /tmp/radar3-recompute-b*.mjs
// before this code was written; every number below was reproduced there):
//   fit: a = 8.028969, b = 0.463147, R² = 0.2493, residual SD 2.0966, n = 128, df = 117.
//   LOO median |ln err| 1.2908, RMSE 2.1974; 70/30 split (seed 20261122,
//   test = first 38 of the seeded shuffle) median 1.1740; coverages 82.0% / 84.2%.
//   odds: IRLS on all 758 protocols, outcome "records a token"; AUC 0.7647.
//   The peer share in the shrinkage prior is the EXACT 416/758 from the
//   snapshot — the rounded 0.5488 quoted in spec D9 does NOT reproduce the
//   coefficients to 6 decimals (it gives -3.040768 / -3.061051), so the code
//   computes the share from the snapshot and the verify suite checks it.
//   Bootstrap (spec D10): B = 200, mulberry32 seed 20261122; a resample that
//   draws no row of a category drops that dummy (effect 0 for that refit) —
//   see lib/ols.ts. The spec-time script divided by a zero pivot there and
//   published NaN-contaminated bootstrap numbers; this build reports the
//   honest bootstrap (entry/BUILD.md, radar-3, has the evidence).

import { bootstrapIntervals, BOOTSTRAP_B, BOOTSTRAP_SEED } from './bootstrap.ts';
import { dot, median, mulberry32, ols, solve } from './ols.ts';

/** One protocol entry of the sealed snapshot: exactly its ten fields. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The radar-2 (D1r) constants, kept as the documented fallback model. */
export interface ModelConstants {
  fallback_multiple: number;
  multiple_floor: number;
  multiple_cap: number;
  size_reference_usd: number;
  size_exponent: number;
  size_floor: number;
  size_cap: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  fallback_multiple: 0.214,
  multiple_floor: 0.08,
  multiple_cap: 0.6,
  size_reference_usd: 50_000_000,
  size_exponent: 0.1,
  size_floor: 0.7,
  size_cap: 1.3,
  growth_weight: 0.6,
  growth_floor: -40,
  growth_cap: 60,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 1095,
  unknown_age_days: 365,
};

export const MODEL_VERSION = 'radar-3';

/** Live-token rows the dashboard's separate live view carries, by market cap. */
export const LIVE_ROWS = 24;

/** Stated assumptions (spec D11): the opportunity rate and the 1 bp
 *  allocation share are assumptions, not snapshot figures. The verdict
 *  thresholds are fixed ratios on the break-even share. */
export const OPPORTUNITY_RATE = 0.05;
export const ALLOCATION_SHARE = 0.0001;
export const VERDICT_FARM = 0.00001;
export const VERDICT_THIN = 0.0001;

/** The radar-3 fitted model (spec D8): pooled log-log OLS, 11 parameters. */
export const FIT = {
  intercept: 8.028969,
  slope: 0.463147,
  effects: {
    'Basis Trading': 1.070305,
    Bridge: -0.111419,
    CEX: 0.867641,
    'Canonical Bridge': 0.754849,
    Dexs: 0.064547,
    Lending: -0.631826,
    'Liquid Staking': -0.964243,
    RWA: 0.179798,
    Yield: -0.786214,
  } as Readonly<Record<string, number>>,
  multipleFloor: 0.08,
  multipleCap: 0.6,
};

/** The radar-3 launch-odds model (spec D9): logistic peer resemblance. */
export const ODDS = {
  intercept: -3.040781,
  age: 0.446892,
  growth: -3.061039,
  peer: 1.329665,
  priorWeight: 5,
};

/** Category multiples of the D1r fallback (median mcap/TVL, n >= 5, clamped). */
export const CATEGORY_MULTIPLES: Readonly<Record<string, number>> = {
  'Liquid Staking': 0.08, // raw median 0.041, clamped; moot on the board (excluded)
  CEX: 0.08, // raw median 0.075, clamped; moot on the board (excluded)
  Lending: 0.132,
  Yield: 0.191,
  RWA: 0.275,
  Dexs: 0.342,
  Bridge: 0.557, // moot on the board (excluded)
  'Basis Trading': 0.6, // raw median 0.654, clamped
  'Canonical Bridge': 0.6, // raw median 0.746, clamped; moot (excluded)
};

/** Categories the board never ranks: their tokens already trade, or they are
 *  exchange / bridge / staking wrappers, not pre-token launches. */
export const EXCLUDED_CATEGORIES: ReadonlySet<string> = new Set([
  'CEX',
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
]);

/** Exchange names: a protocol whose name starts with one is an exchange's own
 *  product, not an independent pre-token launch. */
const EXCHANGE_NAMES = [
  'Binance', 'Coinbase', 'Kraken', 'Bybit', 'OKX', 'Bitget', 'KuCoin',
  'Huobi', 'Gate', 'Gemini', 'Bitstamp', 'Bitfinex', 'Crypto.com',
  'HTX', 'MEXC', 'Bithumb', 'Upbit', 'Deribit',
];

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** The fitted-model breakdown carried on every board row. */
export interface ModelBreakdown {
  intercept: number;
  slope: number;
  category_effect: number;
  fitted_multiple_raw: number;
  fitted_multiple: number;
  /** The D1r median multiple for the row's category — the labelled fallback. */
  d1r_multiple: number;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  age_days: number | null;
  /** True when the fitted multiple sits at the 0.08 / 0.60 clamp bound. */
  at_clamp_bound: boolean;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: ModelBreakdown;
  odds: number;
  expected_value_usd: number;
  peer_shrunk: number;
  peer_logit: number;
  p10_usd: number;
  p90_usd: number;
  rank_lo: number;
  rank_hi: number;
  capital_tier: number;
  hold_days: number;
  gas_total_usd: number;
  opportunity_cost_usd: number;
  farm_cost_usd: number;
  break_even_share: number;
  hours_active: number;
  net_1bp_usd: number;
  dollars_per_hour: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  farm_steps: string[];
}

/** One board row in the compact form data.js carries to the dashboard. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  model: BoardRow['model'];
  odds: number;
  expected_value_usd: number;
  peer_shrunk: number;
  peer_logit: number;
  p10_usd: number;
  p90_usd: number;
  rank_lo: number;
  rank_hi: number;
  capital_tier: number;
  hold_days: number;
  gas_total_usd: number;
  opportunity_cost_usd: number;
  farm_cost_usd: number;
  break_even_share: number;
  hours_active: number;
  net_1bp_usd: number;
  dollars_per_hour: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  farm_steps: string[];
  watchlist: boolean;
}

/** A live-token protocol: it already trades, so the board shows the market's
 *  own value, never a model number. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
}

/** One row of the model-selection horse race (spec D8): all numbers computed
 *  by this file from the snapshot, never typed in. */
export interface HorseRaceRow {
  variant: string;
  loo_median: number;
  loo_rmse: number;
  split_median: number;
}

/** The fitted model's held-out evidence, computed from the snapshot. */
export interface FitMetrics {
  intercept: number;
  slope: number;
  effects: Readonly<Record<string, number>>;
  n: number;
  df: number;
  r2: number;
  resid_sd: number;
  loo_median: number;
  loo_rmse: number;
  split_median: number;
  loo_coverage: number;
  split_coverage: number;
  horse_race: HorseRaceRow[];
}

/** The launch-odds evidence, computed from the snapshot. */
export interface OddsMetrics {
  intercept: number;
  age: number;
  growth: number;
  peer: number;
  prior_weight: number;
  live_share: number;
  auc: number;
  mean_live: number;
  mean_pre: number;
}

/** The 758-protocol ledger (spec D12), computed from the snapshot. */
export interface Ledger {
  total: number;
  ranked: number;
  watchlist: number;
  early: number;
  excluded_pre: number;
  excluded_by_category: [string, number][];
  reasons: { category: number; versioned: number; wrapped: number; exchange: number; category_null: number };
  live: number;
  live_mcap_pos: number;
  live_mcap_zero: number;
  live_mcap_neg: number;
  live_mcap_null: number;
  live_shown: number;
  live_not_shown: number;
}

/** One build-time integrity check for the dashboard strip (spec D12). */
export interface IntegrityCheck {
  id: string;
  label: string;
  pass: boolean;
  value: string;
}

/** Everything the dashboard needs: the board, the live set, and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  category_multiples: Readonly<Record<string, number>>;
  fit: FitMetrics;
  odds: OddsMetrics;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  ledger: Ledger;
  verdict_counts: { FARM: number; THIN: number; SKIP: number };
  median_odds: number;
  max_ev: { slug: string; value: number; odds: number };
  /** Stated assumptions and spec constants the dashboard states (D11/D13). */
  assumptions: {
    opportunity_rate: number;
    allocation_share: number;
    verdict_farm: number;
    verdict_thin: number;
    bootstrap_b: number;
    bootstrap_seed: number;
    split_seed: number;
  };
  integrity: IntegrityCheck[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round2 = (n: number): number => Math.round(n * 100) / 100;
const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The D1r category multiple: the table value when the category earned one at
 *  n >= 5 live observations, else the overall median fallback. */
export function categoryMultiple(category: string | null, model: ModelConstants = MODEL): number {
  if (category !== null) {
    const raw = CATEGORY_MULTIPLES[category];
    if (raw !== undefined) return clamp(raw, model.multiple_floor, model.multiple_cap);
  }
  return model.fallback_multiple;
}

/** The multipliers and the implied value one protocol gets under radar-2 (D1r).
 *  Kept as the documented fallback and as the stability-gate comparator. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants = MODEL,
): {
  implied: number;
  baseMultiple: number;
  sizeMult: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const baseMultiple = categoryMultiple(protocol.category, model);
  const sizeMult = clamp(
    (model.size_reference_usd / protocol.tvl_usd) ** model.size_exponent,
    model.size_floor,
    model.size_cap,
  );
  const growthPct = clamp(finite(protocol.change_7d, 0), model.growth_floor, model.growth_cap);
  const growthMult = 1 + (model.growth_weight * growthPct) / 100;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor +
    (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const implied = Math.max(
    1,
    Math.round(protocol.tvl_usd * baseMultiple * sizeMult * growthMult * maturityMult),
  );
  return { implied, baseMultiple, sizeMult, growthPct, growthMult, maturityMult, age };
}

/** The growth and maturity multipliers (D1r terms, unchanged in radar-3). */
export function growthMaturity(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants = MODEL,
): { growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const growthPct = clamp(finite(protocol.change_7d, 0), model.growth_floor, model.growth_cap);
  const growthMult = 1 + (model.growth_weight * growthPct) / 100;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor +
    (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  return { growthPct, growthMult, maturityMult, age };
}

/** The fitted multiple for a protocol under radar-3 (spec D8). */
export function fittedMultiple(protocol: SnapshotProtocol): {
  raw: number;
  multiple: number;
  effect: number;
  atClampBound: boolean;
} {
  const effect = protocol.category !== null ? (FIT.effects[protocol.category] ?? 0) : 0;
  const raw = Math.exp(FIT.intercept + (FIT.slope - 1) * Math.log(protocol.tvl_usd) + effect);
  const multiple = clamp(raw, FIT.multipleFloor, FIT.multipleCap);
  return { raw, multiple, effect, atClampBound: raw < FIT.multipleFloor || raw > FIT.multipleCap };
}

/** The fitted implied value and its breakdown for one protocol (spec D8). */
export function fittedValue(protocol: SnapshotProtocol, asOf: string): {
  implied: number;
  raw: number;
  multiple: number;
  effect: number;
  atClampBound: boolean;
  d1rMultiple: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  age: number | null;
} {
  const fm = fittedMultiple(protocol);
  const gm = growthMaturity(protocol, asOf);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * fm.multiple * gm.growthMult * gm.maturityMult));
  return {
    implied,
    raw: fm.raw,
    multiple: fm.multiple,
    effect: fm.effect,
    atClampBound: fm.atClampBound,
    d1rMultiple: categoryMultiple(protocol.category),
    growthPct: gm.growthPct,
    growthMult: gm.growthMult,
    maturityMult: gm.maturityMult,
    age: gm.age,
  };
}

/** Per-category live counts and the exact live share, for the odds prior. */
export interface PeerStats {
  catTot: Readonly<Record<string, number>>;
  catLive: Readonly<Record<string, number>>;
  liveShare: number;
}

export function peerStats(snapshot: Snapshot): PeerStats {
  const catTot: Record<string, number> = {};
  const catLive: Record<string, number> = {};
  for (const p of snapshot.protocols) {
    const c = p.category ?? '';
    catTot[c] = (catTot[c] ?? 0) + 1;
    if (p.symbol !== null) catLive[c] = (catLive[c] ?? 0) + 1;
  }
  const liveCount = snapshot.protocols.filter((p) => p.symbol !== null).length;
  return { catTot, catLive, liveShare: liveCount / snapshot.protocols.length };
}

/** The launch odds for one protocol (spec D9). `peerShrunk` uses the exact
 *  live share from the snapshot, not the rounded 0.5488 in the spec text —
 *  the rounded share does not reproduce the D9 coefficients to 6 decimals. */
export function oddsValue(
  protocol: SnapshotProtocol,
  asOf: string,
  peers: PeerStats,
): { odds: number; logit: number; ageTerm: number; growthTerm: number; peerLogit: number; peerShrunk: number } {
  const age = ageDays(asOf, protocol.listed_at) ?? MODEL.unknown_age_days;
  const ageTerm = Math.log(age);
  const growthTerm = clamp(finite(protocol.change_7d, 0), MODEL.growth_floor, MODEL.growth_cap) / 100;
  const c = protocol.category ?? '';
  const peerShrunk =
    ((peers.catLive[c] ?? 0) + ODDS.priorWeight * peers.liveShare) /
    ((peers.catTot[c] ?? 0) + ODDS.priorWeight);
  const peerLogit = Math.log(peerShrunk / (1 - peerShrunk));
  const logit = ODDS.intercept + ODDS.age * ageTerm + ODDS.growth * growthTerm + ODDS.peer * peerLogit;
  const odds = 1 / (1 + Math.exp(-logit));
  return { odds, logit, ageTerm, growthTerm, peerLogit, peerShrunk };
}

/** How much capital one farm position needs, from the protocol's own TVL. */
export function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer
 *  qualifying window. */
export function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** Farm netting for one row (spec D11), from tier/hold and the expected
 *  value — never by parsing the English step text. */
export function farmNetting(
  protocol: SnapshotProtocol,
  age: number | null,
  expectedValueUsd: number,
): {
  capitalTier: number;
  holdDays: number;
  weeks: number;
  gasTotal: number;
  opportunity: number;
  totalCost: number;
  breakEvenShare: number;
  hoursActive: number;
  net1bp: number;
  dollarsPerHour: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
} {
  const capitalTier = capitalFor(protocol);
  const holdDays = holdDaysFor(age);
  const weeks = Math.ceil(holdDays / 7);
  const gasCore = capitalTier >= 150 ? 8 : 4;
  const gasTotal = 3 + 2 * gasCore + 2 * weeks;
  const opportunity = round2((capitalTier * OPPORTUNITY_RATE * holdDays) / 365);
  const totalCost = round2(gasTotal + opportunity);
  const breakEvenShare = totalCost / expectedValueUsd;
  const verdict = breakEvenShare <= VERDICT_FARM ? 'FARM' : breakEvenShare <= VERDICT_THIN ? 'THIN' : 'SKIP';
  const hoursActive = (60 + 10 * weeks) / 60;
  const net1bp = round2(expectedValueUsd * ALLOCATION_SHARE - totalCost);
  const dollarsPerHour = round2(net1bp / hoursActive);
  return { capitalTier, holdDays, weeks, gasTotal, opportunity, totalCost, breakEvenShare, hoursActive, net1bp, dollarsPerHour, verdict };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of
 *  another protocol, not a launch of its own. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word of the name is wrapped, staked or staking: a wrapped or
 *  staked asset, not a protocol launch. */
function hasWrappedWord(name: string): boolean {
  return name
    .toLowerCase()
    .split(/[^a-z]+/)
    .some((w) => w === 'wrapped' || w === 'staked' || w === 'staking');
}

/** The name starts with an exchange's name (word boundary after it). */
function startsWithExchange(name: string): boolean {
  const lower = name.toLowerCase();
  return EXCHANGE_NAMES.some(
    (e) => lower === e.toLowerCase() || lower.startsWith(`${e.toLowerCase()} `) || lower.startsWith(`${e.toLowerCase()}.`),
  );
}

/** Whether the snapshot records no token at all for this protocol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether the board may rank this protocol: pre-token, not in an excluded
 *  category, not a versioned pool, not a wrapped/staked asset, not an
 *  exchange's own product. The watchlist rule minus the $50M floor. */
export function isBoardEligible(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    p.category !== null &&
    !EXCLUDED_CATEGORIES.has(p.category) &&
    !VERSIONED.test(p.name) &&
    !hasWrappedWord(p.name) &&
    !startsWithExchange(p.name)
  );
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const peers = peerStats(snapshot);
  const eligible = snapshot.protocols.filter(isBoardEligible);
  const scored = eligible.map((p) => {
    const v = fittedValue(p, snapshot.as_of);
    const o = oddsValue(p, snapshot.as_of, peers);
    const expected = Math.round(v.implied * o.odds);
    const net = farmNetting(p, v.age, expected);
    return { p, v, o, expected, net };
  });
  scored.sort(
    (a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0),
  );
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    model: {
      intercept: FIT.intercept,
      slope: FIT.slope,
      category_effect: s.v.effect,
      fitted_multiple_raw: round6(s.v.raw),
      fitted_multiple: round6(s.v.multiple),
      d1r_multiple: s.v.d1rMultiple,
      growth_pct: round4(s.v.growthPct),
      growth_multiplier: round4(s.v.growthMult),
      maturity_multiplier: round4(s.v.maturityMult),
      age_days: s.v.age,
      at_clamp_bound: s.v.atClampBound,
    },
    odds: s.o.odds,
    expected_value_usd: s.expected,
    peer_shrunk: s.o.peerShrunk,
    peer_logit: s.o.peerLogit,
    // P10/P90/rank range are filled in by buildRadar (bootstrap step).
    p10_usd: s.v.implied,
    p90_usd: s.v.implied,
    rank_lo: i + 1,
    rank_hi: i + 1,
    capital_tier: s.net.capitalTier,
    hold_days: s.net.holdDays,
    gas_total_usd: s.net.gasTotal,
    opportunity_cost_usd: s.net.opportunity,
    farm_cost_usd: s.net.totalCost,
    break_even_share: s.net.breakEvenShare,
    hours_active: s.net.hoursActive,
    net_1bp_usd: s.net.net1bp,
    dollars_per_hour: s.net.dollarsPerHour,
    verdict: s.net.verdict,
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
  }));
}

// ---------------------------------------------------------------------------
// Farm plans: 7 concrete steps per row.
//
// Every step is one string in the shape "<action> Cost: <cost>. Time: <time>."
// Steps 1, 5, 6 and 7 are the same skeleton for every row; steps 2, 3 and 4
// come from the protocol's category family, its primary chain, its TVL tier
// and its age. No step promises a token, an airdrop or a date, and no step
// names a URL. Where token status matters the steps say the protocol
// "records no token".
// ---------------------------------------------------------------------------

/** One category family: its core action, its second action, its weekly action. */
interface Family {
  id: string;
  core: (name: string, capital: number, chain: string) => string;
  second: (name: string, capital: number, chain: string, otherChain: string | null) => string;
  weekly: (name: string, chain: string) => string;
}

const FAMILIES: Family[] = [
  {
    id: 'lending',
    core: (n, c, ch) => `Supply $${c} of USDC to ${n} on ${ch} as collateral and keep the supply position open`,
    second: (n, _c, ch) => `Borrow a small amount of USDC against the supply on ${n} on ${ch}, then repay half of it so both sides of the market show activity`,
    weekly: (n, ch) => `Adjust the supply or the borrow on ${n} on ${ch} by a small amount`,
  },
  {
    id: 'dexs',
    core: (n, c, ch) => `Provide $${c} of liquidity to ${n}'s main pool on ${ch} and keep the position open`,
    second: (n, c, ch, o) => o
      ? `Add liquidity from the same $${c} to a second pool of ${n} on ${o} so the position spans two chains`
      : `Add part of the same $${c} to a second pool of ${n} on ${ch} at a different price range`,
    weekly: (n, ch) => `Swap a small amount through ${n} on ${ch} or rebalance the liquidity position`,
  },
  {
    id: 'yield',
    core: (n, c, ch) => `Deposit $${c} of USDC into ${n}'s yield vault on ${ch} and keep the vault shares`,
    second: (n, _c, ch) => `Harvest the vault yield on ${n} on ${ch} once and compound it back into the same vault`,
    weekly: (n, ch) => `Check the vault yield on ${n} on ${ch} and compound or top up the position by a small amount`,
  },
  {
    id: 'risk-curators',
    core: (n, c, ch) => `Deposit $${c} into a ${n} curator vault on ${ch} and keep the vault shares`,
    second: (n, c, ch, o) => o
      ? `Deposit part of the same $${c} into a different curator vault of ${n} on ${o} so two curators see the wallet`
      : `Deposit part of the same $${c} into a second, different curator vault of ${n} on ${ch}`,
    weekly: (n, ch) => `Review the curator allocation on ${n} on ${ch} and move a small amount between vaults if the mix changed`,
  },
  {
    id: 'rwa',
    core: (n, c, ch) => `Mint $${c} of ${n}'s yield-bearing asset on ${ch} and hold the asset`,
    second: (n, _c, ch) => `Hold the asset through one full yield accrual cycle on ${n} on ${ch} and read its redemption terms before the cycle ends`,
    weekly: (n, ch) => `Check the accrued yield and the redemption terms of the ${n} asset on ${ch}`,
  },
  {
    id: 'bridge',
    core: (n, c, ch) => `Bridge $${c} of USDC to ${ch} through ${n} and hold the bridged funds in the destination app`,
    second: (n, _c, _ch, o) => o
      ? `Use the bridged funds in a named use on ${o}: deposit them into a lending market there and keep the position open`
      : `Bridge a small amount back through ${n} so the wallet shows use in both directions`,
    weekly: (n, ch) => `Bridge a small amount through ${n} to ${ch} and use the funds in the destination app`,
  },
  {
    id: 'staking',
    core: (n, c, ch) => `Stake $${c} of the chain's staking asset through ${n} on ${ch} and keep the staking receipt`,
    second: (n, _c, ch) => `Delegate part of the stake through ${n} on ${ch} to a second validator so the position is not tied to one operator`,
    weekly: (n, ch) => `Check the staking rewards on ${n} on ${ch} and restake a small amount of them`,
  },
  {
    id: 'derivatives',
    core: (n, c, ch) => `Deposit $${c} of USDC as margin on ${n} on ${ch} and open one small hedge against the position`,
    second: (n, _c, ch) => `Close the hedge on ${n} on ${ch} and open a fresh small one in the opposite direction so both sides are exercised`,
    weekly: (n, ch) => `Rebalance the hedge on ${n} on ${ch} by a small amount to keep it near the target size`,
  },
  {
    id: 'stablecoin',
    core: (n, c, ch) => `Mint or deposit $${c} of the stable asset through ${n} on ${ch} and hold the balance`,
    second: (n, _c, ch) => `Redeem a small amount of the stable asset through ${n} on ${ch} and mint it back, so the redemption path is tested`,
    weekly: (n, ch) => `Check the stable asset's peg and balance on ${n} on ${ch} and top it up by a small amount`,
  },
  {
    id: 'insurance',
    core: (n, c, ch) => `Buy $${c} of cover from ${n} on ${ch} and keep the policy active`,
    second: (n, _c, ch) => `Buy a second, smaller cover from ${n} on ${ch} for a different risk so the wallet holds two policies`,
    weekly: (n, ch) => `Check the cover status and expiry on ${n} on ${ch} and renew the nearer policy before it lapses`,
  },
  {
    id: 'payments',
    core: (n, c, ch) => `Send $${c} through ${n} on ${ch} to settle a real payment and keep the receipt`,
    second: (n, _c, ch) => `Set up a second, recurring payment through ${n} on ${ch} for a regular bill so the wallet shows repeat use`,
    weekly: (n, ch) => `Make one payment through ${n} on ${ch} and record the receipt`,
  },
  {
    id: 'chain-governance',
    core: (n, c, ch) => `Use $${c} in ${n}'s main app on ${ch} and keep the position open`,
    second: (n, _c, ch) => `Vote on one live proposal of ${n} on ${ch} with the position, then delegate the vote to a named delegate for the next proposal`,
    weekly: (n, ch) => `Vote or transact once on ${n} on ${ch} and record the proposal or transaction`,
  },
  {
    id: 'prediction-market',
    core: (n, c, ch) => `Buy $${c} of outcome shares on one open market of ${n} on ${ch} and keep the position until the market resolves`,
    second: (n, c, ch) => `Provide liquidity from part of the same $${c} to ${n}'s market-making pool on ${ch} so the position earns trading fees while the market is open`,
    weekly: (n, ch) => `Place one small trade on a market of ${n} on ${ch} that resolves within the next two weeks and record the outcome`,
  },
  {
    id: 'cedefi',
    core: (n, c, ch) => `Deposit $${c} of USDC into a ${n} CeDeFi strategy vault on ${ch} and keep the vault shares`,
    second: (n, c, ch) => `Allocate part of the same $${c} to a second, different strategy of ${n} on ${ch} so the wallet holds two strategies at once`,
    weekly: (n, ch) => `Check the strategy allocation and yield on ${n} on ${ch} and move a small amount between strategies if the mix changed`,
  },
  {
    id: 'anchor-btc',
    core: (n, c, ch) => `Lock $${c} of BTC through ${n} on ${ch} and mint its anchored BTC asset, then hold the minted asset`,
    second: (n, _c, ch, o) => o
      ? `Move part of the minted anchored BTC through ${n} from ${ch} to ${o} so the position spans two chains`
      : `Deposit part of the minted anchored BTC into a second vault of ${n} on ${ch}`,
    weekly: (n, ch) => `Check the yield accrued on the anchored BTC asset of ${n} on ${ch} and compound it back into the position`,
  },
  {
    id: 'decentralized-btc',
    core: (n, c, ch) => `Lock $${c} of BTC through ${n} on ${ch} and mint its decentralized BTC, holding the minted BTC`,
    second: (n, _c, ch) => `Supply the minted decentralized BTC from ${n} to a lending market on ${ch} and keep the supply position open`,
    weekly: (n, ch) => `Check the peg and the redemption queue of the decentralized BTC on ${n} on ${ch} and redeem a small amount to test the redemption path`,
  },
  {
    id: 'otc',
    core: (n, c, ch) => `Place an OTC order for $${c} of USDC through ${n} on ${ch} and settle it through the protocol's escrow, keeping the settlement receipt`,
    second: (n, _c, ch) => `Place a second OTC order through ${n} on ${ch} in the opposite direction, or with a different asset, so the wallet shows two settled trades`,
    weekly: (n, ch) => `Check the open OTC quotes on ${n} on ${ch} and settle one small trade through the escrow`,
  },
  {
    id: 'crypto-card',
    core: (n, c, ch) => `Top up the ${n} card with $${c} of USDC on ${ch} and spend it on one real purchase, keeping the receipt`,
    second: (n, _c, ch) => `Set up a recurring top-up for the ${n} card on ${ch} for a regular bill so the card shows repeat spending`,
    weekly: (n, ch) => `Top up the ${n} card by a small amount on ${ch} and make one purchase with it`,
  },
];

/** The generic fallback family, used only when no family matches a category. */
const FALLBACK_FAMILY: Family = {
  id: 'fallback',
  core: (n, c, ch) => `Deposit $${c} of USDC into ${n} on ${ch} and keep the position open`,
  second: (n, _c, ch) => `Make a second, different deposit into ${n} on ${ch} with a smaller amount from the same funds`,
  weekly: (n, ch) => `Make one qualifying deposit or transaction on ${n} on ${ch}`,
};

/** The family for a category: matched on the category's words, never on a name. */
export function familyOf(category: string | null): Family {
  const c = (category ?? '').toLowerCase();
  const has = (...words: string[]): boolean => words.some((w) => c.includes(w));
  if (has('lend', 'cdp', 'collateral')) return FAMILIES[0]!;
  if (has('dex', 'liquidity manager', 'amm')) return FAMILIES[1]!;
  if (has('yield', 'leveraged farm', 'farm')) return FAMILIES[2]!;
  if (has('curator', 'allocator')) return FAMILIES[3]!;
  if (has('rwa')) return FAMILIES[4]!;
  if (has('bridge', 'cross chain')) return FAMILIES[5]!;
  if (has('staking', 'restak')) return FAMILIES[6]!;
  if (has('derivative', 'basis', 'perpetual', 'options', 'futures')) return FAMILIES[7]!;
  if (has('stable')) return FAMILIES[8]!;
  if (has('insurance')) return FAMILIES[9]!;
  if (has('payment')) return FAMILIES[10]!;
  if (has('prediction')) return FAMILIES[12]!;
  if (has('cedefi')) return FAMILIES[13]!;
  if (has('anchor btc')) return FAMILIES[14]!;
  if (has('decentralized btc')) return FAMILIES[15]!;
  if (has('otc')) return FAMILIES[16]!;
  if (has('card')) return FAMILIES[17]!;
  if (has('chain', 'governance')) return FAMILIES[11]!;
  return FALLBACK_FAMILY;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** A second, different chain when the protocol names one, else null. */
function secondChainOf(p: SnapshotProtocol): string | null {
  if (p.chains.length > 1 && p.chains[1] !== p.chains[0]) return p.chains[1]!;
  return null;
}

/** One step as a single string: its action, then its cost and time. The
 *  action is shortened first if needed, so the Cost/Time tail always survives
 *  and the step never exceeds the gate's 600 characters. */
export function stepText(step: FarmStep): string {
  const tail = ` Cost: ${step.cost}. Time: ${step.time}.`;
  let action = step.text;
  const maxAction = 600 - tail.length;
  if (action.length > maxAction) action = `${action.slice(0, Math.max(0, maxAction - 3))}...`;
  let s = `${action}${tail}`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** A protocol's farm plan: seven steps, shaped by its family, chain, TVL
 *  tier and age. */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const otherChain = secondChainOf(p);
  const capital = capitalFor(p);
  const gas = capital >= 150 ? 8 : 4;
  const hold = holdDaysFor(age);
  const family = familyOf(p.category);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm for ${p.name}, which records no token, and keep its seed phrase offline`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: family.core(p.name, capital, chain),
      cost: `$${capital} of capital and about $${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: family.second(p.name, capital, chain, otherChain),
      cost: `about $${gas} of gas and no new capital`,
      time: '15 minutes',
    },
    {
      text: `${family.weekly(p.name, chain)}`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position in ${p.name} on ${chain} for at least ${hold} days so the activity spans more than one snapshot`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Open ${p.name}'s own points or rewards page from the protocol's own site and claim only from the link it publishes; never pay to claim`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction hash for ${p.name} in a farm log so you can repeat the position or unwind it`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's live view.
 *  Positive market cap only; never mixed into the ranked board. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd as number,
      change_7d: p.change_7d,
    }));
}

// ---------------------------------------------------------------------------
// Held-out validation, horse race, odds fit, ledger (all computed here from
// the snapshot; the dashboard renders these numbers from data.js, and the
// verify suite recomputes them with its own independent code).
// ---------------------------------------------------------------------------

const Z_90 = 1.2816; // P10–P90 half-width in residual SDs
const SPLIT_SEED = 20261122;
const SPLIT_TEST_SIZE = 38;

/** The 128 live-token fit rows and their design (spec D8). */
export function liveDesign(snapshot: Snapshot): {
  live: SnapshotProtocol[];
  big: string[];
  X: number[][];
  y: number[];
} {
  const live = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const catN: Record<string, number> = {};
  for (const p of live) catN[p.category ?? ''] = (catN[p.category ?? ''] ?? 0) + 1;
  const big = Object.entries(catN)
    .filter(([, n]) => n >= 5)
    .map(([c]) => c)
    .sort();
  const design = (p: SnapshotProtocol): number[] => [
    1,
    Math.log(p.tvl_usd),
    ...big.map((c) => (p.category === c ? 1 : 0)),
  ];
  return { live, big, X: live.map(design), y: live.map((p) => Math.log(p.mcap_usd!)) };
}

/** The seeded 70/30 split: Fisher–Yates over the live rows with mulberry32
 *  seed 20261122; the FIRST 38 of the shuffled order are the test set
 *  (the spec-time convention — the split median 1.1740 reproduces only with
 *  this partition, not with the last 38). */
export function splitIndices(n: number): { train: number[]; test: number[] } {
  const rng = mulberry32(SPLIT_SEED);
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [idx[i], idx[j]] = [idx[j]!, idx[i]!];
  }
  return { test: idx.slice(0, SPLIT_TEST_SIZE), train: idx.slice(SPLIT_TEST_SIZE) };
}

/** The D1r log-prediction for one protocol from a training set's medians
 *  (the honest LOO for the median model: the held-out row's own ratio never
 *  enters its prediction). */
function d1rLogPred(train: SnapshotProtocol[], p: SnapshotProtocol, asOf: string): number {
  const pos = train.filter((q) => q.mcap_usd !== null && q.mcap_usd > 0);
  const byCat: Record<string, number[]> = {};
  for (const q of pos) (byCat[q.category ?? ''] ??= []).push(q.mcap_usd! / q.tvl_usd);
  const overall = median(pos.map((q) => q.mcap_usd! / q.tvl_usd));
  let base = overall;
  if (p.category !== null && byCat[p.category] && byCat[p.category]!.length >= 5) {
    base = clamp(median(byCat[p.category]!), MODEL.multiple_floor, MODEL.multiple_cap);
  }
  const gm = growthMaturity(p, asOf);
  const size = clamp((MODEL.size_reference_usd / p.tvl_usd) ** MODEL.size_exponent, MODEL.size_floor, MODEL.size_cap);
  return Math.log(Math.max(1, Math.round(p.tvl_usd * base * size * gm.growthMult * gm.maturityMult)));
}

function looStats(errs: number[]): { median: number; rmse: number } {
  return { median: median(errs), rmse: Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / errs.length) };
}

/** The full held-out evidence for the fitted model + the horse race. */
export function fitValidation(snapshot: Snapshot): {
  beta: number[];
  r2: number;
  residSd: number;
  looMedian: number;
  looRmse: number;
  splitMedian: number;
  looCoverage: number;
  splitCoverage: number;
  horseRace: HorseRaceRow[];
} {
  const { live, big, X, y } = liveDesign(snapshot);
  const n = live.length;
  const k = X[0]!.length;
  const beta = ols(X, y);
  const pred = X.map((r) => dot(r, beta));
  const resid = y.map((v, i) => v - pred[i]!);
  const yMean = y.reduce((a, b) => a + b, 0) / n;
  const ssTot = y.reduce((s, v) => s + (v - yMean) ** 2, 0);
  const ssRes = resid.reduce((s, v) => s + v * v, 0);
  const r2 = 1 - ssRes / ssTot;
  const residSd = Math.sqrt(ssRes / (n - k));

  // LOO for V1 (refit without the held-out row).
  const looErr: number[] = [];
  const looPred: number[] = [];
  for (let h = 0; h < n; h++) {
    const bh = ols(
      X.filter((_, i) => i !== h),
      y.filter((_, i) => i !== h),
    );
    const ph = dot(X[h]!, bh);
    looPred.push(ph);
    looErr.push(Math.abs(y[h]! - ph));
  }
  const { median: looMedian, rmse: looRmse } = looStats(looErr);
  const looCoverage = looErr.filter((e) => e <= Z_90 * looRmse).length / n;

  // 70/30 split (seeded; test = first 38 of the shuffled order).
  const { train, test } = splitIndices(n);
  const bSplit = ols(
    train.map((i) => X[i]!),
    train.map((i) => y[i]!),
  );
  const splitErr = test.map((i) => Math.abs(y[i]! - dot(X[i]!, bSplit)));
  const splitMedian = median(splitErr);
  const splitCoverage = splitErr.filter((e) => e <= Z_90 * looRmse).length / test.length;

  // Horse race: V0 D1r, V1 fitted (this model), V2 slope 0.90, V3 slope 1.00,
  // V4 V2 + fitted growth coefficient. Each: LOO median/RMSE + split median.
  const growthC = (p: SnapshotProtocol): number => clamp(p.change_7d ?? 0, -40, 60) / 100;
  const horseRace: HorseRaceRow[] = [];
  const addRace = (variant: string, loo: number[], split: number[]): void => {
    const s = looStats(loo);
    horseRace.push({ variant, loo_median: s.median, loo_rmse: s.rmse, split_median: median(split) });
  };
  // V0: D1r, LOO medians refit without the held-out row.
  {
    const errs = live.map((h, i) => Math.abs(Math.log(h.mcap_usd!) - d1rLogPred(live.filter((_, j) => j !== i), h, snapshot.as_of)));
    const splitErrs = test.map((i) => {
      const tr = train.map((t) => live[t]!);
      return Math.abs(Math.log(live[i]!.mcap_usd!) - d1rLogPred(tr, live[i]!, snapshot.as_of));
    });
    addRace('V0 D1r (median model)', errs, splitErrs);
  }
  // V1: the fitted model (already computed above).
  addRace('V1 radar-3 (free slope + 9 dummies)', looErr, splitErr);
  // V2/V3: slope fixed, outcome ln(mcap) - s0*ln(TVL), OLS intercept + dummies.
  for (const [variant, s0] of [
    ['V2 slope fixed 0.90', 0.9],
    ['V3 slope fixed 1.00', 1.0],
  ] as const) {
    const Xf = live.map((p) => [1, ...big.map((c) => (p.category === c ? 1 : 0))]);
    const yf = live.map((p) => Math.log(p.mcap_usd!) - s0 * Math.log(p.tvl_usd));
    const errs: number[] = [];
    for (let h = 0; h < n; h++) {
      const bh = ols(
        Xf.filter((_, i) => i !== h),
        yf.filter((_, i) => i !== h),
      );
      errs.push(Math.abs(Math.log(live[h]!.mcap_usd!) - (s0 * Math.log(live[h]!.tvl_usd) + dot(Xf[h]!, bh))));
    }
    const bS = ols(
      train.map((i) => Xf[i]!),
      train.map((i) => yf[i]!),
    );
    const splitErrs = test.map((i) => Math.abs(yf[i]! - dot(Xf[i]!, bS)));
    addRace(variant, errs, splitErrs);
  }
  // V4: V2 + fitted growth coefficient.
  {
    const Xf = live.map((p) => [1, ...big.map((c) => (p.category === c ? 1 : 0)), growthC(p)]);
    const yf = live.map((p) => Math.log(p.mcap_usd!) - 0.9 * Math.log(p.tvl_usd));
    const errs: number[] = [];
    for (let h = 0; h < n; h++) {
      const bh = ols(
        Xf.filter((_, i) => i !== h),
        yf.filter((_, i) => i !== h),
      );
      errs.push(Math.abs(Math.log(live[h]!.mcap_usd!) - (0.9 * Math.log(live[h]!.tvl_usd) + dot(Xf[h]!, bh))));
    }
    const bS = ols(
      train.map((i) => Xf[i]!),
      train.map((i) => yf[i]!),
    );
    const splitErrs = test.map((i) => Math.abs(yf[i]! - dot(Xf[i]!, bS)));
    addRace('V4 V2 + fitted growth', errs, splitErrs);
  }

  return { beta, r2, residSd, looMedian, looRmse, splitMedian, looCoverage, splitCoverage, horseRace };
}

/** IRLS logistic fit for the odds model (spec D9). Returns the coefficients
 *  and the iteration count. The verify suite carries its own copy. */
export function irlsOdds(snapshot: Snapshot): { beta: number[]; iters: number } {
  const peers = peerStats(snapshot);
  const X = snapshot.protocols.map((p) => {
    const age = ageDays(snapshot.as_of, p.listed_at) ?? MODEL.unknown_age_days;
    const growthTerm = clamp(finite(p.change_7d, 0), MODEL.growth_floor, MODEL.growth_cap) / 100;
    const c = p.category ?? '';
    const ps = ((peers.catLive[c] ?? 0) + ODDS.priorWeight * peers.liveShare) / ((peers.catTot[c] ?? 0) + ODDS.priorWeight);
    return [1, Math.log(age), growthTerm, Math.log(ps / (1 - ps))];
  });
  const y = snapshot.protocols.map((p) => (p.symbol !== null ? 1 : 0));
  let w = [0, 0, 0, 0];
  let iters = 0;
  for (let it = 0; it < 100; it++) {
    iters = it + 1;
    const W: number[] = [];
    const z: number[] = [];
    for (let i = 0; i < X.length; i++) {
      const eta = dot(X[i]!, w);
      const mu = 1 / (1 + Math.exp(-clamp(eta, -30, 30)));
      const v = Math.max(mu * (1 - mu), 1e-9);
      W.push(v);
      z.push(eta + (y[i]! - mu) / v);
    }
    const kk = 4;
    const XtWX: number[][] = Array.from({ length: kk }, () => new Array<number>(kk).fill(0));
    const XtWz: number[] = new Array<number>(kk).fill(0);
    for (let i = 0; i < X.length; i++) {
      for (let a = 0; a < kk; a++) {
        XtWz[a]! += W[i]! * X[i]![a]! * z[i]!;
        for (let b = 0; b < kk; b++) XtWX[a]![b]! += W[i]! * X[i]![a]! * X[i]![b]!;
      }
    }
    const nw = solve(XtWX, XtWz);
    const delta = Math.max(...nw.map((v, i) => Math.abs(v - w[i]!)));
    w = nw;
    if (delta < 1e-10) break;
  }
  return { beta: w, iters };
}

/** AUC (Mann–Whitney, tie-averaged ranks) of the odds score over all 758. */
export function oddsAuc(snapshot: Snapshot): { auc: number; meanLive: number; meanPre: number } {
  const peers = peerStats(snapshot);
  const scored = snapshot.protocols
    .map((p) => ({ s: oddsValue(p, snapshot.as_of, peers).odds, y: p.symbol !== null ? 1 : 0 }))
    .sort((a, b) => a.s - b.s);
  let rankSum1 = 0;
  let n1 = 0;
  let n0 = 0;
  let i = 0;
  while (i < scored.length) {
    let j = i;
    while (j + 1 < scored.length && scored[j + 1]!.s === scored[i]!.s) j++;
    const avgRank = (i + 1 + j + 1) / 2;
    for (let k = i; k <= j; k++) if (scored[k]!.y === 1) rankSum1 += avgRank;
    i = j + 1;
  }
  for (const r of scored) {
    if (r.y === 1) n1++;
    else n0++;
  }
  const auc = (rankSum1 - (n1 * (n1 + 1)) / 2) / (n1 * n0);
  const liveOdds = scored.filter((r) => r.y === 1).map((r) => r.s);
  const preOdds = scored.filter((r) => r.y === 0).map((r) => r.s);
  return {
    auc,
    meanLive: liveOdds.reduce((a, b) => a + b, 0) / liveOdds.length,
    meanPre: preOdds.reduce((a, b) => a + b, 0) / preOdds.length,
  };
}

/** The D8 stability gate: top-10 overlap of the fitted ranking vs the D1r
 *  ranking, and whether the rank-1 slug is unchanged. */
export function stabilityGate(board: BoardRow[], snapshot: Snapshot): { overlap: number; rank1: string; rank1D1r: string; pass: boolean } {
  const d1r = snapshot.protocols
    .filter(isBoardEligible)
    .map((p) => ({ slug: p.slug, v: impliedValue(p, snapshot.as_of).implied }))
    .sort((a, b) => b.v - a.v || (a.slug < b.slug ? -1 : 1));
  const top10fit = board.slice(0, 10).map((r) => r.slug);
  const top10d1r = d1r.slice(0, 10).map((r) => r.slug);
  const overlap = top10fit.filter((s) => top10d1r.includes(s)).length;
  const rank1 = board[0]!.slug;
  const rank1D1r = d1r[0]!.slug;
  return { overlap, rank1, rank1D1r, pass: overlap >= 7 && rank1 === rank1D1r };
}

/** The 758-protocol ledger (spec D12), computed from the snapshot. */
export function buildLedger(snapshot: Snapshot, board: BoardRow[]): Ledger {
  const pre = snapshot.protocols.filter(isPreToken);
  const live = snapshot.protocols.filter((p) => !isPreToken(p));
  const boardSlugs = new Set(board.map((r) => r.slug));
  const excluded = pre.filter((p) => !boardSlugs.has(p.slug));
  const byCat: Record<string, number> = {};
  for (const p of excluded) byCat[p.category ?? ''] = (byCat[p.category ?? ''] ?? 0) + 1;
  const excludedByCategory = Object.entries(byCat)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)) as [string, number][];
  const reasons = { category: 0, versioned: 0, wrapped: 0, exchange: 0, category_null: 0 };
  for (const p of excluded) {
    if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) reasons.category++;
    if (VERSIONED.test(p.name)) reasons.versioned++;
    if (hasWrappedWord(p.name)) reasons.wrapped++;
    if (startsWithExchange(p.name)) reasons.exchange++;
    if (p.category === null) reasons.category_null++;
  }
  const watchlist = new Set(snapshot.watchlist);
  return {
    total: snapshot.protocols.length,
    ranked: board.length,
    watchlist: board.filter((r) => watchlist.has(r.slug)).length,
    early: board.filter((r) => !watchlist.has(r.slug)).length,
    excluded_pre: excluded.length,
    excluded_by_category: excludedByCategory,
    reasons,
    live: live.length,
    live_mcap_pos: live.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0).length,
    live_mcap_zero: live.filter((p) => p.mcap_usd === 0).length,
    live_mcap_neg: live.filter((p) => p.mcap_usd !== null && p.mcap_usd < 0).length,
    live_mcap_null: live.filter((p) => p.mcap_usd === null).length,
    live_shown: LIVE_ROWS,
    live_not_shown: live.length - LIVE_ROWS,
  };
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow, watchlist: ReadonlySet<string>): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    model: row.model,
    odds: row.odds,
    expected_value_usd: row.expected_value_usd,
    peer_shrunk: row.peer_shrunk,
    peer_logit: row.peer_logit,
    p10_usd: row.p10_usd,
    p90_usd: row.p90_usd,
    rank_lo: row.rank_lo,
    rank_hi: row.rank_hi,
    capital_tier: row.capital_tier,
    hold_days: row.hold_days,
    gas_total_usd: row.gas_total_usd,
    opportunity_cost_usd: row.opportunity_cost_usd,
    farm_cost_usd: row.farm_cost_usd,
    break_even_share: row.break_even_share,
    hours_active: row.hours_active,
    net_1bp_usd: row.net_1bp_usd,
    dollars_per_hour: row.dollars_per_hour,
    verdict: row.verdict,
    farm_steps: row.farm_steps,
    watchlist: watchlist.has(row.slug),
  };
}

/** Validation results the build (and main.ts) check before shipping radar-3.
 *  A failed check fails the build loudly — there is no silent fallback to
 *  D1r under radar-3 branding. */
export interface BuildValidation {
  fitBeta: number[];
  fitMaxDelta: number;
  fitMatches6dp: boolean;
  oddsBeta: number[];
  oddsMaxDelta: number;
  oddsMatches6dp: boolean;
  oddsIters: number;
  stability: { overlap: number; rank1: string; rank1D1r: string; pass: boolean };
  ledgerOk: boolean;
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): { board: BoardRow[]; radar: RadarData; fallbackRows: number; validation: BuildValidation } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watchlist.has(r.slug)).length;
  const fallbackRows = board.filter((r) => familyOf(r.category).id === 'fallback').length;

  // Bootstrap (spec D10): intervals + rank ranges on the ranked board.
  const { live: liveFit, big, X, y } = liveDesign(snapshot);
  const boot = bootstrapIntervals(
    X,
    y,
    big,
    board.map((r) => {
      const p = snapshot.protocols.find((q) => q.slug === r.slug)!;
      const gm = growthMaturity(p, snapshot.as_of);
      return { slug: r.slug, tvl_usd: r.tvl_usd, category: r.category, growthMult: gm.growthMult, maturityMult: gm.maturityMult };
    }),
  );
  for (const r of board) {
    const b = boot.get(r.slug)!;
    r.p10_usd = b.p10_usd;
    r.p90_usd = b.p90_usd;
    r.rank_lo = b.rank_lo;
    r.rank_hi = b.rank_hi;
  }

  // Held-out evidence + horse race (spec D8).
  const val = fitValidation(snapshot);
  const fit: FitMetrics = {
    intercept: FIT.intercept,
    slope: FIT.slope,
    effects: FIT.effects,
    n: liveFit.length,
    df: liveFit.length - val.beta.length,
    r2: val.r2,
    resid_sd: val.residSd,
    loo_median: val.looMedian,
    loo_rmse: val.looRmse,
    split_median: val.splitMedian,
    loo_coverage: val.looCoverage,
    split_coverage: val.splitCoverage,
    horse_race: val.horseRace,
  };

  // Odds evidence (spec D9).
  const peers = peerStats(snapshot);
  const { beta: oddsBeta, iters: oddsIters } = irlsOdds(snapshot);
  const { auc, meanLive, meanPre } = oddsAuc(snapshot);
  const oddsMetrics: OddsMetrics = {
    intercept: ODDS.intercept,
    age: ODDS.age,
    growth: ODDS.growth,
    peer: ODDS.peer,
    prior_weight: ODDS.priorWeight,
    live_share: peers.liveShare,
    auc,
    mean_live: meanLive,
    mean_pre: meanPre,
  };

  const ledger = buildLedger(snapshot, board);
  const verdictCounts = { FARM: 0, THIN: 0, SKIP: 0 };
  for (const r of board) verdictCounts[r.verdict]++;
  const medianOdds = median(board.map((r) => r.odds));
  const maxEvRow = board.reduce((a, b) => (b.expected_value_usd > a.expected_value_usd ? b : a), board[0]!);
  const stability = stabilityGate(board, snapshot);

  // Validation vs the hardcoded constants (6 decimals, spec D14/V15/V16).
  const fitExpected = [FIT.intercept, FIT.slope, ...Object.keys(FIT.effects).sort().map((c) => FIT.effects[c]!)];
  // NOTE: val.beta is ordered [intercept, slope, ...BIG sorted]; FIT.effects
  // sorted by key gives the same order as BIG (alphabetical).
  const fitMaxDelta = Math.max(...val.beta.map((v, i) => Math.abs(v - fitExpected[i]!)));
  const fitMatches6dp = val.beta.every((v, i) => v.toFixed(6) === fitExpected[i]!.toFixed(6));
  const oddsExpected = [ODDS.intercept, ODDS.age, ODDS.growth, ODDS.peer];
  const oddsMaxDelta = Math.max(...oddsBeta.map((v, i) => Math.abs(v - oddsExpected[i]!)));
  const oddsMatches6dp = oddsBeta.every((v, i) => v.toFixed(6) === oddsExpected[i]!.toFixed(6));
  const ledgerOk =
    ledger.total === ledger.ranked + ledger.excluded_pre + ledger.live &&
    ledger.ranked === ledger.watchlist + ledger.early &&
    ledger.live === ledger.live_mcap_pos + ledger.live_mcap_zero + ledger.live_mcap_neg + ledger.live_mcap_null;

  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    category_multiples: CATEGORY_MULTIPLES,
    fit,
    odds: oddsMetrics,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    ledger,
    verdict_counts: verdictCounts,
    median_odds: medianOdds,
    max_ev: { slug: maxEvRow.slug, value: maxEvRow.expected_value_usd, odds: maxEvRow.odds },
    assumptions: {
      opportunity_rate: OPPORTUNITY_RATE,
      allocation_share: ALLOCATION_SHARE,
      verdict_farm: VERDICT_FARM,
      verdict_thin: VERDICT_THIN,
      bootstrap_b: BOOTSTRAP_B,
      bootstrap_seed: BOOTSTRAP_SEED,
      split_seed: SPLIT_SEED,
    },
    integrity: [],
    rows: board.map((r) => radarRow(r, watchlist)),
    live,
  };
  return {
    board,
    radar,
    fallbackRows,
    validation: {
      fitBeta: val.beta,
      fitMaxDelta,
      fitMatches6dp,
      oddsBeta,
      oddsMaxDelta,
      oddsMatches6dp,
      oddsIters,
      stability,
      ledgerOk,
    },
  };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SnapshotError('snapshot.json is not a JSON object');
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) {
    throw new SnapshotError('snapshot.json has no as_of date');
  }
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) {
    throw new SnapshotError('snapshot.json has no floor_usd');
  }
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  }
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    }
    const p = v as Record<string, unknown>;
    if (
      typeof p.slug !== 'string' ||
      typeof p.name !== 'string' ||
      typeof p.tvl_usd !== 'number' ||
      !Number.isFinite(p.tvl_usd)
    ) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks,
 *  order, one shared implied value, farm-step shape, and live separation. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) {
    return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  }
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `row ${i + 1} outranks row ${i} on implied value`;
    }
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (r.token_status !== 'pre-token') return `${r.slug} is not a pre-token row`;
    if (r.mcap_usd !== null || r.gecko_id !== null || r.symbol !== null) {
      return `${r.slug} records a token and must not be on the board`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (!(r.odds > 0 && r.odds < 1)) return `${r.slug} has odds ${r.odds}`;
    if (!Number.isSafeInteger(r.expected_value_usd) || r.expected_value_usd < 0) {
      return `${r.slug} has expected value ${r.expected_value_usd}`;
    }
    if (!(r.p10_usd <= r.implied_value_usd && r.implied_value_usd <= r.p90_usd)) {
      return `${r.slug} has implied $${r.implied_value_usd} outside its P10–P90 [$${r.p10_usd}, $${r.p90_usd}]`;
    }
    if (!(r.rank_lo <= r.rank && r.rank <= r.rank_hi)) {
      return `${r.slug} has rank ${r.rank} outside its rank range [${r.rank_lo}, ${r.rank_hi}]`;
    }
    if (!['FARM', 'THIN', 'SKIP'].includes(r.verdict)) return `${r.slug} has verdict ${r.verdict}`;
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
      if (!s.includes('Cost:') || !s.includes('Time:')) return `${r.slug} has a farm step without a cost or a time`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch
 *  and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
