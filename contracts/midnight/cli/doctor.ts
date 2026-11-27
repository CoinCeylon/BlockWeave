// npm run doctor
//
// Checks every connection the wallet and demo need, with the Blockfrost key
// from .env, and prints the results with the key hidden. Same checks as the
// `mnkit doctor` in midnightntwrk/midnight-examples, plus WebSocket tests.

import { WebSocket } from 'ws';
import { getConfig } from './env.js';

const TIMEOUT_MS = 15_000;
const MAX_INDEXER_LAG = 20;
const PROOF_SERVER_PIN = '9.0.2';

const config = (() => {
  try {
    return getConfig();
  } catch (e) {
    console.log(`✖ config: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
})();
const redact = (s: string) => s.replace(/project_id=[^&\s"')]+/g, 'project_id=XXX').replace(/nightpreprod[A-Za-z0-9]+/g, 'nightpreprodXXX');
const rows: { ok: boolean; warn?: boolean; name: string; detail: string }[] = [];
const add = (ok: boolean, name: string, detail: string, warn = false) => rows.push({ ok, name, detail: redact(detail), warn });
const why = (e: unknown) => (e instanceof Error ? `${e.name === 'TimeoutError' ? 'timed out' : e.message}${(e as { cause?: unknown }).cause ? ` (${String((e as { cause?: unknown }).cause)})` : ''}` : String(e));

async function postJson(url: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  return { status: res.status, json };
}

function wsCheck(url: string, protocols?: string | string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, protocols);
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error('timed out'));
    }, TIMEOUT_MS);
    ws.on('open', () => {
      clearTimeout(timer);
      ws.close();
      resolve('connected');
    });
    ws.on('unexpected-response', (_req, res) => {
      clearTimeout(timer);
      let body = '';
      res.on('data', (c: Buffer) => (body += c.toString()));
      res.on('end', () => reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`)));
    });
    ws.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

console.log(`Network: ${config.name}\n`);

// 1. node RPC over HTTP
let nodeHeight: number | null = null;
try {
  const call = async (method: string) => {
    const { json } = await postJson(config.node, { id: 1, jsonrpc: '2.0', method, params: [] });
    if (json?.error) throw new Error(`${method}: ${json.error.message}`);
    return json?.result;
  };
  const [chain, header] = await Promise.all([call('system_chain'), call('chain_getHeader')]);
  nodeHeight = Number.parseInt(header.number, 16);
  add(true, 'node RPC (https)', `${chain}, block ${nodeHeight}`);
} catch (e) {
  add(false, 'node RPC (https)', `${config.node}: ${why(e)}`);
}

// 2. node RPC over WebSocket (what "Unable to initialize the API" uses)
try {
  add(true, 'node RPC (wss)', await wsCheck(config.nodeWS));
} catch (e) {
  add(false, 'node RPC (wss)', `${config.nodeWS}: ${why(e)}`);
}

// 3. indexer over HTTP
let indexerHeight: number | null = null;
try {
  const { json } = await postJson(config.indexer, { query: '{ block { height } }' });
  indexerHeight = json?.data?.block?.height ?? null;
  if (typeof indexerHeight !== 'number') throw new Error(json?.errors?.[0]?.message ?? 'no block height in the answer');
  add(true, 'indexer (https)', `block ${indexerHeight}`);
} catch (e) {
  add(false, 'indexer (https)', `${config.indexer}: ${why(e)}`);
}

// 4. indexer over WebSocket (what the shielded and DUST sync use)
try {
  add(true, 'indexer (wss)', await wsCheck(config.indexerWS, 'graphql-transport-ws'));
} catch (e) {
  add(false, 'indexer (wss)', `${config.indexerWS}: ${why(e)}`);
}

// 5. indexer lag
if (nodeHeight !== null && indexerHeight !== null) {
  const lag = Math.max(0, nodeHeight - indexerHeight);
  add(true, 'indexer lag', lag > MAX_INDEXER_LAG ? `${lag} blocks behind the node: wallets will sync slowly or look stuck` : `${lag} block(s) behind the node`, lag > MAX_INDEXER_LAG);
}

// 6. proof server
try {
  const res = await fetch(new URL('/version', config.proofServer), { signal: AbortSignal.timeout(5_000) });
  const v = (await res.text()).trim();
  add(v.split('.')[0] === PROOF_SERVER_PIN.split('.')[0], 'proof server', `${config.proofServer} runs ${v}${v === PROOF_SERVER_PIN ? '' : ` (expected ${PROOF_SERVER_PIN})`}`);
} catch (e) {
  add(false, 'proof server', `${config.proofServer}: ${why(e)}. Start: docker run -p 6300:6300 midnightntwrk/proof-server:${PROOF_SERVER_PIN}`);
}

