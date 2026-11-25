"use client";

import { useState } from "react";
import { StageBadge, StageBar } from "@/components/Journey";
import { getSource } from "@/lib/data";
import { nextStage } from "@/lib/rules";
import { ROLE_FOR_STAGE } from "@/lib/types";
import { useLots } from "@/lib/useLots";
import { useParty } from "@/lib/useParty";

export default function CheckpointPage() {
  const { party } = useParty();
  const { lots, reload } = useLots();
  const [selected, setSelected] = useState<string>("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const lot = lots?.find((l) => l.lotName === selected) ?? lots?.find((l) => l.stage !== "Exported");
  const next = lot ? nextStage(lot.stage) : null;

  async function submit() {
    if (!lot) return;
    setBusy(true);
    setMsg(null);
    try {
      await getSource().advanceLot(party, lot.lotName, note || `${next} by ${party.name}`);
      setMsg({ ok: true, text: `Checkpoint recorded: ${next}.` });
      setNote("");
      reload();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div>
        <h1 className="font-serif text-2xl font-semibold text-leaf">Add a checkpoint</h1>
        <p className="text-sm text-muted">
          Each party signs its own step. The contract only accepts the right role, in the right order.
        </p>
      </div>

      <div className="card space-y-4">
        <div>
          <label className="label">Lot</label>
          <select className="input" value={lot?.lotName ?? ""} onChange={(e) => setSelected(e.target.value)}>
            {lots?.map((l) => (
              <option key={l.lotName} value={l.lotName}>
                {l.region} · {l.grade} · {l.weightKg} kg ({l.stage})
              </option>
            ))}
          </select>
        </div>

        {lot && (
          <>
            <StageBar stage={lot.stage} />
            <div className="flex items-center gap-2 text-sm">
              Now <StageBadge stage={lot.stage} />
              {next ? (
                <>
                  → next <StageBadge stage={next} />
                  <span className="text-muted">(signed by a {ROLE_FOR_STAGE[next]})</span>
                </>
              ) : (
                <span className="text-muted">Journey complete. This record is frozen.</span>
              )}
            </div>
            {next === "Sold" ? (
              <p className="rounded-lg bg-leaf-soft p-3 text-sm text-leaf">
                The Sold step is written from the auction result. Go to the Auction page.
              </p>
            ) : (
              next && (
                <>
                  <div>
                    <label className="label">Note</label>
                    <input className="input" value={note} onChange={(e) => setNote(e.target.value)}
                      placeholder="e.g. Orthodox rolling, fired 6h" />
                  </div>
                  <button className="btn w-full" onClick={submit} disabled={busy}>
                    {busy ? "Signing…" : `Sign as ${party.name}`}
                  </button>
                </>
              )
            )}
          </>
        )}
        {msg && <p className={`text-sm ${msg.ok ? "text-leaf" : "text-red-700"}`}>{msg.text}</p>}
      </div>
    </div>
  );
}
