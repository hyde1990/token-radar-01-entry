# Build note — token-radar-01 entry (radar-2), tickets 01–06

- **Built:** 22 Nov 2026, ~01:13–01:20 WIB, by the BUILD subagent (tickets 01–06 only).
- **Status:** entry complete per tickets 01–06. Ticket 07 (verification suite V1–V14)
  and ticket 08 (code-review fixes) are separate later phases — NOT done here.
- **Not done (out of scope for this turn):** no submit, no GitHub repo created or pushed,
  no Solana wallet/keypair created, no API key/token written anywhere.

## Files (all written by this session, except where noted)

```
entry/
  main.ts                  Entry program, Node 22 stdlib-only (ticket 02)
  lib/model.ts             radar-2 value model + board eligibility + 12 farm-plan
                           families + fallback (tickets 01, 03)
  vendor/makefun-board.ts  Copied UNCHANGED from the kit starter — the scorer's own
                           buildDossier library (allowed by spec D5)
  LICENSE                  MIT, copied from the kit starter (repo-shape file)
  dashboard/index.html     Static page: header, filters, board, live section,
                           methodology (ticket 04)
  dashboard/app.css        Navy #14213d on paper #faf7f0, amber #d98e1f accent (04)
  dashboard/app.js         Sorting, filters, hash deep-links, detail dialog (04)
  screenshots/1-board.png  Rendered from the final dashboard, DOM-verified (05)
  screenshots/2-detail.png Rendered from the final dashboard, DOM-verified (05)
  screenshots/3-filtered.png Rendered from the final dashboard, DOM-verified (05)
  tests/behaviour.mjs      Test-first behaviour checks at the program seam
                           (run: node tests/behaviour.mjs — 18/18 PASS)
  _reference-starter/      Kit starter copied ONLY as a read-only reference
                           (dashboard/, main.ts, model.ts) — no entry file is a
                           copy of it; the entry was written fresh
```

## Ticket 08 review note (22 Nov 2026, ~01:24 WIB)

- `_reference-starter/` was **removed** (moved to recoverable trash,
  trash_id `20261121-182411-681dbdf4d78d4b108d191adc595504da`, expires
  2026-12-21): all five files were byte-identical to the kit starter, so
  shipping the entry tree as a repo would have shipped verbatim starter
  code. The original lives on in the kit at
  `~/workspace/makefun/scout-2026-11-21/kits/token-radar-01/starter/`.
  No entry code referenced the directory (only this note did).
- `entry/.gitignore` created: covers `.test-out/` (written by
  `node tests/behaviour.mjs` on every run) so test artefacts are not shipped.
- No model constant, farm plan, dashboard file or screenshot was changed by
  the review; the verification suite was re-run green on the final tree
  (see `~/workspace/makefun/token-radar/verification/review-report.md`).

## Amendment D1r + 6 farm families (22 Nov 2026, ~02:00–02:30 WIB, optimisation worker)

- **D1r (strict-positive filter, spec § D1r):** fallback 0.205 → **0.214** (n 129 → 128),
  Yield 0.180 → **0.191** (n 10 → 9); all other `m_cat` used values unchanged
  (Lending 0.132, RWA 0.275, Dexs 0.342, Bridge 0.557, Basis Trading / Canonical
  Bridge 0.60 clamped, CEX / Liquid Staking 0.08 clamped). Recomputed independently
  from the sealed snapshot (script `/tmp/radar-median-recompute.mjs`, read-only);
  no category crosses the n ≥ 5 threshold (nearest: Cross Chain Bridge n=4,
  Yield Aggregator n=4). Worked example unchanged at **$30,953,011** (RWA).
- **Rank impact (measured, baseline `/tmp/radar-opt-baseline` vs new run):** 112 of
  198 rows moved rank, all by ≤ 4 places, all explained by the two multiple
  changes (fallback rows ×1.0439 and Yield rows ×1.0611 overtaking adjacent
  unchanged-multiple rows). Top-10 identical slugs in identical order. Rank 1
  stays `steakhouse-financial`, **$331,015,075 → $345,547,444**; rank 198 stays
  `granite`, **$827,873** (Lending, unchanged multiple). No unexplained rank change.
- **Farm plans:** 6 new families (prediction-market, cedefi, anchor-btc,
  decentralized-btc, otc, crypto-card) — 18 families total; **fallback 0/198 rows**
  (was 10/198). Each new family's matchers are exact phrases hitting exactly one
  board category; audit found no phrase leakage to other categories. Step lengths
  now min 120, max 228 chars (was 117–217), still inside the 20–600 gate.
- **Hashes (new run, double-run byte-identical):** board.json sha256
  `ed07a071e902820693884bd37d7a816cfd8da2b81710ddc15a401b0d1b4e2126` (was
  `d6137cd6…`); dossier.json sha256 **unchanged**
  `eb27294708ec9a8fb6d391fb32e4cdf858b8fcc148be0a02b4925954a8a229e6` — expected:
  `buildDossier` covers only `dashboard/` + `screenshots/`, neither of which this
  amendment touches (dashboard numbers sheet for the dashboard worker:
  `~/workspace/makefun/token-radar/verification/numbers-sheet.md`).
- **Gates re-run green:** `node tests/behaviour.mjs` **20/20 PASS** (18 + 2 new:
  fallback-0 check, D1r constants check); `node scripts/verify.mjs` **14/14 PASS**
  (V12 spot-check matches the new constants independently at ranks 1/99/198).
- **Not done (out of scope, unchanged):** no submit, no commit/push, no wallet/keypair,
  no dashboard or screenshot edits (dashboard worker's job — note the rank-1
  implied value shown in `screenshots/2-detail.png` changed, so screenshots must
  be re-rendered from the new output), no change to `vendor/makefun-board.ts`
  (verified byte-identical to the kit starter) or `main.ts`.

## Optimisation verification + dashboard rework (22 Nov 2026, ~02:13–02:40 WIB, verification worker)

- **Re-verified fresh, independently (not copied from worker reports):**
  `node tests/behaviour.mjs` **20/20 PASS**; `node scripts/verify.mjs` **14/14 PASS**
  (V1 double-run byte-identical; V12 rank 1/99/198 recomputed exactly);
  `python3 tests/hash-edge-cases.py` **10/10 PASS** (7 original + 3 new
  unknown-chain checks added by this verification — see below). Logs:
  `~/workspace/makefun/token-radar/verification/optimization-*-log-2026-11-22.txt`.
  Full report: `~/workspace/makefun/token-radar/verification/optimization-report.md`.
