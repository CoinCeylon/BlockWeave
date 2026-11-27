// npm run status [-- <contract address>]
//
// Reads an auction's PUBLIC state from the indexer. No wallet needed. This is
// exactly what anyone on the internet can see: no losing bid amounts.
// Without an address it uses the most recent deployment in cli/deployments/.

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { getConfig, logger } from './env.js';
import { ledger, Phase } from './contract.js';
import { ledgerState } from './providers.js';
import { isMain } from './paths.js';

export const DEPLOYMENTS_DIR = fileURLToPath(new URL('./deployments/', import.meta.url));

export function latestDeployment(): string | undefined {
  try {
    const files = readdirSync(DEPLOYMENTS_DIR).filter((f) => f.endsWith('.json'));
    const records = files.map((f) => JSON.parse(readFileSync(DEPLOYMENTS_DIR + f, 'utf8')) as { address: string; deployedAt: string });
    records.sort((a, b) => a.deployedAt.localeCompare(b.deployedAt));
    return records.at(-1)?.address;
  } catch {
    return undefined;
  }
}

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

export function describe(l: ReturnType<typeof ledger>) {
  return {
    phase: Phase[l.phase],
    lotId: hex(l.lotId),
    reservePrice: l.reservePrice,
    bidCount: l.bidCount,
    sealedBids: [...l.commitments].map(([pk, c]) => ({ bidder: hex(pk), commitment: hex(c) })),
    threshold: l.threshold,
    winner: l.phase === Phase.CLOSED && l.winningPrice > 0n ? hex(l.winner) : null,
    winningPrice: l.winningPrice,
  };
}

if (isMain(import.meta.url)) {
  const address = process.argv[2] ?? latestDeployment();
  if (!address) {
    logger.error('Give a contract address: npm run status -- <address> (or run npm run demo first).');
    process.exit(1);
  }
  const config = getConfig();
  const pdp = indexerPublicDataProvider(config.indexer, config.indexerWS);
  const read = await pdp.queryContractState(address);
  const state = describe(ledger(ledgerState(read)));
  console.log(JSON.stringify({ address, ...state }, (_k, v) => (typeof v === 'bigint' ? Number(v) : v), 2));
  if (config.explorer) console.log(`\nExplorer: ${config.explorer} (search for the address)`);
  process.exit(0);
}
