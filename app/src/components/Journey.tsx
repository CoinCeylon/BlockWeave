import { STAGES, type Checkpoint, type Stage } from "@/lib/types";

export function StageBadge({ stage }: { stage: Stage }) {
  const done = stage === "Exported";
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
        done ? "bg-leaf text-white" : "bg-leaf-soft text-leaf"
      }`}
    >
      {stage}
    </span>
  );
}

export function StageBar({ stage }: { stage: Stage }) {
  const at = STAGES.indexOf(stage);
  return (
    <div className="flex gap-1" aria-label={`Stage ${at + 1} of ${STAGES.length}: ${stage}`}>
      {STAGES.map((s, i) => (
        <div key={s} className={`h-1.5 flex-1 rounded-full ${i <= at ? "bg-leaf" : "bg-line"}`} title={s} />
      ))}
    </div>
  );
}

export function Timeline({ history }: { history: Checkpoint[] }) {
  return (
    <ol className="relative ml-2 border-l-2 border-leaf/30">
      {history.map((c) => (
        <li key={c.txHash} className="mb-6 ml-6 last:mb-0">
          <span className="absolute -left-[9px] mt-1 h-4 w-4 rounded-full border-2 border-paper bg-leaf" />
          <div className="flex flex-wrap items-baseline gap-x-3">
            <StageBadge stage={c.stage} />
            <span className="text-sm font-medium">{c.byName}</span>
            <span className="text-xs text-muted">{new Date(c.at).toLocaleString()}</span>
          </div>
          <p className="mt-1 text-sm">{c.note}</p>
          <p className="mono mt-1 text-muted">tx {c.txHash.slice(0, 16)}…</p>
        </li>
      ))}
    </ol>
  );
}
