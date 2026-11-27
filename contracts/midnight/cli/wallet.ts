// Adapted for TeaTrail from midnightntwrk/midnight-examples (examples/private-bid/src/wallet.ts,
// 24 Nov 2026). Changes: wallet state lives in contracts/midnight/.wallet-state/,
// and the shared-role resolver was replaced by cli/env.ts.
//
// Original file: part of example-private-bid.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type CoinPublicKey,
  type EncPublicKey,
  type FinalizedTransaction,
  type PreBinding,
  type Proof,
  type SignatureEnabled,
  Transaction,
  LedgerParameters,
  unshieldedToken,
  ZswapSecretKeys,
} from '@midnight-ntwrk/midnight-js-protocol/v9';
import {
  LedgerTransaction,
  type Ledger9WalletProvider,
  type TransactionAnswer,
} from '@midnight-ntwrk/midnight-js-types';
import { ttlOneHour } from '@midnight-ntwrk/midnight-js-utils';
import {
  DefaultForkSchedule,
  ProtocolVersion,
  WalletTransaction,
  DustWallet,
  InMemoryTransactionHistoryStorage,
  mergeWalletEntries,
  ShieldedWallet,
  UnshieldedWallet,
  WalletEntrySchema,
  WalletFacade,
  type FacadeState,
  type UnshieldedKeystore,
  type WalletSeeds,
} from '@midnightntwrk/wallet-sdk';
import {
  type DustWalletOptions,
  type EnvironmentConfiguration,
  FluentWalletBuilder,
  logger as testkitLogger,
} from '@midnight-ntwrk/testkit-js';
import * as Rx from 'rxjs';
import { Option } from 'effect';
import { findDustBoundary } from './dust-boundary.js';
import type { DustWalletTypes } from '@midnightntwrk/wallet-sdk-dust-wallet';
import type { Logger } from 'pino';

// A proven, not yet bound ledger 9 transaction: what a contract call or deploy
// hands the wallet to balance.
type UnboundTransaction = Transaction<SignatureEnabled, Proof, PreBinding>;

/**
 * Midnight.js 5 passes transactions as era-tagged byte handles. Decode a proven
 * one into the ledger 9 transaction the wallet SDK balances.
 */
export function unboundFromHandle(handle: LedgerTransaction<'Unbound'>): UnboundTransaction {
  if (handle.era !== 'v9') throw new Error(`expected a ledger 9 transaction, got ${handle.era}`);
  return Transaction.deserialize('signature', 'proof', 'pre-binding', handle.serialize());
}

/** The secret a wallet is built from: a hex seed or a BIP-39 mnemonic. */
export type WalletSecret = { kind: 'seed'; value: string } | { kind: 'mnemonic'; value: string };

// testkit logs through its own module-level logger. At info it prints the
// wallet's indexer and relay URLs, which carry the Blockfrost project_id, and
// two lines per sync update. Keep only its warnings and errors.
testkitLogger.level = 'warn';

export class MidnightWalletProvider implements Ledger9WalletProvider {
  readonly wallet: WalletFacade;
  readonly unshieldedKeystore: UnshieldedKeystore;

  private readonly zswapSecretKeys: ZswapSecretKeys;

  private constructor(
    private readonly logger: Logger,
    wallet: WalletFacade,
    private readonly seeds: WalletSeeds,
    unshieldedKeystore: UnshieldedKeystore,
  ) {
    this.wallet = wallet;
    this.unshieldedKeystore = unshieldedKeystore;
    this.zswapSecretKeys = ZswapSecretKeys.fromSeed(seeds.shielded);
  }

  getCoinPublicKey(): CoinPublicKey {
    return this.zswapSecretKeys.coinPublicKey;
  }

  getEncryptionPublicKey(): EncPublicKey {
    return this.zswapSecretKeys.encryptionPublicKey;
  }

