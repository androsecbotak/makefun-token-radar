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

## How the radar scores

One function of the snapshot's own figures, the same for every row:

- **Base:** a quarter of the protocol's TVL. Locked value is the anchor
  because it is the one figure every protocol reports the same way, and a
  protocol holding billions is scored from real usage, not from a promise.
- **Growth:** the seven-day change, clamped between -60% and +120%, with a
  momentum kicker past +50%. A fresh listing cannot win the board on one
  spike, and a run that keeps going after a strong week earns a little more.
- **Maturity:** 0.6 rising to 1.0 over three years, then tapering. A protocol
  that has run for years with no token has had years to earn one; past three
  years the credit tapers, because waiting that long shows it can wait longer.
  A missing listing date is given one year, the middle of the range.
- **Category:** a nudge of 5–15%. Curators and yield managers sit at the top
  because they already hold other people's money; bridges and chains sit at
  the bottom because they mostly move value that already exists elsewhere.
- **Chains:** +5% per extra chain, capped at four extra. Two chains are
  genuinely harder to ignore than one; twenty are not twenty times the
  opportunity.

No protocol name is ever special-cased. The dashboard shows the full
reading guide under the board ("Reading the radar"), one entry per factor,
and the detail drawer recomputes every row so a stale number shows itself.

## Reading the board

- **Rank** is the order of the implied value, highest first. The whole
  40-protocol watchlist sits inside the top 69; everything below it is an
  early find the exclusion rule kept.
- **"Records no token"** means the snapshot entry carries no market cap, no
  CoinGecko id and no symbol. It does not mean the protocol has no token,
  only that its record names none.
- **Live tokens are set aside.** Protocols whose token already trades appear
  in the live-token view with their market caps, never mixed into the ranked
  board, because a token that trades is a price, not an implied value.
- **The farm plan is a plan, not a promise.** Each row carries six steps with
  a cost and a time on each, derived from its category, chains, TVL and age.
  Costs are the cheapest honest way in, and the last step is always to write
  down what happened, because a farm with no log is one you cannot repeat.
- **An implied value is an estimate, never a price.** The snapshot is one
  day, 14 November 2026, and the board cannot know what launched after it.
  A TVL that can rise in a week can fall in one too.

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
