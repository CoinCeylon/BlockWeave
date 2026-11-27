// What the demo does next, decided only from the auction's public on-chain state
// plus the bidders' private bids. Pure, so it's safe to re-run after any failure:
// a retry re-reads the chain and picks up where the auction really is.

export type Phase = 'BIDDING' | 'REVEAL' | 'CLOSED';

export type Step =
  | { kind: 'placeBid'; bidder: string }
  | { kind: 'ruleChecks' }
  | { kind: 'startReveal'; price: bigint }
  | { kind: 'lowerThreshold'; price: bigint }
  | { kind: 'claimWin'; bidder: string }
  | { kind: 'closeNoSale' }
  | { kind: 'done' };

export type View = {
  phase: Phase;
  bidCount: bigint;
  threshold: bigint;
  reserve: bigint;
};

export type Plan = {
  bidderOrder: string[]; // bids are placed in this order, so bidCount n means the first n are in
  bids: Record<string, bigint>;
  startThreshold: bigint;
  step: bigint;
  ruleChecksDone: boolean;
};

export function nextStep(v: View, p: Plan): Step {
  if (v.phase === 'CLOSED') return { kind: 'done' };
  if (v.phase === 'BIDDING') {
    const placed = Number(v.bidCount);
    if (placed < p.bidderOrder.length) return { kind: 'placeBid', bidder: p.bidderOrder[placed]! };
    if (!p.ruleChecksDone) return { kind: 'ruleChecks' };
    return { kind: 'startReveal', price: p.startThreshold };
  }
  // REVEAL: each bidder's own client compares its sealed bid with the public threshold.
  const eligible = p.bidderOrder
    .filter((id) => p.bids[id]! >= v.threshold)
    .sort((a, b) => (p.bids[b]! > p.bids[a]! ? 1 : -1));
  if (eligible.length) return { kind: 'claimWin', bidder: eligible[0]! };
  if (v.threshold <= v.reserve) return { kind: 'closeNoSale' };
  const next = v.threshold - p.step > v.reserve ? v.threshold - p.step : v.reserve;
  return { kind: 'lowerThreshold', price: next };
}

/** Errors worth waiting out: the indexer, node or proof server briefly unavailable. */
export function isTransient(e: unknown): boolean {
  const text = `${e instanceof Error ? `${e.name} ${e.message} ${String((e as { cause?: unknown }).cause ?? '')}` : String(e)}`;
  return /\b50[234]\b|IndexerQueryError|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|fetch failed|timed? ?out|WebSocket|Abnormal Closure|1006/i.test(text);
}