// 7. which subscriptions the indexer offers (the wallet needs all of these)
const NEEDED = ['unshieldedTransactions', 'dustLedgerEvents', 'zswapLedgerEvents', 'shieldedTransactions'];
try {
  const { json } = await postJson(config.indexer, { query: '{ __type(name: "Subscription") { fields { name } } }' });
  const have: string[] = (json?.data?.__type?.fields ?? []).map((f: { name: string }) => f.name);
  if (!have.length) throw new Error(json?.errors?.[0]?.message ?? 'no subscription list in the answer');
  const missing = NEEDED.filter((n) => !have.includes(n));
  add(missing.length === 0, 'subscriptions', missing.length ? `missing: ${missing.join(', ')} (has: ${have.join(', ')})` : `all present (${NEEDED.join(', ')})`);
} catch (e) {
  add(false, 'subscriptions', `schema query failed: ${why(e)}`);
}

// 8. open the two subscriptions the stuck parts of the wallet use, print the first reply
function firstReply(query: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(config.indexerWS, 'graphql-transport-ws');
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error('no reply within 20 s'));
    }, 20_000);
    const done = (fn: () => void) => {
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* already closed */
      }
      fn();
    };
    ws.on('open', () => ws.send(JSON.stringify({ type: 'connection_init', payload: {} })));
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as { type: string; payload?: unknown };
      if (msg.type === 'connection_ack') ws.send(JSON.stringify({ id: '1', type: 'subscribe', payload: { query } }));
      else if (msg.type === 'next') {
        const p = msg.payload as { data?: unknown; errors?: { message: string }[] };
        if (p.errors?.length) done(() => reject(new Error(`GraphQL error: ${p.errors!.map((e) => e.message).join('; ')}`)));
        else done(() => resolve(JSON.stringify(p.data).slice(0, 160)));
      } else if (msg.type === 'error') done(() => reject(new Error(`subscription error: ${JSON.stringify(msg.payload).slice(0, 300)}`)));
      else if (msg.type === 'complete') done(() => reject(new Error('server ended the subscription with no data')));
    });
    ws.on('unexpected-response', (_req, res) => done(() => reject(new Error(`HTTP ${res.statusCode}`))));
    ws.on('close', (code, reason) => done(() => reject(new Error(`closed by server: ${code} ${reason.toString()}`))));
    ws.on('error', (e) => done(() => reject(e)));
  });
}
for (const [name, query] of [
  ['dust events (wss)', 'subscription { dustLedgerEvents(id: 0) { id maxId protocolVersion } }'],
  ['zswap events (wss)', 'subscription { zswapLedgerEvents(id: 0) { id maxId protocolVersion } }'],
] as const) {
  try {
    add(true, name, await firstReply(query));
  } catch (e) {
    add(false, name, why(e));
  }
}

// 9. everything at once, as the wallet does: node + DUST + zswap + unshielded-style
//    subscriptions opened together and held for 30 s. Each must get a reply and stay open.
async function holdOpen(label: string, url: string, protocol: string | undefined, onOpen: (ws: WebSocket) => void, isReply: (m: any) => boolean): Promise<string> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const ws = new WebSocket(url, protocol);
    let replied = -1;
    const end = (msg: string) => {
      clearTimeout(timer);
      try { ws.terminate(); } catch { /* closed */ }
      resolve(msg);
    };
    const timer = setTimeout(() => end(replied >= 0 ? `ok: first reply after ${replied} ms, still open after 30 s` : 'FAIL: open for 30 s but no reply'), 30_000);
    ws.on('open', () => onOpen(ws));
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === 'connection_ack') return;
      if (m.type === 'error' || (m.type === 'next' && m.payload?.errors)) return end(`FAIL: ${JSON.stringify(m.payload).slice(0, 200)}`);
      if (replied < 0 && isReply(m)) replied = Date.now() - t0;
    });
    ws.on('unexpected-response', (_req, res) => end(`FAIL: refused with HTTP ${res.statusCode}`));
    ws.on('close', (code, reason) => end(`FAIL: closed by server after ${Date.now() - t0} ms (${code} ${reason.toString()})${replied >= 0 ? ', after replying' : ', no reply'}`));
    ws.on('error', (e) => end(`FAIL: ${e.message}`));
  });
}
const gql = (query: string) => (ws: WebSocket) => {
  ws.send(JSON.stringify({ type: 'connection_init', payload: {} }));
  ws.once('message', () => ws.send(JSON.stringify({ id: '1', type: 'subscribe', payload: { query } })));
};
const isNext = (m: any) => m.type === 'next';
const AT_ONCE = Number(process.env['DOCTOR_AT_ONCE'] ?? 8);
console.log(`Checking connections one by one, then ${AT_ONCE} at once for 30 s (about 1 minute)...`);
// Like the wallet: 2 node connections, the rest indexer subscriptions, all opened together, held 30 s.
const plan: [string, Promise<string>][] = [];
for (let i = 0; i < AT_ONCE; i++) {
  if (i < 2) {
    plan.push([`node #${i + 1}`, holdOpen('node', config.nodeWS, undefined, (ws) => ws.send(JSON.stringify({ id: 1, jsonrpc: '2.0', method: 'system_chain', params: [] })), (m) => m.id === 1)]);
  } else {
    const q = i % 2 === 0 ? `subscription { dustLedgerEvents(id: ${1857961 + i}) { id maxId } }` : `subscription { zswapLedgerEvents(id: ${i}) { id maxId } }`;
    plan.push([`indexer #${i - 1}`, holdOpen('idx', config.indexerWS, 'graphql-transport-ws', gql(q), isNext)]);
  }
}
const parallel = await Promise.all(plan.map(([, p]) => p));
plan.forEach(([n], i) => add(parallel[i]!.startsWith('ok'), `at once: ${n}`, parallel[i]!));

