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