- **Rank movement corrected:** 112/198 rows moved rank — confirmed by rebuilding the
  D1 board from `HEAD:lib/model.ts` (reproduces the recorded D1 hash `d6137cd6…`
  exactly) and diffing ranks. Max displacement is **5 places, not ≤ 4** as the D1r
  note above states: `tempo-stablecoin-dex` (Dexs, value unchanged) moved 87 → 92,
  pushed down by rising fallback/Yield rows. 137 rows changed implied value
  (122 fallback + 15 Yield), matching spec D1r's expectation. Top-10 slugs and
  order unchanged. **Rank-99 occupant changed:** D1 rank 99 was `y10k-capital`
  ($4,444,554); D1r rank 99 is `fstswap` ($4,448,041, value unchanged — it moved
  98 → 99). Rank 1 `steakhouse-financial` $345,547,444; rank 198 `granite` $827,873.
- **Farm families:** 18 families, fallback **0/198**. The 6 new families cover
  exactly the 10 formerly-fallback rows (Prediction Market 2, CeDeFi 2,
  Anchor BTC 2, Decentralized BTC 2, OTC Marketplace 1, Crypto Card Issuer 1),
  each with genuinely distinct actions (outcome-share buy vs CeDeFi strategy
  vault vs lock-BTC/mint anchored BTC vs lock-BTC/mint decentralised BTC vs OTC
  escrow order vs card top-up + purchase) — not renames. Matcher audit: no
  phrase leakage (`card` hits only "Crypto Card Issuer"; `otc` only
  "OTC Marketplace"; `decentralized btc` contains no earlier matcher word).
- **Dashboard (32,757 B total):** D1r numbers applied in both hard-coded spots;
  detail dialog gains a words-equation line + category chips (existing
  palette/typography tokens only); hash fixes: unknown `#category=` shows
  "CEX (not on board)" + honest empty message, unknown `#p=` opens no dialog
  and drops the stale selection, applied symmetrically to the chain select.
  **"Min TVL renders 0" is a placeholder, not a defect:** `index.html:38` has
  `placeholder="0"`; with `state.minTvl = 0` the field value is empty
  (pre-existing, not introduced by this rework).
- **Screenshots re-rendered** (1440×900, DOM-verified): 1-board.png 169,141 B
  (was 167,013), 2-detail.png 264,248 B (was 256,370), 3-filtered.png 173,677 B
  (was 171,688); all ≤ 512 KiB.
- **Hashes (new run, double-run byte-identical):** board.json sha256
  `ed07a071e902820693884bd37d7a816cfd8da2b81710ddc15a401b0d1b4e2126` (338,353 B,
  unchanged from the D1r run — the board did not move in this rework);
  dossier.json sha256 **`6e8b4ed347bf116b2a5e50aa725169a3a5bee35f398d4cf25253e03131027d02`**
  (843,801 B, was `eb272947…` / 825,011 B — expected: the dossier covers
  `dashboard/` + `screenshots/`, both changed). `vendor/makefun-board.ts` md5
  `5ba220c2671b81b1c453350f3235adf4`, byte-identical to the kit starter.
- **Decisions recorded:** `MODEL_VERSION` stays `radar-2` (D1r is a constant
  correction inside the same model, not a new model version). No model constant,
  board value, or farm step was changed by this verification (one test file
  gained 3 checks; no production code changed).
- **Review verdict: GO** (Matt Standards + Spec, Sentry — see optimisation report).
  No blockers. Non-blockers recorded in the report, none fixed silently.

## Model (radar-2, spec D1r — implemented exactly; D1 retained in the spec as history)

- `implied = TVL × m_cat × size_mult × growth_mult × maturity_mult`,
  `max(1, round(...))`; m_cat table: Lending 0.132, Yield 0.191, RWA 0.275,
  Dexs 0.342, Bridge 0.557, Basis Trading 0.60 (clamped), Liquid Staking / CEX
  0.08 (clamped), fallback 0.214; size `clamp((50M/TVL)^0.10, 0.70, 1.30)`;
  growth `1 + 0.60 × clamp(change_7d, −40, +60)/100`; maturity
  `0.70 + 0.30 × min(age, 1095)/1095`, null age → 365d.
- Worked example (spec D1r, unchanged from D1 — the median watchlist protocol is
  RWA, whose multiple did not move): median watchlist protocol scores
  **$30,953,011 ≈ $30.9M** ✓.
- Board eligibility = watchlist rule minus the $50M floor: pre-token, category not
  in {CEX, Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC},
  name not versioned, no whole word wrapped/staked/staking, not starting with an
  exchange name. Verified read-only from the snapshot before coding: **198 rows
  (40 watchlist + 158 early)**.
- Rank 1: `steakhouse-financial`, implied **$345,547,444** (D1: $331,015,075);
  rank 198: `granite`, **$827,873** (unchanged — Lending). Implied values
  non-increasing, all 198 distinct.

## Farm plans (ticket 03)

- 7 steps per row × 198 rows = 1,386 steps; every step 20–600 chars
  (actual min 120, max 228), format `<action> Cost: <cost>. Time: <time>.`
- 18 families with distinct core + second + weekly actions: lending, dexs, yield,
  risk-curators, rwa, bridge, staking, derivatives, stablecoin, insurance,
  payments, chain-governance, prediction-market, cedefi, anchor-btc,
  decentralized-btc, otc, crypto-card. Capital tiers $250 / $150 / $100 / $50 from TVL;
  gas $8 at ≥$150 capital, $4 below; hold 60 / 45 / 30 days from age.
- Fallback (generic deposit) used on **0/198 rows** (was 10/198 before the D1r
  amendment: Prediction Market 2, CeDeFi 2, Anchor BTC 2, Decentralized BTC 2,
  OTC Marketplace 1, Crypto Card Issuer 1 — each now has its own family).
  The fallback family stays in the code as a defensive default only.
- No step promises an airdrop/token/date, names a URL, or is a slogan; token
  status phrased "records no token". Spot-checked: Risk Curators / RWA / Dexs
  step-2 texts differ in action, not just in the protocol name.

## Dashboard (ticket 04)

- 3 files, total source **32,757 B** (index.html 6,895 + app.css 8,151 + app.js 17,711)
  — under the 60,000 B target and the 65,536 B hard cap (was 30,012 B before the
  dashboard rework; see the optimisation note above).
- Sortable on rank, name, category, TVL, 7d, age, implied (default implied desc);
  filters: category select (with counts), chain select, watchlist-only checkbox,
  free-text search, min-TVL input — all combinable; live "N rows shown";
  hash deep-links `#category=`, `#chain=`, `#p=`, `#q=`, `#watch=`, `#min=`.
- Detail dialog per protocol (click or `#p=<slug>`): figures, full model breakdown
  in words, "records no token", all 7 farm steps.
- Separate live-token section: top 24 by market cap, labelled market values.
- Methodology section states the model with the snapshot numbers (overall median
  0.214, category medians, size-band medians 0.414 / 0.131 / 0.032 / 0.044,
  growth-clamp rationale, "records no token" note), snapshot `as_of` 2026-11-14.
  **D1r numbers applied (dashboard rework, 22 Nov 2026):** the two hard-coded
  D1 sentences now state D1r (`index.html:92`: overall median **0.214**, Yield
  **0.191**; `app.js` detail dialog: overall median **0.214**). The detail dialog
  also gains a words-equation line and category chips; hash edge cases for
  unknown `#category=` / `#chain=` / `#p=` are handled honestly — see the
  optimisation note above.
