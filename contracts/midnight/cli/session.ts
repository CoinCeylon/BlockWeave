// Start the wallet, sync it, make sure it can pay fees, and build providers.

import * as Rx from 'rxjs';
import { unshieldedToken } from '@midnight-ntwrk/midnight-js-protocol/v9';
import type { FacadeState } from '@midnightntwrk/wallet-sdk';
import { envConfigOf, getConfig, logger, walletSeed, type NetworkConfig } from './env.js';
import { MidnightWalletProvider, syncWallet, waitForNightThenDust } from './wallet.js';
import { buildProviders, type AuctionProviders } from './providers.js';

export type Session = {
  config: NetworkConfig;
  wallet: MidnightWalletProvider;
  providers: AuctionProviders;
  address: string;
  stop: () => Promise<void>;
};

const SPECKS_PER_DUST = 10n ** 15n;
export const fmtDust = (specks: bigint) =>
  `${specks / SPECKS_PER_DUST}.${(specks % SPECKS_PER_DUST).toString().padStart(15, '0').slice(0, 3)}`;
export const fmtNight = (stars: bigint) => `${stars / 10n ** 6n}`; // 1 NIGHT = 10^6 STAR

export async function balances(wallet: MidnightWalletProvider) {
  const s: FacadeState = await Rx.firstValueFrom(wallet.wallet.state());
  return {
    night: s.unshielded.balances[unshieldedToken().raw] ?? 0n,
    dust: s.dust.balance(new Date()),
  };
}

export async function startSession({ needFunds = true, requireProofServer = true } = {}): Promise<Session> {
  const config = getConfig();
  const env = envConfigOf(config);
  const isRemote = config.name !== 'local';

  logger.info(`Network: ${config.name}. Proof server: ${config.proofServer}`);
  try {
    await checkProofServer(config.proofServer);
  } catch (e) {
    if (requireProofServer) throw e;
    logger.warn(`${e instanceof Error ? e.message : String(e)}\nContinuing: syncing and funding work without it. Start it before npm run demo.`);
  }

  const wallet = await MidnightWalletProvider.build(logger, env, { kind: 'seed', value: walletSeed(config) });
  const address = String(wallet.unshieldedKeystore.getBech32Address());
  logger.info(`Wallet address (send tNIGHT here): ${address}`);

  await wallet.start();
  const stop = async () => {
    await wallet.stop().catch((e: unknown) => logger.warn(`wallet stop failed: ${String(e)}`));
  };
  // Stop cleanly on Ctrl+C so the next run can reuse the saved sync state.
  process.once('SIGINT', () => {
    logger.warn('Interrupted. Stopping wallet...');
    void stop().finally(() => process.exit(130));
  });

  const syncTimeoutMs = Number(process.env['MIDNIGHT_SYNC_TIMEOUT_MS'] ?? (isRemote ? 3 * 60 * 60_000 : 10 * 60_000));
  logger.info(isRemote ? 'Syncing with Preprod. The first sync of a new wallet can take a while; later runs are quick.' : 'Syncing...');
  await syncWallet(logger, wallet.wallet, syncTimeoutMs);

  if (isRemote && needFunds) {
    await waitForNightThenDust(logger, wallet.wallet, wallet.unshieldedKeystore, env, config.faucet, { label: 'TeaTrail wallet' });
  }
  const b = await balances(wallet);
  logger.info(`Balances: ${fmtNight(b.night)} tNIGHT, ${fmtDust(b.dust)} tDUST`);

  return { config, wallet, providers: buildProviders(wallet, config), address, stop };
}

async function checkProofServer(url: string): Promise<void> {
  try {
    const res = await fetch(new URL('/health', url), { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    throw new Error(
      `Proof server not reachable at ${url} (${String(e)}). Start it in another terminal (Docker Desktop running):\n` +
        '  docker run -p 6300:6300 midnightntwrk/proof-server:9.0.2',
    );
  }
}
