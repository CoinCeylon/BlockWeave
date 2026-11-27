// npm run demo [-- --lot <64 hex chars>] [-- --reserve 1200]
//
// Runs one full TeaTrail sealed-bid auction on Midnight Preprod, the same flow
// as test/auction.test.mjs but for real:
//   1. auctioneer deploys the auction for a lot (one contract per lot)
//   2. three bidders place sealed bids (only salted hashes go on chain)
//   3. two rule checks that fail locally, before any proof or fee
//   4. auctioneer starts the reveal and lowers the public threshold step by step
//   5. the first bidder whose sealed bid >= threshold claims and wins at their own bid
//
// One funded wallet pays every fee. Each party is a separate identity because
// identity comes from the localSk witness (its private state), not the wallet.
// In production each bidder runs this in their own browser.
//
// Private states (secret keys, bid amounts, salts) stay in the encrypted local DB.
// cli/deployments/<address>.json records only public facts.

import { mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { deployContract, submitCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import { logger } from './env.js';
import { startSession, balances, fmtDust } from './session.js';
import { CompiledAuction, assertFullBuild, ledger, Phase } from './contract.js';
import { ledgerState } from './providers.js';
import { DEPLOYMENTS_DIR, describe } from './status.js';
import { newParty, withBid, type AuctionPrivateState } from '../src/witnesses.js';

// ---- demo parameters (LKR per kg) ----
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}
const LOT_ID_HEX = arg('lot') ?? randomBytes(32).toString('hex'); // Person A's lot NFT name goes here later
if (!/^[0-9a-fA-F]{64}$/.test(LOT_ID_HEX)) throw new Error('--lot must be 64 hex characters (the 32-byte lot NFT name).');
const RESERVE = BigInt(arg('reserve') ?? '1200');
const START_THRESHOLD = 1600n;
const STEP = 50n;
const BIDS: Record<string, bigint> = { 'bidder-a': 1300n, 'bidder-b': 1450n, 'bidder-c': 1380n };

try {
  assertFullBuild();
} catch (e) {
  logger.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
const s = await startSession({ needFunds: true }).catch((e: unknown) => {
  logger.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
const { providers, config } = s;

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const short = (h: string) => `${h.slice(0, 10)}…`;
let txCount = 0;

try {
  // ---- 1. deploy ----
  const auctioneer = newParty();
  logger.info(`[1/5] Deploying auction for lot ${short(LOT_ID_HEX)} with reserve ${RESERVE} LKR/kg (proving can take a minute)...`);
  const deployed = await deployContract(providers, {
    compiledContract: CompiledAuction,
    privateStateId: 'auctioneer',
    initialPrivateState: auctioneer,
    args: [Uint8Array.from(Buffer.from(LOT_ID_HEX, 'hex')), RESERVE],
  });
  txCount++;
  const address = deployed.deployTxData.public.contractAddress;
  logger.info(`      Deployed at ${address}`);
  mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
  const record = {
    network: config.name,
    address,
    lotId: LOT_ID_HEX,
    reserve: Number(RESERVE),
    deployedAt: new Date().toISOString(),
  };
  writeFileSync(`${DEPLOYMENTS_DIR}${address}.json`, JSON.stringify(record, null, 2) + '\n');

  const states = providers.privateStateProvider.forContract(address);
  const call = (who: string, circuitId: 'placeBid' | 'startReveal' | 'lowerThreshold' | 'claimWin' | 'closeNoSale', args: bigint[] = []) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    submitCallTx(providers, { compiledContract: CompiledAuction, contractAddress: address, privateStateId: who, circuitId, args } as any);
  const read = async () => ledger(ledgerState(await providers.publicDataProvider.queryContractState(address)));

  // ---- 2. sealed bids ----
  const bidders: Record<string, AuctionPrivateState> = {};
  for (const [id, amount] of Object.entries(BIDS)) {
    bidders[id] = withBid(newParty(), amount);
    await states.set(id, bidders[id]);
  }
  logger.info('[2/5] Placing 3 sealed bids (amounts never leave this machine)...');
  for (const id of Object.keys(BIDS)) {
    await call(id, 'placeBid');
    txCount++;
    logger.info(`      ${id} sealed a bid`);
  }
  let l = await read();
  logger.info(`      On chain: ${l.bidCount} bids, ${l.commitments.size()} commitments (hashes only)`);

  // ---- 3. rule checks (fail locally: no proof, no fee) ----
  logger.info('[3/5] Rule checks...');
  await states.set('lowballer', withBid(newParty(), RESERVE - 200n));
  await expectRejected(() => call('lowballer', 'placeBid'), /Bid below reserve/, 'bid below reserve');
  await expectRejected(() => call('bidder-a', 'startReveal', [START_THRESHOLD]), /Only the auctioneer/, 'bidder trying to run the reveal');

  // ---- 4. descending reveal ----
  logger.info(`[4/5] Reveal: threshold starts at ${START_THRESHOLD} and drops by ${STEP}`);
  await call('auctioneer', 'startReveal', [START_THRESHOLD]);
  txCount++;
  let threshold = START_THRESHOLD;
  let winnerId: string | undefined;
  for (;;) {
    // Each bidder's own client checks its private bid against the public threshold.
    // If a step passes several bids at once, the highest one claims first.
    winnerId = Object.keys(BIDS)
      .filter((id) => bidders[id]!.bidAmount >= threshold)
      .sort((x, y) => (bidders[y]!.bidAmount > bidders[x]!.bidAmount ? 1 : -1))[0];
    if (winnerId) break;
    const next = threshold - STEP > RESERVE ? threshold - STEP : RESERVE;
    if (next === threshold) break; // at reserve, nobody bid this high
    await call('auctioneer', 'lowerThreshold', [next]);
    txCount++;
    threshold = next;
    logger.info(`      threshold → ${threshold}`);
  }

  // ---- 5. claim ----
  if (winnerId) {
    // A losing bidder can't claim at this price: the proof would fail locally.
    const loser = Object.keys(BIDS).find((id) => bidders[id]!.bidAmount < threshold);
    if (loser) await expectRejected(() => call(loser, 'claimWin'), /below the threshold/, `${loser} claiming with a lower bid`);
    logger.info(`[5/5] ${winnerId} sees threshold ${threshold} ≤ their sealed bid and claims...`);
    await call(winnerId, 'claimWin');
    txCount++;
  } else {
    logger.info('[5/5] Threshold reached reserve with no claim: closing with no sale.');
    await call('auctioneer', 'closeNoSale');
    txCount++;
  }

  l = await read();
  const summary = describe(l);
  console.log('\n=========== PUBLIC STATE (what anyone can see) ===========');
  console.log(JSON.stringify({ address, ...summary }, (_k, v) => (typeof v === 'bigint' ? Number(v) : v), 2));
  console.log('===========================================================');

  // ---- privacy check on the public ledger ----
  const publicText = JSON.stringify(summary, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  const losing = Object.entries(BIDS).filter(([id]) => id !== winnerId).map(([, v]) => v.toString());
  const leaked = losing.filter((v) => publicText.includes(`"${v}"`));
  if (l.phase !== Phase.CLOSED) throw new Error('Auction did not close.');
  logger.info(
    leaked.length === 0
      ? `Privacy check passed: losing bids (${losing.join(', ')}) appear nowhere in the public state.`
      : `PRIVACY CHECK FAILED: ${leaked.join(', ')} found in public state.`,
  );
  if (winnerId) {
    const winnerPk = summary.winner;
    logger.info(`Winner: ${winnerId} (pk ${short(winnerPk ?? '')}) at ${l.winningPrice} LKR/kg`);
    writeFileSync(
      `${DEPLOYMENTS_DIR}${address}.json`,
      JSON.stringify({ ...record, result: { winnerPk, winningPrice: Number(l.winningPrice) } }, null, 2) + '\n',
    );
  }
  const b = await balances(s.wallet);
  logger.info(`Done: ${txCount} transactions. DUST left: ${fmtDust(b.dust)}. Contract: ${address}`);
  logger.info(`Check it yourself: npm run status -- ${address}${config.explorer ? `   or ${config.explorer}` : ''}`);
} catch (e) {
  logger.error(e instanceof Error ? (e.stack ?? e.message) : String(e));
  process.exitCode = 1;
} finally {
  await s.stop();
}
process.exit(process.exitCode ?? 0);

async function expectRejected(fn: () => Promise<unknown>, pattern: RegExp, label: string) {
  try {
    await fn();
  } catch (e) {
    const msg = e instanceof Error ? `${e.message} ${String((e as { cause?: unknown }).cause ?? '')}` : String(e);
    if (pattern.test(msg)) {
      logger.info(`      ✓ rejected: ${label}`);
      return;
    }
    throw new Error(`Expected "${pattern.source}" for ${label}, got: ${msg}`);
  }
  throw new Error(`Expected ${label} to be rejected, but it went through.`);
}
