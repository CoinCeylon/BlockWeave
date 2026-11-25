//// LotTracker: one multi-purpose validator.
////   mint  -> creates a lot passport NFT (policy id == this script's hash)
////   spend -> advances the lot to its next checkpoint
//// Because both handlers share one script, the NFT policy id and the script
//// address are the same hash, so there is no circular parameter problem.

use aiken/cbor
use aiken/collection/dict
use aiken/collection/list
use aiken/crypto.{blake2b_256}
use cardano/address.{Address, Script}
use cardano/assets.{PolicyId}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction, find_input,
}
use teatrail/rules
use teatrail/types.{
  Advance, Brokered, CreateLot, Exported, Harvested, LotDatum, MintAction,
  Processed, Registry, Sale, Sold, SpendAction,
}

/// NFT name for a lot = blake2b_256(cbor(seed utxo)). Off-chain code must use
/// the same formula (see app/src/lib/cardano/lotName.ts).
pub fn lot_name_from_seed(seed: OutputReference) -> ByteArray {
  blake2b_256(cbor.serialise(seed))
}

validator lot_tracker(registry: Registry) {
  mint(redeemer: MintAction, policy_id: PolicyId, self: Transaction) {
    let CreateLot { seed } = redeemer
    let Transaction { inputs, outputs, mint, extra_signatories, .. } = self
    let lot_name = lot_name_from_seed(seed)

    // 1. Seed UTxO is consumed -> lot name can never be reused.
    expect list.any(inputs, fn(i) { i.output_reference == seed })

    // 2. Exactly one token minted under this policy: quantity 1, correct name.
    expect [Pair(name, qty)] = dict.to_pairs(assets.tokens(mint, policy_id))
    expect name == lot_name && qty == 1

    // 3. The NFT is locked at this script with a fresh "Harvested" datum.
    expect [out] =
      list.filter(
        outputs,
        fn(o) { assets.quantity_of(o.value, policy_id, lot_name) == 1 },
      )
    expect out.address.payment_credential == Script(policy_id)
    expect InlineDatum(raw) = out.datum
    expect datum: LotDatum = raw

    // 4. Only an approved estate, signing the tx, can create a lot.
    and {
      datum.lot_name == lot_name,
      datum.stage == Harvested,
      datum.holder == datum.estate,
      datum.sale == None,
      datum.weight_kg > 0,
      list.has(registry.estates, datum.estate),
      list.has(extra_signatories, datum.estate),
    }
  }

  spend(
    datum: Option<LotDatum>,
    _redeemer: SpendAction,
    own_ref: OutputReference,
    self: Transaction,
  ) {
    expect Some(old) = datum
    let Transaction { inputs, outputs, mint, extra_signatories, .. } = self
    expect Some(own_input) = find_input(inputs, own_ref)
    let own_address = own_input.output.address
    expect Script(own_hash) = own_address.payment_credential

    // One lot per tx (blocks double-satisfaction tricks).
    expect
      list.count(
        inputs,
        fn(i) { i.output.address.payment_credential == Script(own_hash) },
      ) == 1

    // The input really is this lot's passport, and nothing is minted/burned.
    expect assets.quantity_of(own_input.output.value, own_hash, old.lot_name) == 1
    expect dict.is_empty(assets.tokens(mint, own_hash))

    // Exactly one continuing output at the same address, still holding the NFT.
    expect [out] = list.filter(outputs, fn(o) { o.address == own_address })
    expect assets.quantity_of(out.value, own_hash, old.lot_name) == 1
    expect InlineDatum(raw) = out.datum
    expect new: LotDatum = raw

    rules.valid_transition(registry, old, new, extra_signatories)
  }

  else(_) {
    fail
  }
}

// ======================================================================
// Tests — run with `aiken check`
// ======================================================================

const script_hash: ByteArray =
  #"00000000000000000000000000000000000000000000000000000001"

const estate_key: ByteArray =
  #"e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5"

const factory_key: ByteArray =
  #"fafafafafafafafafafafafafafafafafafafafafafafafafafafafa"

const broker_key: ByteArray =
  #"b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0"

const auction_key: ByteArray =
  #"a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0"

const exporter_key: ByteArray =
  #"e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0"

const stranger_key: ByteArray =
  #"99999999999999999999999999999999999999999999999999999999"

fn test_registry() -> Registry {
  Registry {
    estates: [estate_key],
    factories: [factory_key],
    brokers: [broker_key],
    auctioneers: [auction_key],
    exporters: [exporter_key],
  }
}

fn seed_ref() -> OutputReference {
  OutputReference {
    transaction_id: #"5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed",
    output_index: 0,
  }
}

fn script_address() -> Address {
  Address { payment_credential: Script(script_hash), stake_credential: None }
}

fn harvested() -> LotDatum {
  LotDatum {
    lot_name: lot_name_from_seed(seed_ref()),
    estate: estate_key,
    region: "Nuwara Eliya",
    grade: "BOPF",
    weight_kg: 500,
    harvest_date: 1764028800000,
    stage: Harvested,
    holder: estate_key,
    note: "Plucked at 1,868 m",
    sale: None,
  }
}

