//// Pure business rules for lot passports. No transaction plumbing here,
//// so these are easy to unit-test.

use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use teatrail/types.{
  Brokered, Exported, Harvested, LotDatum, Processed, Registry, Sold, Stage,
}

/// The only allowed order: Harvested -> Processed -> Brokered -> Sold -> Exported.
pub fn next_stage(stage: Stage) -> Option<Stage> {
  when stage is {
    Harvested -> Some(Processed)
    Processed -> Some(Brokered)
    Brokered -> Some(Sold)
    Sold -> Some(Exported)
    Exported -> None
  }
}

/// Which role may sign a checkpoint that moves a lot INTO `stage`.
pub fn signers_for(registry: Registry, stage: Stage) -> List<VerificationKeyHash> {
  when stage is {
    Harvested -> registry.estates
    Processed -> registry.factories
    Brokered -> registry.brokers
    Sold -> registry.auctioneers
    Exported -> registry.exporters
  }
}

/// Origin data written at harvest can never be edited.
pub fn fixed_fields_unchanged(old: LotDatum, new: LotDatum) -> Bool {
  and {
    old.lot_name == new.lot_name,
    old.estate == new.estate,
    old.region == new.region,
    old.grade == new.grade,
    old.weight_kg == new.weight_kg,
    old.harvest_date == new.harvest_date,
  }
}

/// A checkpoint is valid when it moves exactly one stage forward, is signed by
/// someone holding the right role, keeps origin data intact, and (for the Sold
/// stage only) records a positive auction price.
pub fn valid_transition(
  registry: Registry,
  old: LotDatum,
  new: LotDatum,
  signatories: List<VerificationKeyHash>,
) -> Bool {
  when next_stage(old.stage) is {
    None -> False
    Some(expected) -> {
      let sale_ok =
        if expected == Sold {
          when new.sale is {
            Some(sale) -> sale.price_lkr > 0
            None -> False
          }
        } else {
          new.sale == old.sale
        }
      and {
        new.stage == expected,
        fixed_fields_unchanged(old, new),
        list.has(signers_for(registry, expected), new.holder),
        list.has(signatories, new.holder),
        sale_ok,
      }
    }
  }
}

// ---------------------------------------------------------------- tests

test order_is_fixed() {
  and {
    next_stage(Harvested) == Some(Processed),
    next_stage(Brokered) == Some(Sold),
    next_stage(Exported) == None,
  }
}