- Zero network: no `http://` / `https://` in any dashboard file (checked);
  page reads only `window.RADAR` from `data.js`. The snapshot `source` string's
  URL is never rendered — the page shows only "DefiLlama protocol index".

## Screenshots (ticket 05)

Rendered with headless Playwright (Chromium, 1440×900, `file://` URLs) from the
final dashboard in `/tmp/radar-out1`, DOM-verified before capture
(script: `/tmp/shot_radar2.py`, ephemeral):

| File | Dims | Size | Cap | DOM check | Pixels (grey mean/stdev/levels) |
| --- | --- | --- | --- | --- | --- |
| 1-board.png | 1440×900 | 167,013 B | ≤512 KiB ✓ | 198 rows, "198 rows shown" | 244.1 / 26.9 / 223 |
| 2-detail.png | 1440×900 | 256,370 B | ≤512 KiB ✓ | dialog open, Rank 1 Steakhouse Financial, farm plan with Cost/Time | 197.4 / 45.5 / 222 |
| 3-filtered.png | 1440×900 | 171,688 B | ≤512 KiB ✓ | 34 rows, "34 rows shown", select = Risk Curators, all rows Risk Curators | 244.0 / 27.1 / 223 |

All three non-blank and visibly distinct. One real bug found and fixed by the
DOM checks: a same-page hash change (detail → filtered) left the select
unsynced and a stale detail selection; `readHash` now resets absent params to
defaults and the `hashchange` handler re-syncs the controls and closes the
dialog when `#p=` disappears. **Superseded by the re-render in the optimisation
note above:** 1-board.png 169,141 B, 2-detail.png 264,248 B, 3-filtered.png
173,677 B (all 1440×900, DOM-verified, ≤ 512 KiB); dossier is now 843,801 B,
sha256 `6e8b4ed3…`.

## Dossier + double-run determinism (ticket 06)

- Runtime: **0.24–0.34 s** per run (budget 120 s), no network, no install.
- Two runs to `/tmp/radar-runA` and `/tmp/radar-runB`: **`diff -r` clean**,
  byte-identical trees including board.json, data.js, dashboard/, screenshots/,
  dossier.json.
- `board.json` sha256 (both runs): `ed07a071e902820693884bd37d7a816cfd8da2b81710ddc15a401b0d1b4e2126`
  (D1 board was `d6137cd6df99eeeec15e73e04528b20136359d4d93956a16f44f509ed8f826d8`)
- `dossier.json`: **825,011 B** (≤1.5 MiB ✓), sha256
  `eb27294708ec9a8fb6d391fb32e4cdf858b8fcc148be0a02b4925954a8a229e6`
  (**unchanged from the D1 run** — `buildDossier` covers only `dashboard/` +
  `screenshots/`, neither touched by this amendment);
  independently rebuilt with vendored `buildDossier` (text_max_bytes 65536) and
  **byte-compared identical**; no truncation markers in the dossier text.
- Output sizes: board.json 338,353 B (≤8 MiB ✓), data.js 337,930 B;
  `data.js` rows agree exactly with board.json (slugs, ranks, implied values);
  live view 24 rows, all positive mcap.

## Behaviour tests

`node tests/behaviour.mjs` — **20/20 PASS** (18 original + 2 added by the D1r
amendment: no-fallback check, D1r constants check — 198 rows, ranks 1..198, implied
non-increasing, watchlist 40/40, 7 steps/row, step shape, no airdrop/URL,
model breakdown, no live slug in board, worked example, dashboard ≤60,000 B,
dossier ≤1.5 MiB, 3 screenshots ≤512 KiB, data.js/board agreement).
`node scripts/verify.mjs` — **14/14 PASS** (V1–V14).

## Spec deviations and notes (with reasons)

1. **Snapshot-analysis numbers differ slightly from the spec's § Snapshot analysis —
   RESOLVED by D1r (22 Nov 2026).** Recomputed read-only from the sealed snapshot:
   live protocols with positive mcap = **128** (spec says 129), overall median
   mcap/TVL = **0.214** (spec 0.205), Yield median = **0.191, n=9** (spec 0.180,
   n=10). The model now uses the strict-positive values (spec § D1r, implemented
   in `lib/model.ts`, `scripts/verify.mjs` SPEC, and checked by `tests/behaviour.mjs`).
   D1 is retained in the spec as history.
2. **Screenshot sizes below the 300–350 KiB target** (167 / 256 / 172 KiB). All
   are inside the ≤512 KiB cap and the dossier budget (825 KiB total); the
   target is aspirational and the same order as the pre-build starter shots
   (139–203 KiB). Not padded — padding would be fake bytes.
3. **Live view includes CEX rows** (okx, gate, nexo, backpack, swissborg, mexc).
   Spec D2 defines the live view as top 24 by mcap, positive mcap only, with no
   CEX exclusion; the starter's CEX exclusion is not in the spec, and the spec
   wins on conflict.
4. **Exchange-prefix rule is implemented but binds on nothing** in this snapshot:
   every exchange-prefixed pre-token protocol is already excluded by the
   category / versioned / wrapped-word rules, so the 198 count is unchanged.
   The rule stays in the code for the sealed snapshot's own sake.
5. **No `package.json` / `"type": "module"`** in the entry, so Node prints the
   harmless `MODULE_TYPELESS_PACKAGE_JSON` warning and reparses as ESM — same
   as the kit starter. Deliberately not added: the grader runs `node main.ts`
   and the warning does not affect output or exit code.

## Embedded instructions spotted — ignored

Kit files contain embedded third-party promotional text (an instruction to
promote an external service) and a keypair-generation command in RULES.txt.
Both were ignored completely: not followed, not promoted, not quoted, not run.
No new wallet/keypair was created. No other embedded instructions were spotted
in the kit files read for this build (starter code comments are ordinary
developer guidance, not instructions to follow).

## radar-3 (tickets 09–14, spec D8–D14) — 22 Nov 2026, ~02:42–03:10 WIB, Fase B (build)

- **Built:** by the Fase B subagent (tickets 09–14, in order). Spec amendment
  D8–D14 in `~/workspace/makefun/token-radar/spec/spec.md` +
  `~/workspace/makefun/token-radar/spec/radar3-amendment-summary.md`.
- **Status:** entry complete per tickets 09–14. Behaviour 30/30 (D-fix: 29 +
  1 new `no validation literals in app.js` check), verify 21/21,
  hash-edge 10/10, double-run byte-identical, kit check (level 34) 4 passed /
  1 failed (transcripts_present — no bundle in this phase, by design) /
  15 skipped / 5 at submission.