  // Wallet SDK 2 balances and submits handles adopted at the chain's current
  // protocol version, and hands back a handle to unwrap. The keys come from the
  // seeds the wallet was started with, so balancing no longer takes them.
  async balanceTx(
    handle: LedgerTransaction<'Unbound'>,
    ttl: Date = ttlOneHour(),
  ): Promise<TransactionAnswer> {
    const tx = unboundFromHandle(handle);
    const active = await this.activeProtocolVersion();
    const recipe = await this.wallet.balanceUnboundTransaction(
      WalletTransaction.adopt('Unbound', tx, active),
      { ttl },
    );
    // Balancing may add unshielded inputs (e.g. NIGHT spent to fund a
    // contract's receiveUnshielded). Those inputs need signatures from the
    // unshielded keystore; without this step the node rejects the transaction
    // with InputsSignaturesLengthMismatch (Custom error 192).
    const signed = await this.wallet.signRecipe(recipe, (payload) =>
      this.unshieldedKeystore.signDataAsync(payload),
    );
    const finalized = await this.wallet.finalizeRecipe(signed);
    const accepted = ProtocolVersion.epochOf(active, DefaultForkSchedule.v9);
    const unwrapped = WalletTransaction.unwrapWithin<FinalizedTransaction>(finalized, accepted);
    if (unwrapped._tag === 'Left') throw unwrapped.left;
    return unwrapped.right;
  }

  async submitTx(tx: LedgerTransaction<'Finalized', 'v9'> | FinalizedTransaction): Promise<string> {
    const finalized: FinalizedTransaction = LedgerTransaction.isLedgerTransaction(tx)
      ? Transaction.deserialize('signature', 'proof', 'binding', tx.serialize())
      : tx;
    const active = await this.activeProtocolVersion();
    return this.wallet.submitTransaction(WalletTransaction.adopt('Finalized', finalized, active));
  }

  private async activeProtocolVersion(): Promise<ProtocolVersion.ProtocolVersion> {
    return (await Rx.firstValueFrom(this.wallet.state())).activeProtocolVersion;
  }

  async start(): Promise<void> {
    this.logger.info('Starting wallet...');
    await this.wallet.start(this.seeds);
  }

  async stop(): Promise<void> {
    return this.wallet.stop();
  }

  /**
   * Build an un-started wallet provider from a seed or mnemonic. A new wallet's
   * first sync takes seconds on a local devnet and about 6 minutes on preprod,
   * where it skips the Ledger 8 DUST history.
   */
  static async build(
    logger: Logger,
    env: EnvironmentConfiguration,
    secret: WalletSecret,
  ): Promise<MidnightWalletProvider> {
    const dustOptions: DustWalletOptions = {
      ledgerParams: LedgerParameters.initialParameters(),
      additionalFeeOverhead: 1_000n,
      feeBlocksMargin: 5,
    };

    const base = FluentWalletBuilder.forEnvironment(env)
      .withDustOptions(dustOptions);
    const builder =
      secret.kind === 'mnemonic'
        ? base.withMnemonic(secret.value)
        : base.withSeed(secret.value);

    await useDustTimelineStart(logger, builder, env.walletNetworkId);

    const built = await builder.buildWithoutStarting();
    const { seeds, keystore } = built;
    const wallet = await restoreSavedState(logger, env, builder, dustOptions, built.wallet, seeds.masterSeed);

    logger.info(
      `Wallet built from ${secret.kind}; address ${String(keystore.getBech32Address())}`,
    );

    return new MidnightWalletProvider(logger, wallet, seeds, keystore);
  }
}

function isProgressStrictlyComplete(progress: unknown): boolean {
  if (!progress || typeof progress !== 'object') {
    return false;
  }
  const candidate = progress as { isStrictlyComplete?: unknown };
  if (typeof candidate.isStrictlyComplete !== 'function') {
    return false;
  }
  return (candidate.isStrictlyComplete as () => boolean)();
}

