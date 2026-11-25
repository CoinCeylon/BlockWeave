// Witness implementations for sealed_auction.compact.
// STATUS: DRAFT — match the generated types in managed/sealed_auction/contract
// after the first `compact compile`, then remove the local type stubs below.
//
// Private state lives only in the bidder's browser (Midnight.js private state
// provider). It is never sent to the chain; only ZK proofs about it are.

export type AuctionPrivateState = {
  secretKey: Uint8Array; // 32 bytes, per-user, derived/stored in the wallet app
  bidAmount: bigint; // LKR per kg
  bidSalt: Uint8Array; // 32 random bytes, generated once per bid
};

// Minimal shape of the witness context Midnight.js passes in.
// Replace with: import type { WitnessContext } from "@midnight-ntwrk/compact-runtime";
type Ctx = { privateState: AuctionPrivateState };

export const witnesses = {
  localSk: ({ privateState }: Ctx): [AuctionPrivateState, Uint8Array] => [
    privateState,
    privateState.secretKey,
  ],
  bidAmount: ({ privateState }: Ctx): [AuctionPrivateState, bigint] => [
    privateState,
    privateState.bidAmount,
  ],
  bidSalt: ({ privateState }: Ctx): [AuctionPrivateState, Uint8Array] => [
    privateState,
    privateState.bidSalt,
  ],
};

export function newBidState(secretKey: Uint8Array, amountLkr: bigint): AuctionPrivateState {
  const salt = new Uint8Array(32);
  crypto.getRandomValues(salt);
  return { secretKey, bidAmount: amountLkr, bidSalt: salt };
}
