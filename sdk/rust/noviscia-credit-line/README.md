# Noviscia Credit Line SDK

A **low-latency instruction builder** for the Noviscia Credit Line — an atomic,
single-block credit facility on Solana. Institutional desks and smart-contract
dApps compile this crate directly into their own software so they can bundle
Noviscia credit instructions into their local execution strings without a REST
round-trip. Because all four steps execute inside **one** Solana transaction
(one ~400ms slot), the credit is atomic: if the desk cannot settle, the whole
transaction rolls back and the pool is untouched.

```
┌────────────────────────────────────────────────────────┐
│ 1. pull_credit      draw USDC from the alpha-sleeve    │
│ 2. external swap    Raydium — buy target asset low      │
│ 3. external swap    Meteora — sell asset high           │
│ 4. repay_and_settle Atomic Balance-State Constraint     │
└────────────────────────────────────────────────────────┘
```

## Repository layout

- **`programs/cluster-1-clearing-core/noviscia-credit-line/`** — the on-chain Anchor program
  (the credit-line ledger, the alpha-sleeve credit vault, per-borrower
  registries, the dynamic toll engine, and the balance-state constraint).
- **`sdk/`** — this crate: the offline instruction builder
  (`NovisciaCreditLineClient`), plus the single-block B2B execution template.
- The `#[cfg(test)]` module in the program's `lib.rs` is the **local simulation
  harness** (`#[noviscia_test]`): quants run it on their own machines with zero
  gas to validate the toll + balance-state math before spending a single tick
  of Devnet/Mainnet.

## On-chain design (what the program actually does)

| Concept | Implementation |
|---|---|
| **Alpha Sleeve** | `CreditLine` ledger PDA (`credit-line` seed) owns a USDC `credit_vault` token PDA (`credit-vault` seed) |
| **Borrower** | `Borrower` registry PDA (`borrower` + owner seed); authority-gated, with a per-borrower `credit_limit` |
| **Limits** | Per-borrower cap + a shared `global_outstanding_cap` (no single draw or aggregate draw can exceed liquidity) |
| **Toll** | Dynamic and clamped: `rate = base + (max − base) · utilization`, in `[base, max]` bps; rises with how much of the cap is deployed. **Spliced 90/10**: 90% → the `nv-usdc-vault` omni-pool (LP NAV) via `accumulate_protocol_fees`, 10% → the system `toll_recipient` treasury |
| **Balance-state constraint** | `repay_and_settle` returns `principal` to the vault, sends 10% of the toll to the treasury, stages 90% in the `toll_vault`, and sweeps it into the omni-pool — all in the same instruction. If the borrower cannot cover `principal + toll`, the transfer CPI reverts → the entire enclosing transaction rolls back |

### The four instructions

- `initialize(toll_recipient, base_toll_bps, max_toll_bps, borrower_cap, global_outstanding_cap)`
- `register_borrower(credit_limit)` — authority whitelists a desk
- `pull_credit(amount)` — draw USDC from the credit vault to the borrower's ATA
- `repay_and_settle(principal)` — the Atomic Balance-State Constraint
- `set_config(...)` — authority tunes tolls / caps / recipient

## Using the SDK

Add it as a path dependency:

```toml
[dependencies]
noviscia-credit-line-sdk = { path = ".../sdk/rust/noviscia-credit-line" }
```

Build the two instructions and place your venue swaps between them:

```rust
use solana_program::pubkey::Pubkey;
use noviscia_credit_line_sdk::{
    NovisciaCreditLineClient, credit_line_pda, credit_vault_pda,
};

// vault_config + vault_usdc are the nv-usdc-vault omni-pool accounts
// ([nv-vault-config, usdc_mint] / [nv-vault-usdc, usdc_mint]) that receive the
// 90% LP-NAV toll sweep. Derive them from the nv-usdc-vault program ID + mint.
let (vault_config, vault_usdc) = (nv_vault_config_pda(), nv_vault_usdc_pda());
let client = NovisciaCreditLineClient::new(
    noviscia_credit_line_sdk::CREDIT_LINE_PROGRAM_ID,
    user_wallet,          // Signer
    user_usdc,            // Borrower's USDC ATA
    credit_vault_pda(PROGRAM_ID),
    credit_line_pda(PROGRAM_ID),
    treasury_vault,       // 10% system treasury destination
    vault_config,         // nv-usdc-vault pool config (90% LP-NAV sweep)
    vault_usdc,           // nv-usdc-vault USDC pool (90% LP-NAV sweep)
);

let principal = 2_000_000_000u64; // $2,000 USDC at 6 dp
let mut tx = vec![client.build_pull_credit_ix(principal)?];     // 1. pull
tx.push(raydium_buy_ix(...));      // 2. venue A — wire in your venue SDK
tx.push(meteora_sell_ix(...));     // 3. venue B — wire in your venue SDK
tx.push(client.build_repay_and_settle_ix(principal)?);           // 4. settle

// Submit `tx` as ONE transaction (one recent blockhash, one slot).
```

See [`examples/single_block_arb_bundle.rs`](examples/single_block_arb_bundle.rs)
for the full reference template.

## Notes / deliberate deviations from the original sketch

The original sketch proposed a client-supplied `max_premium_bid_tip` on the pull
instruction. That was **not** carried into production: the toll is computed and
clamped **on-chain** from the shared-cap utilization, which is safer than letting
a borrower self-report a tip and keeps the instruction set minimal. The pull
instruction therefore takes only `amount`; the toll is settled in
`repay_and_settle`.

## 90/10 toll split (high-end LP-NAV integration)

The dynamic toll is not skimmed to a single party. In `repay_and_settle` it is
spliced:

- **90% → the `nv-usdc-vault` omni-pool (LP NAV)**. Staged in the `toll_vault`
  token PDA (`toll-vault` seed, owned by the credit-line ledger), then swept
  natively into the pool via the shared `accumulate_protocol_fees` revenue
  spine — the same allowlisted fee route `gateway-auction` tips use. The
  credit-line ledger PDA is added to that allowlist in
  `nv-usdc-vault/src/lib.rs` (`CREDIT_LINE_PROGRAM_ID` + `expected_credit_line`).
- **10% → the system treasury** (`toll_recipient`).

`build_repay_and_settle_ix` therefore carries the omni-pool accounts
(`vault_config`, `vault_usdc`, `nv_usdc_vault_program`) in addition to the
Credit Line's own PDAs. Splitting happens fully on-chain; the SDK only wires the
accounts.

## Running the local simulation

```bash
# off-chain test harness (no keys, no gas, no cluster):
cargo test -p noviscia-credit-line
cargo test -p noviscia-credit-line-sdk
cargo test -p noviscia-credit-line-sdk --examples
```

> **Environment note:** `anchor build` currently fails repo-wide in this
> checkout because the bundled Solana rustc (1.79) predates the `indexmap 2.12`
> MSRV (1.82). This affects every Anchor program in the workspace, not just this
> one. Use the system toolchain for compile/test (`cargo build`, `cargo test`)
> until the toolchain is updated/synchronized.
