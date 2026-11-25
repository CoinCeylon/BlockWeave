# Midnight: sealed-bid auction (Person B)

`src/sealed_auction.compact` is a **draft that has not been compiled yet**. The
first job is to get it compiling, then deploy to Preprod.

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

## Build

```bash
cd contracts/midnight
compact compile src/sealed_auction.compact managed/sealed_auction
```

Generated TypeScript lands in `managed/` (git-ignored). Point `src/witnesses.ts` at
the generated types.

## This week's checklist

- [ ] Toolchain + proof server running; an official example deployed to Preprod
- [ ] `sealed_auction.compact` compiles
- [ ] CLI script: deploy, 3 bids from 3 wallets, startReveal, lowerThreshold, claimWin
- [ ] Confirm the losing amounts don't appear anywhere in the public ledger state
- [ ] Hand Person C a small TS module: `deployAuction`, `placeBid`, `getState`, `claimWin`
