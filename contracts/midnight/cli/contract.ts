// The compiled sealed auction, ready for Midnight.js. Needs the contract compiled
// (the full build: deploying needs the ZK proving keys in managed/).
// On Windows, compile in Ubuntu (WSL): the Compact compiler only runs on Linux.

import path from 'node:path';
import { existsSync } from 'node:fs';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/v9/compact-js';
import { Contract } from '../managed/sealed_auction/contract/index.js';
import { witnesses } from '../src/witnesses.js';
import { zkConfigPath } from './paths.js';

export { Contract, ledger, Phase, type Ledger, type ImpureCircuits } from '../managed/sealed_auction/contract/index.js';

export { zkConfigPath };

export function assertFullBuild(): void {
  if (!existsSync(path.join(zkConfigPath, 'keys'))) {
    throw new Error('No proving keys in managed/sealed_auction/keys. Compile the contract first, in Ubuntu (WSL):\n  cd /mnt/d/blockweave/contracts/midnight && compact compile src/sealed_auction.compact managed/sealed_auction');
  }
}

export const CompiledAuction = CompiledContract.make('TeaTrailSealedAuction', Contract).pipe(
  CompiledContract.withWitnesses(witnesses),
  CompiledContract.withCompiledFileAssets(zkConfigPath),
);
