// Fake data source so the UI can be built and demoed with no wallet or chain.
// Stored in localStorage so it survives page reloads.
// Enforces the same rules as the real contracts (see ../rules.ts).

import { canAdvance } from "../rules";
import type { AuctionState, Checkpoint, LotWithHistory, Party, Sale } from "../types";
import type { NewLotInput, TeaTrailSource } from "./index";

export const PARTIES: Party[] = [
  { id: "estate-pedro", name: "Pedro Estate, Nuwara Eliya", role: "estate" },
  { id: "estate-kenilworth", name: "Kenilworth Estate, Dimbula", role: "estate" },
  { id: "factory-pedro", name: "Pedro Tea Factory", role: "factory" },
  { id: "broker-ceylon", name: "Ceylon Tea Brokers PLC", role: "broker" },
  { id: "auction-cta", name: "Colombo Tea Auction", role: "auctioneer" },
  { id: "exporter-lanka", name: "Lanka Leaf Exports", role: "exporter" },
  { id: "buyer-hamburg", name: "Bidder: Hamburg Teehaus", role: "exporter" },
  { id: "buyer-dubai", name: "Bidder: Gulf Blends", role: "exporter" },
];

const KEY = "teatrail-mock-v1";
const DAY = 86_400_000;

type PrivateBid = { bidder: string; amountLkr: number; salt: string };
type Store = {
  lots: LotWithHistory[];
  auctions: AuctionState[];
  // Simulates each bidder's LOCAL private state. On Midnight this never
  // leaves the bidder's browser; the public AuctionState only has hashes.
  privateBids: Record<string, PrivateBid[]>;
};

