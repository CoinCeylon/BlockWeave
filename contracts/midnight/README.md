# Midnight: sealed-bid auction (Person B)

`src/sealed_auction.compact` **compiles** with Compact toolchain 0.36.1 (Preprod, ledger 9)
and passes 11 local simulator tests. `cli/` deploys it to Preprod and runs a full
3-bidder auction (Midnight.js 5.0.1, wallet SDK 2.0.1). Not yet run on Preprod.

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

1. WSL/Linux, Node 22, Compact toolchain `compact update 0.36.1`, Docker.
   See `claude/midnight-build-guide.md` in the team project for Windows steps.
2. Don't use the old official starters (`example-counter`, `create-mn-app`):
   they target the pre-upgrade network. The maintained reference is
   https://github.com/midnightntwrk/midnight-examples (our `cli/wallet.ts` comes from it).

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

## Run on Preprod

You need: the full build (`npm run compile`), the proof server running, and a
Blockfrost **Midnight Preprod** project key.

```bash
# terminal 1: proof server (leave running)
docker run -p 6300:6300 midnightntwrk/proof-server:9.0.2

# terminal 2
cd contracts/midnight
cp .env.example .env        # then put your nightpreprod... key in it
npm run wallet              # 1st time: creates a wallet, prints its mn_addr_preprod1... address
                            # fund that address at https://midnight-tmnight-preprod.nethermind.dev/
                            # it then registers DUST and waits until there's enough to deploy
npm run demo                # deploy + 3 sealed bids + rule checks + reveal + claim
npm run status              # public state of the last auction (or: npm run status -- <address>)
```

| Command | What it does |
|---|---|
| `npm run wallet` | Creates/syncs the CLI wallet, waits for faucet tNIGHT, registers it for DUST (works around Lace's DUST bug), waits for ~60 DUST |
| `npm run demo` | One full auction for a random lot (`-- --lot <64 hex>` for a real Cardano lot name, `-- --reserve 1200`). About 9 transactions |
| `npm run status` | Reads the public ledger from the indexer. No wallet needed. This is all the world can see |

How it works:
- **One wallet pays every fee.** A party's identity is the secret key in its private
  state (`localSk` witness), not the wallet. The script keeps 4 private states:
  `auctioneer`, `bidder-a/b/c`.
- **Rule checks cost nothing:** a bid below reserve, a bidder running the reveal and a
  losing bidder claiming all fail in local circuit execution, before any proof or fee.
- **Secrets stay local:** `.env` (seed, Blockfrost key, DB password), `midnight-level-db/`
  (encrypted private states) and `.wallet-state/` are git-ignored.
  `cli/deployments/<address>.json` holds only public facts (lot, reserve, winner pk,
  price), so commit it to share contract addresses with the team.
- First sync of a new wallet on Preprod can take a while; later runs reuse
  `.wallet-state/` and are quick.

If it fails:

| Error | Fix |
|---|---|
| `Proof server not reachable` | Start the docker command above |
| `No proving keys` | `npm run compile` (the full build) |
| `BLOCKFROST_PROJECT_ID ...` / HTTP 403 | Midnight Preprod key (`nightpreprod…`) in `.env`, not the Cardano one |
| `Wallet.InsufficientFunds` / `could not balance dust` | Not enough DUST yet: re-run `npm run wallet` and wait |
| Repeated `Wallet.Sync` lines | Normal on the first sync, leave it running |

## This week's checklist

- [ ] Toolchain + proof server running on Kavishan's PC; `npm test` and `npm run compile` pass there
- [x] `sealed_auction.compact` compiles (0.36.1)
- [x] Local simulator tests: 3 bidders, reveal, claim, rule checks, privacy
- [x] CLI script written: deploy, 3 bidders (one funded wallet, 3 private states), startReveal, lowerThreshold, claimWin
- [ ] `npm run wallet` + `npm run demo` succeed on Preprod
- [ ] Confirm on Preprod (`npm run status` + explorer) what the simulator test already shows: losing amounts never appear
- [ ] Hand Person C a small TS module: `deployAuction`, `placeBid`, `getState`, `claimWin`
