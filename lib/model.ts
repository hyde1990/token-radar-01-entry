// Token Radar, model radar-2.
//
// One sealed snapshot in, one ranked board out. Every board row is scored by the
// same pure function of that protocol's own snapshot figures plus the live-token
// medians below. No protocol name or slug is ever special-cased: the same code
// scores every row, and the constants are stated here with their evidence.
//
// The evidence (medians of mcap/TVL among live-token protocols with a positive
// market cap, computed from the sealed snapshot, as_of 2026-11-14, strict filter
// mcap_usd > 0 — spec D1r; the -1 sentinel and the 15 zero-mcap rows are excluded):
//   overall median 0.214 (n = 128). By category, n >= 5 only:
//   Lending 0.132 (n = 15), Yield 0.191 (n = 9), RWA 0.275 (n = 9),
//   Dexs 0.342 (n = 11), Bridge 0.557 (n = 6), Basis Trading 0.654 (n = 7),
//   Canonical Bridge 0.746 (n = 8), CEX 0.075 (n = 9), Liquid Staking 0.041 (n = 9).
// Categories with fewer than 5 live observations get no multiple of their own:
// a single protocol must never set the value of a whole watchlist category
// (Risk Curators has n = 1, Onchain Capital Allocator n = 3). Every multiple is
// clamped to [0.08, 0.60], so the category spread is 7.5x, not the raw 18x.
//
//   age_days        = days(as_of - listed_at); null listed_at -> 365
//   m_cat           = category multiple (table below; fallback 0.214)
//   size_mult       = clamp((50_000_000 / tvl_usd) ^ 0.10, 0.70, 1.30)
//   growth_pct      = clamp(change_7d ?? 0, -40, +60)
//   growth_mult     = 1 + 0.60 * growth_pct / 100
//   maturity_mult   = 0.70 + 0.30 * min(age_days, 1095) / 1095
//   implied_value   = max(1, round(tvl_usd * m_cat * size_mult * growth_mult * maturity_mult))
//
// Why these shapes: the mean mcap/TVL (5.0) is outlier-driven, so medians rule;
// the size dampener is mild (exponent 0.10) because the raw band medians are
// confounded by category mix, and it keeps implied value strictly increasing in
// TVL (it scales as TVL^0.9); the growth clamp binds almost only on early rows
// (the watchlist's 7d range is -28.5% to +11.2%); maturity is a gentle survival
// premium because youth is already rewarded through growth.

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

/** The radar-2 constants, as the dashboard states them. */
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

export const MODEL_VERSION = 'radar-2';

/** Live-token rows the dashboard's separate live view carries, by market cap. */
export const LIVE_ROWS = 24;

/** Category multiples: median mcap/TVL among live-token protocols with a
 *  positive market cap (strict mcap_usd > 0, spec D1r), n >= 5, clamped to
 *  [0.08, 0.60]. Anything not listed here falls back to the overall median 0.214. */
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
  model: {
    base_multiple: number;
    size_multiplier: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
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

/** Everything the dashboard needs: the board, the live set, and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  category_multiples: Readonly<Record<string, number>>;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
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

/** The category multiple: the table value when the category earned one at
 *  n >= 5 live observations, else the overall median fallback. */
export function categoryMultiple(category: string | null, model: ModelConstants = MODEL): number {
  if (category !== null) {
    const raw = CATEGORY_MULTIPLES[category];
    if (raw !== undefined) return clamp(raw, model.multiple_floor, model.multiple_cap);
  }
  return model.fallback_multiple;
}

/** The multipliers and the implied value one protocol gets under radar-2. */
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
  const eligible = snapshot.protocols.filter(isBoardEligible);
  const scored = eligible.map((p) => ({ p, v: impliedValue(p, snapshot.as_of, model) }));
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
      base_multiple: s.v.baseMultiple,
      size_multiplier: round4(s.v.sizeMult),
      growth_pct: round4(s.v.growthPct),
      growth_multiplier: round4(s.v.growthMult),
      maturity_multiplier: round4(s.v.maturityMult),
      age_days: s.v.age,
    },
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

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer
 *  qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
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
    farm_steps: row.farm_steps,
    watchlist: watchlist.has(row.slug),
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): { board: BoardRow[]; radar: RadarData; fallbackRows: number } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watchlist.has(r.slug)).length;
  const fallbackRows = board.filter((r) => familyOf(r.category).id === 'fallback').length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    category_multiples: CATEGORY_MULTIPLES,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map((r) => radarRow(r, watchlist)),
    live,
  };
  return { board, radar, fallbackRows };
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
