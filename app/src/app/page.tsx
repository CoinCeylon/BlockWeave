"use client";

import Link from "next/link";
import { StageBadge, StageBar } from "@/components/Journey";
import { resetMockData } from "@/lib/data/mock";
import { useLots } from "@/lib/useLots";

export default function Home() {
  const { lots, reload } = useLots();
  return (
    <div className="space-y-8">
      <section>
        <h1 className="font-serif text-3xl font-semibold text-leaf">Every lot of Ceylon tea, verified.</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Each lot gets a passport on Cardano that records every step from estate to export, so no one can
          change it later. Lots are sold through a sealed-bid auction on Midnight, where bids stay private.
        </p>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">All lots</h2>
          <button
            className="text-xs text-muted underline"
            onClick={() => {
              resetMockData();
              reload();
            }}
          >
            Reset demo data
          </button>
        </div>
        {!lots && <p className="text-sm text-muted">Loading…</p>}
        {lots?.map((lot) => (
          <Link key={lot.lotName} href={`/lot/${lot.lotName}`} className="card block hover:border-leaf">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-medium">
                {lot.region} · {lot.grade} · {lot.weightKg} kg
              </span>
              <StageBadge stage={lot.stage} />
              <span className="ml-auto text-xs text-muted">{lot.estateName}</span>
            </div>
            <div className="mt-3">
              <StageBar stage={lot.stage} />
            </div>
            <p className="mono mt-2 text-muted">lot {lot.lotName.slice(0, 20)}…</p>
          </Link>
        ))}
      </section>
    </div>
  );
}
