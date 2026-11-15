# Token Radar

[![make.fun](https://make.fun/badge/bounty.svg)](https://make.fun/bounty/token-radar-01)
[![make.fun](https://make.fun/badge/competition.svg)](https://make.fun/bounty/token-radar-01)
[![make.fun](https://make.fun/badge/entry.svg)](https://make.fun/bounty/token-radar-01)

Build the best token launch radar. A web dashboard that tracks the protocols
whose token does not exist yet, ranks them by an implied value, and shows a
reader how to farm each one — built to find future airdrops early.

## What it does

- Reads the sealed DefiLlama snapshot (`input/snapshot.json`, fetched
  2026-11-14) and scores every pre-token protocol with the radar-2 model:
  TVL x growth (with a momentum kicker past 50% in seven days) x maturity
  (rising with age, tapering past three years) x the category's own factor
  x the chain-breadth factor. No protocol name is ever special-cased.
- Ranks **198 protocols**: the whole 40-protocol watchlist plus every other
  protocol the house's exclusion rule keeps (not a wrapped, staked or
  bridged product, not a versioned pool, not an exchange).
- Gives every row a six-step farm plan derived from its category, chains,
  TVL and age, each step with an explicit cost and time.
- Renders a static, no-network dashboard (`dashboard/`) with search,
  category and chain filters, a watchlist-only toggle, a live-token view
  (top 24 by market cap), and a detail drawer with the model's five-factor
  breakdown for every row.

## Run it

```sh
node main.ts --input path/to/snapshot.json
```

Writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and
`dossier.json` to `/output` (or `$MAKEFUN_OUTPUT_DIR`). Deterministic:
two runs write identical bytes.

## License

MIT — see [LICENSE](LICENSE).

Built with [make.fun](https://make.fun/bounty/token-radar-01) — an entry in the
"Build the best token launch radar" bounty.