export async function syncWallet(
  logger: Logger,
  wallet: WalletFacade,
  timeout = 300_000,
): Promise<FacadeState> {
  logger.info('Syncing wallet... (progress is printed every 10 seconds)');
  let emissionCount = 0;
  let lastLog = 0;
  // TeaTrail change: one progress line every 10 s with a percentage per sub-wallet,
  // instead of a line per update (thousands on a fresh Preprod wallet).
  const started = Date.now();
  const firstApplied = new Map<string, number>();
  const pct = (name: string, progress: unknown, done: boolean): string => {
    if (done) return `${name} done`;
    const p = (progress ?? {}) as {
      appliedIndex?: number | bigint;
      highestIndex?: number | bigint;
      highestRelevantIndex?: number | bigint;
      highestRelevantWalletIndex?: number | bigint;
      isConnected?: boolean;
    };
    const applied = Number(p.appliedIndex ?? 0);
    // The DUST wallet's event sync records its target in highestRelevantWalletIndex (the indexer's maxId),
    // not highestIndex, so take whichever field is filled in.
    const highest = Math.max(Number(p.highestIndex ?? 0), Number(p.highestRelevantIndex ?? 0), Number(p.highestRelevantWalletIndex ?? 0));
    if (!highest) return `${name} starting${p.isConnected === false ? ' (not connected)' : ''}`;
    if (!firstApplied.has(name)) firstApplied.set(name, applied);
    const mins = (Date.now() - started) / 60_000;
    const rate = mins > 0.2 ? (applied - firstApplied.get(name)!) / mins : 0; // events per minute
    const eta = rate > 0 ? `, ~${Math.ceil((highest - applied) / rate)} min left` : '';
    return `${name} ${Math.min(99.9, (applied / highest) * 100).toFixed(1)}% (${applied}/${highest}${eta})`;
  };
  const state = await Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.tap((state: FacadeState) => {
        emissionCount++;
        const shielded = isProgressStrictlyComplete(state.shielded.progress);
        const unshielded = isProgressStrictlyComplete(state.unshielded.progress);
        const dust = isProgressStrictlyComplete(state.dust.progress);
        const now = Date.now();
        if (now - lastLog >= 10_000 || (shielded && unshielded && dust)) {
          lastLog = now;
          logger.info(
            `Wallet sync: ${pct('dust', state.dust.progress, dust)} | ${pct('shielded', state.shielded.progress, shielded)} | ${pct('unshielded', state.unshielded.progress, unshielded)}`,
          );
        }
        logger.debug(`Wallet sync [${emissionCount}]: shielded=${shielded}, unshielded=${unshielded}, dust=${dust}`);
      }),
      Rx.filter(
        (state: FacadeState) =>
          isProgressStrictlyComplete(state.shielded.progress) &&
          isProgressStrictlyComplete(state.dust.progress) &&
          isProgressStrictlyComplete(state.unshielded.progress),
      ),
      Rx.tap(() => logger.info(`Wallet sync complete after ${emissionCount} emissions`)),
      Rx.timeout({
        each: timeout,
        with: () =>
          Rx.throwError(
            () => new Error(`Wallet sync timeout after ${timeout}ms (${emissionCount} emissions received)`),
          ),
      }),
      Rx.catchError((err) => {
        logger.error(`Wallet sync error: ${err}`);
        return Rx.throwError(() => err);
      }),
    ),
  );
  await saveWalletState(logger, wallet);
  return state;
}

// ---------------------------------------------------------------------------
// Saved wallet state (remote networks)
// ---------------------------------------------------------------------------
// On a long-lived network a sync from genesis takes minutes per wallet, and
// every suite builds its wallets afresh. So after each sync the three
// sub-wallets' state is saved to the gitignored repo-root .wallet-state/,
// keyed by network ID and a hash of the master seed, and the next build of the
// same wallet restores it and syncs only the gap. The local devnet is skipped:
// it starts from a new genesis each time. MIDNIGHT_WALLET_STATE=off turns this
// off.
//
// Each save is stamped with the indexer's host and its tip (height and block
// hash), and a restore checks the stamp first. A network reset can keep the
// genesis hash (Preview's on 6 November 2026 did), so without the check a state
// from the old chain would be restored onto the new one. And indexers number
// events differently (Blockfrost's preprod ids run 22 behind the official
// indexer's), so a state from another indexer would resume from the wrong
// cursors. If the check fails, the wallet syncs from genesis and the next save
// replaces the file. A version 1 file (from before stamping) is restored as
// before and gets its stamp on the next save.

const STATE_DIR = fileURLToPath(new URL('../.wallet-state/', import.meta.url));
const stateFiles = new WeakMap<WalletFacade, { file: string; indexer: string }>();

