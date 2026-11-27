// Finds where Preprod's DUST event timeline crosses the ledger 9 upgrade, so a
// new wallet can skip ~1.9 million older DUST events (about 17 hours of replay).
//
// Same algorithm as the wallet SDK's findDustTimelineStart (wallet-sdk-dust-wallet
// 5.1.0, v2/Sync.js), but each probe gets 60 s and 3 tries instead of one 10 s try,
// and every step is logged. From Sri Lanka the SDK's 10 s probe timed out on the
// first step through Blockfrost, so the SDK silently fell back to the full replay.

import { WebSocket } from 'ws';
import type { Logger } from 'pino';

export type DustBoundary = { cursor: bigint; version: bigint };
type Probe = { id: number; version: bigint; maxId: number };

const PROBE_TIMEOUT_MS = 60_000;
const TRIES = 3;
const QUERY = 'subscription ($id: Int) { dustLedgerEvents(id: $id) { id maxId protocolVersion } }';

const redact = (s: string) => s.replace(/project_id=[^&\s"')]+/g, 'project_id=XXX');

/** The first DUST event at or after `id` (null: the start of the timeline). */
function probeOnce(indexerWS: string, id: number | null): Promise<Probe> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(indexerWS, 'graphql-transport-ws');
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* already closed */
      }
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new Error(`no event within ${PROBE_TIMEOUT_MS / 1000}s`))), PROBE_TIMEOUT_MS);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'connection_init', payload: {} })));
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as { type: string; payload?: any };
      if (msg.type === 'connection_ack') {
        ws.send(JSON.stringify({ id: '1', type: 'subscribe', payload: { query: QUERY, variables: { id } } }));
      } else if (msg.type === 'next') {
        const errors = msg.payload?.errors as { message: string }[] | undefined;
        if (errors?.length) return finish(() => reject(new Error(errors.map((e) => e.message).join('; '))));
        const e = msg.payload?.data?.dustLedgerEvents;
        if (!e) return finish(() => reject(new Error('reply had no dustLedgerEvents')));
        finish(() => resolve({ id: Number(e.id), maxId: Number(e.maxId), version: BigInt(e.protocolVersion) }));
      } else if (msg.type === 'error') {
        finish(() => reject(new Error(`subscription error: ${JSON.stringify(msg.payload).slice(0, 300)}`)));
      } else if (msg.type === 'complete') {
        finish(() => reject(new Error(`indexer closed the DUST events at ${id ?? 'the start'}`)));
      }
    });
    ws.on('unexpected-response', (_req, res) => finish(() => reject(new Error(`HTTP ${res.statusCode}`))));
    ws.on('close', (code, reason) => finish(() => reject(new Error(`connection closed: ${code} ${reason.toString()}`))));
    ws.on('error', (e) => finish(() => reject(e)));
  });
}

async function probe(indexerWS: string, id: number | null, logger: Logger): Promise<Probe> {
  for (let attempt = 1; ; attempt++) {
    const t0 = Date.now();
    try {
      const p = await probeOnce(indexerWS, id);
      logger.debug(`  probe ${id ?? 'start'} → event ${p.id}, version ${p.version} (${Date.now() - t0} ms)`);
      return p;
    } catch (e) {
      const msg = redact(e instanceof Error ? e.message : String(e));
      if (attempt >= TRIES) throw new Error(`DUST event probe at ${id ?? 'the start'} failed ${TRIES} times: ${msg}`);
      logger.warn(`  probe at ${id ?? 'the start'} failed (${msg}); retrying (${attempt}/${TRIES})...`);
    }
  }
}

/**
 * Where the DUST timeline reaches `boundary`: `cursor` is the last event id below
 * it, `version` the version of the first event at or beyond it. Undefined when
 * the chain has not crossed it, or crossed before its first DUST event.
 */
export async function findDustBoundary(indexerWS: string, boundary: bigint, logger: Logger): Promise<DustBoundary | undefined> {
  const first = await probe(indexerWS, null, logger);
  const last = await probe(indexerWS, first.maxId, logger);
  logger.info(`  DUST events ${first.id}…${last.id} (versions ${first.version} → ${last.version}); searching for ${boundary}...`);
  if (first.version >= boundary || last.version < boundary) return undefined;

  let low = first.id + 1;
  let high = last.id;
  let atHigh = last;
  let steps = 0;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const p = await probe(indexerWS, middle, logger);
    steps++;
    if (p.version >= boundary) {
      high = middle;
      atHigh = p;
    } else {
      low = p.id + 1; // step over gaps where zswap events sit, as the SDK does
    }
    if (steps % 5 === 0) logger.info(`  ...narrowing: events ${low}…${high} (${steps} steps)`);
  }
  return { cursor: BigInt(low - 1), version: atHigh.version };
}
