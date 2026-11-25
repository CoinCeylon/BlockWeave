//// Shared on-chain types for TeaTrail.
////
//// KEEP IN SYNC with app/src/lib/types.ts — this is the contract between
//// Person A (Cardano) and Person C (frontend). Change both together.

use aiken/crypto.{VerificationKeyHash}
use cardano/transaction.{OutputReference}

/// The journey of a tea lot, in the only order the contract allows.
pub type Stage {
  Harvested
  Processed
  Brokered
  Sold
  Exported
}

/// Result of the Midnight sealed-bid auction, copied onto the passport.
/// `winner` is an off-chain identifier (Midnight address / buyer id), so it is
/// stored as raw bytes rather than a Cardano key hash.
pub type Sale {
  winner: ByteArray,
  price_lkr: Int,
  auction_id: ByteArray,
}

/// Inline datum carried by every lot passport UTxO.
pub type LotDatum {
  // ---- fixed at harvest, never change ----
  lot_name: ByteArray,
  estate: VerificationKeyHash,
  region: ByteArray,
  grade: ByteArray,
  weight_kg: Int,
  harvest_date: Int,
  // ---- updated at every checkpoint ----
  stage: Stage,
  holder: VerificationKeyHash,
  note: ByteArray,
  sale: Option<Sale>,
}

/// Who is allowed to sign each stage. Applied as a script parameter.
/// Hackathon simplification: changing the list means redeploying. Production
/// version would read this from a reference-input "registry" NFT instead.
pub type Registry {
  estates: List<VerificationKeyHash>,
  factories: List<VerificationKeyHash>,
  brokers: List<VerificationKeyHash>,
  auctioneers: List<VerificationKeyHash>,
  exporters: List<VerificationKeyHash>,
}

pub type MintAction {
  /// Create a new lot passport. `seed` must be spent in the same tx;
  /// its hash becomes the NFT name, so every lot name is unique.
  CreateLot { seed: OutputReference }
}

pub type SpendAction {
  /// Move the lot to the next stage.
  Advance
}
