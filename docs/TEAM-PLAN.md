# Team plan: build sessions

Three people working in parallel until 30 Nov, then integrating. Everyone codes against
`app/src/lib/types.ts` and the `TeaTrailSource` interface in `app/src/lib/data/index.ts`.
**If you change the data shape, change it in both `types.ts` and `types.ak` in the same PR.**

## Today's session (Wed 25 Nov)

| | Person A: Cardano | Person B: Midnight | Person C: Product + frontend |
|---|---|---|---|
| First 30 min | Clone, `aiken check` passes on your machine | Toolchain + proof server running | `npm run dev`, click the full demo flow |
| Main block | Mesh script: mint one lot on Preprod with the registry applied | Run one official example on Preprod | Polish screens, mobile layout for the scan page |
| Before you stop | Push branch, post the minted lot's tx hash in the group | `sealed_auction.compact` compiles (or a list of errors) | Message 3 tea industry contacts for interviews |

## Milestones

| Date | Done means |
|---|---|
| **30 Nov** | A: a lot advanced through all 4 checkpoints on Preprod. B: 3-bidder auction run from a CLI script. C: all screens final on mock data, 1+ interview done |
| **by 1 Dec** | GitHub access form submitted (hard deadline 5 Dec 11:59 PM) |
| **1–7 Dec** | Write `app/src/lib/data/cardano.ts` (A) and `midnight.ts` (B) behind `TeaTrailSource`, flip `NEXT_PUBLIC_DATA_SOURCE=chain` |
| **10 Dec** | Must-work list green on testnet |
| **11 Dec** | Feature freeze |
| **11–13 Dec** | README, 2–4 min demo video, pitch deck, rehearsal |
| **14 Dec 12:00** | Submission deadline |

## Git workflow

- `main` always runs. Work on `a/...`, `b/...`, `c/...` branches and open small PRs.
- One other person reviews each PR. A quick look is fine. The point is that two people know every part.
- Commit messages say what changed: `cardano: reject Sold without price`.
- Never commit `.env.local`, seed phrases or `.skey` files. Run `git status` before every commit.

## Safety net

If Midnight gets stuck, the Cardano passport alone is a complete product. Keep each part demoable on its own.
The mock data source stays in the repo as a fallback for the live demo.
