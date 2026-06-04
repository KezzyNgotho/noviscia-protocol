# Noviscia token model — NVSCUSDC vs NVSC

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
| `nv-usdc-vault` | `initialize_vault`, `deposit_usdc`, `redeem_nvusdc`, `update_total_assets`, `accrue_vault_yield` |
| `escrow` | `deposit_nvusdc`, `withdraw_nvusdc`, `reserve_nvusdc_margin`, `settle_position_nvusdc` (+ USDC path) |
| `lending-integrator` | `initialize_protocol_registry`, `set_venue_weights_governed` |
| `staking-manager` | `initialize_governance`, `create_proposal`, `vote_proposal`, `execute_proposal` |
| `yield-distributor` | `distribute_yield` (85% user / 15% burn-engine CPI) |

## Flow

```text
USDC → nv-usdc-vault → NVSCUSDC shares
NVSCUSDC → escrow → reserve_nvusdc_margin → perps
Vault yield → 85% NAV + 15% burn-engine (NVSC buyback)
Escrow lend yield → yield-distributor 85/15 split
Perp fees (USDC) → burn-engine + staking-manager
NVSC stakers → proposals → set_venue_weights_governed
```

## Deploy (devnet)

```bash
TMPDIR="$PWD/.tmp-build" CARGO_TARGET_DIR="$PWD/target" anchor build --ignore-keys
anchor deploy --provider.cluster devnet
npx tsx scripts/init-rewire-devnet.ts
```

**Note:** Redeploy after account layout changes; re-init escrows and vault PDAs.
