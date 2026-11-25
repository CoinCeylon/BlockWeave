# Midnight: sealed-bid auction (Person B)

`src/sealed_auction.compact` **compiles** with Compact toolchain 0.36.1 (Preprod, ledger 9)
and passes 11 local simulator tests. Next: deploy to Preprod from a CLI script.

## How the auction keeps bids secret

| Phase | What's public | What stays private |
|---|---|---|
| BIDDING | number of bids, one commitment hash per bidder | every amount |
| REVEAL | the current threshold price (counts down) | every amount |
| CLOSED | winner key + winning bid | all losing bids, forever |

A ZK proof checks each bid is above the reserve at bid time. In the reveal phase,
the first bidder whose sealed bid is at or above the threshold proves it and wins.
The client claims automatically, so the highest bid always claims first.

**Known limits (say these in the pitch, judges like honesty):**
- Ties at the same threshold step go to whoever submits first, so use small steps.
- The auctioneer runs the countdown. A production version would use a time-based
  schedule instead.
- Settlement (payment) is off-chain for the hackathon. The app copies the
  winner and price to the Cardano passport as the `Sold` checkpoint.

## Setup

1. Follow https://docs.midnight.network/getting-started: install the Compact
   toolchain, then run the proof server with Docker on port 6300.
2. Get tNIGHT from the Preprod faucet: https://docs.midnight.network/guides/acquire-tokens
3. Run one official example end to end first (zkloan or leaderboard), so you
   know your toolchain works before you debug our contract.

## Build and test (no wallet or network needed)

Run inside WSL/Linux with `compact update 0.36.1` done:

```bash
cd contracts/midnight
npm install
npm run compile:fast   # TypeScript only, a few seconds
npm test               # 11 simulator tests: full auction, rule checks, privacy check
npm run typecheck      # witnesses.ts against the generated types
npm run compile        # full build with ZK proving keys (needed before deploying)
```

Generated code lands in `managed/` (git-ignored). The full `compile` downloads ZK
parameters from srs.midnight.network the first time.

The tests run the real compiled circuits against an in-memory ledger. The privacy
test checks that losing bid amounts appear nowhere in the public state, circuit
inputs/outputs or public transcripts, and that the winning price does.

## This week's checklist

- [ ] Toolchain + proof server running; an official example deployed to Preprod
- [x] `sealed_auction.compact` compiles (0.36.1)
- [x] Local simulator tests: 3 bidders, reveal, claim, rule checks, privacy
- [ ] CLI script on Preprod: deploy, 3 bidders (one funded wallet, 3 private states), startReveal, lowerThreshold, claimWin
- [ ] Confirm on Preprod (indexer) what the simulator test already shows: losing amounts never appear
- [ ] Hand Person C a small TS module: `deployAuction`, `placeBid`, `getState`, `claimWin`