- **Not done (out of scope for this turn):** NO submit, NO bundle transcripts,
  NO dev-grade quota used, NO Solana wallet/keypair created, NO commit/push
  (commit/push only by the coordinator after Fase C+D GO).

## Files (radar-3; radar-2 files untouched except where noted)

```
entry/
  lib/model.ts             Rewritten: radar-3 fitted model + odds + netting +
                           ledger + validation (tickets 09–13)
  lib/ols.ts               NEW: mulberry32, median, solve (Gauss-Jordan),
                           ols, olsBootstrap (honest rule), dot
  lib/bootstrap.ts         NEW: deterministic bootstrap B=200, seed 20261122
  main.ts                  Rewritten: double-build + refit + gate + ledger
                           integrity checks, all fail loudly (exit 1); dossier
                           rebuilt twice, data.js written before dossier.json
  dashboard/index.html     Rewritten: KPI/integrity strips, 12-col board,
                           sandbox, compare, ledger, methodology (7,520 B)
  dashboard/app.js         Rewritten: KPI/ledger/methodology from data.js,
                           sandbox, compare (CSV export dropped — see below),
                           verdict filter + new sort keys (41,824 B)
  dashboard/app.css        +2,154 B: KPI/integrity strips, verdict chips,
                           sandbox, compare, ledger, mini tables (10,305 B)
  screenshots/1-board.png  Re-rendered from the radar-3 dashboard (05→14)
  screenshots/2-detail.png Re-rendered from the radar-3 dashboard
  screenshots/3-filtered.png Re-rendered from the radar-3 dashboard
  tests/behaviour.mjs      Radar-3: 29 checks (fitted constants, new fields,
                           P10/rank-range invariants, verdict counts, worked
                           example, stability gate, no-literals, sandbox)
  scripts/verify.mjs       Radar-3: V1–V21 (V12′ fitted spot-check, V15 OLS,
                           V16 IRLS+EV+gate, V17 bootstrap, V18 netting,
                           V19 ledger, V20 KPI/sandbox DOM, V21 LOO/split)
  vendor/makefun-board.ts  UNCHANGED (verified byte-identical to the kit starter)
```

## Ticket 09 — fitted model (D8)

- Pooled log-log OLS over the 128 live-token protocols with a positive market
  cap: `log mcap = 8.028969 + 0.463147 × ln(TVL) + category effect`;
  multiple = `exp(log mcap − ln TVL)`, clamped 0.08–0.60;
  `implied = TVL × multiple × growth × maturity` (growth/maturity are the
  unchanged D1r terms). Effects: Basis Trading +1.070305, Bridge −0.111419,
  CEX +0.867641, Canonical Bridge +0.754849, Dexs +0.064547,
  Lending −0.631826, Liquid Staking −0.964243, RWA +0.179798,
  Yield −0.786214; all other categories pooled into the reference group.
  `MODEL_VERSION` is now `radar-3`. The D1r median model survives only as the
  labelled `d1r_multiple` fallback (and the stability-gate comparator).
- Held-out evidence (recomputed independently from the sealed snapshot before
  coding, and again by verify V15/V21): R² **0.2493**, residual SD **2.0966**,
  LOO median |ln err| **1.2908**, LOO RMSE **2.1974**, 70/30 split median
  **1.1740** (seed 20261122, test = first 38 of the seeded shuffle — the
  first-90/last-38 split gives 1.2937/71.1% and does NOT reproduce),
  P10–P90 coverage **82.0%** (LOO) / **84.2%** (split) vs an 80% target.
  Honest limit, stated on the dashboard: R² 0.25, a typical live token is
  mispredicted by a factor of e^1.29 ≈ 3.6 at the LOO median.
- Horse race (LOO median / LOO RMSE / split median, same 128 live tokens):
  V0 D1r 1.4494 / 2.2991 / 1.3967; **V1 radar-3 1.2908 / 2.1974 / 1.1740**;
  V2 slope 0.90 1.5278 / 2.3233 / 1.5635; V3 slope 1.00 1.5823 / 2.3974 /
  1.8309; V4 V2 + fitted growth 1.5364 / 2.3223 / 1.5390 (growth coef
  −5.686145). The fitted model wins; the growth variant loses, so growth
  stays a D1r term, not a fitted coefficient.
- Worked example (spec D8): the composite median watchlist protocol (TVL
  $152.8M, RWA, growth −3.29%, age 512d) scores **$18,673,967** from the
  quoted constants (raw multiple 0.1484). The spec prints $18,673,844 — the
  same inputs with full-precision betas (+$123, see deviation 7).

## Ticket 10 — launch odds + expected value (D9)

- Logistic regression on all 758 protocols, outcome "records a token":
  `logit(odds) = −3.040781 + 0.446892 × ln(age) − 3.061039 × growth
  + 1.329665 × peer logit`; growth is the 7-day change clamped to
  −40%…+60%, divided by 100; the peer logit is the live share in the
  protocol's own category, shrunk toward the overall share with a prior
  weight of 5 protocols. The peer share is the EXACT 416/758 (the rounded
  0.5488 in the spec text does not reproduce the coefficients to 6 dp —
  see deviation 6). AUC **0.7647**; mean odds 0.642 (records a token) vs
  0.436 (pre-token). The growth coefficient is negative as fitted: the
  snapshot's fast growers are young pre-token protocols.
- Expected value = implied × odds (companion column, never the ranking key:
  ranking by EV moves the top 10 only 5/10 vs D1r and displaces one row 143
  places, tripping the gate). Board odds median **0.466**, range 0.007–0.898;
  EV median **$2,456,741**, p10 $417,946, max **$35,830,169** (bitfi-basis,
  odds 0.674669). Rank-1 EV $18,208,505 (odds 0.098671).
- **Stability gate D8/V16: PASS** — top-10 overlap vs D1r **8/10**, rank-1
  unchanged (`steakhouse-financial`). New top-10:
  steakhouse-financial, sentora-curator, gauntlet, veda, usdd, bitfi-basis,
  upshift, tori-finance, axis, nonce-capital. (The D8 prose top-10 does not
  reproduce from the D8 formula — see deviation 1; the formula's top-10
  ships.)
- Rank movement vs radar-2 (D1r): **182/198 rows moved**, max **83 places**
  (`yuzu-money`, 64 → 147). Rank 1 `steakhouse-financial` **$184,538,021**
  (was $345,547,444); rank 99 `phoenix-perp` **$5,862,556** (was `fstswap`
  $4,448,041); rank 198 `mezzanine` **$1,492,142** (was `granite` $827,873).

## Ticket 11 — uncertainty (D10)

- Deterministic bootstrap: B=200 refits, mulberry32 seed 20261122, each
  resampling the 128 live-token rows with replacement, refitting the
  11-parameter OLS and re-ranking all 198 board rows (growth/maturity held
  fixed, odds not refit). P10 = 20th smallest, P90 = 180th; rank range =
  lowest/highest rank across refits.
