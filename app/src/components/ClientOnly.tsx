"use client";

// TeaTrail is a wallet dApp: all data comes from the browser (wallet, chain
// queries, mock localStorage). So we skip server prerendering of page bodies.

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

export function ClientOnly({ children }: { children: React.ReactNode }) {
  const isClient = useSyncExternalStore(subscribe, () => true, () => false);
  return isClient ? <>{children}</> : <p className="text-sm text-muted">Loading…</p>;
}
