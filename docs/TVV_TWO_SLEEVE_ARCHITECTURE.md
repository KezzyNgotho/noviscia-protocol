# TVV Two-Sleeve Architecture — Accounts, Instructions, Default Waterfall

> **Purpose:** The build spec for the Jit-Risk Time-Slice Marketplace (TVV — *Total Value
> Velocity*) as implemented *inside* the surviving `nv-usdc-vault` host (Program ID
> `CN92hAtnZxbMxPdho8tugi9GDK86UpGwmnbEvk5yzAWC`). Replaces the frozen-standalone-program map
> (`clearing-core`, `tvv-gate` staged-deleted; see `docs/FROZEN.md`). Draft v0.1 — for review before
> coding.
>
> **Design axioms (from the validation discussion):**
> 1. **Two products, one spine.** S1 (atomic per-slot rental) is the lossless showcase; S2
>    (24h-netting credit) is the revenue engine. Never blurred in the same instruction path.
> 2. **The insurance fund is never rented.** It is lender-of-last-resort only, fed by fees,
>    reached at waterfall step 5. "Renting the insurance" framing is compliance suicide.
> 3. **Flash loans are free** — so the premium is sold on *reserved capacity + priority + netting +
>    KYB'd counterparty*, never on "a slot of capital."
> 4. Discrepancy flagged: `docs/ACCOUNT_MAP.md` still lists 19 programs; on-disk reality is
>    3 programs after consolidation. ACCOUNT_MAP must be regenerated when this lands.

---

## 1. Sleeve overview

| | **S1 — Atomic Sleeve** | **S2 — Credit Sleeve** |
|---|---|---|
| Product claim | Reserved per-slot capital, lossless by construction | Intraday facility, 24h net settlement |
| Exposure window | One slot (400ms); bundle-enforced return | Hours to 24h |
| Loss risk | None (atomic bundle or nothing) | Desk default (time-extended) |
| Yield driver | ~0.13% (showcase) — not the raise number | the 15–35% (the raise number) |
| Risk backbone | Jito bundle atomicity | Margin + netting + default waterfall |
| Desk entry | `RouterPool` KYC leaf | `RouterPool` KYB leaf + margin |
| Capital source | Vault USDC custody (partitioned) | Vault USDC custody (partitioned) |

Both sleeves draw from the same on-ledger capital; partitioning is enforced by the existing
**systemic cap** (`C_sys` = 60% of pool, USD-cents) and **per-desk cap** (`C_desk` = 15% of pool,
reference `$1.5M`), mirroring the merged `asset_engine` concentration checks that already carry
tests `rejects_systemic_concentration_cap_breach` / `enforces_per_asset_capacity_ceiling`.

---

## 2. Accounts (new seed namespace, all under `nv_usdc_vault` host)

Convention: rebuild-modules inherit the absorbing program's `declare_id`; seeds use a distinct
prefix (mirrors the `router-*` rename when `permissioned-pool` was absorbed).

### 2.1 S1 — atomic sleeve

| Seed | Const | Struct | Seeds | Authority |
|---|---|---|---|---|
| `b"s1-capacity"` | `S1_CAPACITY_SEED` | `S1CapacityState` | `[S1_CAPACITY_SEED, vault_config.key()]` | — |
| `b"s1-receipt"` | `S1_RECEIPT_SEED` | `S1SlotReceipt` | `[S1_RECEIPT_SEED, desk.key, slot.to_le_bytes()]` | vault-authority PDA |

```rust
#[account]
pub struct S1CapacityState {
    pub vault_config: Pubkey,        // 32
    pub active: bool,                //  1  admin-hard-stop for the sleeve
    pub slot_ceiling_usd: u64,       //  8  max draw per slot (µUSD), <= C_sys
    pub jito_window_slots: u8,       //  1  bundled return window (unused in strict mode)
    pub strict_bundle: bool,         //  1  true => return must be in same bundle
    pub toll_bps: u16,               //  2  venue premium (borrow-scale)
    pub draws_this_slot: u64,        //  8  rolling aggregate (live window)
    pub slot_key: u64,               //  8  slot_key of the live window
    pub bump: u8,                    //  1
}
// SPACE = 8 + 71
```

