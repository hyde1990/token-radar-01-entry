// Deterministic bootstrap for radar-3 (spec D10).
//
// B = 200 refits of the V1 fitted model. Each refit resamples the 128
// live-token rows with replacement, refits the 11-parameter OLS (design
// fixed from the full sample — the nine BIG categories are not re-derived
// per resample), and predicts the fitted implied value for every board row
// with growth/maturity held fixed and odds NOT refit. Rows are re-ranked
// within each refit by predicted implied value (ties: slug ascending).
// PRNG is mulberry32, seed 20261122. Quantiles: P10 = index 19, P90 =
// index 179 of the 200 sorted values (0-based). Rank range = [min, max]
// rank across the 200 refits.
//
// A resample can draw no row of a category (Bridge, n=6, in refits 10 and
// 184 at this seed): that dummy is unidentified, so olsBootstrap drops the
// column and returns effect 0 for it (see lib/ols.ts). The spec-time script
// divided by the zero pivot instead and produced all-NaN betas for those
// refits; its published D10 numbers are that artifact (its rank ranges are
// alphabetical ranks — steakhouse [1,152] is its alphabetical rank). This
// implementation reports the honest bootstrap; entry/BUILD.md (radar-3)
// carries the full evidence.
import { mulberry32, olsBootstrap } from './ols.ts';

export interface BootstrapInput {
  slug: string;
  tvl_usd: number;
  category: string | null;
  growthMult: number;
  maturityMult: number;
}

export interface BootstrapResult {
  p10_usd: number;
  p90_usd: number;
  rank_lo: number;
  rank_hi: number;
}

export const BOOTSTRAP_B = 200;
export const BOOTSTRAP_SEED = 20261122;

/**
 * Run the bootstrap. `design`/`y` are the full-sample live-token design
 * rows and ln(mcap) outcomes; `big` is the nine BIG categories in the same
 * order as the design's dummy columns. Returns one result per board row,
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
    const order = preds
      .map((v, i) => i)
      .sort((i, j) => preds[j]! - preds[i]! || (rows[i]!.slug < rows[j]!.slug ? -1 : 1));
    order.forEach((ri, pos) => {
      values[ri]!.push(preds[ri]!);
      ranks[ri]!.push(pos + 1);
    });
  }
  const out = new Map<string, BootstrapResult>();
  rows.forEach((r, i) => {
    const vs = [...values[i]!].sort((a, b) => a - b);
    out.set(r.slug, {
      p10_usd: vs[19]!,
      p90_usd: vs[179]!,
      rank_lo: Math.min(...ranks[i]!),
      rank_hi: Math.max(...ranks[i]!),
    });
  });
  return out;
}
