# noviscia-types

Shared on-chain types, PDA seeds, protocol constants, and canonical program IDs
for the Noviscia protocol. This is the single source of truth consumed by the
Anchor programs and every Rust SDK crate, so addresses, seeds, and fee splits
stay byte-identical across the stack.

## What it provides

- **PDA seeds** — the canonical byte strings for every program: `pool`,
  `pool-vault`, `lp-entry`, `lp-mint`, `insurance`, `credit-line`,
  `credit-vault`, `toll-vault`, `borrower`, `position`, `collateral-vault`,
  `pt-config`, `capacity`, `congestion`, `client`, `slot-ledger`, `treasury`,
  `treasury-auth`, `asset-registry`, `asset-pool`, `asset-vault`, `asset-fees`,
  `asset-authority`, `desk-position`, `asset-lp-mint`, `asset-lp-position`,
  `tranches`, `protected-vault`, `insti-vault`.
- **Program IDs** — `POSITION_TRACKER_PROGRAM_ID`, `ESCROW_PROGRAM_ID`,
  `CREDIT_LINE_PROGRAM_ID`, `NV_USDC_VAULT_PROGRAM_ID`, `BURN_ENGINE_PROGRAM_ID`,
  `STAKING_MANAGER_PROGRAM_ID`, `NETTING_ENGINE_PROGRAM_ID`,
  `LIQUIDATION_VAULT_PROGRAM_ID`, `JIT_RISK_PROGRAM_ID`,
  `GATEWAY_AUCTION_PROGRAM_ID`, `SOVEREIGN_NETTING_PROGRAM_ID`,
  `CAPACITY_PROGRAM_ID`, `ASSET_ENGINE_PROGRAM_ID`, `TRANCHE_VAULT_PROGRAM_ID`.
- **Mints** — `USDC_MINT`, `NVSC_MINT`, `NVSCUSDC_MINT`, `WSOL_MINT`.
- **Fixed-point / split constants** — `BPS = 10_000`, `BPS_U128`, `WAD`,
  `LP_NAV_SPLIT_BPS = 9_000` (LPs), `TREASURY_SPLIT_BPS = 1_000` (treasury),
  and the asset-engine window constants `WINDOW_SLOTS = 216_000` (24h),
  `GRACE_SLOTS = 18_000`, `LATE_FEE_RATE_BPS = 50`, `LATE_FEE_BASE = 10_000`.
- **Account structs** — `CreditLine`, `Borrower`, `PoolConfig`, `LpEntry`,
  `TollResult`, `CapacityConfig`, `CongestionOracle`, `ClientAccount`,
  `SlotLedger`, `AssetEngineRegistry`, `AssetPool`, `InstitutionalCreditLine`,
  `DeskPosition`, `TrancheVault`, `TranchePosition`, plus `LpTier`, `Side`,
  `ClientTier`, and `Tranche` enums.

## Usage

```toml
[dependencies]
noviscia-types = "0.2"
```

```rust
use noviscia_types::{ASSET_ENGINE_PROGRAM_ID, LP_NAV_SPLIT_BPS, WINDOW_SLOTS};

assert_eq!(LP_NAV_SPLIT_BPS, 9_000);
```

## Repository

- Programs: `programs/cluster-*/`
- SDK crates: `sdk/rust/*`
- On-chain layout and governance: see `docs/ARCHITECTURE.md` in the Noviscia
  mono-repo — [https://github.com/KezzyNgotho/Noviscia-protocal](https://github.com/KezzyNgotho/Noviscia-protocal)

## License

Apache-2.0