type SubWalletStates = { shielded: string; unshielded: string; dust: string };
/** Where a state was synced: the indexer's host (never its URL, which can carry a token) and a block on its chain. */
type ChainStamp = { indexer: string; height: number; blockHash: string };
type SavedWalletState = ({ version: 1 } | { version: 2; chain: ChainStamp }) & SubWalletStates;

/** POST a GraphQL query to the indexer; undefined if it can't be reached. */
async function indexerQuery<T>(indexerHttpUrl: string, query: string): Promise<T | undefined> {
  try {
    const res = await fetch(indexerHttpUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(30_000),
    });
    return res.ok ? ((await res.json()) as { data?: T }).data : undefined;
  } catch {
    return undefined;
  }
}

/** A stamp for the indexer's current tip, or undefined if it can't be read. */
async function readChainStamp(indexerHttpUrl: string): Promise<ChainStamp | undefined> {
  const data = await indexerQuery<{ block?: { height?: number; hash?: string } | null }>(
    indexerHttpUrl,
    '{ block { height hash } }',
  );
  const height = data?.block?.height;
  const blockHash = data?.block?.hash;
  if (typeof height !== 'number' || height <= 0 || typeof blockHash !== 'string') return undefined;
  return { indexer: new URL(indexerHttpUrl).host, height, blockHash };
}

/** Null when `stamp` is from this indexer and its block is still on the chain, else why not. */
async function checkChainStamp(indexerHttpUrl: string, stamp: ChainStamp): Promise<string | null> {
  const host = new URL(indexerHttpUrl).host;
  if (stamp.indexer !== host) return `it was synced against ${stamp.indexer}, not ${host}`;
  const data = await indexerQuery<{ block?: { hash?: string } | null }>(
    indexerHttpUrl,
    `{ block(offset: { height: ${Math.trunc(stamp.height)} }) { hash } }`,
  );
  const hash = data?.block?.hash;
  if (typeof hash !== 'string') return `the indexer has no block ${stamp.height} or can't be reached (was the network reset?)`;
  if (hash !== stamp.blockHash) return `block ${stamp.height} is ${hash}, not ${stamp.blockHash} (was the network reset?)`;
  return null;
}

function stateFileFor(networkId: string, masterSeed: string): string | undefined {
  if (networkId === 'undeployed' || process.env['MIDNIGHT_WALLET_STATE'] === 'off') return undefined;
  const id = createHash('sha256').update(masterSeed).digest('hex').slice(0, 16);
  return join(STATE_DIR, `${networkId}-${id}.json`);
}

/**
 * Turn on the Wallet SDK's `skipLedgerV8DustHistory` for the DUST wallet the
 * builder makes. On a chain that crossed the Ledger 9 fork in place (preprod,
 * Preview, Mainnet), the fork emptied all DUST state and re-emitted live
 * DUST as Ledger 9 events, so a fresh wallet can start at the fork instead of
 * replaying every Ledger 8 DUST event from genesis: the slow part of a first
 * sync. Only fresh starts read it (a restore resumes from its saved cursor),
 * and on a chain that never crossed the fork it changes nothing. The cost is
 * the wallet's Ledger 8 DUST transaction history, which the examples don't use.
 * testkit's builder keeps its wallet configuration private, so it is set there.
 */
function skipLedgerV8DustHistory(builder: FluentWalletBuilder): void {
  (builder as unknown as { config: { skipLedgerV8DustHistory?: boolean } }).config.skipLedgerV8DustHistory = true;
}


// ---------------------------------------------------------------------------
// TeaTrail change (27 Nov 2026). With skipLedgerV8DustHistory the SDK searches
// the indexer for the ledger 9 boundary on every fresh start, but gives up after
// a hard-coded 30 s and then silently replays all ledger 8 DUST history (~70 min
// or much more). Over Blockfrost from Sri Lanka the search can take longer than
// 30 s, which left the first sync stuck on "dust starting". The boundary is a
// fixed point of the chain (Preprod crossed it once, 9 Nov 2026), so we run the
// same search once (cli/dust-boundary.ts: 60 s per probe, 3 tries, logged), save
// the answer in .wallet-state/, and
// hand it to the wallet through the SDK's own `dustTimelineStartProbe` hook.
// Nightcast (LearnMidnight/Nightcast, 15 Nov 2026) hit the same 30 s limit and
// fixed it the same way.
// If the search finds nothing we fall back to the SDK's behaviour.

