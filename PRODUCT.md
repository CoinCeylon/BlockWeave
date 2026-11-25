# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary: Sri Lankan tea exporters.** They pay a small fee per certified lot. They use TeaTrail to show
buyers in Europe and elsewhere a traceability record they can trust, as evidence for Ceylon Tea's
Geographical Indication (GI) status and to earn premium prices. They work at a desk, deal with paperwork,
certificates and shipment documents, and need to see a lot's status and history fast.

Secondary, in order:
1. **Estates and tea factories** create lots and sign their own checkpoints, often on a phone, in the field or on the factory floor.
2. **Brokers and the auctioneer** move lots into sale and run the sealed-bid auction.
3. **Auction bidders (buyers)** place bids that must stay private from competitors.
4. **Consumers and importers abroad** scan a QR code on the pack and read the lot's journey. This is TeaTrail's public face.

## Product Purpose

Every lot of Ceylon tea gets a digital passport. Each party in the chain (estate → factory → broker →
auction → exporter) adds a signed checkpoint, and nobody can change the record afterwards. Lots are sold
through a sealed-bid auction where only the winner and the winning price are revealed.

Success means an exporter can hand a buyer one link or QR code, and the buyer trusts the origin without
having to trust TeaTrail itself.

Context: tea is Sri Lanka's second-largest export. Fake "Ceylon Tea" sold abroad lowers prices for real
producers, and GI status depends on proving origin and traceability.

## Positioning

Public, tamper-proof traceability (Cardano) combined with a private, provably fair auction (Midnight).
A normal database can be edited by whoever runs it. A blockchain record can't be quietly changed, and
zero-knowledge proofs let the auction be checked without exposing anyone's bids.

## Operating Context

- Hackathon product: UniHack 2026 (Cardano + Midnight). Demo for judges on 17 Dec 2026; submission 14 Dec.
- Testnets only (Cardano Preprod, Midnight Preprod). Wallet: Lace.
- Lot journey stages, in this exact order: Harvested → Processed → Brokered → Sold → Exported.
- Each stage can only be signed by its role (estate, factory, broker, auctioneer, exporter). Wrong role or wrong order is rejected by the contract, and the UI should explain the rejection in plain words.
- Tea grades use industry codes (BOP, BOPF, FBOP, OP, OP1, Pekoe, Dust). Regions are Sri Lanka's tea regions (Nuwara Eliya, Dimbula, Uva, Uda Pussellawa, Kandy, Sabaragamuwa, Ruhuna).
- Prices are in LKR per kg.

## Capabilities and Constraints

- Web app: Next.js 16 + Tailwind 4 in `app/`. Runs fully client-side (wallet dApp); `NEXT_PUBLIC_DATA_SOURCE=mock` gives fake data with no wallet.
- Screens: lots list, estate (create lot), checkpoint, auction, public lot passport / QR scan page.
- Blockchain terms the UI may use, explained in plain words: passport, checkpoint, sealed bid, transaction. Avoid jargon such as UTxO, datum, redeemer or commitment in user-facing copy except where the screen is explicitly showing proof.
- Undecided: final product name (TeaTrail is a working title), logo, brand colours and type.

## Brand Commitments

None binding yet. "TeaTrail" is a working title and may change. Team name: BlockWeave.

## Evidence on Hand

- **No industry interviews, quotes, partners or customers yet.** Never invent testimonials, partner logos, customer counts, adoption figures or prices.
- Demo data uses deliberately fictional names marked "(demo)". Never use real estate, factory, broker or exporter names in the UI without written permission.
- Real, citable context: Ceylon Tea's EU GI effort and the counterfeit problem (sources in the project brief).

## Product Principles

1. **Trust you can check.** Every claim on screen traces back to a signed record. Show where it came from, not just a badge.
2. **Plain words for non-crypto people.** Exporters and estate staff are not blockchain users. Explain what happened, not how the chain works.
3. **Private where it matters.** Bid amounts are never shown, logged or hinted at, apart from the winning bid after close.
4. **Each party sees its own next step.** A user signed in as one role should immediately see what they can do now and why other actions are locked.
5. **Honest about the prototype.** Testnet, mock data and hackathon limits are stated, not hidden.

## Accessibility & Inclusion

- Estate and factory staff may use low-end Android phones on slow connections. Checkpoint and scan pages must work well at 360px wide.
- English UI for now. Sinhala and Tamil are likely future needs, so avoid text baked into images.
