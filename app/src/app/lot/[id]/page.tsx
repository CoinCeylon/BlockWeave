"use client";

// Public scan page: what a buyer in Europe sees after scanning the QR code.
// On chain: reads the NFT's tx history + inline datums via Blockfrost.

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { StageBadge, StageBar, Timeline } from "@/components/Journey";
import { getSource } from "@/lib/data";
import type { LotWithHistory } from "@/lib/types";

export default function LotPage() {
  const { id } = useParams<{ id: string }>();
  const [lot, setLot] = useState<LotWithHistory | null | undefined>(undefined);
  const url = window.location.href;

  useEffect(() => {
    getSource().getLot(id).then(setLot);
  }, [id]);

  if (lot === undefined) return <p className="text-sm text-muted">Reading passport…</p>;
  if (lot === null) return <p className="card text-sm">No passport found for this lot ID.</p>;

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_260px]">
      <div className="space-y-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gold">Verified Ceylon Tea · Lot passport</p>
          <h1 className="mt-1 font-serif text-3xl font-semibold text-leaf">
            {lot.region} {lot.grade}
          </h1>
          <p className="text-muted">
            {lot.estateName} · {lot.weightKg} kg · harvested {new Date(lot.harvestDate).toLocaleDateString()}
          </p>
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm">
            Current stage <StageBadge stage={lot.stage} />
          </div>
          <StageBar stage={lot.stage} />
        </div>
        {lot.sale && (
          <div className="rounded-lg bg-leaf-soft p-3 text-sm text-leaf">
            Sold by sealed-bid auction <b>{lot.sale.auctionId}</b> at LKR {lot.sale.priceLkr.toLocaleString()}/kg.
            Losing bids were never revealed.
          </div>
        )}
        <section className="card">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted">Journey</h2>
          <Timeline history={lot.history} />
        </section>
      </div>

      <aside className="space-y-4">
        <div className="card flex flex-col items-center gap-3">
          {url && <QRCodeSVG value={url} size={180} fgColor="#1f4d3a" bgColor="#fffdf8" />}
          <p className="text-center text-xs text-muted">Print this on the pack. Anyone can scan it to see this page.</p>
        </div>
        <div className="card space-y-2">
          <p className="label">Lot NFT</p>
          <p className="mono">{lot.lotName}</p>
          <p className="text-xs text-muted">
            Every step above is a signed Cardano transaction. No one, including us, can change it.
          </p>
        </div>
      </aside>
    </div>
  );
}