type DustTimelineStart = DustWalletTypes.DustTimelineStart;

async function useDustTimelineStart(logger: Logger, builder: FluentWalletBuilder, networkId: string): Promise<void> {
  const config = (builder as unknown as { config: Record<string, unknown> & { forks: { v9: bigint } } }).config;
  if (networkId === 'undeployed' || process.env['MIDNIGHT_DUST_TIMELINE'] === 'sdk') {
    skipLedgerV8DustHistory(builder);
    return;
  }
  const file = join(STATE_DIR, `${networkId}-dust-timeline-start.json`);
  let start: DustTimelineStart | undefined;
  if (existsSync(file)) {
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8')) as { cursor: string; version: string };
      start = { cursor: BigInt(saved.cursor), version: BigInt(saved.version) as DustTimelineStart['version'] };
    } catch (error) {
      logger.warn(`Ignoring unreadable ${file}: ${String(error)}`);
    }
  }
  if (!start) {
    logger.info(`One-time lookup (${networkId}): where the DUST history crosses the ledger 9 upgrade (can take a few minutes)...`);
    const started = Date.now();
    const conn = config['indexerClientConnection'] as { indexerWsUrl: string };
    let found: Awaited<ReturnType<typeof findDustBoundary>>;
    try {
      found = await findDustBoundary(conn.indexerWsUrl, BigInt(config.forks.v9), logger);
    } catch (error) {
      logger.warn(String(error instanceof Error ? error.message : error));
      found = undefined;
    }
    const secs = Math.round((Date.now() - started) / 1000);
    if (!found) {
      logger.warn(`DUST boundary lookup found nothing after ${secs}s; using the SDK default (may replay old DUST history).`);
      skipLedgerV8DustHistory(builder);
      return;
    }
    start = { cursor: found.cursor, version: found.version as DustTimelineStart['version'] };
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(file, JSON.stringify({ cursor: start.cursor.toString(), version: start.version.toString() }, null, 2) + '\n');
    logger.info(`DUST boundary found in ${secs}s (event ${start.cursor}); saved for next time.`);
  } else {
    logger.info(`Using saved DUST boundary (event ${start.cursor}).`);
  }
  const fixed = start;
  config['skipLedgerV8DustHistory'] = false; // so the SDK doesn't replace our probe with its 30 s search
  config['dustTimelineStartProbe'] = () => Promise.resolve(Option.some(fixed));
}

/** The three sub-wallets restored from a snapshot, configured as testkit's WalletFactory configures new ones. */
async function restoreFacade(
  builder: FluentWalletBuilder,
  dustOptions: DustWalletOptions,
  saved: SavedWalletState,
): Promise<WalletFacade> {
  // testkit keeps the builder's wallet configuration private and does not
  // export the function that derives it; reuse it so a restored wallet is
  // configured exactly like a new one.
  const config = (builder as unknown as { config: Parameters<typeof ShieldedWallet>[0] }).config;
  const shielded = ShieldedWallet(config).restore(saved.shielded);
  const unshielded = UnshieldedWallet({
    ...config,
    txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries),
  } as Parameters<typeof UnshieldedWallet>[0]).restore(saved.unshielded);
  const dust = DustWallet({
    ...config,
    costParameters: {
      ledgerParams: dustOptions.ledgerParams,
      additionalFeeOverhead: dustOptions.additionalFeeOverhead,
      feeBlocksMargin: dustOptions.feeBlocksMargin,
    },
  } as Parameters<typeof DustWallet>[0]).restore(saved.dust);
  return WalletFacade.init({
    configuration: config as Parameters<typeof WalletFacade.init>[0]['configuration'],
    shielded: () => shielded,
    unshielded: () => unshielded,
    dust: () => dust,
  });
}