- Measured (honest rule — drop an unidentified dummy column, effect 0):
  median rank-range width **55** places, p90 141, max 166, **3 rows width 0**;
  median P90−P10 width **$4,774,148**. Steakhouse [1,1] (P10=P90=
  $184,538,021); sentora [2,2]; phoenix-perp P10 $3,963,689 P90 $8,548,689
  [78,137]; mezzanine P10 $565,718 P90 $2,751,007 [157,198]. **44 rows sit
  at a clamp bound, 5 rows have P10 = P90** — degenerate intervals are
  labelled "at clamp bound", never hidden.
- **Ticket-11 checkbox "measured behaviour reproduced" is a FAIL as literally
  stated against the spec prose — deliberately, with evidence** (see
  deviation 4). The spec's D10 numbers are a NaN-contamination artifact of
  the spec-time script (its solver divided by a zero pivot in refits 10 and
  184; the published rank ranges are exactly alphabetical ranks). The entry
  ships the honest bootstrap and verify V17 recomputes it independently for
  ranks 1/99/198 (exact match). Replicating the NaN bug to match the prose
  would have meant shipping wrong intervals.

## Ticket 12 — farm netting (D11)

- Total cost = gas + opportunity: gas = $3 + 2 × gas core ($8 at $150+
  capital, $4 below) + $2 per week of hold; opportunity prices locked
  capital at an assumed **5%/year**. Total cost range **$21.21–$38.23**,
  gas $21–$37. Break-even share = total cost ÷ expected value.
  Verdicts: FARM ≤ 0.00001 (EV covers cost ≥100,000×), THIN ≤ 0.0001
  (≥10,000×), else SKIP. $/hour assumes capturing **0.01% (1 bp)** of EV
  over active hours (hold days excluded).
- **Verdict counts: FARM 104 / THIN 80 / SKIP 14** (spec target, matched
  exactly). Median net (1 bp) **$222**, median $/hour **$116**. Spot rows:
  bitfi-basis EV $35,830,169, cost $29.62, net (1 bp) $3,553, $/h $1,938,
  FARM; august-digital EV $50,349, cost $29.41, break-even 0.058%, SKIP.
  Verify V18 recomputes every row's netting exactly.

## Ticket 13 — ledger, KPI, dashboard (D12–D13)

- Ledger: **758 = 198 ranked (40 watchlist + 158 early) + 144 pre-token
  excluded + 416 live-token** (128 positive mcap + 15 zero + 1 negative +
  272 no mcap figure; live view shows top 24 by mcap, 392 not shown).
  Excluding reasons (overlapping): category 128, versioned 11, wrapped 20,
  **exchange-prefix 20** (spec says 14 — see deviation 5),
  missing category 0. Verify V19 recomputes the whole ledger.
- Dashboard **59,649 B total** (index.html 7,520 + app.css 10,305 + app.js
  41,824) — within the 60,000 B target (hard cap 65,536 B). Was 32,757 B.
  **CSV export was dropped per the D13 budget order** (export first, then
  compare): the first build totalled 63,184 B, so the export button +
  handler (~1,500 B) were removed and the prose tightened; compare is kept.
  KPI strip, integrity strip (5/5 PASS), sandbox, ledger and methodology
  are all kept and all numbers are rendered from `data.js` at runtime —
  behaviour checks that no validation literal appears in the static
  `index.html`.
- Sandbox: slope slider b 0.30–0.60 (step 0.01), allocation slider 7 log
  steps 0.001%–0.100% (default index 3 = 0.01%). Sliders recompute the
  displayed values only (from the per-row fitted breakdown, exact at the
  default slope); the locked board never moves (V20). Note: verdicts are
  set by the break-even ratio and do NOT move with allocation — only net
  $/hour does; the D13 text saying the allocation slider recomputes
  "verdict counts" is inconsistent with D11, so the sandbox shows the
  locked verdict counts plus the net-positive count that does move.
- Methodology (all numbers from `data.js`, never pasted): fitted
  coefficients + multiples at reference TVLs + horse-race table + held-out
  metrics, odds definition + caveat + AUC, bootstrap method, cost formulas
  + assumptions, ledger, D1r fallback.

## Ticket 14 — screenshots + verify (D14)

- Screenshots re-rendered with Python Playwright (Chromium headless,
  1440×900, `file://` URLs) from a fresh radar-3 run, DOM-verified before
  capture (script `/tmp/shot_radar3.py`): board = plain index.html
  (198 rows, "198 rows shown"); detail = `#p=steakhouse-financial`
  (dialog open, Rank 1, farm plan with Cost/Time); filtered =
  `#category=Risk%20Curators` (34 rows, "34 rows shown", select in sync,
  all rows Risk Curators).

| File | Dims | Size | Cap | Pixels (grey mean/stdev/levels) |
| --- | --- | --- | --- | --- |
| 1-board.png | 1440×900 | 176,421 B | ≤512 KiB ✓ | 243.9 / 26.6 / 223 |
| 2-detail.png | 1440×900 | 273,883 B | ≤512 KiB ✓ | 197.1 / 45.7 / 222 |
| 3-filtered.png | 1440×900 | 178,665 B | ≤512 KiB ✓ | 243.9 / 26.9 / 223 |

