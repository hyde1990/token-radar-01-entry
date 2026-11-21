// Small numeric helpers for radar-3: OLS via normal equations, a seeded PRNG,
// and medians. Standard library only, no randomness outside the seeded PRNG.
// The OLS solver is written here once and used by main.ts for the held-out
// reporting and the bootstrap; scripts/verify.mjs carries its own independent
// copy, so a bug here cannot hide from the verification suite.

/** mulberry32: a small deterministic PRNG. Seed is fixed at every call site. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** Solve A x = b by Gauss-Jordan with partial pivoting. Throws on a zero pivot. */
export function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]!]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[piv]![c]!)) piv = r;
    [M[c], M[piv]] = [M[piv]!, M[c]!];
    const d = M[c]![c]!;
    if (d === 0) throw new Error('singular matrix');
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r]![c]! / d;
      for (let k = c; k <= n; k++) M[r]![k]! -= f * M[c]![k]!;
    }
  }
  return M.map((r, i) => r[n]! / M[i]![i]!);
}

/** Ordinary least squares: beta = (X'X)^-1 X'y. X rows are design rows. */
export function ols(X: readonly (readonly number[])[], y: readonly number[]): number[] {
  const k = X[0]!.length;
  const XtX: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const Xty: number[] = new Array<number>(k).fill(0);
  for (let i = 0; i < X.length; i++) {
    for (let a = 0; a < k; a++) {
      Xty[a]! += X[i]![a]! * y[i]!;
      for (let b = 0; b < k; b++) XtX[a]![b]! += X[i]![a]! * X[i]![b]!;
    }
  }
  return solve(XtX, Xty);
}

/**
 * OLS for a bootstrap resample. A category dummy whose column is all zero in
 * the resample (the category drew no rows — Bridge, n=6, draws none in 2 of
 * 200 refits at seed 20261122) is unidentified: the coefficient cannot be
 * estimated, so the column is dropped and its effect returned as 0 (the
 * category falls back to the reference group for that refit). The design
 * itself — which nine categories get dummies — is NOT re-derived per
 * resample; only the unidentified column is dropped.
 *
 * Why not the spec-time script's behaviour: that script's solver divided by
 * a zero pivot and produced an all-NaN beta for those two refits; its sort
 * then fell back to slug order, so the published D10 rank ranges are
 * alphabetical ranks (steakhouse [1,152] is its alphabetical rank, 152) and
 * its P10/P90 lists carry NaN holes. The honest bootstrap drops the column
 * instead; see entry/BUILD.md (radar-3) for the full evidence.
 */
export function olsBootstrap(X: readonly (readonly number[])[], y: readonly number[]): number[] {
  const k = X[0]!.length;
  const keep: number[] = [];
  for (let a = 0; a < k; a++) {
    let nz = false;
    for (let i = 0; i < X.length; i++) {
      if (X[i]![a] !== 0) {
        nz = true;
        break;
      }
    }
    if (nz) keep.push(a);
  }
  const Xr = X.map((r) => keep.map((a) => r[a]!));
  const br = ols(Xr, y);
  const out = new Array<number>(k).fill(0);
  keep.forEach((a, i) => {
    out[a] = br[i]!;
  });
  return out;
}

export const dot = (r: readonly number[], b: readonly number[]): number =>
  r.reduce((s, v, i) => s + v * b[i]!, 0);