```rust
#[account]
pub struct S1SlotReceipt {
    pub desk: Pubkey,                // 32
    pub slot_key: u64,               //  8
    pub principal: u64,              //  8  drawn amount (µUSD)
    pub toll_due: u64,               //  8  premium for the slot
    pub settled: bool,               //  1
    pub bump: u8,                    //  1
}
// SPACE = 8 + 58
```

S1 receipts are **audit/derive artifacts**. In strict-bundle mode the engine never holds S1 risk:
the desk's bundle = `[draw, <venue swaps>, repay(principal+toll)]`; if any leg fails, the bundle
is dropped atomically and the draw never becomes exposure (`buildCreditBundle` in
`sdk/src/creditLine.ts` already implements this shape). The receipt is written by `repay_atomic`
for the toll-graph/metrics, never trusted for solvency.

### 2.2 S2 — credit sleeve

| Seed | Const | Struct | Seeds | Authority |
|---|---|---|---|---|
| `b"s2-desk"` | `S2_DESK_SEED` | `S2DeskCredit` | `[S2_DESK_SEED, desk.key, vault_config.key()]` | — |
| `b"s2-ledger"` | `S2_LEDGER_SEED` | `S2PositionLedger` | `[S2_LEDGER_SEED, desk.key, vault_config.key()]` | — |
| `b"s2-margin"` | `S2_MARGIN_SEED` | margin USDC ATA | `[S2_MARGIN_SEED, desk.key, vault_config.key()]` | vault-authority PDA |
| `b"s2-waterfall"` | `S2_WATERFALL_SEED` | `S2WaterfallState` | `[S2_WATERFALL_SEED, vault_config.key()]` | — |

```rust
#[account]
pub struct S2DeskCredit {
    pub desk: Pubkey,                // 32
    pub vault_config: Pubkey,        // 32
    pub router_leaf: [u8; 32],       // 32  keccak KYB proof (consumer of RouterPool gate)
    pub kyc_expiry: i64,             //  8
    pub total_limit: u64,            //  8  <= C_desk
    pub drawn: u64,                  //  8  outstanding principal
    pub margin_posted: u64,          //  8  >= margin_bps x limit at open
    pub margin_bps: u16,             //  2  reference 3_000 (30%)
    pub frozen: bool,                //  1
    pub day_open_slot: u64,          //  8  EOD netting window start
    pub bump: u8,                    //  1
}
// SPACE = 8 + 140
```

```rust
#[account]
pub struct S2PositionLedger {
    pub desk: Pubkey,                // 32
    pub vault_config: Pubkey,        // 32
    pub net_notional: i64,           //  8  signed intraday net (USD cents)
    pub gross_volume: u64,           //  8  cumm. volume in window (toll base)
    pub toll_accrued: u64,           //  8  staged per-slot (FeeIndex pattern)
    pub pnl: i64,                    //  8  realized mtm vs margin
    pub last_accrual_slot: u64,      //  8
    pub bump: u8,                    //  1
}
// SPACE = 8 + 73
```

```rust
#[account]
pub struct S2WaterfallState {
    pub vault_config: Pubkey,        // 32
    pub default_fund: u64,           //  8  fee-funded last-resort bucket
    pub defaults_eaten: u64,         //  8  cumulative absorbed losses
    pub insurance_times_used: u64,   //  8  cap: frequency guard
    pub last_default_slot: u64,      //  8
    pub bump: u8,                    //  1
}
// SPACE = 8 + 65
```

---

## 3. Instructions (namespace `noviscia_tvv_*` within `nv_usdc_vault`)

### S1 — atomic sleeve

