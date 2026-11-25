// Local simulator test for sealed_auction.compact. No network, wallet or proof server.
// Runs the real compiled circuits against an in-memory ledger.
//
//   npm run compile:fast   # writes managed/sealed_auction (git-ignored)
//   npm test
//
// Covers the 30 Nov milestone flow: deploy, 3 sealed bids, descending reveal,
// highest bidder claims, plus the failure cases and a privacy check.

import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  createCircuitContext,
  createConstructorContext,
  sampleContractAddress,
} from "@midnight-ntwrk/compact-runtime";
import { Contract, ledger, Phase } from "../managed/sealed_auction/contract/index.js";

// ---- witnesses (same logic as src/witnesses.ts) ----
const witnesses = {
  localSk: ({ privateState }) => [privateState, privateState.secretKey],
  bidAmount: ({ privateState }) => [privateState, privateState.bidAmount],
  bidSalt: ({ privateState }) => [privateState, privateState.bidSalt],
};

const party = (bidAmount = 0n) => ({
  secretKey: new Uint8Array(randomBytes(32)),
  bidAmount,
  bidSalt: new Uint8Array(randomBytes(32)),
});

const COIN_PK = "0".repeat(64);
const LOT_ID = new Uint8Array(randomBytes(32)); // stands in for the Cardano lot NFT name
const RESERVE = 1200n;

/** One deployed auction. Every caller supplies their own private state. */
class Sim {
  static async deploy(auctioneer, reserve = RESERVE) {
    const s = new Sim();
    s.contract = new Contract(witnesses);
    s.address = sampleContractAddress();
    const init = await s.contract.initialState(
      createConstructorContext(auctioneer, COIN_PK), LOT_ID, reserve);
    s.state = init.currentContractState.data;
    s.trace = [];
    return s;
  }
  get ledger() {
    return ledger(this.state);
  }
  async call(circuit, who, ...args) {
    const ctx = createCircuitContext({
      circuitId: circuit,
      contractAddress: this.address,
      coinPublicKeyOrZswapState: COIN_PK,
      contractState: this.state,
      privateState: who,
    });
    const res = await this.contract.circuits[circuit](ctx, ...args);
    this.state = res.context.callContext.currentQueryContext.state;
    this.trace.push(...res.context.callProofDataTrace);
    return res;
  }
}

async function freshAuction() {
  const auctioneer = party();
  const a = party(1300n), b = party(1450n), c = party(1380n);
  const sim = await Sim.deploy(auctioneer);
  for (const bidder of [a, b, c]) await sim.call("placeBid", bidder);
  return { sim, auctioneer, a, b, c };
}

// ---------------------------------------------------------------- happy path

test("full auction: highest sealed bid wins at its own price", async () => {
  const { sim, auctioneer, b } = await freshAuction();
  assert.equal(sim.ledger.phase, Phase.BIDDING);
  assert.equal(sim.ledger.bidCount, 3n);
  assert.equal(sim.ledger.commitments.size(), 3n);

  await sim.call("startReveal", auctioneer, 1600n);
  assert.equal(sim.ledger.phase, Phase.REVEAL);
  for (const p of [1550n, 1500n, 1450n]) await sim.call("lowerThreshold", auctioneer, p);
  assert.equal(sim.ledger.threshold, 1450n);

  await sim.call("claimWin", b);
  assert.equal(sim.ledger.phase, Phase.CLOSED);
  assert.equal(sim.ledger.winningPrice, 1450n);
  assert.equal(sim.ledger.lotId.length, 32);
});

test("a bidder can replace their own bid without inflating bidCount", async () => {
  const auctioneer = party();
  const sim = await Sim.deploy(auctioneer);
  const a = party(1300n);
  await sim.call("placeBid", a);
  a.bidAmount = 1500n;
  a.bidSalt = new Uint8Array(randomBytes(32));
  await sim.call("placeBid", a);
  assert.equal(sim.ledger.bidCount, 1n);
});

