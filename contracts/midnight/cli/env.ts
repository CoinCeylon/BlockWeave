// Network config and local secrets for the TeaTrail Midnight CLI.
//
// Secrets live only in contracts/midnight/.env (git-ignored):
//   BLOCKFROST_PROJECT_ID            Midnight Preprod project key (nightpreprod...). You add this.
//   MIDNIGHT_SEED                    64-hex wallet seed. Created on first `npm run wallet`.
//   MIDNIGHT_PRIVATE_STATE_PASSWORD  encrypts the local private-state DB. Created on first run.
//
// Never print these values, commit them or paste them into chat.

import { randomBytes } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validatePassword } from '@midnight-ntwrk/midnight-js-utils';
import type { EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import pino from 'pino';
import { WebSocket } from 'ws';

// GraphQL subscriptions in Node need a global WebSocket.
// @ts-expect-error assigning the ws implementation to the global
globalThis.WebSocket = WebSocket;

/** contracts/midnight/ */
export const MIDNIGHT_DIR = fileURLToPath(new URL('../', import.meta.url));
export const ENV_FILE = fileURLToPath(new URL('../.env', import.meta.url));

if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

export const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport: { target: 'pino-pretty', options: { ignore: 'pid,hostname' } },
});

export type NetworkConfig = {
  name: 'preprod' | 'local';
  networkId: string;
  indexer: string;
  indexerWS: string;
  node: string;
  nodeWS: string;
  proofServer: string;
  faucet: string;
  explorer: string;
};

// Blockfrost needs the key on every request; the SDK clients only take URLs,
// so it rides along as a query parameter. Never log these URLs.
function withKey(url: string, key: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}project_id=${encodeURIComponent(key)}`;
}

export function getConfig(): NetworkConfig {
  const network = process.env['MIDNIGHT_NETWORK'] ?? 'preprod';
  const proofServer = process.env['MIDNIGHT_PROOF_SERVER'] ?? 'http://127.0.0.1:6300';
  if (network === 'local') {
    // Optional: the local devnet from midnight-examples' compose.yml.
    return {
      name: 'local',
      networkId: 'undeployed',
      indexer: 'http://127.0.0.1:8088/api/v4/graphql',
      indexerWS: 'ws://127.0.0.1:8088/api/v4/graphql/ws',
      node: 'http://127.0.0.1:9944',
      nodeWS: 'ws://127.0.0.1:9944',
      proofServer,
      faucet: '',
      explorer: '',
    };
  }
  if (network !== 'preprod') throw new Error(`MIDNIGHT_NETWORK must be 'preprod' or 'local', got '${network}'.`);
  const key = process.env['BLOCKFROST_PROJECT_ID']?.trim();
  if (!key) {
    throw new Error(
      'BLOCKFROST_PROJECT_ID is not set. Create a "Midnight Preprod" project on blockfrost.io ' +
        '(the ID starts with nightpreprod) and add BLOCKFROST_PROJECT_ID=... to contracts/midnight/.env',
    );
  }
  if (!key.startsWith('nightpreprod')) {
    throw new Error('BLOCKFROST_PROJECT_ID must be a Midnight Preprod key (starts with nightpreprod), not a Cardano key.');
  }
  return {
    name: 'preprod',
    networkId: 'preprod',
    indexer: withKey('https://midnight-preprod.blockfrost.io/api/v0', key),
    indexerWS: withKey('wss://midnight-preprod.blockfrost.io/api/v0/ws', key),
    node: withKey('https://rpc.midnight-preprod.blockfrost.io', key),
    nodeWS: withKey('wss://rpc.midnight-preprod.blockfrost.io', key),
    proofServer,
    faucet: 'https://midnight-tmnight-preprod.nethermind.dev/',
    explorer: 'https://preprod.midnightexplorer.com/',
  };
}

export function envConfigOf(config: NetworkConfig): EnvironmentConfiguration {
  return {
    walletNetworkId: config.networkId,
    networkId: config.networkId,
    indexer: config.indexer,
    indexerWS: config.indexerWS,
    node: config.node,
    nodeWS: config.nodeWS,
    faucet: config.faucet,
    proofServer: config.proofServer,
  };
}

function saveSecret(name: string, value: string): void {
  if (!existsSync(ENV_FILE)) writeFileSync(ENV_FILE, '', { mode: 0o600 });
  appendFileSync(ENV_FILE, `\n${name}=${value}\n`);
  try {
    chmodSync(ENV_FILE, 0o600);
  } catch {
    /* not supported on every filesystem */
  }
  process.env[name] = value;
}

/** The wallet seed from .env, created there on first use. Local devnet uses the genesis-funded seed. */
export function walletSeed(config: NetworkConfig): string {
  if (config.name === 'local') return '0000000000000000000000000000000000000000000000000000000000000001';
  let seed = process.env['MIDNIGHT_SEED']?.trim();
  if (!seed) {
    seed = randomBytes(32).toString('hex');
    saveSecret('MIDNIGHT_SEED', seed);
    logger.info('Created a new wallet seed and saved it to contracts/midnight/.env (git-ignored). Back that file up.');
  }
  if (!/^[0-9a-fA-F]{64}$/.test(seed)) throw new Error('MIDNIGHT_SEED in .env must be 64 hex characters.');
  return seed;
}

/** Password for the encrypted private-state DB, created in .env on first use. */
export function privateStatePassword(): string {
  const existing = process.env['MIDNIGHT_PRIVATE_STATE_PASSWORD'];
  if (existing) {
    validatePassword(existing);
    return existing;
  }
  for (;;) {
    const candidate = `Tt!${randomBytes(24).toString('base64url')}`;
    try {
      validatePassword(candidate);
      saveSecret('MIDNIGHT_PRIVATE_STATE_PASSWORD', candidate);
      return candidate;
    } catch {
      /* rare: random pattern failed the policy, try again */
    }
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