const nameOf = (id: string) => PARTIES.find((p) => p.id === id)?.name ?? id;
const randHex = (n: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");

async function sha256(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

function seed(): Store {
  const t0 = Date.now() - 12 * DAY;
  const cp = (stage: Checkpoint["stage"], by: string, note: string, d: number): Checkpoint => ({
    stage, by, byName: nameOf(by), note, at: t0 + d * DAY, txHash: randHex(32),
  });
  const demo: LotWithHistory = {
    lotName: "7a3f9c" + randHex(29),
    estate: "estate-pedro",
    estateName: nameOf("estate-pedro"),
    region: "Nuwara Eliya",
    grade: "BOPF",
    weightKg: 500,
    harvestDate: t0,
    stage: "Exported",
    holder: "exporter-lanka",
    note: "Shipped to Hamburg, container MSCU 482913",
    sale: { winner: "buyer-hamburg", priceLkr: 1450, auctionId: "cta-2026-47" },
    history: [
      cp("Harvested", "estate-pedro", "Hand-plucked at 1,868 m, two leaves and a bud", 0),
      cp("Processed", "factory-pedro", "Orthodox rolling, fired 6h, graded BOPF", 2),
      cp("Brokered", "broker-ceylon", "Catalogued as lot 42, sale no. 47", 5),
      cp("Sold", "auction-cta", "Sealed-bid auction closed. Winner Hamburg Teehaus at LKR 1,450/kg", 8),
      cp("Exported", "exporter-lanka", "Shipped to Hamburg, container MSCU 482913", 11),
    ],
  };
  const fresh: LotWithHistory = {
    lotName: "b21e04" + randHex(29),
    estate: "estate-kenilworth",
    estateName: nameOf("estate-kenilworth"),
    region: "Dimbula",
    grade: "FBOP",
    weightKg: 320,
    harvestDate: Date.now() - 3 * DAY,
    stage: "Brokered",
    holder: "broker-ceylon",
    note: "Catalogued as lot 18, sale no. 48",
    sale: null,
    history: [
      { ...cp("Harvested", "estate-kenilworth", "Morning pluck, west slope", 9) },
      { ...cp("Processed", "factory-pedro", "Orthodox, graded FBOP", 10) },
      { ...cp("Brokered", "broker-ceylon", "Catalogued as lot 18, sale no. 48", 11) },
    ],
  };
  return { lots: [demo, fresh], auctions: [], privateBids: {} };
}

function load(): Store {
  if (typeof window === "undefined") return seed();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  const s = seed();
  save(s);
  return s;
}

function save(s: Store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {}
}

export function resetMockData() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}

const wait = (ms = 350) => new Promise((r) => setTimeout(r, ms)); // feels like a tx

function findAuction(s: Store, lotName: string) {
  const a = s.auctions.find((x) => x.lotName === lotName);
  if (!a) throw new Error("No auction for this lot yet.");
  return a;
}

export const mockSource: TeaTrailSource = {
  async listLots() {
    return load().lots;
  },

  async getLot(lotName) {
    return load().lots.find((l) => l.lotName === lotName) ?? null;
  },

  async createLot(signer: Party, input: NewLotInput) {
    if (signer.role !== "estate") throw new Error("Only an approved estate can create a lot passport.");
    await wait();
    const s = load();
    const lot: LotWithHistory = {
      lotName: randHex(32),
      estate: signer.id,
      estateName: signer.name,
      ...input,
      stage: "Harvested",
      holder: signer.id,
      sale: null,
      history: [
        { stage: "Harvested", by: signer.id, byName: signer.name, note: input.note, at: Date.now(), txHash: randHex(32) },
      ],
    };
    s.lots.unshift(lot);
    save(s);
    return lot;
  },

  async advanceLot(signer, lotName, note, sale?: Sale) {
    const s = load();
    const lot = s.lots.find((l) => l.lotName === lotName);
    if (!lot) throw new Error("Lot not found.");
    const check = canAdvance(lot, signer, sale?.priceLkr);
    if (!check.ok) throw new Error(`Contract rejected the transaction: ${check.reason}`);
    await wait();
    lot.stage = check.next;
    lot.holder = signer.id;
    lot.note = note;
    if (check.next === "Sold" && sale) lot.sale = sale;
    lot.history.push({ stage: check.next, by: signer.id, byName: signer.name, note, at: Date.now(), txHash: randHex(32) });
    save(s);
    return lot;
  },

  async getAuction(lotName) {
    return load().auctions.find((a) => a.lotName === lotName) ?? null;
  },

  async openAuction(signer, lotName, reserveLkr) {
    if (signer.role !== "auctioneer") throw new Error("Only the auctioneer can open an auction.");
    const s = load();
    const lot = s.lots.find((l) => l.lotName === lotName);
    if (!lot || lot.stage !== "Brokered") throw new Error("Only Brokered lots can go to auction.");
    await wait();
    const a: AuctionState = {
      auctionId: "cta-" + randHex(3),
      lotName,
      phase: "BIDDING",
      reservePriceLkr: reserveLkr,
      bidCount: 0,
      commitments: [],
      thresholdLkr: 0,
      winner: null,
      winningPriceLkr: null,
    };
    s.auctions = s.auctions.filter((x) => x.lotName !== lotName).concat(a);
    save(s);
    return a;
  },

  async placeBid(bidder, lotName, amountLkr) {
    const s = load();
    const a = findAuction(s, lotName);
    if (a.phase !== "BIDDING") throw new Error("Bidding is closed.");
    if (amountLkr < a.reservePriceLkr) throw new Error("ZK check failed: bid is below the reserve price.");
    await wait(700); // proof generation
    const salt = randHex(32);
    const commitment = await sha256(`${amountLkr}|${salt}|${bidder.id}`);
    const priv = (s.privateBids[lotName] ??= []).filter((b) => b.bidder !== bidder.id);
    priv.push({ bidder: bidder.id, amountLkr, salt });
    s.privateBids[lotName] = priv;
    a.commitments = a.commitments.filter((c) => c.bidder !== bidder.id).concat({ bidder: bidder.id, commitment });
    a.bidCount = a.commitments.length;
    save(s);
    return a;
  },

  async startReveal(signer, lotName, startLkr) {
    if (signer.role !== "auctioneer") throw new Error("Only the auctioneer can start the reveal.");
    const s = load();
    const a = findAuction(s, lotName);
    if (a.phase !== "BIDDING") throw new Error("Not in bidding phase.");
    if (startLkr < a.reservePriceLkr) throw new Error("Start price must be at or above the reserve.");
    await wait();
    a.phase = "REVEAL";
    a.thresholdLkr = startLkr;
    autoClaim(s, a);
    save(s);
    return a;
  },

  async lowerThreshold(signer, lotName, stepLkr) {
    if (signer.role !== "auctioneer") throw new Error("Only the auctioneer can lower the threshold.");
    const s = load();
    const a = findAuction(s, lotName);
    if (a.phase !== "REVEAL") throw new Error("Not in reveal phase.");
    await wait();
    a.thresholdLkr = Math.max(a.reservePriceLkr, a.thresholdLkr - stepLkr);
    autoClaim(s, a);
    if (a.phase === "REVEAL" && a.thresholdLkr === a.reservePriceLkr && !a.winner) {
      // nobody at reserve either -> no sale (closeNoSale)
      const any = (s.privateBids[lotName] ?? []).some((b) => b.amountLkr >= a.thresholdLkr);
      if (!any) a.phase = "CLOSED";
    }
    save(s);
    return a;
  },
};

/** Simulates every bidder's client: the first sealed bid >= threshold proves it and wins. */
function autoClaim(s: Store, a: AuctionState) {
  const eligible = (s.privateBids[a.lotName] ?? [])
    .filter((b) => b.amountLkr >= a.thresholdLkr)
    .sort((x, y) => y.amountLkr - x.amountLkr);
  if (eligible.length) {
    a.winner = eligible[0].bidder;
    a.winningPriceLkr = eligible[0].amountLkr;
    a.phase = "CLOSED";
  }
}

export { nameOf };
