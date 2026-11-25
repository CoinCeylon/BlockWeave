// KEEP IN SYNC with contracts/cardano/lib/teatrail/types.ak
// This file is the agreement between Person A (Cardano), Person B (Midnight)
// and Person C (frontend). Change it together, in one PR.

export const STAGES = ["Harvested", "Processed", "Brokered", "Sold", "Exported"] as const;
export type Stage = (typeof STAGES)[number];

export type Role = "estate" | "factory" | "broker" | "auctioneer" | "exporter";

/** Which role signs the checkpoint that moves a lot INTO each stage. */
export const ROLE_FOR_STAGE: Record<Stage, Role> = {
  Harvested: "estate",
  Processed: "factory",
  Brokered: "broker",
  Sold: "auctioneer",
  Exported: "exporter",
};

export type Sale = {
  winner: string; // Midnight bidder id
  priceLkr: number; // LKR per kg
  auctionId: string;
};

/** Mirrors the on-chain LotDatum. */
export type Lot = {
  lotName: string; // hex NFT asset name
  estate: string; // key hash (mock: party id)
  estateName: string; // display only, not on-chain
  region: string;
  grade: string;
  weightKg: number;
  harvestDate: number; // POSIX ms
  stage: Stage;
  holder: string;
  note: string;
  sale: Sale | null;
};

/** One row of the public journey (one Cardano tx). */
export type Checkpoint = {
  stage: Stage;
  by: string; // key hash / party id
  byName: string;
  note: string;
  at: number; // POSIX ms (block time)
  txHash: string;
};

export type LotWithHistory = Lot & { history: Checkpoint[] };

export type Party = { id: string; name: string; role: Role };

// ---- Midnight auction (public view only: no amounts until reveal) ----
export type AuctionPhase = "BIDDING" | "REVEAL" | "CLOSED";

export type AuctionState = {
  auctionId: string;
  lotName: string;
  phase: AuctionPhase;
  reservePriceLkr: number;
  bidCount: number;
  commitments: { bidder: string; commitment: string }[]; // public hashes only
  thresholdLkr: number;
  winner: string | null;
  winningPriceLkr: number | null;
};
