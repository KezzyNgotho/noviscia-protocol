# Noviscia Tokenomics — nvscUSDC vs NVSC

**Last updated:** August 24, 2026
**Status:** Devnet · both tokens live on-chain · 16 programs · CCP clearing house

---

## Token model overview

Noviscia uses a **dual-token model** that separates yield-bearing margin from governance:

| | **nvscUSDC** | **NVSC** |
|---|--------------|----------|
| Role | Yield-bearing vault share (margin) | Protocol + governance token |
| Mint | `nv-usdc-vault` on USDC deposit | `token-nvsc` (fixed supply) |
| Supply | Elastic (mint/redeem at NAV) | Fixed: 1,000,000,000 (9 decimals) |
| Governance | **No votes** | **Staked NVSC votes** |
| Yield | Auto-compounding (NAV accrual from all products) | Fee share + burn flywheel |
| Used as margin | **Yes** — locked, never redeemed while open | No |

---

## nvscUSDC — yield-bearing margin

### How it works

1. Trader deposits USDC into the `nv-usdc-vault`.
2. Vault mints nvscUSDC shares at live NAV: `shares = deposit_usdc * total_shares / total_assets`.
3. Trader uses nvscUSDC as margin — shares are **locked** but never redeemed.
4. While locked, shares keep compounding because `total_assets` grows from **all protocol revenue** — perps fees, event market fees, DEX fees, liquidation penalties.
5. On close, PnL (including funding) is settled, and shares are returned (or forfeited on liquidation).

### NAV accrual sources (CCP-wide)

| Source | Flow |
|--------|------|
| Perps trading fees (open + close) | 100% → `total_assets` |
| Event market fees | 100% → `total_assets` |
| Spot DEX fees | 100% → `total_assets` |
| Liquidation penalties | 90% of protocol-retained → `total_assets` |
| Insurance fund carve-out | 10% of protocol-retained → `Market.insurance_fund_usdc` |

**Yield is auto-compounding.** Every fee event across every product increases `total_assets`, which increases the value of every share. A position open for a week has margin worth strictly more than at entry, from vault-wide yield alone.

### Key properties

- **Non-custodial:** shares live in program-derived accounts.
- **Not a governance token:** no voting rights.
- **Single-asset vault:** only USDC backs nvscUSDC (v1).
- **Elastic supply:** minted on deposit, burned on redemption.
- **CCP-shared:** same vault backs perps, events, and all future products.

---

## NVSC — governance and utility

### Token properties

| Property | Value |
|----------|-------|
| Total supply | 1,000,000,000 NVSC |
| Decimals | 9 |
| Program | `token-nvsc` (`HSaBJHaGa4Hiv1uBYPHQC4ijmnh8237a5LzM8Lyuz1YT`) |

### Distribution

| Allocation | % | Tokens | Vesting |
|------------|---|--------|---------|
| Ecosystem | 35% | 350,000,000 | Various (incentives, partnerships, grants) |
| Public sale | 25% | 250,000,000 | TGE unlock |
| Liquidity | 15% | 150,000,000 | TGE (DEX/CEX liquidity) |
| Team | 15% | 150,000,000 | 4yr linear vest, 1yr cliff |
| Partners | 10% | 100,000,000 | 2yr linear vest |

### Staking tiers

| Tier | Minimum NVSC | Fee Discount | Governance |
|------|-------------|--------------|------------|
| Bronze | 100 | 10% | Proposal creation |
| Silver | 1,000 | 25% | Proposal creation |
| Gold | 10,000 | 50% | Proposal creation + priority |
| Platinum | 100,000 | 100% (free trading) | Full governance |

### Burn mechanics

1. Trading fees accumulate in the `burn-engine` PDA as USDC.
2. Permissionless caller triggers `trigger_burn` when threshold is met.
3. Engine swaps USDC → NVSC and calls `burn` — supply permanently reduced.
4. Deflationary flywheel: more volume → more fees → more burns → reduced supply.

### Governance

Staked NVSC holders can:
- Create proposals (`create_proposal`)
- Vote on protocol parameters (`vote_proposal`)
- Execute approved changes (`execute_proposal`)

Covers: fee tiers, market risk parameters, insurance thresholds, protocol upgrades.

---

## Fee flow diagram (CCP-wide)

```
PERPS TRADER opens/closes position
  → Trading fee (5-50 bps) → nv-usdc-vault.total_assets

EVENT MARKET resolves
  → Resolution fee → nv-usdc-vault.total_assets

SPOT DEX trade
  → Swap fee → nv-usdc-vault.total_assets

LIQUIDATION
  → 20% → liquidator bounty (nvscUSDC shares)
  → 80% → protocol-retained
       → 10% → Market.insurance_fund_usdc
       → 90% → nv-usdc-vault.total_assets

FUNDING SETTLEMENT
  → 100% redistributed longs ↔ shorts (not protocol revenue)

BURN ENGINE
  → Accumulated USDC → swap to NVSC → burn (supply decreases)

STAKING
  → Stakers receive share of protocol fees (proportional to stake)
```

---

## On-chain programs involved

| Program | Role in tokenomics |
|---------|-------------------|
| `nv-usdc-vault` | Mint/burn nvscUSDC, NAV accrual, omni-pool |
| `position-tracker` | Lock nvscUSDC as margin, trigger perps fee/liquidation flows |
| `noviscia-clearing` | Event market fee flows |
| `netting-engine` | Cross-tenant netting, venue registration |
| `staking-manager` | NVSC staking, governance, fee distribution |
| `burn-engine` | USDC accumulation, NVSC buyback & burn |
| `token-nvsc` | NVSC SPL token operations |
| `yield-distributor` | Yield distribution and claiming |
| `protocol-lp-vault` | LP fee share |
| `yield-router` | Atomic recall for margin calls |

---

## Key metrics (devnet, Aug 2026)

| Metric | Value |
|--------|-------|
| On-chain programs | 16 |
| Perp markets live | 22 |
| NVSC total supply | 1,000,000,000 |
| Trading fee range | 5-50 bps |
| Liquidation bounty | 20% of forfeited collateral |
| Insurance carve | 10% of protocol-retained penalty |
| Staking tiers | 4 (Bronze → Platinum) |

---

## Security considerations

- **No external yield sources:** NAV accrues only from protocol trading fees and liquidation revenue.
- **CCP-shared vault:** nvscUSDC is backed by revenue from all products, not just perps.
- **Burn is permissionless:** anyone can trigger when threshold is met.
- **Staking is non-custodial:** staked NVSC remains in the user's PDA.

---

*See [`WHITEPAPER.md`](./WHITEPAPER.md) for the full protocol design, [`SECURITY.md`](./SECURITY.md) for security details, and [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the complete system architecture.*
