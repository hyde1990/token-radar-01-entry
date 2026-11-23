// Deterministic bootstrap for radar-7 (spec D10, ranking key updated T1).
//
// B = 200 refits of the radar-7 fitted model (intercept + ln(TVL) only —
// the additive ablation kept no category term, so there are no dummies
// to re-derive per resample). Each refit resamples the 128
// live-token rows with replacement, refits the 2-parameter OLS, and
// predicts the fitted value for every board row
// with growth/maturity held fixed and odds NOT refit. Rows are re-ranked
// within each refit by predicted EXPECTED value (predicted fitted × the
// row's fixed odds; ties: slug ascending), because the board itself is
// ranked by implied value — fitted × odds — since radar-6. P10–P90 stay
// fitted-value intervals (the 20th/180th sorted predicted fitted values).
// PRNG is mulberry32, seed 20261122. Quantiles: P10 = index 19, P90 =
// index 179 of the 200 sorted values (0-based). Rank range = [min, max]
// rank across the 200 refits.
import { mulberry32, olsBootstrap } from './ols.ts';

export interface BootstrapInput {
  slug: string;
  tvl_usd: number;
  category: string | null;
  growthMult: number;
  maturityMult: number;
  /** Fixed launch odds: the refit re-ranks by predicted expected value. */
  odds: number;
}

export interface BootstrapResult {
  p10_usd: number;
  p90_usd: number;
  rank_lo: number;
  rank_hi: number;
  /** Refits whose predicted value equals the collapsed P10 (= P90), when the
   *  interval collapsed; null otherwise. Never 200/200 by assumption — the
   *  count is measured, e.g. 198/200 for steakhouse-financial (radar-4 T4). */
  stable_refits: number | null;
}

export const BOOTSTRAP_B = 200;
export const BOOTSTRAP_SEED = 20261122;

/**
 * Run the bootstrap. `design`/`y` are the full-sample live-token design
 * rows and ln(mcap) outcomes; `big` is the dummy-category list in the
 * same order as the design's dummy columns — empty in radar-7 (the
 * shipped design has no dummies). Returns one result per board row,
 * in the same order as `rows`.
 */
export function bootstrapIntervals(
  design: readonly (readonly number[])[],
  y: readonly number[],
  big: readonly string[],
  rows: readonly BootstrapInput[],
): Map<string, BootstrapResult> {
  const rng = mulberry32(BOOTSTRAP_SEED);
  const values: number[][] = rows.map(() => []);
  const ranks: number[][] = rows.map(() => []);
  for (let b = 0; b < BOOTSTRAP_B; b++) {
    const sample: number[] = [];
    for (let i = 0; i < design.length; i++) sample.push(Math.floor(rng() * design.length));
    const beta = olsBootstrap(
      sample.map((i) => design[i]!),
      sample.map((i) => y[i]!),
    );
    const preds = rows.map((r) => {
      const eff = r.category !== null && big.includes(r.category) ? beta[2 + big.indexOf(r.category)]! : 0;
      const raw = Math.exp(beta[0]! + (beta[1]! - 1) * Math.log(r.tvl_usd) + eff);
      const multiple = Math.min(0.6, Math.max(0.08, raw));
      return Math.max(1, Math.round(r.tvl_usd * multiple * r.growthMult * r.maturityMult));
    });
    // Rank by predicted implied value (predicted fitted × fixed odds), not fitted.
    const evs = preds.map((v, i) => v * rows[i]!.odds);
    const order = evs
      .map((v, i) => i)
      .sort((i, j) => evs[j]! - evs[i]! || (rows[i]!.slug < rows[j]!.slug ? -1 : 1));
    order.forEach((ri, pos) => {
      values[ri]!.push(preds[ri]!);
      ranks[ri]!.push(pos + 1);
    });
  }
  const out = new Map<string, BootstrapResult>();
  rows.forEach((r, i) => {
    const vs = [...values[i]!].sort((a, b) => a - b);
    const collapsed = vs[19] === vs[179];
    out.set(r.slug, {
      p10_usd: vs[19]!,
      p90_usd: vs[179]!,
      rank_lo: Math.min(...ranks[i]!),
      rank_hi: Math.max(...ranks[i]!),
      stable_refits: collapsed ? values[i]!.filter((v) => v === vs[19]).length : null,
    });
  });
  return out;
}
