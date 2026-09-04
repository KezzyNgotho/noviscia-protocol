# noviscia-asset-engine-sdk

Low-latency instruction builders, PDA derivation, and LP-share math for the
Noviscia **asset engine** — the institutional multi-asset JIT allocation and
daily-clearing facility on Solana. Institutional desks and capital providers
compile this crate directly into their software to drive the engine without a
REST round-trip.

## What it provides

- **PDA derivation** — `registry_pda`, `asset_pool_pda`, `asset_vault_pda`,
  `asset_fee_vault_pda`, `asset_authority_pda`, `credit_line_pda`,
  `desk_position_pda`, `asset_lp_mint_pda`, `asset_lp_position_pda` (all anchored
  via `anchor_discriminator`).
- **Instruction builders** — `build_initialize_ix`, `build_register_asset_ix`,
  `build_update_asset_params_ix`, `build_set_asset_support_ix`,
  `build_initialize_credit_line_ix`, `build_update_credit_limit_ix`,
  `build_set_credit_frozen_ix`, `build_set_paused_ix`,
  `build_allocate_asset_capacity_ix`, `build_recredit_asset_capacity_ix`,
  `build_set_kyc_root_ix`, `build_settle_daily_ix`,
  `build_deposit_asset_liquidity_ix`, `build_withdraw_asset_liquidity_ix`,
  `build_withdraw_asset_fees_ix`.
- **Asset profiles** — `NVSC_PROFILE`, `USDC_PROFILE`, `WSOL_PROFILE` with the
  per-asset ceilings, hairline bps, and fee splits that govern allocation, plus
  `register_asset_default` / `register_wsol_default` conveniences.
- **LP share / risk math** — `compute_deposit_shares`,
  `compute_lp_withdraw_value`, `compute_lp_share_price` (ERC-4626-style shares,
  `LP_PRICE_SCALE = 1_000_000`), `compute_premium`, `compute_late_fee`, and
  `window_posture` tracking the 24h clearing window (`WINDOW_SLOTS = 216_000`,
  `GRACE_SLOTS = 18_000`).

The engine's three-tier governance (Breaker / Risk Committee / Core Council) is
enforced on-chain in `AssetRegistry`; the SDK only wires the authority into each
builder as required.

## Usage

```toml
[dependencies]
noviscia-asset-engine-sdk = "0.2"
noviscia-types = "0.2"
```

```rust
use noviscia_asset_engine_sdk::{
    ASSET_ENGINE_PROGRAM_ID, registry_pda, asset_pool_pda,
    USDC_PROFILE, build_allocate_asset_capacity_ix,
};

let registry = registry_pda(&ASSET_ENGINE_PROGRAM_ID);
let pool = asset_pool_pda(&ASSET_ENGINE_PROGRAM_ID, &USDC_MINT);

let ix = build_allocate_asset_capacity_ix(
    institution,
    principal,
    usdc_mint,
    pool,
    /* ... accounts ... */
);
```

See `docs/PARTICIPANT_ACCESS.md` in the mono-repo for the end-to-end
institutional borrower and LP flows.

## Repository

- Program: `programs/active/noviscia-asset-engine`
- Type crate: `sdk/rust/noviscia-types`
- TS twin: `@noviscia/sdk` (`assetEngine` and `jito` modules) on npm
- On-chain layout and governance: see `docs/ARCHITECTURE.md` —
  [https://github.com/KezzyNgotho/Noviscia-protocal](https://github.com/KezzyNgotho/Noviscia-protocal)

## License

Apache-2.0