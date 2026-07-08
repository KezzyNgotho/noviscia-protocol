# Noviscia token model — nvscUSDC vs NVSC

**Last updated:** July 7, 2026 — margin path corrected below (position-tracker locks margin directly, no escrow reserve step; `lending-integrator` deleted).

## Separation

| | **NVSCUSDC** | **NVSC** |
|---|--------------|----------|
| Role | Yield-bearing vault share (margin) | Protocol + governance token |
| Mint | `nv-usdc-vault` on USDC deposit | `token-nvsc` (fixed supply) |
| Supply | Elastic (mint/redeem) | Fixed / emissions / burn |
| Governance | **No votes** | **Staked NVSC votes** |
| Fees | Indirect (more volume → fee flywheel) | Burn + staking pool share |

## On-chain programs

| Program | Instructions |
|---------|----------------|
| `nv-usdc-vault` | `deposit_usdc`, `redeem_nvusdc`, `accumulate_protocol_fees`, `adjust_locked_margin` |
| `position-tracker` | `open_position_jit` (locks nvscUSDC shares as margin directly via CPI — no escrow reserve step), `close_position`, `liquidate` |
| `staking-manager` | `initialize_governance`, `create_proposal`, `vote_proposal`, `execute_proposal` |
| `burn-engine` | Fee accumulation, permissionless burn trigger |

`lending-integrator` has been deleted from the codebase — the `set_venue_weights_governed`-style external-venue routing it provided no longer exists; `nv-usdc-vault` holds USDC directly (`lend_mode` hardcoded to 0).

## Flow (perps, current)

```text
USDC (or any SPL asset via Jupiter, mainnet-only) → nv-usdc-vault.deposit_usdc → nvscUSDC shares
nvscUSDC → position_tracker.open_position_jit → locked as collateral_shares (never redeemed while open)
Trading fees (open + close) → 100% nv-usdc-vault.total_assets (NAV increases for every holder)
Liquidation penalty → 20% caller bounty · 80% retained (10% → per-market insurance fund, 90% → vault NAV)
Peer-to-peer funding → 100% redistributed longs ↔ shorts, not protocol revenue
```

The broader NVSC staking/burn-engine flow (fee-tier discounts, buyback triggers) exists separately and hasn't been re-verified against current code this cycle — see `staking-manager`/`burn-engine` source directly for exact current mechanics.

## Deploy (devnet)

See [`DEVNET.md`](./DEVNET.md) for the current, verified deploy flow (`anchor build` → `solana program extend` if needed → deploy → copy IDL). The `--ignore-keys`/`init-rewire-devnet.ts` flow referenced here previously has not been re-verified against the current program set this cycle.
