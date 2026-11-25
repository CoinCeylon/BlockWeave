// Witness implementations for sealed_auction.compact.
// Types come from the compiler output: run `npm run compile:fast` first.
//
// Private state lives only on the bidder's machine (Midnight.js private state
// provider). It is never sent to the chain; only ZK proofs about it are.

import type { WitnessContext } from "@midnight-ntwrk/compact-runtime";
import type { Ledger, Witnesses } from "../managed/sealed_auction/contract/index.js";

export type AuctionPrivateState = {
  secretKey: Uint8Array; // 32 bytes, per user (auctioneer or bidder)
  bidAmount: bigint; // LKR per kg (0n for the auctioneer)
  bidSalt: Uint8Array; // 32 random bytes, new for every bid
};

type Ctx = WitnessContext<Ledger, AuctionPrivateState>;

export const witnesses: Witnesses<AuctionPrivateState> = {
  localSk: ({ privateState }: Ctx) => [privateState, privateState.secretKey],
  bidAmount: ({ privateState }: Ctx) => [privateState, privateState.bidAmount],
  bidSalt: ({ privateState }: Ctx) => [privateState, privateState.bidSalt],
};

function random32(): Uint8Array {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return b;
}

/** A new identity (auctioneer or bidder) with no bid yet. */
export function newParty(): AuctionPrivateState {
  return { secretKey: random32(), bidAmount: 0n, bidSalt: random32() };
}

/** Same identity, new sealed bid. Always uses a fresh salt. */
export function withBid(state: AuctionPrivateState, amountLkr: bigint): AuctionPrivateState {
  return { ...state, bidAmount: amountLkr, bidSalt: random32() };
}
