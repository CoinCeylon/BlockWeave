// The ONE interface the UI talks to. Screens never call Mesh / Midnight.js
// directly. On 1 Dec, Person A implements `cardano.ts` and Person B
// implements `midnight.ts` behind these same functions, then we flip
// NEXT_PUBLIC_DATA_SOURCE=chain.

import type { AuctionState, LotWithHistory, Party, Sale } from "../types";
import { mockSource } from "./mock";

export type NewLotInput = {
  region: string;
  grade: string;
  weightKg: number;
  harvestDate: number;
  note: string;
};

export interface TeaTrailSource {
  // Cardano passport
  listLots(): Promise<LotWithHistory[]>;
  getLot(lotName: string): Promise<LotWithHistory | null>;
  createLot(signer: Party, input: NewLotInput): Promise<LotWithHistory>;
  advanceLot(signer: Party, lotName: string, note: string, sale?: Sale): Promise<LotWithHistory>;

  // Midnight auction
  getAuction(lotName: string): Promise<AuctionState | null>;
  openAuction(signer: Party, lotName: string, reserveLkr: number): Promise<AuctionState>;
  placeBid(bidder: Party, lotName: string, amountLkr: number): Promise<AuctionState>;
  startReveal(signer: Party, lotName: string, startLkr: number): Promise<AuctionState>;
  lowerThreshold(signer: Party, lotName: string, stepLkr: number): Promise<AuctionState>;
}

export function getSource(): TeaTrailSource {
  // if (process.env.NEXT_PUBLIC_DATA_SOURCE === "chain") return chainSource;
  return mockSource;
}
