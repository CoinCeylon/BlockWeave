"use client";

import Link from "next/link";
import { useState } from "react";
import { StageBadge } from "@/components/Journey";
import { getSource } from "@/lib/data";
import { useLots } from "@/lib/useLots";
import { useParty } from "@/lib/useParty";

const REGIONS = ["Nuwara Eliya", "Dimbula", "Uva", "Uda Pussellawa", "Kandy", "Sabaragamuwa", "Ruhuna"];
const GRADES = ["BOP", "BOPF", "FBOP", "OP", "OP1", "Pekoe", "Dust"];

export default function EstatePage() {
  const { party } = useParty();
  const { lots, reload } = useLots();
  const [form, setForm] = useState({
    region: REGIONS[0],
    grade: GRADES[1],
    weightKg: 500,
    harvestDate: new Date().toISOString().slice(0, 10),
    note: "",
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; lot?: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const lot = await getSource().createLot(party, {
        ...form,
        weightKg: Number(form.weightKg),
        harvestDate: new Date(form.harvestDate).getTime(),
        note: form.note || "Harvested",
      });
      setMsg({ ok: true, text: "Lot passport minted.", lot: lot.lotName });
      reload();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const mine = lots?.filter((l) => l.estate === party.id) ?? [];

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_1fr]">
      <form onSubmit={submit} className="card space-y-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold text-leaf">New lot passport</h1>
          <p className="text-sm text-muted">Mints a unique NFT for this lot on Cardano. Only approved estates can do this.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Region</label>
            <select className="input" value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })}>
              {REGIONS.map((r) => <option key={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Grade</label>
            <select className="input" value={form.grade} onChange={(e) => setForm({ ...form, grade: e.target.value })}>
              {GRADES.map((g) => <option key={g}>{g}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Weight (kg)</label>
            <input className="input" type="number" min={1} value={form.weightKg}
              onChange={(e) => setForm({ ...form, weightKg: Number(e.target.value) })} />
          </div>
          <div>
            <label className="label">Harvest date</label>
            <input className="input" type="date" value={form.harvestDate}
              onChange={(e) => setForm({ ...form, harvestDate: e.target.value })} />
          </div>
        </div>
        <div>
          <label className="label">Note</label>
          <input className="input" placeholder="e.g. Hand-plucked at 1,800 m" value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </div>
        <button className="btn w-full" disabled={busy}>
          {busy ? "Signing…" : `Mint as ${party.name}`}
        </button>
        {msg && (
          <p className={`text-sm ${msg.ok ? "text-leaf" : "text-red-700"}`}>
            {msg.text}{" "}
            {msg.lot && <Link className="underline" href={`/lot/${msg.lot}`}>View passport →</Link>}
          </p>
        )}
        {party.role !== "estate" && (
          <p className="text-xs text-muted">Tip: switch “Acting as” to an estate. Other roles are rejected, same as on chain.</p>
        )}
      </form>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Lots from {party.name}</h2>
        {mine.length === 0 && <p className="text-sm text-muted">No lots yet.</p>}
        {mine.map((l) => (
          <Link key={l.lotName} href={`/lot/${l.lotName}`} className="card flex items-center gap-3 hover:border-leaf">
            <span className="text-sm font-medium">{l.region} · {l.grade} · {l.weightKg} kg</span>
            <span className="ml-auto"><StageBadge stage={l.stage} /></span>
          </Link>
        ))}
      </section>
    </div>
  );
}