/** The saved wallet for this seed and network if there is one, else `fresh`. */
async function restoreSavedState(
  logger: Logger,
  env: EnvironmentConfiguration,
  builder: FluentWalletBuilder,
  dustOptions: DustWalletOptions,
  fresh: WalletFacade,
  masterSeed: string,
): Promise<WalletFacade> {
  const file = stateFileFor(env.networkId, masterSeed);
  let wallet = fresh;
  if (file && existsSync(file)) {
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8')) as SavedWalletState;
      const mismatch = saved.version === 2 ? await checkChainStamp(env.indexer, saved.chain) : null;
      if (mismatch) {
        logger.warn(`Not restoring ${file}: ${mismatch}. Syncing from genesis.`);
      } else {
        wallet = await restoreFacade(builder, dustOptions, saved);
        logger.info(
          saved.version === 2
            ? `Restored wallet state from ${file} (chain check passed at block ${saved.chain.height}).`
            : `Restored wallet state from ${file} (no chain stamp yet; it gets one on the next save).`,
        );
      }
    } catch (error) {
      logger.warn(`Could not restore ${file} (${String(error)}); syncing from genesis.`);
    }
  }
  if (file) stateFiles.set(wallet, { file, indexer: env.indexer });
  return wallet;
}

/** Save the wallet's state for the next build of the same wallet (no-op on the local devnet). */
export async function saveWalletState(logger: Logger, wallet: WalletFacade): Promise<void> {
  const target = stateFiles.get(wallet);
  if (!target) return;
  const { file } = target;
  const chain = await readChainStamp(target.indexer);
  if (!chain) {
    // An unstamped save could never be checked, so keep the previous file.
    logger.warn(`Could not read the chain tip from the indexer; not saving wallet state to ${file}.`);
    return;
  }
  const saved: SavedWalletState = {
    version: 2,
    chain,
    shielded: await wallet.shielded.serializeState(),
    unshielded: await wallet.unshielded.serializeState(),
    dust: await wallet.dust.serializeState(),
  };
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(`${file}.tmp`, JSON.stringify(saved), { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
  logger.info(`Saved wallet state to ${file}.`);
}

// ---------------------------------------------------------------------------
// Funding gate for remote runs
// ---------------------------------------------------------------------------
//
// "Synced" is not "funded": a wallet that was never funded is at chain tip
// with no coins. This waits for NIGHT from the faucet, registers it for DUST
// generation, and waits for spendable DUST.
//
// testkit's waitForFunds does the same, but it re-syncs with a fixed 90 s
// timeout after the faucet transfer. Indexers back their progress updates off
// to ~4 min on an idle subscription, so that check can time out although the
// NIGHT has arrived. The DUST wait below is the readiness check instead.

/** How long to wait for a human to visit the faucet, and for DUST to accrue. */
const FUND_TIMEOUT_MS = Number(process.env['MIDNIGHT_FUND_TIMEOUT_MS'] ?? 30 * 60_000);

const hasNight = (s: FacadeState) => Object.values(s.unshielded.balances).some((v) => v > 0n);

/** The indexer's latest block time, or undefined while it can't be read. */
async function latestBlockTime(indexerHttpUrl: string, timeoutMs: number): Promise<Date | undefined> {
  try {
    const res = await fetch(indexerHttpUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ block { timestamp } }' }),
      signal: AbortSignal.timeout(Math.max(1, timeoutMs)),
    });
    const body = (await res.json()) as { data?: { block?: { timestamp?: number } } };
    const ts = body.data?.block?.timestamp;
    return typeof ts === 'number' ? new Date(ts) : undefined;
  } catch {
    return undefined;
  }
}

/** 1 DUST is 10^15 Specks (SPECKS_PER_DUST in the ledger). */
const SPECKS_PER_DUST = 10n ** 15n;

/**
 * The DUST a wallet must hold before a suite transacts: enough to pay for a
 * deploy. MIDNIGHT_MIN_DUST overrides it, in DUST (default 60).
 */
const MIN_DUST_SPECKS = BigInt(
  Math.round(Number(process.env['MIDNIGHT_MIN_DUST'] ?? '60') * 1e6),
) * (SPECKS_PER_DUST / 10n ** 6n);

function formatDust(specks: bigint): string {
  return `${specks / SPECKS_PER_DUST}.${(specks % SPECKS_PER_DUST).toString().padStart(15, '0').slice(0, 6)}`;
}

