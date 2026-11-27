// npm run demo                         new auction for a random lot
// npm run demo -- --lot <64 hex>        new auction for a real Cardano lot NFT name
// npm run demo -- --resume [address]    carry on an auction that stopped half-way
//                                        (no address: the most recent one in cli/deployments/)
//
// Runs one full TeaTrail sealed-bid auction on Midnight, the same flow as
// test/auction.test.mjs but for real:
//   1. auctioneer deploys the auction for a lot (one contract per lot)
//   2. three bidders place sealed bids (only salted hashes go on chain)
//   3. rule checks that fail locally, before any proof or fee
//   4. auctioneer starts the reveal and lowers the public threshold step by step
//   5. the first bidder whose sealed bid >= threshold claims and wins at their own bid
//
// Each step is chosen from the auction's on-chain state (cli/auction-plan.ts), so
// when the indexer or node has a hiccup the demo waits, re-reads the chain and
// carries on, and a stopped run can be resumed with --resume.
//
// One funded wallet pays every fee. Each party is a separate identity because
// identity comes from the localSk witness (its private state), not the wallet.
// Private states (secret keys, bid amounts, salts) stay in the encrypted local DB.
// cli/deployments/<address>.json records only public facts.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { deployContract, submitCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import { logger, sleep } from './env.js';
import { startSession, balances, fmtDust } from './session.js';
import { CompiledAuction, assertFullBuild, ledger, Phase } from './contract.js';
import { ledgerState } from './providers.js';
import { DEPLOYMENTS_DIR, describe, latestDeployment } from './status.js';
import { nextStep, isTransient, type Plan, type View } from './auction-plan.js';
import { newParty, withBid, type AuctionPrivateState } from '../src/witnesses.js';

// ---- demo parameters (LKR per kg) ----
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : '';
}
const RESUME = arg('resume');
const START_THRESHOLD = 1600n;
const STEP = 50n;
const BIDS: Record<string, bigint> = { 'bidder-a': 1300n, 'bidder-b': 1450n, 'bidder-c': 1380n };
const BIDDER_ORDER = Object.keys(BIDS);
const MAX_HICCUPS = 12;
const HICCUP_WAIT_MS = 20_000;

type Record_ = { network: string; address: string; lotId: string; reserve: number; deployedAt: string; result?: unknown };

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
const short = (h: string) => `${h.slice(0, 10)}…`;
let txCount = 0;