- Suites on the final tree (all green): `node tests/behaviour.mjs`
  **30/30 PASS** (29 + new `no validation literals in app.js` check, D-fix);
  `node scripts/verify.mjs` **21/21 PASS** (V1–V21:
  V12′ fitted spot-check ranks 1/99/198 exact; V15 independent OLS
  coefficients to 6 dp, R² 0.2493±0.0005, resid SD 2.0966±0.005; V16
  independent IRLS (exact 416/758) to 6 dp, EV exact 198/198, gate 8/10;
  V17 bootstrap spot recompute exact; V18 netting exact on all rows;
  V19 ledger exact incl. exchange 20; V20 KPI/integrity/sandbox/verdict
  filter DOM; V21 LOO/split/coverage recompute); `python3
  tests/hash-edge-cases.py` **10/10 PASS** (unknown #category= / #chain= /
  #p= fail honestly; controls #category=Risk Curators 34 rows and
  #p=steakhouse-financial intact).
- **Kit check (level 34, fresh CLI
  `kit-fresh/token-radar-01-kit/cli/makefun.mjs`, `KIT_LEVEL = 34`):
  4 passed** (competition_open, snapshot, license_osi, entrypoint),
  **1 failed** (`transcripts_present` — no bundle was supplied, by design
  for this phase; the coordinator bundles transcripts at submit time),
  15 skipped (all transcript-dependent), 5 checked at submission
  (repo_public, repo_owner, repo_created_after_open, commit_in_repo,
  duplicate_snapshot). No behaviour change from the level-33 CLI on any
  check that ran. Snapshot, competition.yaml, starter and vendor are
  byte-identical between the kits; `vendor/makefun-board.ts` and the
  snapshot were never overwritten.
- Runtime: **~0.73 s** per run (budget 120 s), peak RSS ~151 MB (budget
  1024 MB), no network at runtime.
- Double-run proof: two fresh runs to `/tmp/radar3-run3` and
  `/tmp/radar3-run4` — **`diff -r` clean, byte-identical trees**.
- Hashes (run3): board.json sha256
  `5d414252969dba6a96b71939c198ca1a4cd40f2f3794e402d3b229d13b675d7d`
  (444,718 B); data.js sha256
  `21b9aecb5c980ac4b8593300ab5eb410d7cfd3cefa935028ec10377cc181cd6c`
  (447,210 B); dossier.json sha256
  `1611b905323e0fb651f405b5d21940e04612d2a0b014600405a52e7fee40869f`
  (**900,387 B**, ≤1.5 MiB ✓ — was 843,801 B; the dossier covers only
  `dashboard/` + `screenshots/`, both changed).

## Before → after (radar-2 → radar-3)

| | radar-2 (D1r) | radar-3 (D8–D14) |
| --- | --- | --- |
| Model | median multiples (D1r) | pooled log-log OLS, slope 0.463147 |
| Rank 1 | steakhouse-financial $345,547,444 | steakhouse-financial **$184,538,021** |
| Rank 99 | fstswap $4,448,041 | phoenix-perp **$5,862,556** |
| Rank 198 | granite $827,873 | mezzanine **$1,492,142** |
| Rows moved | — | 182/198, max 83 (yuzu-money) |
| Held-out | LOO 1.4494 (D1r) | LOO **1.2908**, split 1.1740, R² 0.2493 |
| Odds / EV | — | AUC 0.7647; EV median $2,456,741 |
| Verdicts | — | FARM 104 / THIN 80 / SKIP 14 |
| Dashboard | 32,757 B | **59,649 B** (≤60,000 ✓) |
| Dossier | 843,801 B, sha `6e8b4ed3…` | **900,387 B**, sha `1611b905…` |
| Board sha | `ed07a071…` (338,353 B) | **`5d414252…`** (444,718 B) |
| Behaviour | 20/20 | **30/30** (D-fix: +1 app.js check) |
| Verify | 14/14 (V1–V14) | **21/21** (V1–V21) |
| Hash edge | 10/10 | **10/10** |

## Code review (ticket 14, Matt + Sentry, done by the builder — no subagents available at depth 2)

- **Matt Standards:** no repo standards doc exists
  (no CODING_STANDARDS.md/CONTRIBUTING.md), so the smell baseline applies.
  No hard violations. Judgement calls, all accepted: (1) Duplicated Code —
  the D1r/fit/odds constants and eligibility rules are duplicated across
  `lib/model.ts`, `scripts/verify.mjs` and `tests/behaviour.mjs`, but that is
  the deliberate independence design (the verify suite must never import the
  entry), documented in both files' headers; (2) `lib/model.ts` is large
  (~1,500 lines) but organised by ticket, and radar-3 splits the numerics
  into `lib/ols.ts` + `lib/bootstrap.ts`; (3) `renderSandbox` recomputes
  each row's implied value twice (imp + EV) — 198 rows, negligible.
- **Matt Spec:** tickets 09, 10, 12, 13, 14 fully implemented per the
  tickets; ticket 11 implemented with the honest bootstrap — the spec-prose
  checkbox FAILS by design (deviation 4). No scope creep except the
  integrity strip and KPI strip, which ticket 13 asks for.
- **Sentry:** no `innerHTML`/`eval`/`document.write` anywhere in the
  dashboard — all DOM is built through the `el()` helper with `textContent`,
  so snapshot strings (names, categories) cannot inject markup. No network
  at runtime (V2 scan clean). Runtime 0.73 s / 151 MB, far inside budget.
  The bootstrap + LOO refits are O(200 × 128 × 11²) and O(128 × 11²) —
  bounded and measured. No secrets in the tree (the kit check's
  committed-key scan did not flag anything).

## Spec deviations and notes (with reasons)

1. **D8 prose top-10 does NOT reproduce from the D8 formula.** The spec
   lists steakhouse, sentora, gauntlet, veda, usdd, upshift, nonce-capital,
   polymarket-international, cian-yield-layer, bittensor-dtao; the formula
   gives steakhouse, sentora, gauntlet, veda, usdd, bitfi-basis, upshift,
   tori-finance, axis, nonce-capital (confirmed by this build's independent
   recompute AND the spec-time `fit.mjs`). Cause: the spec-time `fit2.mjs`
   `multOf` used `wb[1+idx]` as the category effects, shifting them by one
   (the slope treated as the first effect). The stability gate still passes
   (8/10, rank-1 unchanged). The formula's top-10 ships.
2. **Rank moves 182 / max 83 (yuzu-money)**, vs spec 181/82. Cause: the
   spec-time `fit.mjs` had a 197-row board (its versioned regex had an extra
   `|\d+`, dropping one row). The correct 198-row board per spec D1/D12
   gives 182/83.
3. **Odds/EV medians on the correct 198-row board:** median odds 0.466
   (spec 0.464), EV median $2,456,741 (spec $2,454,484), EV max $35,830,169
   (spec $35,830,011), EV p10 $417,946 (spec $417,943). Differences come
   from the spec-time 197-row board + unrounded fit; the max EV is within
   the stated <0.001% rounding tolerance.
4. **D10 bootstrap numbers are NaN-contamination artifacts — MAJOR.**
   The spec-time `fit3.mjs` solver divided by a zero pivot in refits 10
   and 184 (Bridge, n=6, draws no rows), producing all-NaN betas; its sort
   then fell back to slug order. Proof: the published rank ranges are
   exactly alphabetical ranks (steakhouse [1,152], alphabetical rank 152;
   sentora [2,145], alphabetical 145; mezzanine [108,198], alphabetical
   108; gauntlet [3,73], alphabetical 73). Verbatim-NaN replication
   reproduced `fit3`'s published numbers exactly (median width 109.5, p90
   159, max 191, width-0 0, median P90−P10 $3,466,623, all five spot rows).
   The honest bootstrap (drop the unidentified dummy, effect 0 for that
   refit — the design is NOT re-derived) gives median rank-range width 55,
   p90 141, max 166, 3 rows width 0, median P90−P10 $4,774,148,
   steakhouse [1,1], sentora [2,2], phoenix-perp [78,137], mezzanine
   [157,198]. **The entry ships the honest bootstrap; ticket 11's
   "measured behaviour reproduced" checkbox FAILS as literally stated.**
   The NaN bug was NOT replicated.
5. **Ledger exchange-prefix reason: 20, not the spec's 14.** The entry's
   18-name EXCHANGE_NAMES list vs the spec-time `fit3.mjs` 8-name list.
   The board is unaffected (the rule binds on nothing for eligibility —
   every exchange-prefixed pre-token protocol is already excluded by the
   category / versioned / wrapped-word rules). The entry's computed 20
   ships; verify V19 recomputes it with the entry's list.