fn passport_output(d: LotDatum) -> Output {
  Output {
    address: script_address(),
    value: assets.from_asset(script_hash, d.lot_name, 1)
      |> assets.merge(assets.from_lovelace(2_000_000)),
    datum: InlineDatum(d),
    reference_script: None,
  }
}

fn lot_ref() -> OutputReference {
  OutputReference {
    transaction_id: #"10710710710710710710710710710710710710710710710710710710710710ff",
    output_index: 0,
  }
}

/// Build a checkpoint tx: spend `old` passport, recreate it with `new`.
fn advance_tx(old: LotDatum, new: LotDatum, signer: ByteArray) -> Transaction {
  Transaction {
    ..transaction.placeholder,
    inputs: [Input { output_reference: lot_ref(), output: passport_output(old) }],
    outputs: [passport_output(new)],
    extra_signatories: [signer],
  }
}

fn run_advance(old: LotDatum, new: LotDatum, signer: ByteArray) -> Bool {
  lot_tracker.spend(
    test_registry(),
    Some(old),
    Advance,
    lot_ref(),
    advance_tx(old, new, signer),
  )
}

fn mint_tx(d: LotDatum, signer: ByteArray) -> Transaction {
  Transaction {
    ..transaction.placeholder,
    inputs: [
      Input {
        output_reference: seed_ref(),
        output: Output {
          address: Address {
            payment_credential: address.VerificationKey(signer),
            stake_credential: None,
          },
          value: assets.from_lovelace(10_000_000),
          datum: transaction.NoDatum,
          reference_script: None,
        },
      },
    ],
    outputs: [passport_output(d)],
    mint: assets.from_asset(script_hash, d.lot_name, 1),
    extra_signatories: [signer],
  }
}

// ---- mint -------------------------------------------------------------

test estate_can_create_lot() {
  lot_tracker.mint(
    test_registry(),
    CreateLot { seed: seed_ref() },
    script_hash,
    mint_tx(harvested(), estate_key),
  )
}

test stranger_cannot_create_lot() fail {
  let d = LotDatum { ..harvested(), estate: stranger_key, holder: stranger_key }
  lot_tracker.mint(
    test_registry(),
    CreateLot { seed: seed_ref() },
    script_hash,
    mint_tx(d, stranger_key),
  )
}

test cannot_create_lot_already_past_harvest() fail {
  let d = LotDatum { ..harvested(), stage: Sold }
  lot_tracker.mint(
    test_registry(),
    CreateLot { seed: seed_ref() },
    script_hash,
    mint_tx(d, estate_key),
  )
}

// ---- spend: happy path through the whole journey ----------------------

test full_journey() {
  let h = harvested()
  let p = LotDatum { ..h, stage: Processed, holder: factory_key, note: "CTC" }
  let b = LotDatum { ..p, stage: Brokered, holder: broker_key, note: "Lot 42" }
  let s =
    LotDatum {
      ..b,
      stage: Sold,
      holder: auction_key,
      sale: Some(Sale { winner: "buyer-7", price_lkr: 1_450, auction_id: "a1" }),
    }
  let e = LotDatum { ..s, stage: Exported, holder: exporter_key, note: "HAM" }
  and {
    run_advance(h, p, factory_key),
    run_advance(p, b, broker_key),
    run_advance(b, s, auction_key),
    run_advance(s, e, exporter_key),
  }
}

// ---- spend: the contract must reject these ----------------------------

test wrong_role_rejected() {
  let h = harvested()
  // Broker tries to sign the factory step.
  let p = LotDatum { ..h, stage: Processed, holder: broker_key }
  !run_advance(h, p, broker_key)
}

test skipping_a_stage_rejected() {
  let h = harvested()
  let b = LotDatum { ..h, stage: Brokered, holder: broker_key }
  !run_advance(h, b, broker_key)
}

test unsigned_checkpoint_rejected() {
  let h = harvested()
  let p = LotDatum { ..h, stage: Processed, holder: factory_key }
  // Correct holder in datum, but a stranger signed the tx.
  !run_advance(h, p, stranger_key)
}

test editing_origin_rejected() {
  let h = harvested()
  let p =
    LotDatum { ..h, stage: Processed, holder: factory_key, region: "Fake" }
  !run_advance(h, p, factory_key)
}

test sold_without_price_rejected() {
  let b = LotDatum { ..harvested(), stage: Brokered, holder: broker_key }
  let s = LotDatum { ..b, stage: Sold, holder: auction_key, sale: None }
  !run_advance(b, s, auction_key)
}

test exported_lot_is_frozen() {
  let e =
    LotDatum {
      ..harvested(),
      stage: Exported,
      holder: exporter_key,
      sale: Some(Sale { winner: "b", price_lkr: 1, auction_id: "a" }),
    }
  !run_advance(e, e, exporter_key)
}
