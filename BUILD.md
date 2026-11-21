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

## Model (radar-2, spec D1 — implemented exactly)

- `implied = TVL × m_cat × size_mult × growth_mult × maturity_mult`,
  `max(1, round(...))`; m_cat table: Lending 0.132, Yield 0.180, RWA 0.275,
  Dexs 0.342, Bridge 0.557, Basis Trading 0.60 (clamped), Liquid Staking / CEX
  0.08 (clamped), fallback 0.205; size `clamp((50M/TVL)^0.10, 0.70, 1.30)`;
  growth `1 + 0.60 × clamp(change_7d, −40, +60)/100`; maturity
  `0.70 + 0.30 × min(age, 1095)/1095`, null age → 365d.
- Worked example (spec): median watchlist protocol scores **$30,953,011 ≈ $30.9M** ✓.
- Board eligibility = watchlist rule minus the $50M floor: pre-token, category not
  in {CEX, Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC},
  name not versioned, no whole word wrapped/staked/staking, not starting with an
  exchange name. Verified read-only from the snapshot before coding: **198 rows
  (40 watchlist + 158 early)**.
- Rank 1: `steakhouse-financial`, implied **$331,015,075**; rank 198: `granite`,
  **$827,873**. Implied values non-increasing, not all identical.

## Farm plans (ticket 03)

- 7 steps per row × 198 rows = 1,386 steps; every step 20–600 chars
  (actual min 117, max 217), format `<action> Cost: <cost>. Time: <time>.`
- 12 families with distinct core + second + weekly actions: lending, dexs, yield,
  risk-curators, rwa, bridge, staking, derivatives, stablecoin, insurance,
  payments, chain-governance. Capital tiers $250 / $150 / $100 / $50 from TVL;
  gas $8 at ≥$150 capital, $4 below; hold 60 / 45 / 30 days from age.
- Fallback (generic deposit) used on **10/198 rows** (5%): Prediction Market 2,
  CeDeFi 2, Anchor BTC 2, Decentralized BTC 2, OTC Marketplace 1,
  Crypto Card Issuer 1 — a small minority, as ticket 03 expects.
- No step promises an airdrop/token/date, names a URL, or is a slogan; token
  status phrased "records no token". Spot-checked: Risk Curators / RWA / Dexs
  step-2 texts differ in action, not just in the protocol name.

## Dashboard (ticket 04)

- 3 files, total source **30,012 B** (index.html 6,895 + app.css 7,743 + app.js 15,374)
  — under the 60,000 B target and the 65,536 B hard cap.
- Sortable on rank, name, category, TVL, 7d, age, implied (default implied desc);
  filters: category select (with counts), chain select, watchlist-only checkbox,
  free-text search, min-TVL input — all combinable; live "N rows shown";
  hash deep-links `#category=`, `#chain=`, `#p=`, `#q=`, `#watch=`, `#min=`.
- Detail dialog per protocol (click or `#p=<slug>`): figures, full model breakdown
  in words, "records no token", all 7 farm steps.
- Separate live-token section: top 24 by market cap, labelled market values.
- Methodology section states the model with the snapshot numbers (overall median
  0.205, category medians, size-band medians 0.414 / 0.131 / 0.032 / 0.044,
  growth-clamp rationale, "records no token" note), snapshot `as_of` 2026-11-14.
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
dialog when `#p=` disappears.

## Dossier + double-run determinism (ticket 06)

- Runtime: **0.24–0.34 s** per run (budget 120 s), no network, no install.
- Two runs to `/tmp/radar-runA` and `/tmp/radar-runB`: **`diff -r` clean**,
  byte-identical trees including board.json, data.js, dashboard/, screenshots/,
  dossier.json.
- `board.json` sha256 (both runs): `d6137cd6df99eeeec15e73e04528b20136359d4d93956a16f44f509ed8f826d8`
- `dossier.json`: **825,011 B** (≤1.5 MiB ✓), sha256
  `eb27294708ec9a8fb6d391fb32e4cdf858b8fcc148be0a02b4925954a8a229e6`;
  independently rebuilt with vendored `buildDossier` (text_max_bytes 65536) and
  **byte-compared identical**; no truncation markers in the dossier text.
- Output sizes: board.json 337,204 B (≤8 MiB ✓), data.js 336,780 B;
  `data.js` rows agree exactly with board.json (slugs, ranks, implied values);
  live view 24 rows, all positive mcap.

## Behaviour tests

`node tests/behaviour.mjs` — **18/18 PASS** (198 rows, ranks 1..198, implied
non-increasing, watchlist 40/40, 7 steps/row, step shape, no airdrop/URL,
model breakdown, no live slug in board, worked example, dashboard ≤60,000 B,
dossier ≤1.5 MiB, 3 screenshots ≤512 KiB, data.js/board agreement).

## Spec deviations and notes (with reasons)

1. **Snapshot-analysis numbers differ slightly from the spec's § Snapshot analysis.**
   Recomputed read-only from the sealed snapshot: live protocols with positive
   mcap = **128** (spec says 129), overall median mcap/TVL = **0.214** (spec
   0.205), Yield median = **0.191, n=9** (spec 0.180, n=10). The model uses the
   spec's stated table values exactly as specified in D1 — the discrepancy is in
   the spec's analysis counts, not in the implemented constants, so no model
   value changes. Flagged for ticket 07 to confirm.
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