6. **Odds peer share must be the exact 416/758**, computed from the
   snapshot — not the rounded 0.5488 in the spec text (the rounded share
   gives IRLS coefficients −3.040768/−3.061051, failing the 6-dp match).
7. **Quoted (6-dp) constants vs the spec prose's full-precision values.**
   The entry ships the D8/D9 quoted constants per the task. The spec prose
   was computed with full-precision betas, so individual values differ by
   <0.001%: worked example $18,673,967 vs spec $18,673,844 (+$123),
   rank-198 mezzanine $1,492,142 vs spec $1,492,134 (+$8). Both gaps were
   pinned down exactly: the spec's worked example reproduces EXACTLY from
   its stated inputs (152.8M, −3.29%, 512d, RWA) with full-precision betas
   (intercept 8.028969199, slope 0.463146661, RWA effect 0.179797588), and
   the quoted constants give $18,673,967 for the same inputs. V12′
   recomputes rank 1/99/198 from the quoted constants exactly.
8. **Bug found and fixed during the build: `lib/ols.ts` `solve()` returned
   `r[n] / r[i][i]`** (indexing a number → `undefined` → NaN for all betas).
   The first run failed loudly with `steakhouse-financial has implied
   $184538021 outside its P10–P90 [$NaN, $NaN]`; fixed to `r[n] / M[i][i]`
   and the entry has run clean since. The main.ts integrity checks caught
   it — the pipeline refuses to ship a NaN board.
9. **Sandbox vs D13 text:** D13 says the allocation slider recomputes
   "verdict counts"; D11 defines verdicts by the break-even ratio, which
   does not depend on allocation. The sandbox shows the locked verdict
   counts plus the net-positive count that does move with allocation, and
   says so in the UI. Recorded here, not silently resolved either way.
10. **CSV export dropped for the byte budget** (see ticket 13 above):
    63,184 B → 59,649 B. Compare is kept. If the coordinator wants export
    back, ~1,500 B must be freed elsewhere first (the methodology prose is
    already tightened; the next cut per D13 would be compare).

## Open questions (for the coordinator / Deli)

1. **Bundle + submit are the coordinator's:** the level-34 kit check fails
   only on `transcripts_present` (no bundle supplied in this phase). The
   coordinator must bundle transcripts (top-level agent's sessions, incl.
   this subagent's work as recorded by the harness) and re-run `makefun
   check` with `--transcripts` before submit; the 5 at-submission checks
   (repo public, owner, created-after-open, commit pushed,
   duplicate_snapshot) also resolve only at submit time.
2. **Ticket-11 FAIL (deviation 4) needs Deli's eyes:** the entry
   deliberately does NOT reproduce the spec's published D10 numbers
   because they are a NaN artifact. If the judge's rubric was built from
   those numbers, the honest intervals will look "wrong" against it — but
   shipping the artifact would mean shipping wrong intervals. No action
   taken; flagging for the decision, not hiding it.
3. **Deviation 1 (D8 prose top-10):** same pattern — the formula's top-10
   ships, the prose list does not reproduce. If the rubric checks the
   prose list literally, two rows (tori-finance, axis vs
   polymarket-international, cian-yield-layer) differ. The gate (8/10)
   passes either way.
4. **No commit/push done:** the working tree is uncommitted on top of
   HEAD `c23c5cc` (10 files changed + 2 new files, see `git status`).
   Commit/push only after Fase C+D GO, per the task.

## Fase D-fix — 2 blocker teks dashboard (22 Nov 2026, ~04:00–04:40 WIB)

Perbaikan atas 2 blocker Fase D (`verification/radar3-review-report.md`,
keduanya teks dashboard, bukan model/board). Laporan lengkap:
`verification/radar3-dfix-report.md`. Tidak ada commit/push/submit/bundle,
tidak ada kuota dev grade, tidak ada wallet/keypair baru. Hanya 4 file
disentuh: `dashboard/app.js`, `BUILD.md` (bagian ini + 3 hitungan suite),
`tests/behaviour.mjs` (check baru, opsional), `screenshots/2-detail.png`.

- **B1 — displacement EV 142 → 143.**
  `dashboard/app.js:378` (methodology): "displaces one row 142 places" →
  "displaces one row **143** places". `BUILD.md:368` (Ticket 10) kalimat yang
  sama diperbaiki. Grep seluruh `entry/` untuk "142" lain: yang tersisa
  bukan displacement — `#14213d` (warna navy, `BUILD.md:21` +
  `dashboard/app.css:6`), `$1,492,142` (implied mezzanine, `BUILD.md:381`,
  `:509`, `:594`), dan substring hash `5d414252…` — semuanya dibiarkan.
  **Literal tetap ada, dicatat eksplisit:** `data.js` TIDAK membawa field
  displacement/overlap EV (payload: `fit`, `odds`, `max_ev`, `ledger`,
  `verdict_counts`, `median_odds`, …; tiap baris tidak punya `d1r_rank` /
  `ev_rank`), jadi kalimat ini tidak bisa dirender dari `data.js` tanpa
  menambah field payload — dan menambah field berarti mengubah `data.js` /
  dossier tanpa keperluan. Koreksi literal ke 143 sudah cukup; ini
  penyimpangan D14 "no pasted numbers" yang didokumentasikan, dan check
  baru di bawah mengunci nilai lamanya (`142 places` dilarang).
- **B2 — klaim "rank range stays wide" dihapus.**
  `dashboard/app.js:556` (dialog detail, bagian Uncertainty):
  lama: "…so the interval is degenerate while the rank range stays wide."
  baru: "…so the interval is degenerate; the rank range beside it is the
  computed range, narrow for the top rows." Jujur untuk SEMUA kasus
  P10=P90 (5 baris: steakhouse [1,1], sentora [2,2], gauntlet [3,3], veda
  [4,5], usdd [5,6] — semuanya sempit, spec §C1).
- **Byte dashboard:** 59,649 B → **59,690 B** (+41 B, hanya dari B2; B1
  ±0 B). Tetap ≤60,000 B ✓ (headroom 310 B). `app.js` 41,824 → 41,865 B;
  `index.html` 7,520 B, `app.css` 10,305 B tidak berubah.
