# Midnight status + what we need before wiring up

*Written 27 Nov 2026 by Kavishan (Person B). Read time: about 5 minutes.*

## TL;DR

✅ **The sealed-bid auction works end to end on a real Midnight network (Preview).** It deployed, took 3 sealed bids, counted down the threshold and picked a winner. **The losing bids never became public.** The 30 Nov milestone for Person B is done.

Before we connect everything to the app (1–7 Dec), **each part needs to be at the same level**: working on its own, on a testnet, from a script. Your to-do list is in [section 3](#3-what-everyone-needs-to-do-before-we-wire-up). **Please also answer the 6 decisions in [section 4](#4-decisions-we-need-to-agree-reply-yes-or-no).**

---

## 1. What's done on the Midnight side

### The result (on Midnight Preview, 27 Nov, 21:34)

| | |
|---|---|
| Contract | `d9dc9e28392fb945c40fd0090cae37fc8df89fef609c5c9f5655baf668e6af99` |
| Lot | `8188e3fa…` (random test lot; the next run will use a real Cardano lot) |
| Reserve | 1,200 LKR/kg |
| Sealed bids | A: 1,300 · B: 1,450 · C: 1,380. These amounts **never left the PC** |
| On chain during bidding | 3 bidder keys + 3 hashes. **No amounts** |
| Rule checks (all rejected) | bid below reserve · bidder trying to run the reveal · lower bidder trying to claim |
| Reveal | threshold 1600 → 1550 → 1500 → 1450 |
| Winner | **Bidder B at 1,450 LKR/kg** |
| Privacy check | ✅ 1,300 and 1,380 appear **nowhere** in the public state |

What anyone in the world can see after the auction:
```
phase: CLOSED   reservePrice: 1200   bidCount: 3
sealedBids: 3 × { bidder: <key>, commitment: <hash> }
threshold: 1450   winner: 718dd459…   winningPrice: 1450
```
This is our privacy proof for the pitch: one winner, one price, and no losing bids.

### What's in the repo (branch `b/compile-auction`, `contracts/midnight/`)

| Thing | What it does |
|---|---|
| `src/sealed_auction.compact` | The contract. Commit + descending-threshold reveal. Compiles with Compact 0.36.1 (the current toolchain) |
| `test/auction.test.mjs` | **11 local tests** with no network needed: full auction, all the rule checks, plus a privacy test that fails if a losing bid leaks |
| `npm run wallet` | Creates and funds the CLI wallet and registers it for DUST (Midnight's fee resource) |
| `npm run demo` | Runs a full auction on chain. `-- --resume` carries on one that stopped half-way; it waits out network hiccups |
| `npm run status` | Shows an auction's public state (what the world sees) |
| `npm run doctor` | Checks every connection the wallet needs; the output is safe to paste |
| `cli/deployments/*.json` | Public record of each auction: contract, lot, reserve, winner, price |

### Things that changed in the Midnight world this month (good to know)

- **Midnight Preprod is now only reachable through Blockfrost.** Midnight shut its own Preprod servers (9 Oct / 18–23 Nov). A **Midnight Preprod** Blockfrost key is *different* from the Cardano one.
- **We run the auction on Midnight Preview**, which still has Midnight's own servers and needs no key. Cardano stays on Preprod. Both are official testnets, which is what the rules require.
- **Most online tutorials are out of date.** The network upgrade (ledger 9) on 9 Nov broke the old examples. The current reference is `midnightntwrk/midnight-examples`. Our versions: Compact 0.36.1, proof server 9.0.2, Midnight.js 5.0.1.
- **Lace's "Generate tDUST" button is broken** right now (Lace bug #2274). Our CLI wallet works around it, but **the browser can't pay Midnight fees through Lace yet.** See decision D6.
- On Windows, Midnight tools only run inside **WSL (Ubuntu)**.

---

## 2. Want to see it yourself? (optional, ~1 hour the first time)

You don't need to do this to do your own part, but it helps for reviewing my PR.

```bash
# in Ubuntu (WSL) with Node 22+, Docker and: compact update 0.36.1
git fetch && git switch b/compile-auction
cd contracts/midnight
npm install
npm run compile:fast && npm test     # 11 passing, no network needed (2 minutes)
```
To run it on chain as well:
```bash
npm run compile                                   # full build with ZK keys
docker run -p 6300:6300 midnightntwrk/proof-server:9.0.2   # separate terminal
cp .env.example .env && echo "MIDNIGHT_NETWORK=preview" >> .env
npm run wallet      # prints an mn_addr_preview1… address: fund it at
                    # https://midnight-tmnight-preview.nethermind.dev/ and wait for DUST
npm run demo
```
⚠️ `.env` holds your wallet seed. It's git-ignored; **never commit it or paste it anywhere.**

---

## 3. What everyone needs to do before we wire up

Goal: by **30 Nov**, every part works **on its own, on a testnet, from a script**, the way the Midnight part does now. Then 1–7 Dec is just connecting the parts.

### 🟦 Person A: Cardano (passport)

| # | Task | Done means |
|---|---|---|
| A1 | Mint one lot passport on **Cardano Preprod** with the registry applied | Tx hash posted in the group |
| A2 | Advance that lot through the checkpoints on Preprod: Processed → Brokered → **Sold** → Exported | 4 tx hashes posted; the contract **rejected** at least one wrong-role or wrong-order attempt (screenshot or log) |
| A3 | Make it **one command** (like `npm run demo`) that mints and advances a lot | Anyone on the team can run it from the README |
| A4 | Check the **Sold** checkpoint takes what Midnight produces: `winner` = 64-hex key, `priceLkr` = number, `auctionId` = 64-hex Midnight contract address | One Sold tx on Preprod with this example: winner `718dd459ca4afa2a55064692fd69bf1fda0f2d5a4ad1a4915f02df79a4d60270`, price `1450`, auctionId `d9dc9e28392fb945c40fd0090cae37fc8df89fef609c5c9f5655baf668e6af99` |
| A5 | **Send me one real lot name** (the 64-hex NFT asset name) of a lot that has reached *Brokered* | I'll run the next auction **for that exact lot**, so the demo links both chains |
| A6 | Push to an `a/...` branch, open a PR | PR link in the group |

Tip: the Cardano Blockfrost key (`preprod…`) is separate from Midnight's. Keep yours in a git-ignored `.env` too.

### 🟩 Person C: Product + frontend

| # | Task | Done means |
|---|---|---|
| C1 | All screens final on **mock data** (estate, checkpoint, auction, scan page) | Full demo flow clickable on `npm run dev` |
| C2 | **Mobile layout** for the QR scan page | Looks right on a phone |
| C3 | Auction screen shows the states the real contract has: **Bidding** (hashes only, no amounts), **Reveal** (live threshold), **Closed** (winner + price), **Closed – no sale** | Each state visible with mock data |
| C4 | Show the winner as a **name + short key**, e.g. "Bidder B (demo) · 718dd4…" (see D4) | |
| C5 | At least **1 industry interview** (estate, factory, broker or exporter) | 1–2 quotes written down for the README/pitch |
| C6 | A pitch slide: **"What the world sees vs. what stays private"**, using the public state in section 1 | Draft slide |
| C7 | Push to a `c/...` branch, open a PR | PR link in the group |

### 🟨 Everyone

| # | Task | By |
|---|---|---|
| E1 | **Submit the GitHub access form** (organiser code + all 3 GitHub usernames) | **1 Dec** (hard deadline 5 Dec, 11:59 PM) |
| E2 | Review and approve the Midnight PR `b/compile-auction` (a quick look is fine) | 29 Nov |
| E3 | **Answer the 6 decisions below** | 29 Nov |

---

## 4. Decisions we need to agree (reply YES or NO)

These come from differences between the app's mock auction and the real contract. Changing `types.ts` or `index.ts` needs all three of us in one PR, so each proposal changes as little as possible.

| # | Difference | Proposal | Changes the shared interface? |
|---|---|---|---|
| **D1** | The real contract has a **claim** step (the winner proves their bid ≥ threshold); the app has none | `midnight.ts` claims automatically for the highest eligible bidder after each threshold drop, like the mock already does. In the pitch: "in production each bidder's own browser does this" | No |
| **D2** | The app's `lowerThreshold` sends a **step** (e.g. 50); the contract wants the **new price** | `midnight.ts` converts it: new price = max(reserve, current − step) | No |
| **D3** | **No sale**: the mock closes by itself at reserve; the contract needs an explicit call | `midnight.ts` calls it automatically when the threshold reaches reserve and nobody claims | No |
| **D4** | On chain the winner is a **64-hex key**, not a name | `AuctionState.winner` and `Sale.winner` stay the hex key, since that's what's provable. Add **one optional display field** `winnerName?: string` to `AuctionState` | Yes, but additive and optional |
| **D5** | Networks: **Cardano Preprod + Midnight Preview** | Keep it. `auctionId` = the Midnight contract address | No |
| **D6** | **Browser can't pay Midnight fees** (Lace DUST bug) | A small **local helper program** on the demo laptop holds the funded Midnight wallet; `midnight.ts` calls it over `localhost`. If Lace gets fixed before 10 Dec we can switch, but we won't depend on it | No |

---

## 5. After that: the wiring plan (1–7 Dec)

| Who | What |
|---|---|
| B (Kavishan) | Local Midnight helper (`npm run serve`) + `app/src/lib/data/midnight.ts` behind `TeaTrailSource` |
| A | `app/src/lib/data/cardano.ts` behind `TeaTrailSource` (Mesh + Lace on Cardano Preprod, Blockfrost for reading history) |
| C | Flip `NEXT_PUBLIC_DATA_SOURCE=chain`, fix whatever the real data breaks in the UI, keep mock as the fallback |
| All | **End-to-end test**: create lot (A) → Processed → Brokered → auction on Midnight (B) → **Sold** written to Cardano with the Midnight result (A+B) → Exported → scan page shows the full journey (C) |

**Safety net (unchanged):** each part must still demo on its own. If Midnight misbehaves on demo day, the Cardano passport alone is a complete product, and the CLI auction run above is our recorded proof.

---

## 6. Honest limits (say these in the pitch)

- **Ties** at the same threshold go to whoever submits first, so we use small steps.
- The **auctioneer runs the countdown**. A production version would use a time-based schedule.
- **Payment is off-chain** for the hackathon. The result is copied to Cardano as the Sold checkpoint by the auctioneer, not by a trustless bridge.
- The Midnight demo runs on **Preview**, because of the Preprod/Blockfrost and Lace issues above.