try {
  // ---- 1. deploy, or pick up an existing auction ----
  let address: string;
  let record: Record_;
  if (RESUME !== undefined) {
    address = RESUME || latestDeployment() || '';
    if (!address) throw new Error('Nothing to resume: give an address (npm run demo -- --resume <address>).');
    const file = `${DEPLOYMENTS_DIR}${address}.json`;
    if (!existsSync(file)) throw new Error(`No record of ${address} in cli/deployments/: was it deployed from this PC?`);
    record = JSON.parse(readFileSync(file, 'utf8')) as Record_;
    if (record.network !== config.name) throw new Error(`${address} is on ${record.network}, but MIDNIGHT_NETWORK is ${config.name}.`);
    logger.info(`Resuming auction ${short(address)} for lot ${short(record.lotId)} (reserve ${record.reserve} LKR/kg).`);
  } else {
    const lotIdHex = arg('lot') || randomBytes(32).toString('hex'); // Person A's lot NFT name goes here later
    if (!/^[0-9a-fA-F]{64}$/.test(lotIdHex)) throw new Error('--lot must be 64 hex characters (the 32-byte lot NFT name).');
    const reserve = BigInt(arg('reserve') || '1200');
    logger.info(`[1/5] Deploying auction for lot ${short(lotIdHex)} with reserve ${reserve} LKR/kg (proving can take a minute)...`);
    const deployed = await deployContract(providers, {
      compiledContract: CompiledAuction,
      privateStateId: 'auctioneer',
      initialPrivateState: newParty(),
      args: [Uint8Array.from(Buffer.from(lotIdHex, 'hex')), reserve],
    });
    txCount++;
    address = deployed.deployTxData.public.contractAddress;
    record = { network: config.name, address, lotId: lotIdHex, reserve: Number(reserve), deployedAt: new Date().toISOString() };
    mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
    writeFileSync(`${DEPLOYMENTS_DIR}${address}.json`, JSON.stringify(record, null, 2) + '\n');
    logger.info(`      Deployed at ${address}`);
  }

  // ---- private states: every party's secret key / sealed bid, on this PC only ----
  const states = providers.privateStateProvider.forContract(address);
  const bidders: Record<string, AuctionPrivateState> = {};
  for (const id of BIDDER_ORDER) {
    const saved = (await states.get(id)) as AuctionPrivateState | null;
    if (saved) bidders[id] = saved;
    else if (RESUME !== undefined) throw new Error(`No saved private state for ${id} on ${address}; can't resume this auction.`);
    else {
      bidders[id] = withBid(newParty(), BIDS[id]!);
      await states.set(id, bidders[id]);
    }
  }
  const plan: Plan = {
    bidderOrder: BIDDER_ORDER,
    bids: Object.fromEntries(BIDDER_ORDER.map((id) => [id, bidders[id]!.bidAmount])),
    startThreshold: START_THRESHOLD,
    step: STEP,
    ruleChecksDone: RESUME !== undefined, // only on a fresh run
  };

  const call = (who: string, circuitId: 'placeBid' | 'startReveal' | 'lowerThreshold' | 'claimWin' | 'closeNoSale', args: bigint[] = []) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    submitCallTx(providers, { compiledContract: CompiledAuction, contractAddress: address, privateStateId: who, circuitId, args } as any);
  const read = async () => ledger(ledgerState(await providers.publicDataProvider.queryContractState(address)));
  const view = (l: Awaited<ReturnType<typeof read>>): View => ({
    phase: Phase[l.phase] as View['phase'],
    bidCount: l.bidCount,
    threshold: l.threshold,
    reserve: l.reservePrice,
  });

  // ---- 2–5. one step at a time, from the chain's state ----
  let hiccups = 0;
  let announced = '';
  for (;;) {
    try {
      const v = view(await read());
      const step = nextStep(v, plan);
      const stage = { placeBid: '[2/5] Placing sealed bids (amounts never leave this machine)...', ruleChecks: '[3/5] Rule checks...', startReveal: `[4/5] Reveal: threshold starts at ${START_THRESHOLD} and drops by ${STEP}`, lowerThreshold: '', claimWin: '[5/5] Claim', closeNoSale: '[5/5] No sale', done: '' }[step.kind];
      if (stage && stage !== announced) {
        logger.info(stage);
        announced = stage;
      }
      if (step.kind === 'done') break;
      if (step.kind === 'placeBid') {
        await call(step.bidder, 'placeBid');
        txCount++;
        logger.info(`      ${step.bidder} sealed a bid`);
        const l = await read();
        if (Number(l.bidCount) === BIDDER_ORDER.length) logger.info(`      On chain: ${l.bidCount} bids, ${l.commitments.size()} commitments (hashes only)`);
      } else if (step.kind === 'ruleChecks') {
        await states.set('lowballer', withBid(newParty(), v.reserve - 200n));
        await expectRejected(() => call('lowballer', 'placeBid'), /Bid below reserve/, 'bid below reserve');
        await expectRejected(() => call(BIDDER_ORDER[0]!, 'startReveal', [START_THRESHOLD]), /Only the auctioneer/, 'bidder trying to run the reveal');
        plan.ruleChecksDone = true;
      } else if (step.kind === 'startReveal') {
        await call('auctioneer', 'startReveal', [step.price]);
        txCount++;
        logger.info(`      threshold → ${step.price}`);
      } else if (step.kind === 'lowerThreshold') {
        await call('auctioneer', 'lowerThreshold', [step.price]);
        txCount++;
        logger.info(`      threshold → ${step.price}`);
      } else if (step.kind === 'claimWin') {
        // A losing bidder can't claim at this price: the proof fails locally, no fee.
        const loser = BIDDER_ORDER.find((id) => plan.bids[id]! < v.threshold);
        if (loser) await expectRejected(() => call(loser, 'claimWin'), /below the threshold/, `${loser} claiming with a lower bid`);
        logger.info(`      ${step.bidder} sees threshold ${v.threshold} ≤ their sealed bid and claims...`);
        await call(step.bidder, 'claimWin');
        txCount++;
      } else if (step.kind === 'closeNoSale') {
        logger.info('      Threshold reached reserve with no claim: closing with no sale.');
        await call('auctioneer', 'closeNoSale');
        txCount++;
      }
      hiccups = 0;
    } catch (e) {
      if (!isTransient(e) || ++hiccups > MAX_HICCUPS) throw e;
      const msg = e instanceof Error ? e.message.split('\n')[0] : String(e);
      logger.warn(`Network hiccup (${msg}). Waiting ${HICCUP_WAIT_MS / 1000}s, then carrying on from the chain's state (${hiccups}/${MAX_HICCUPS})...`);
      await sleep(HICCUP_WAIT_MS);
    }
  }

  // ---- result ----
  const l = await read();
  const summary = describe(l);
  console.log('\n=========== PUBLIC STATE (what anyone can see) ===========');
  console.log(JSON.stringify({ address, ...summary }, (_k, val) => (typeof val === 'bigint' ? Number(val) : val), 2));
  console.log('===========================================================');

  const publicText = JSON.stringify(summary, (_k, val) => (typeof val === 'bigint' ? val.toString() : val));
  const winnerId = l.winningPrice > 0n ? BIDDER_ORDER.find((id) => plan.bids[id] === l.winningPrice) : undefined;
  const losing = BIDDER_ORDER.filter((id) => id !== winnerId).map((id) => plan.bids[id]!.toString());
  const leaked = losing.filter((val) => publicText.includes(`"${val}"`));
  logger.info(
    leaked.length === 0
      ? `Privacy check passed: losing bids (${losing.join(', ')}) appear nowhere in the public state.`
      : `PRIVACY CHECK FAILED: ${leaked.join(', ')} found in public state.`,
  );
  if (winnerId) {
    logger.info(`Winner: ${winnerId} (pk ${short(summary.winner ?? '')}) at ${l.winningPrice} LKR/kg`);
    writeFileSync(
      `${DEPLOYMENTS_DIR}${address}.json`,
      JSON.stringify({ ...record, result: { winnerPk: summary.winner, winningPrice: Number(l.winningPrice) } }, null, 2) + '\n',
    );
  }
  const b = await balances(s.wallet);
  logger.info(`Done: ${txCount} transactions this run. DUST left: ${fmtDust(b.dust)}. Contract: ${address}`);
  logger.info(`Check it yourself: npm run status -- ${address}${config.explorer ? `   or ${config.explorer}` : ''}`);
} catch (e) {
  logger.error(e instanceof Error ? (e.stack ?? e.message) : String(e));
  logger.error('If the auction was deployed, carry on with: npm run demo -- --resume');
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
    throw e;
  }
  throw new Error(`Expected ${label} to be rejected, but it went through.`);
}