test("no sale: auctioneer closes once threshold reaches reserve", async () => {
  const auctioneer = party();
  const sim = await Sim.deploy(auctioneer);
  await sim.call("startReveal", auctioneer, 1300n);
  await assert.rejects(sim.call("closeNoSale", auctioneer), /Lower to reserve first/);
  await sim.call("lowerThreshold", auctioneer, RESERVE);
  await sim.call("closeNoSale", auctioneer);
  assert.equal(sim.ledger.phase, Phase.CLOSED);
  assert.equal(sim.ledger.winningPrice, 0n);
});

// ---------------------------------------------------------------- rules

test("bid below reserve is rejected", async () => {
  const sim = await Sim.deploy(party());
  await assert.rejects(sim.call("placeBid", party(1000n)), /Bid below reserve/);
});

test("only the auctioneer can run the reveal", async () => {
  const { sim, a } = await freshAuction();
  await assert.rejects(sim.call("startReveal", a, 1600n), /Only the auctioneer/);
});

test("threshold must go down and never below reserve", async () => {
  const { sim, auctioneer } = await freshAuction();
  await sim.call("startReveal", auctioneer, 1600n);
  await assert.rejects(sim.call("lowerThreshold", auctioneer, 1600n), /Must go down/);
  await assert.rejects(sim.call("lowerThreshold", auctioneer, 1100n), /Below reserve/);
});

test("a lower bid cannot claim at a higher threshold", async () => {
  const { sim, auctioneer, c } = await freshAuction();
  await sim.call("startReveal", auctioneer, 1450n);
  await assert.rejects(sim.call("claimWin", c), /below the threshold/);
});

test("lying about your bid amount fails the commitment check", async () => {
  const { sim, auctioneer, c } = await freshAuction();
  await sim.call("startReveal", auctioneer, 1450n);
  const liar = { ...c, bidAmount: 9999n }; // real sealed bid was 1380
  await assert.rejects(sim.call("claimWin", liar), /Bid mismatch/);
});

test("someone who never bid cannot claim", async () => {
  const { sim, auctioneer } = await freshAuction();
  await sim.call("startReveal", auctioneer, 1600n);
  await assert.rejects(sim.call("claimWin", party(5000n)), /No bid from you/);
});

test("no bids after bidding closes", async () => {
  const { sim, auctioneer } = await freshAuction();
  await sim.call("startReveal", auctioneer, 1600n);
  await assert.rejects(sim.call("placeBid", party(2000n)), /Bidding is closed/);
});

// ---------------------------------------------------------------- privacy

// Everything that goes on chain: final ledger state plus, for every tx, the circuit
// inputs/outputs and public transcript. privateTranscriptOutputs (witness values)
// stay on the prover's machine, so they're deliberately excluded.
function publicBytes(sim) {
  const parts = [JSON.stringify(sim.state.encode?.() ?? sim.state, replacer)];
  for (const t of sim.trace) {
    parts.push(JSON.stringify({ i: t.input, o: t.output, p: t.publicTranscript }, replacer));
  }
  return parts.join("\n");
}
function replacer(_k, v) {
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Uint8Array) return Buffer.from(v).toString("hex");
  return v;
}
// a Uint<64> as it is laid out in aligned values: little-endian bytes, trailing zeros trimmed
const leHex = (n) => {
  const b = []; let x = n;
  while (x > 0n) { b.push(Number(x & 0xffn)); x >>= 8n; }
  return Buffer.from(b).toString("hex");
};

test("losing bid amounts never appear in public data", async () => {
  const { sim, auctioneer, b } = await freshAuction();
  await sim.call("startReveal", auctioneer, 1600n);
  for (const p of [1550n, 1500n, 1450n]) await sim.call("lowerThreshold", auctioneer, p);
  await sim.call("claimWin", b);

  const pub = publicBytes(sim);
  // sanity: the winning price IS public, so the encoding check must find it
  assert.ok(pub.includes(leHex(1450n)), "encoding check is broken: winning price not found");
  for (const losing of [1300n, 1380n]) {
    assert.ok(!pub.includes(leHex(losing)), `losing bid ${losing} leaked`);
    assert.ok(!pub.includes(`"${losing}"`), `losing bid ${losing} leaked`);
  }
});
