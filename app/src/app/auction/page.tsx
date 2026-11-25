"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getSource } from "@/lib/data";
import { nameOf } from "@/lib/data/mock";
import type { AuctionState } from "@/lib/types";
import { useLots } from "@/lib/useLots";
import { useParty } from "@/lib/useParty";

const lkr = (n: number) => `LKR ${n.toLocaleString()}/kg`;

export default function AuctionPage() {
  const { party } = useParty();
  const { lots, reload } = useLots();
  const candidates = lots?.filter((l) => l.stage === "Brokered" || l.stage === "Sold") ?? [];
  const [selected, setSelected] = useState("");
  const lot = candidates.find((l) => l.lotName === selected) ?? candidates[0];

  const [auction, setAuction] = useState<AuctionState | null>(null);
  const [reserve, setReserve] = useState(1000);
  const [bid, setBid] = useState(1200);
  const [start, setStart] = useState(2000);
  const [step, setStep] = useState(100);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const lotName = lot?.lotName;
  const refresh = () => {
    if (lotName) getSource().getAuction(lotName).then((a) => setAuction(a ? { ...a } : null));
  };
  useEffect(() => {
    if (!lotName) return;
    getSource().getAuction(lotName).then((a) => setAuction(a ? { ...a } : null));
  }, [lotName]);

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: label });
      refresh();
      reload();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const src = getSource();
  const isAuctioneer = party.role === "auctioneer";

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-serif text-2xl font-semibold text-leaf">Sealed-bid auction</h1>
        <p className="max-w-2xl text-sm text-muted">
          Runs on Midnight. Bids are stored as hashes, and a zero-knowledge proof checks each one is above the
          reserve. When the auction closes, only the winner and the winning price are revealed.
        </p>
      </div>

      {candidates.length === 0 ? (
        <p className="card text-sm text-muted">No lots ready for auction. Move a lot to <b>Brokered</b> first.</p>
      ) : (
        <div className="grid gap-5 md:grid-cols-[1.2fr_1fr]">
          {/* ---------- public state ---------- */}
          <section className="card space-y-4">
            <div>
              <label className="label">Lot</label>
              <select className="input" value={lot?.lotName} onChange={(e) => setSelected(e.target.value)}>
                {candidates.map((l) => (
                  <option key={l.lotName} value={l.lotName}>
                    {l.region} · {l.grade} · {l.weightKg} kg ({l.stage})
                  </option>
                ))}
              </select>
            </div>

            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Public state (what anyone sees)</h2>
            {!auction ? (
              <p className="text-sm text-muted">No auction opened for this lot.</p>
            ) : (
              <dl className="grid grid-cols-2 gap-y-2 text-sm">
                <dt className="text-muted">Phase</dt>
                <dd className="font-medium">{auction.phase}</dd>
                <dt className="text-muted">Reserve</dt>
                <dd>{lkr(auction.reservePriceLkr)}</dd>
                <dt className="text-muted">Sealed bids</dt>
                <dd>{auction.bidCount}</dd>
                {auction.phase !== "BIDDING" && (
                  <>
                    <dt className="text-muted">Threshold</dt>
                    <dd>{lkr(auction.thresholdLkr)}</dd>
                  </>
                )}
                {auction.phase === "CLOSED" && (
                  <>
                    <dt className="text-muted">Winner</dt>
                    <dd className="font-medium text-leaf">{auction.winner ? nameOf(auction.winner) : "No sale"}</dd>
                    <dt className="text-muted">Winning bid</dt>
                    <dd className="font-medium text-leaf">{auction.winningPriceLkr ? lkr(auction.winningPriceLkr) : "–"}</dd>
                  </>
                )}
              </dl>
            )}
            {auction && auction.commitments.length > 0 && (
              <div>
                <p className="label">Commitments on chain</p>
                <ul className="space-y-1">
                  {auction.commitments.map((c, i) => (
                    <li key={c.bidder} className="mono rounded bg-cream px-2 py-1 text-muted">
                      bid #{i + 1}: {c.commitment.slice(0, 32)}… <span className="text-ink">amount hidden</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {/* ---------- actions for current role ---------- */}
          <section className="card space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
              Actions for {party.name}
            </h2>

            {isAuctioneer && lot?.stage === "Brokered" && (!auction || auction.phase === "CLOSED") && !(auction?.winner) && (
              <div className="space-y-2">
                <label className="label">Reserve price (LKR/kg)</label>
                <input className="input" type="number" value={reserve} onChange={(e) => setReserve(+e.target.value)} />
                <button className="btn w-full" disabled={busy}
                  onClick={() => run("Auction opened on Midnight.", () => src.openAuction(party, lot.lotName, reserve))}>
                  Open auction
                </button>
              </div>
            )}

            {!isAuctioneer && auction?.phase === "BIDDING" && (
              <div className="space-y-2">
                <label className="label">Your sealed bid (LKR/kg)</label>
                <input className="input" type="number" value={bid} onChange={(e) => setBid(+e.target.value)} />
                <button className="btn w-full" disabled={busy}
                  onClick={() => run("Bid sealed. Only its hash is public.", () => src.placeBid(party, lot!.lotName, bid))}>
                  {busy ? "Generating proof…" : "Place sealed bid"}
                </button>
                <p className="text-xs text-muted">Your amount stays on this device. The chain stores a hash and a proof.</p>
              </div>
            )}

            {isAuctioneer && auction?.phase === "BIDDING" && (
              <div className="space-y-2">
                <label className="label">Start reveal at (LKR/kg)</label>
                <input className="input" type="number" value={start} onChange={(e) => setStart(+e.target.value)} />
                <button className="btn w-full" disabled={busy || auction.bidCount === 0}
                  onClick={() => run("Bidding closed. Reveal started.", () => src.startReveal(party, lot!.lotName, start))}>
                  Close bidding & start reveal
                </button>
              </div>
            )}

            {isAuctioneer && auction?.phase === "REVEAL" && (
              <div className="space-y-2">
                <label className="label">Lower threshold by (LKR/kg)</label>
                <input className="input" type="number" value={step} onChange={(e) => setStep(+e.target.value)} />
                <button className="btn w-full" disabled={busy}
                  onClick={() => run("Threshold lowered.", () => src.lowerThreshold(party, lot!.lotName, step))}>
                  Lower threshold
                </button>
                <p className="text-xs text-muted">
                  The first bidder whose sealed bid meets the threshold proves it and wins. No one else reveals anything.
                </p>
              </div>
            )}

            {isAuctioneer && auction?.phase === "CLOSED" && auction.winner && lot?.stage === "Brokered" && (
              <button className="btn w-full" disabled={busy}
                onClick={() =>
                  run("Sold checkpoint written to the Cardano passport.", () =>
                    src.advanceLot(party, lot.lotName,
                      `Sealed-bid auction closed. Winner ${nameOf(auction.winner!)} at ${lkr(auction.winningPriceLkr!)}`,
                      { winner: auction.winner!, priceLkr: auction.winningPriceLkr!, auctionId: auction.auctionId }))
                }>
                Write result to Cardano passport
              </button>
            )}

            {lot?.stage === "Sold" && (
              <p className="text-sm text-leaf">
                Recorded on the passport. <Link className="underline" href={`/lot/${lot.lotName}`}>View lot →</Link>
              </p>
            )}

            {!isAuctioneer && auction?.phase !== "BIDDING" && lot?.stage === "Brokered" && (
              <p className="text-sm text-muted">
                {auction ? "Bidding is closed." : "Waiting for the auctioneer to open this auction."} Switch “Acting as” to
                Colombo Tea Auction to run it.
              </p>
            )}

            {msg && <p className={`text-sm ${msg.ok ? "text-leaf" : "text-red-700"}`}>{msg.text}</p>}
          </section>
        </div>
      )}
    </div>
  );
}
