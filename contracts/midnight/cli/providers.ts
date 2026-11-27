// Midnight.js 5 providers for the auction. Adapted from
// midnightntwrk/midnight-examples examples/private-bid/src/providers.ts (Apache-2.0).

import path from 'node:path';
import {
  createLedger9MidnightProvider,
  createLedger9WalletProvider,
  type ContractStateRead,
  type MidnightProviders,
} from '@midnight-ntwrk/midnight-js-types';
import { ContractState } from '@midnight-ntwrk/midnight-js-protocol/v9/compact-runtime';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import type { MidnightWalletProvider } from './wallet.js';
import { MIDNIGHT_DIR, privateStatePassword, type NetworkConfig } from './env.js';
import { zkConfigPath } from './paths.js';
import type { ImpureCircuits } from './contract.js';

export type AuctionCircuits = keyof ImpureCircuits<unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AuctionProviders = MidnightProviders<any>;

const TX_TTL_SECONDS = Number(process.env['MIDNIGHT_TX_TTL_SECONDS'] ?? 3600);

export function buildProviders(wallet: MidnightWalletProvider, config: NetworkConfig): AuctionProviders {
  const zkConfigProvider = new NodeZkConfigProvider<AuctionCircuits>(zkConfigPath);
  return {
    // Encrypted, on this machine only (contracts/midnight/midnight-level-db/, git-ignored).
    // Holds every party's secret key, bid amount and salt.
    privateStateProvider: levelPrivateStateProvider({
      midnightDbName: path.join(MIDNIGHT_DIR, 'midnight-level-db'),
      privateStateStoreName: `teatrail-auction-${config.networkId}`,
      privateStoragePasswordProvider: () => privateStatePassword(),
      accountId: wallet.getCoinPublicKey(),
    }),
    publicDataProvider: indexerPublicDataProvider(config.indexer, config.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(config.proofServer, zkConfigProvider),
    walletProvider: createLedger9WalletProvider(wallet),
    midnightProvider: createLedger9MidnightProvider((tx) => wallet.submitTx(tx)),
    config: { networkId: config.networkId, ttlSeconds: TX_TTL_SECONDS },
  };
}

/** Decode a contract's public state for the compiled `ledger()`. */
export function ledgerState(read: ContractStateRead | null) {
  if (read === null) throw new Error('Contract state not found. Wrong address, or the indexer has not seen it yet.');
  if (read.contractState.era !== 'v9') throw new Error('Expected a ledger 9 contract state.');
  return read.contractState.deserialize({ v9: ContractState }).data;
}
