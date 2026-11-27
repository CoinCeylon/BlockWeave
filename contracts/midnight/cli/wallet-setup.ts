// npm run wallet
//
// Creates the CLI wallet (first run), prints its address, waits for tNIGHT from
// the faucet, registers it for DUST and waits until there is enough DUST to
// deploy. Safe to re-run: a funded wallet just prints its balances.
//
// This is the workaround for Lace's "Generate tDUST" bug on Preprod
// (ProtocolVersionMismatchError): the wallet SDK 2.0.1 flow below waits for the
// wallet to settle on the new protocol version before registering, and retries.

import { logger } from './env.js';
import { startSession } from './session.js';

const session = await startSession({ needFunds: true, requireProofServer: false }).catch((e: unknown) => {
  logger.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
logger.info('Wallet is funded and has DUST. Next: npm run demo');
await session.stop();
process.exit(0);