// 10. the node requests the wallet's node library (polkadot.js) makes, on one connection,
//     in its order. Blockfrost's node has dropped some of these before (Nightcast 634aa0f).
console.log('Testing the node requests the wallet makes (about 30 s)...');
const nodeSteps: [string, string, unknown[], boolean][] = [
  ['system_chain', 'system_chain', [], false],
  ['state_call (metadata versions)', 'state_call', ['Metadata_metadata_versions', '0x'], false],
  ['state_getMetadata', 'state_getMetadata', [], false],
  ['state_getRuntimeVersion', 'state_getRuntimeVersion', [], false],
  ['state_subscribeRuntimeVersion', 'state_subscribeRuntimeVersion', [], true],
];
const nodeResults = await new Promise<string[]>((resolve) => {
  const out: string[] = [];
  const ws = new WebSocket(config.nodeWS);
  let step = 0;
  let timer: NodeJS.Timeout | undefined;
  const t0 = Date.now();
  const finish = (extra?: string) => {
    if (timer) clearTimeout(timer);
    while (out.length < nodeSteps.length) out.push(extra ?? 'not reached');
    try { ws.terminate(); } catch { /* closed */ }
    resolve(out);
  };
  const next = () => {
    if (step >= nodeSteps.length) return finish();
    const [, method, params, isSub] = nodeSteps[step]!;
    const sent = Date.now();
    timer = setTimeout(() => { out.push(`FAIL: no answer in 15 s${isSub ? ' (subscription)' : ''}`); step++; next(); }, 15_000);
    ws.once('message', function handler(raw) {
      clearTimeout(timer);
      const text = raw.toString();
      let m: any = {};
      try { m = JSON.parse(text); } catch { /* not JSON */ }
      const ms = Date.now() - sent;
      if (m.error) out.push(`FAIL: ${m.error.message ?? JSON.stringify(m.error)} (${ms} ms)`);
      else if (isSub) {
        // the subscription id comes first; the first notification should follow
        ws.once('message', (n) => { out.push(`ok: subscribed, first update after ${Date.now() - sent} ms (${n.toString().length} bytes)`); step++; finish(); });
        timer = setTimeout(() => { out.push('FAIL: subscribed but no update in 15 s'); step++; finish(); }, 15_000);
        return;
      } else out.push(`ok: ${text.length.toLocaleString()} bytes in ${ms} ms`);
      step++;
      next();
    });
    ws.send(JSON.stringify({ id: step + 1, jsonrpc: '2.0', method, params }));
  };
  ws.on('open', next);
  ws.on('close', (code, reason) => { if (out.length < nodeSteps.length) out.push(`FAIL: connection closed after ${Date.now() - t0} ms (${code} ${reason.toString()})`); finish('not reached (connection closed)'); });
  ws.on('unexpected-response', (_req, res) => finish(`FAIL: refused with HTTP ${res.statusCode}`));
  ws.on('error', (e) => finish(`FAIL: ${e.message}`));
});
nodeSteps.forEach(([label], i) => add(nodeResults[i]!.startsWith('ok'), `node: ${label}`, nodeResults[i]!));

for (const r of rows) console.log(`${r.ok ? (r.warn ? '!' : '✔') : '✖'} ${r.name.padEnd(36)} ${r.detail}`);
console.log('\n(Blockfrost key hidden as XXX. Safe to paste.)');
process.exit(rows.every((r) => r.ok) ? 0 : 1);