/**
 * Wait until the wallet holds at least `minCoins` spendable DUST coin(s).
 *
 * With `indexerHttpUrl`, also wait until the DUST is worth at least
 * MIN_DUST_SPECKS at the latest block's time, which is when the wallet values
 * it while balancing. DUST accrues after registration, so a freshly registered
 * wallet holds a coin worth almost nothing, too little to pay for a deploy
 * ("could not balance dust"). On a fresh local devnet the DUST exists from
 * genesis but is worth 0 until the first block after genesis.
 */
export async function waitForDust(
  logger: Logger,
  wallet: WalletFacade,
  minCoins = 1,
  timeoutMs = 180_000,
  indexerHttpUrl?: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  logger.info(`Waiting for >=${minCoins} spendable DUST coin(s) (timeout ${timeoutMs}ms)...`);
  const state = await Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.filter((s: FacadeState) => s.dust.availableCoins.length >= minCoins),
      Rx.take(1),
      Rx.timeout({
        each: timeoutMs,
        with: () => Rx.throwError(() => new Error(`No spendable DUST coin within ${timeoutMs}ms`)),
      }),
    ),
  );
  if (indexerHttpUrl) {
    logger.info(`Waiting for >=${formatDust(MIN_DUST_SPECKS)} DUST at the latest block...`);
    let latest = state;
    let lastLogged = 0;
    for (;;) {
      const blockTime = await latestBlockTime(indexerHttpUrl, Math.min(10_000, deadline - Date.now()));
      const balance = blockTime ? latest.dust.balance(blockTime) : 0n;
      if (balance >= MIN_DUST_SPECKS) break;
      if (Date.now() > deadline) {
        throw new Error(
          `DUST at ${formatDust(balance)}, below ${formatDust(MIN_DUST_SPECKS)}, after ${timeoutMs}ms`,
        );
      }
      if (Date.now() - lastLogged >= 60_000) {
        logger.info(`  DUST ${formatDust(balance)} / ${formatDust(MIN_DUST_SPECKS)}`);
        lastLogged = Date.now();
      }
      await new Promise((r) => setTimeout(r, 5_000));
      latest = await Rx.firstValueFrom(wallet.state());
    }
  }
  logger.info('DUST ready.');
}

export interface FundingGateOptions {
  /**
   * Register the wallet's NIGHT for DUST generation (default true). Pass false
   * for a wallet that must hold NIGHT but no DUST, such as a sponsored user.
   */
  registerDust?: boolean;
  /** Names the wallet in log lines. */
  label?: string;
}

/** How often, and how long to wait, when retrying DUST registration after a protocol-version mismatch. */
const DUST_REGISTRATION_RETRY_ATTEMPTS = 10;
const DUST_REGISTRATION_RETRY_DELAY_MS = 2_000;

const PROTOCOL_VERSION_MISMATCH_TAG =
  '@midnightntwrk/wallet-sdk-abstractions/WalletTransaction/ProtocolVersionMismatchError';

function isProtocolVersionMismatchError(err: unknown): boolean {
  // The SDK's error carries `_tag` set to exactly this string (checked on
  // wallet-sdk-abstractions 3.0.0); the `name`/class-name checks add nothing.
  return (
    err != null &&
    typeof err === 'object' &&
    (err as { _tag?: unknown })._tag === PROTOCOL_VERSION_MISMATCH_TAG
  );
}

/**
 * Wallet SDK 2.0.0 can throw ProtocolVersionMismatchError on a
 * `registerNightUtxosForDustGeneration` call made while the facade is still
 * crossing a protocol boundary (midnight-examples#93). `waitForFunding`
 * waits for the facade to settle before registering, but a crossing can
 * still land between that read and this call — so retry over a few blocks
 * as a backstop.
 */
async function registerNightUtxosForDustGenerationRetrying<T>(
  logger: Logger,
  label: string,
  register: () => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= DUST_REGISTRATION_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await register();
    } catch (err) {
      lastError = err;
      if (!isProtocolVersionMismatchError(err) || attempt === DUST_REGISTRATION_RETRY_ATTEMPTS) {
        throw err;
      }
      logger.warn(
        `${label}: DUST registration hit ProtocolVersionMismatchError (attempt ${attempt}/${DUST_REGISTRATION_RETRY_ATTEMPTS}); retrying in ${DUST_REGISTRATION_RETRY_DELAY_MS}ms`,
      );
      await new Promise((resolve) => {
        setTimeout(resolve, DUST_REGISTRATION_RETRY_DELAY_MS);
      });
    }
  }
  throw lastError;
}

