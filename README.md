# token-radar-01-entry

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/hyde1990/token-radar-01-entry/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/hyde1990/token-radar-01-entry/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Launch Radar: ranks 198 DefiLlama protocols with no token by expected launch value — fitted implied value (a pooled log-log OLS fit; LOO median |ln err| 1.29, R² 0.25: honest about uncertainty, not precise) times launch odds — with all 40 watchlist protocols covered. Rank 1 is BitFi Basis at $35,830,169 expected value (implied value $53,107,813, fitted rank 6); total expected value across the board is $785,907,488. The fit is validated three ways: leave-one-out, a 70/30 split (84.2% coverage), and a walk-forward test on the 95 dated live tokens (pooled median |ln err| 1.25, 77.3% coverage — the second fold is worse than the first, reported as measured). A per-term ablation keeps every term (none fails both blind tests). Every row carries launch odds (AUC 0.7647, Brier 0.1959) and expected value, P10–P90 and rank ranges from a deterministic B=200 bootstrap, the three nearest traded-token comps that anchor its value, and a farm verdict (FARM 104 / THIN 80 / SKIP 14), backed by a 758-protocol ledger. The board renders as a static offline dashboard (64,519 B) with an out-of-sample evidence section, a KPI/integrity strip, a sandbox, per-protocol detail, filters, and concrete farm plans with costs and times.

## Run it

```sh
node main.ts --input snapshot.json --output ./output
```

Then open `output/dashboard/index.html` in a browser. No install, no network; everything runs offline. In the grader the sealed snapshot is read from `/input/snapshot.json` and the output is written to `/output`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=witty-condor-29&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