| Instruction | Scope | Guard rails |
|---|---|---|
| `tvv_s1_configure(ctx, active, slot_ceiling_usd, strict_bundle, toll_bps)` | `SetVaultAdmin`-class authority | `slot_ceiling_usd <= C_sys`, `toll_bps <= 500` (5bp) |
| `tvv_s1_draw(ctx, amount, slot_key)` | Desk (pre-verified KYC leaf in `RouterPool`) | within active window; `draws_this_slot + amount <= slot_ceiling_usd`; amount is *drawn from vault USDC ATA → desk*, **must be repaid in-bundle** |
| `tvv_s1_repay(ctx, slot_key, principal, toll)` | Same bundle as draw | `principal == receipt.principal`; toll → `compute_fee_insurance_split` → `accrue_slot_yield` staging (reuse `pay_toll` mechanics, lib.rs:1793); 90% of toll to pool via `FEE_INDEX_SCALE`, 10% to treasury (reuse `TOLL_POOL_BPS = 9_000`, lib.rs:478) |

The S1 premium is **not** the revenue story. Figures landed by the twin tests
(`docs/TVV_SPEC_SHEET.md` §5b): max single-desk slot toll `4,566` µUSD, toll ≈ 5 ppm of borrower
net. S1 exists to (a) prove atomicity publicly, (b) gate desks into S2, (c) generate the
reputational "proven lossless per-slot" evidence investors ask for.

### S2 — credit sleeve

| Instruction | Scope | Guard rails |
|---|---|---|
| `tvv_s2_open_credit(ctx, limit, margin_bps)` | Desk + `RouterPool` KYB leaf (keccak), admin approves | `limit <= C_desk`; posts `>= margin_bps x limit` (µUSD) into `s2-margin` ATA; sets `frozen = false`, `day_open_slot = Clock.slot` |
| `tvv_s2_draw(ctx, amount)` | Desk | `drawn + amount <= total_limit`; health check `margin/（limit−drawn+exposure) >= floor` (reuse `compute_dynamic_reserve_floor`-adjacent math, lib.rs:6226); updates `S2PositionLedger.net_notional` |
| `tvv_s2_repay(ctx, amount)` | Desk | decrements `drawn`, credits `net_notional`; toll accrual: `toll_accrued += amount × toll_bps` staged per-slot via `accrue_slot_yield` |
| `tvv_s2_settle_eod(ctx, desks[], s2_waterfall)` | Permissionless crank (replaces removed crank service; on-chain enforced) | window = `[day_open_slot, day_open_slot + 24h]`; per desk: settle `pnl` vs margin; net toll into fee spine; `net_notional = 0`; `day_open_slot = now` |
| `tvv_s2_freeze(ctx, desk)` | Permissionless crank + orphanable on breach | if `margin_haircut < floor` or window breach confirmed → `frozen = true`; no further draws |
| `tvv_s2_liquidate(ctx, desk, loss)` | Permissionless | only when `frozen && pnl < −margin_haircut`; runs **waterfall** (§4) |

Concentration: S2 `drawn` is bounded by `C_sys` at the window level; cross-desk exposure tracked by
re-using the merged `AssetExposureTracker` account semantics (per-asset ceiling).

---

## 4. Default waterfall (S2 losses) — the compliance centerpiece

```text
Desk default loss L
│
│ step 1   desk margin (s2-margin ATA, hair-cut FN)
│ step 2   desk residual collateral (excess above margin_bps)
│         ──────────────── pool-protective boundary ────────────────
│ step 3   TranchePool.PROTECTED tier  (loss-capped: loss_cap_bps; boundary
│ │                                   PROTECTED_MAX_SHARE_BPS = 50%)
│ step 4   TranchePool.INSTITUTIONAL tier
│ step 5   InsuranceFundState insurance reserve (5% default carve-out,
│ │                                   max 20% per lib.rs:774; FEE-spine funded)
│ step 6   S2WaterfallState.default_fund (fee-funded, last resort)
│ step 7   (deferred) cross-protocol ccp_equity  — never written until
│          Tier A/B loss ratio < 0.20 for 90 consecutive days
└── remaining uncovered => parity shortfall, documented loss not silent
```

Enforcement points:
- Steps 1–2 in `tvv_s2_liquidate` (margins are token-account real transfers).
- Steps 3–4 via `TranchePool` mutation using the existing
  `protected loss_cap_bps` + `PROTECTED_MAX_SHARE_BPS` constants (`tranche_pool.rs:29`).
