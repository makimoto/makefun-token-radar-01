# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/makimoto/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/makimoto/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar built from one sealed DefiLlama snapshot (2026-11-14). All 758 protocols are classified with reasons: 416 record a token, 144 are excluded by category and name screens, and 198 pre-token protocols (the full 40-protocol watchlist plus 158 eligible early rows) are ranked by an implied value from a size curve fitted on the snapshot's own token-recording peers — leave-one-out median |log10 error| 0.530, recomputed on the page. Every ranked protocol carries a concrete farm plan with per-step cost and time, a gas verdict against an 8% line, and exit timing that is rechecked while the position is held. The dashboard is static, sortable and filterable, and recomputes each implied value from the snapshot inputs.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=9f5dxbzs&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