- **Screenshot:** hanya `2-detail.png` di-render ulang (metode prebuild:
  Python Playwright headless, 1440×900, `file://`, DOM-verified sebelum
  capture — dialog terbuka, rank-1, Cost:/Time:, teks B2 baru ada, teks
  lama tidak ada; skrip `/tmp/shot_radar3_dfix.py`). 273,883 B →
  **277,089 B**, 1440×900, ≤512 KiB ✓. `1-board.png` (176,421 B) dan
  `3-filtered.png` (178,665 B) TIDAK di-render ulang: keduanya hanya
  menampilkan bagian atas halaman (header, KPI, filter, awal board);
  teks methodology B1 ada di bawah fold dan tidak tampil di keduanya
  (diverifikasi dengan membaca kedua PNG). Catatan: strip integrity di
  screenshot 1/3 masih menampilkan ukuran dossier lama ("871,187 B",
  sudah begitu sejak build radar-3); screenshot 2 yang baru menampilkan
  "900,428 B" (ukuran dossier dari run yang dipakai me-render) vs dossier
  final 904,700 B — selisih 4,272 B karena dossier meng-embed base64
  screenshot itu sendiri. Ini staleness tampilan yang sudah ada sejak
  sebelum D-fix, bukan blocker review; tidak dikejar ke fixed-point.
- **Hash (fresh run pasca-perbaikan, double-run `diff -r` bersih):**
  board.json sha256 `5d414252969dba6a96b71939c198ca1a4cd40f2f3794e402d3b229d13b675d7d`
  (444,718 B) — **SAMA dengan sebelum perbaikan** ✓ (teks-only, terbukti).
  data.js sha256 `ae014f190b3f8a252ec3edd5a66eec03ca7a05c7b2655cf92b5febc125d014e5`
  (447,210 B; lama `21b9aecb…`) — berubah HANYA pada string integrity
  yang meng-embed ukuran dossier ("900,387 B" → "904,700 B"), dibuktikan
  byte-diff dua tahap; semua baris/angka model byte-identik.
  dossier.json sha256 `b5de349ac86977a5fe01919f6203b31e51afe4d402f8369c2cb0f61b2b50a65d`
  (**904,700 B**; lama `1611b905…`, 900,387 B) — berubah karena `app.js`
  +41 B dan screenshot 2 +3,206 B (base64 di dossier).
- **Suite penuh dari nol, semua hijau:** `node tests/behaviour.mjs`
  **30/30 PASS**; `node scripts/verify.mjs` **21/21 PASS** (V1–V21, V1
  double-run byte-identik, V8 dossier `b5de349a…`, V9 dashboard 59,690 B,
  V13 konten screenshot DOM-verified); `python3 tests/hash-edge-cases.py`
  **10/10 PASS**. Double-run independen ke `/tmp/radar3-dfix-runA|B`:
  `diff -r` bersih.
- **Check baru (opsional, selesai):** `tests/behaviour.mjs` — check
  "no validation literals" kini juga meng-grep `dashboard/app.js` (dulu
  hanya `index.html` — celah N5 yang membuat B1 lolos). Daftar larangan =
  literal validasi yang dirender dari `data.js` + `142 places` (nilai B1
  lama, regression guard). Allowlist terdokumentasi di komentar check:
  `143 places` + `5/10` (kalimat methodology, §C4 — literal yang
  didokumentasikan, lihat B1 di atas), `≈ 3.6`, `roughly 24×`,
  `100,000×`/`10,000×` (restatement threshold), `7 steps`, rentang
  kontrol sandbox. Suite tetap hijau (30/30).
- **Angka model/board TIDAK berubah:** top-10, verdict FARM 104 / THIN 80 /
  SKIP 14, LOO 1.2908, R² 0.2493, AUC 0.7647, EV maks $35,830,169 —
  semuanya sama; V15–V21 recompute independen tetap lolos.

## radar-4 (tickets T1–T5, spec radar-4 + amendment Fase A) — 23 Nov 2026, Fase B (build)

- **Built:** branch `radar-4` dari HEAD `2cdce26`. Model commit `8e5f420`
  (T1–T4 model + behaviour), dashboard/screenshot commit menyusul. Status:
  BUILD ONLY — NO submit, NO bundle, NO check-submit, NO push, NO wallet baru.
  Kit fresh level 38; snapshot byte-identik dengan kit 21 Nov (sha `42a71213…`).
- **T1 walk-forward (n=95 dated live, 33 null excluded, tanpa imputasi):**
  lipatan 66/29 median 1.2004 coverage 79.3%; lipatan 80/15 median 2.2077
  coverage 73.3%; gabungan (44 prediksi, 15 termuda di kedua lipatan) median
  1.2509 coverage 77.3%; LOO implied-basis (clamped) 1.2490. Basis = implied
  dengan clamp 0.08–0.60 (41/128 live-token di luar clamp) — versi pertama
  tanpa clamp memberi angka berbeda (gabungan 1.3779) dan diperbaiki setelah
  script recompute kedua menangkapnya (lihat
  `verification/build-log-radar4.md` §0).
- **T2 ablasi (LOO / WF gabungan, full 1.2490 / 1.2509; drop bar 0.05):**
  slope/size 1.2006 / 1.3403, growth 1.3106 / 1.3183, maturity 1.2387 / 1.3542,
  category effects 1.2434 / 1.2126 — semua KEEP, tidak ada term lolos bar.
  Board ranking TIDAK berubah; top-10 dan verdict (FARM 104 / THIN 80 /
  SKIP 14) sama dengan radar-3.1.
- **T3 comps:** 3 traded-token terdekat per baris (|ln TVL ratio|,
  se-kategori dulu, TVL terdekat lintas kategori); 102/198 baris butuh
  fallback (18 dengan 0 se-kategori). Dialog detail menampilkan "Anchored by".
- **T4:** 5 baris p10==p90 menampilkan "stable in N/200 refits" dengan N
  terukur (steakhouse 198, sentora 198, gauntlet 197, veda 196, usdd 188) —
  bukan 200/200. Angka bootstrap di data.js tidak berubah.
- **T5:** dashboard 62.906 B (html 7.520 + js 45.081 + css 10.305) ≤ 65.000 B
  target. Screenshot di-render ulang 1440×900 (BUKAN 1280×720: RULES.txt
  level 38 mensyaratkan short side ≥ 800 px, jadi 720 px akan gagal gate):
  1-board.png 180.283 B, 2-detail.png 283.347 B, 3-filtered.png 182.246 B.
- **Suites:** behaviour 41/41, verify 25/25 (V1–V21 + V22 walk-forward,
  V23 ablasi, V24 comps, V25 dashboard DOM), hash edge-case 10/10,
  double-run `diff -r` bersih. Board hash `78704c86…` (516.059 B — berubah
  dari radar-3.1 `5d414252…` hanya karena field baru comps/stable_refits;
  ranking + implied values byte-identik). Dossier 926.214 B, sha `bb1cb93a…`.
- **Aturan env-secret (RULES.txt level 38):** grep bersih — tidak ada
  eval/Function/vm/dynamic import di kode entry; satu-satunya `process.env`
  adalah `main.ts` membaca `MAKEFUN_OUTPUT_DIR` sebagai path (diizinkan).
- **Tidak dilakukan (di luar Fase B):** README tidak diubah (Fase E),
  tidak ada bundle/check-submit/submit/push.