/**
 * Hold until the wallet can pay for transactions on a remote network. Returns
 * at once when it already can, so only a new wallet sees the faucet prompt.
 */
export async function waitForNightThenDust(
  logger: Logger,
  wallet: WalletFacade,
  keystore: UnshieldedKeystore,
  envConfig: EnvironmentConfiguration,
  faucet: string,
  { registerDust = true, label = 'wallet' }: FundingGateOptions = {},
): Promise<void> {
  const address = String(keystore.getBech32Address());
  // Bounded peek: if state() hasn't emitted yet, assume "not funded" and fall
  // into the wait below, which has its own timeout.
  const current = await Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.timeout({ each: 30_000, with: () => Rx.of(null) }),
      Rx.catchError(() => Rx.of(null)),
    ),
  );
  if (current === null || !hasNight(current)) {
    logger.info(`Fund ${label} with tNIGHT at ${faucet}; the run continues once it arrives.`);
    logger.info(`  address: ${address}`);
    if (!registerDust) logger.info('  This wallet must NOT have DUST delegated: send tNIGHT only.');
    await Rx.firstValueFrom(
      wallet.state().pipe(
        Rx.filter(hasNight),
        Rx.take(1),
        Rx.timeout({
          each: FUND_TIMEOUT_MS,
          with: () => Rx.throwError(() => new Error(`No NIGHT at ${address} within ${FUND_TIMEOUT_MS}ms`)),
        }),
      ),
    );
  }

  if (!registerDust) {
    logger.info(`${label}: NIGHT present; not registering it for DUST, by design.`);
    return;
  }

  // Registration needs the facade settled on one side of a protocol
  // boundary: the first state emission can land mid-crossing, while the
  // facade is still bound to the version the laggard wallets are on, and
  // registration then fails with ProtocolVersionMismatchError
  // (midnight-examples#93). testkit's syncWallet waits for the same
  // `protocol._tag === 'Settled'` reading; the retry below stays as a
  // backstop for a crossing that lands between this read and the call.
  // Bounded overall (`first`, not `each`): the state keeps emitting while the
  // wallets cross, so a per-emission timeout would never fire on a stall.
  let lastProtocol: FacadeState['protocol'] | undefined;
  const state = await Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.tap((s: FacadeState) => {
        lastProtocol = s.protocol;
      }),
      Rx.filter((s: FacadeState) => s.protocol._tag === 'Settled'),
      Rx.timeout({
        first: FUND_TIMEOUT_MS,
        with: () =>
          Rx.throwError(() => {
            const p = lastProtocol;
            const behind = p?._tag === 'Crossing' ? ` (${p.behind.join(', ')} behind)` : '';
            return new Error(
              `${label}: wallets still crossing a protocol boundary after ${FUND_TIMEOUT_MS}ms${behind}`,
            );
          }),
      }),
    ),
  );
  const night = unshieldedToken().raw;
  const unregistered = state.unshielded.availableCoins.filter(
    (coin) => coin.utxo.type === night && !coin.meta.registeredForDustGeneration,
  );
  if (state.dust.balance(new Date()) === 0n && unregistered.length > 0) {
    logger.info(`${label}: registering ${unregistered.length} NIGHT UTXO(s) for DUST generation...`);
    const recipe = await registerNightUtxosForDustGenerationRetrying(
      logger,
      label,
      () =>
        wallet.registerNightUtxosForDustGeneration(
          unregistered,
          keystore.getPublicKey(),
          (payload) => keystore.signDataAsync(payload),
        ),
    );
    const txId = await wallet.submitTransaction(await wallet.finalizeRecipe(recipe));
    logger.info(`${label}: DUST registration submitted (${txId}).`);
  }
  await waitForDust(logger, wallet, 1, FUND_TIMEOUT_MS, envConfig.indexer);
  logger.info(`${label}: funded and ready.`);
}
