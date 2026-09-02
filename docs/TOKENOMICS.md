# Noviscia Tokenomics — nvscUSDC vs NVSC

**Last updated:** August 31, 2026
**Status:** Devnet · both tokens live on-chain · 15 active programs · CCP clearing house + TVV revenue spine (15–35% velocity APY)

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
4. While locked, shares keep compounding because `total_assets` grows from **all protocol revenue** — gateway-auction (State B), netting rent (State A), JIT premiums (State C), perp fees, liquidation penalties.
5. On close, PnL (including funding) is settled, and shares are returned (or forfeited on liquidation).

### NAV accrual sources (CCP-wide)

| Source | Flow |
|--------|------|
| State-B gateway auction | 100% → fee spine (`accumulate_protocol_fees`) → `total_assets` |
| State-A netting rent (sovereign-netting) | 100% → fee spine → `total_assets` |
| State-C JIT premiums (jit-risk) | 100% → fee spine (`sweepPremiums`) → `total_assets` |
| Perps trading fees (open + close) | 100% → `total_assets` |
| Liquidation penalties | 90% of protocol-retained → `total_assets` |
| Insurance fund carve-out | 10% of protocol-retained → `Market.insurance_fund_usdc` |

**Yield is auto-compounding.** Every fee event across every product increases `total_assets`, which increases the value of every share. A position open for a week has margin worth strictly more than at entry, from vault-wide yield alone. Fees are released into NAV on-chain as the revenue engines sweep (`jit-risk`, `gateway-auction`, `sovereign-netting`) into `accumulate_protocol_fees` at the TVV velocity APY (15–35%).

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

1. Protocol revenue accrues into the `nv-usdc-vault` 5-authority `accumulate_protocol_fees` spine.
2. A surplus/buyback mechanism converts accumulated fees to NVSC and burns it — supply permanently reduced.
3. Deflationary flywheel: more volume → more fees → more burns → reduced supply.

### Governance

Staked NVSC holders can:
- Create proposals (`create_proposal`)
- Vote on protocol parameters (`vote_proposal`)
- Execute approved changes (`execute_proposal`)

Covers: fee tiers, market risk parameters, insurance thresholds, protocol upgrades.

---

## Fee flow diagram (CCP-wide)

```
STATE-B GATEWAY AUCTION
  → Auction batches → accumulate_protocol_fees (5-authority spine)

STATE-A NETTING RENT (sovereign-netting)
  → Netting rent → fee spine

STATE-C JIT PREMIUMS (jit-risk)
  → sweepPremiums → fee spine

PERPS TRADER opens/closes position
  → Trading fee → nv-usdc-vault.total_assets

LIQUIDATION
  → 20% → liquidator bounty (nvscUSDC shares)
  → 80% → protocol-retained
       → 10% → Market.insurance_fund_usdc
       → 90% → nv-usdc-vault.total_assets

FUNDING SETTLEMENT
  → 100% redistributed longs ↔ shorts (not protocol revenue)

REVENUE RELEASE
  → jit-risk / gateway-auction / sovereign-netting sweep into vault via CPI
  → `nv-usdc-vault::accumulate_protocol_fees` routes cut to LP NAV (TVV 15–35%)
  → revenue indexer (`services/indexer`, :8092) surfaces on-chain totals

STAKING
  → Stakers receive share of protocol fees (proportional to stake)
```

---

## On-chain programs involved

| Program | Role in tokenomics |
|---------|-------------------|
| `nv-usdc-vault` | Mint/burn nvscUSDC, NAV accrual, `accumulate_protocol_fees` spine, target-APY release |
| `gateway-auction` | State-B revenue → fee spine |
| `sovereign-netting` | State-A netting rent → fee spine |
| `jit-risk` | State-C JIT premiums (`sweepPremiums`) → fee spine |
| `position-tracker` | Lock nvscUSDC as margin, trigger perps fee/liquidation flows |
| `netting-engine` / `clearing-registry` | Cross-tenant netting, venue registration |
| `yield-distributor` | Yield distribution and claiming |
| `yield-router` | Atomic recall for margin calls |
| `staking-manager` | NVSC staking, governance, fee distribution |
| `ve-nvs` | Vote-escrowed NVSC governance weight |
| `noviscia-credit-line` | Institutional credit-line commits (priority-bid monetization) |
| `token-nvsc` | NVSC SPL token operations |

---

## Key metrics (devnet, Aug 2026)

| Metric | Value |
|--------|-------|
| Active on-chain programs | 15 |
| Vault AUM | ≈ $54.2M USDC |
| Velocity APY (TVV) | 15–35% |
| Revenue sources | Netting rent · gateway auction tips · JIT slot premiums |
| Funder balance | Auto-minted from USDC mint authority |
| NVSC total supply | 1,000,000,000 |
| Liquidation bounty | 20% of forfeited collateral |
| Insurance carve | 10% of protocol-retained penalty |
| Staking tiers | 4 (Bronze → Platinum) |

---

## Security considerations

- **No external yield sources:** NAV accrues only from on-chain protocol revenue (gateway-auction, netting rent, JIT premiums, perps fees, liquidation penalties).
- **CCP-shared vault:** nvscUSDC is backed by revenue from all products via the unified fee spine, not just perps.
- **Fees released on-chain:** the 5-authority `accumulate_protocol_fees` spine and the revenue-engine CPI sweeps gate fee release into NAV.
- **Staking is non-custodial:** staked NVSC remains in the user's PDA.

---

*See [`WHITEPAPER.md`](./WHITEPAPER.md) for the full protocol design, [`SECURITY.md`](./SECURITY.md) for security details, and [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the complete system architecture.*
