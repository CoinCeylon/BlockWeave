// Same rules as contracts/cardano/lib/teatrail/rules.ak, used so the UI can
// explain a rejection before sending a tx (the chain still enforces them).

import { Lot, Party, ROLE_FOR_STAGE, STAGES, Stage } from "./types";

export function nextStage(stage: Stage): Stage | null {
  const i = STAGES.indexOf(stage);
  return i < STAGES.length - 1 ? STAGES[i + 1] : null;
}

export type CheckResult = { ok: true; next: Stage } | { ok: false; reason: string };

export function canAdvance(lot: Lot, signer: Party, priceLkr?: number): CheckResult {
  const next = nextStage(lot.stage);
  if (!next) return { ok: false, reason: "This lot is already exported. Its record is frozen." };
  const needed = ROLE_FOR_STAGE[next];
  if (signer.role !== needed)
    return {
      ok: false,
      reason: `Only a ${needed} can mark this lot as ${next}. You're signed in as a ${signer.role}.`,
    };
  if (next === "Sold" && !(priceLkr && priceLkr > 0))
    return { ok: false, reason: "A Sold checkpoint needs the auction price." };
  return { ok: true, next };
}
