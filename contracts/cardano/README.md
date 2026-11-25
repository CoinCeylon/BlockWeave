# Cardano: LotTracker (Person A)

One Aiken validator with two handlers:

- **mint** creates a lot passport NFT. Only an approved estate can do it. The NFT
  name is `blake2b_256(cbor(seed UTxO))`, so every lot name is unique.
- **spend** moves the lot one stage forward. The right role must sign, origin data
  can't change, and `Sold` must carry an auction price. Once `Exported`, the lot
  is frozen for good.

Because both handlers live in one script, **policy id = script hash = script
address credential**. Off-chain code only needs one hash.

```
Harvested ──factory──▶ Processed ──broker──▶ Brokered ──auctioneer──▶ Sold ──exporter──▶ Exported
```

## Commands

```bash
cd contracts/cardano
aiken check      # compile + run the 11 tests
aiken build      # writes plutus.json (the blueprint the app loads)
```

Tests cover: estate mint ✓, stranger mint ✗, mint at wrong stage ✗, full journey ✓,
wrong role ✗, skipped stage ✗, unsigned ✗, edited origin ✗, Sold without price ✗,
editing an Exported lot ✗.

## Script parameter: the role registry

The validator takes a `Registry` (lists of key hashes per role) as a parameter.
Apply it off-chain with Mesh before deriving the address:

```ts
import { applyParamsToScript, resolveScriptHash, serializePlutusScript } from "@meshsdk/core";
import blueprint from "../../contracts/cardano/plutus.json";

const compiled = blueprint.validators.find(v => v.title === "lot_tracker.lot_tracker.spend")!.compiledCode;
const registry = { constructor: 0, fields: [
  { list: [{ bytes: ESTATE_PKH }] },
  { list: [{ bytes: FACTORY_PKH }] },
  { list: [{ bytes: BROKER_PKH }] },
  { list: [{ bytes: AUCTIONEER_PKH }] },
  { list: [{ bytes: EXPORTER_PKH }] },
]};
const script = applyParamsToScript(compiled, [registry], "JSON");
const policyId = resolveScriptHash(script, "V3");
const { address } = serializePlutusScript({ code: script, version: "V3" }, undefined, 0);
```

For the demo, make 5 Lace accounts on Preprod (estate, factory, broker,
auctioneer, exporter) and put their key hashes in the registry.

> The `hash` inside `plutus.json` is for the **unparameterised** script. The real
> policy id changes once the registry is applied.

## Datum shape (keep in sync with `app/src/lib/types.ts`)

| Field | Type | Set when |
|---|---|---|
| lot_name | bytes | mint (= NFT asset name) |
| estate, region, grade, weight_kg, harvest_date | | mint, then frozen |
| stage | Harvested/Processed/Brokered/Sold/Exported (constructor 0–4) | each checkpoint |
| holder | key hash of who signed this checkpoint | each checkpoint |
| note | bytes (short text) | each checkpoint |
| sale | `Option<Sale{winner, price_lkr, auction_id}>` | Sold |

## This week's checklist

- [ ] Mint one lot on Preprod with Mesh + Lace (script: `app/src/lib/cardano/`)
- [ ] Advance it through all 4 checkpoints with 4 different wallets
- [ ] Show the contract rejecting a wrong-role tx (screenshot it for the pitch)
- [ ] Blockfrost: list a lot's tx history + datums → hand to Person C for the scan page

## Not done yet (honest limits)

- Registry is fixed per deployment. Next step: a registry NFT read as a reference input.
- `harvest_date` is not checked against the tx validity range.