- Step 5: **insurance is reachable but rate-limited.** `S2WaterfallState.insurance_times_used`
  and `defaults_eaten` are checked; per-policy caps prevent the insurance bucket from becoming a
  rentable asset. `compute_fee_insurance_split` keeps feeding it while below its
  `insurance_reserve_bps` target (lib.rs:6196).
- S1 can **never** reach this waterfall: it has no default state by construction.

---

## 5. Fee spine integration (reuse, don't re-derive)

| Stage | Existing code | Reused for |
|---|---|---|
| Toll split | `TOLL_POOL_BPS = 9_000` (lib.rs:478) | 90% pool / 10% treasury for S1 premiums + S2 tolls |
| Staged yield | `accrue_slot_yield` → `pending_fee_index` (lib.rs:1835) | per-slot, smooth NAV release for both sleeves |
| Insurance carve | `compute_fee_insurance_split` (lib.rs:6196) | 5% default carve-out before NAV boost |
| Dynamic floor | reserve-floor engine (lib.rs:6222) + `max_oi_ratio_bps` | S2 margin haircut floor |
| KYC gate | `RouterPool` merkle/keccak (`router_pool.rs`) | both sleeves' desk admission |
| Concentration | merged `asset_engine` caps + `AssetExposureTracker` | `C_sys` / `C_desk` enforcement |
| Target APY | `set_target_apy` (lib.rs:814, band 1–55%) | toll-keeper bounds on S2 effective rate |

---

## 6. Compliance mapping (diligence-proof framing)

1. **Insurance is never rented.** It sits at step 5 of a documented waterfall, fed by fees.
   The marketed asset is the *trading sleeve* (partitioned pool capital), not the insurance fund —
   directly answers Peirce Howey-lens + GENIUS Act yield prohibition on a deposit-like leg.
2. **Senior yield is loss-capped, not guaranteed.** Protected tranche absorbs losses only up to
   `loss_cap_bps` of its deposits, then the institutional tier and insurance take over — the deck
   must not promise principal protection on the protected tranche beyond the declared cap.
3. **US persons geoblocked.** Sumsub KYB gate (`RouterPool` leaf + expiry) + no-US wallet allowlist
   on `tvv_s2_*`; S1 inherits the same gate.
4. **Master agreement required.** 24h netting is a credit facility; on-chain netting is the
   settlement math, but a per-desk ISDA-lite master credit agreement backs the default waterfall
   (see `docs/MASTER_LOAN_AGREEMENT.md`). Code cannot create legal recourse.

---

## 7. Build order

1. `tvv_s1_configure` + `S1CapacityState` (reuse `pay_toll` fee path end-to-end) — S1 first, tiny.
2. `tvv_s2_open_credit` + `S2DeskCredit` + margin ATA (RouterPool leaf enforced).
3. `draw` / `repay` / `settle_eod` + `S2PositionLedger` (per-slot toll staging).
4. `freeze` / `liquidate` + `S2WaterfallState` (waterfall, todos: rate-limits + `insurance_times_used`).
5. Twin SDK + Python replay (mirror `docs/TVV_SPEC_SHEET.md` §5b / Module 4 ledger pattern).
6. Regenerate `docs/ACCOUNT_MAP.md` from source.

## Cross-references
- Velocity/micro-premium integer math: `docs/TVV_SPEC_SHEET.md` (§2, §5b) + `sdk/src/velocity.ts` + `sdk/src/feasibility.ts`
- Waterfall + insurance policy: `docs/TVV_FINANCIAL_ENGINEERING.md`, `docs/QUANTIFIED_RISK_PACK.md`
- Fee-spine & reserves: `nv-usdc-vault/src/lib.rs` (`pay_toll`:1793, `compute_fee_insurance_split`:6196, `set_target_apy`:814, `TOLL_POOL_BPS`:478)
- Tranches (loss-ordering): `nv-usdc-vault/src/tranche_pool.rs` (`PROTECTED_MAX_SHARE_BPS`:29, `loss_cap_bps`)
- KYB/KYC gate: `nv-usdc-vault/src/router_pool.rs`
- Consolidation audit trail: `docs/FROZEN.md`, `docs/CONSOLIDATION.md`, `docs/REVIEW_CONSOLIDATION.md`