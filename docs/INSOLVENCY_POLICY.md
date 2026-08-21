# Terminal-Layer Insolvency Policy

**Document owner:** Noviscia CCP  
**Last updated:** 2026-08-21  
**Status:** On-chain enforcement — all layers below are codified in `position-tracker/src/lib.rs`

---

## What happens when the CCP runs out of equity?

Noviscia operates a **full waterfall loss-absorption cascade** with five distinct layers. Each layer is exhausted before the next is triggered. All five layers are on-chain and enforced by the `nv-usdc-vault` program.

### Waterfall Order

```
L1  Liquidation penalties        (100% of seized margin)
L2  Default fund                 (market insurance_fund_usdc)
L3  Vault reserve (allocated)    (vault default_fund_usdc)
L4  CCP equity                   (vault ccp_equity_usdc)
L5  Socialized loss              (pro-rata haircut on all positions)
```

### Layer Descriptions

| Layer | Source | Trigger | Mechanism |
|-------|--------|---------|-----------|
| **L1** | Liquidated trader's margin | Position health < maintenance | `liquidate()` seizes full margin; protocol-retained share sweeps into L2/L3/L4 per fee split |
| **L2** | Per-market insurance fund | L1 insufficient for shortfall | `insurance_fund_usdc` on the Market PDA is drawn down per market |
| **L3** | Vault default fund (cross-market) | L2 exhausted | `default_fund_usdc` on VaultConfig — cross-market insurance pool |
| **L4** | CCP equity (house book) | L3 exhausted | `ccp_equity_usdc` on VaultConfig — the house's own capital buffer |
| **L5** | Socialized loss | L4 exhausted | Pro-rata haircut on ALL profitable positions across the protocol |

### L5: Socialized Loss (Terminal Event)

When all four preceding layers are exhausted, the protocol executes a **pro-rata socialized loss**:

1. Every profitable position's PnL is reduced proportionally
2. The haircut ratio = `shortfall / total_profitable_pnl`
3. No position is closed — only PnL is adjusted
4. The adjustment is applied at settlement time via the `settlement_vault`
5. The CCP's `house_net_position_usdc` goes negative (house takes the residual loss)

**Key properties:**
- Losses are **socialized**, not socialized-and-frozen — traders can still close positions
- The haircut is **bounded** by the available settlement vault balance
- If the settlement vault itself is depleted, remaining claims are queued for the next fee-sweep cycle

### Comparison to Other Protocols

| Protocol | Terminal mechanism | What happens to traders |
|----------|-------------------|------------------------|
| **Drift** | Pro-rata socialized loss | PnL haircut on profitable traders |
| **Ethereal (dYdX v4)** | Full account takeover at bankruptcy price | Liquidated at oracle price, losses absorbed by insurance fund |
| **Hyperliquid (HLP)** | Socialized loss + insurance fund | PnL haircut, then ADL, then socialized |
| **Noviscia (L1-L5)** | 4-layer waterfall + socialized loss | Max protection before haircut; same L5 as Drift |

### Why This Matters for Institutional Users

1. **Predictable loss allocation**: The waterfall is deterministic and on-chain — no discretionary intervention
2. **4 layers of protection before haircut**: More cushion than any competitor (Drift has 2, Hyperliquid has 2)
3. **House book as L4**: The CCP's own capital is at risk before socializing losses — skin in the game
4. **ADL as release valve**: `execute_adl` closes insolvent positions before they drain the waterfall, reducing L5 probability
5. **No single point of failure**: The waterfall is enforced by code, not by a multisig or committee

### Audit Trail

Every waterfall draw is logged on-chain via Anchor events:
- `LiquidationEvent` — records seized margin and which layers were drawn
- `InsuranceDrawEvent` — records L2/L3/L4 draws
- `SocializedLossEvent` — records L5 haircut ratio and affected positions

### Emergency Powers

The **timelocked admin** can:
- Pause new opens (`pause_opens`) without affecting existing positions
- Pause liquidations (`pause_liquidations`) — emergency only, with documentation
- **Cannot** modify the waterfall order or skip layers
- **Cannot** redirect funds from the settlement vault to external accounts

The timelock delay is `DEFAULT_TIMELOCK_SECS` (24 hours) — providing a governance window for any parameter change.
