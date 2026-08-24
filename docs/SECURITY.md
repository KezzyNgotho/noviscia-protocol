# Security Best Practices & Audit Guide

**Last updated:** August 24, 2026
**Status:** Devnet · unaudited · mainnet requires audit sign-off

---

## Findings log

**2026-07-06 — ETH market risk-parameter misconfiguration (found and fixed).** `position-tracker`'s ETH market was registered with `max_leverage_bps=10,000,000` (1000x) against `maintenance_margin_bps=99` (0.99%) — positions opened at max leverage started **already below** the maintenance threshold, liquidatable with zero price movement. Found via live devnet testing. Fixed by: (1) `set_market_risk_params` admin instruction; (2) hard on-chain invariant `maintenance_margin_bps * max_leverage_bps < 10_000²` on both `register_market` and `set_market_risk_params`.

---

## CCP security model

Noviscia is a **central counterparty** — it interposes on every trade (novation). This creates unique security requirements beyond a standard DEX:

### Non-custodial architecture

All funds live in program-derived accounts. Users sign every action:

```rust
seeds = [b"escrow", user.key().as_ref()]
```

- No private keys on servers
- Only user can withdraw (enforced by PDA)
- All transactions signed by user wallet
- Transparent on-chain verification

### Oracle security — JIT Pyth pull-oracle

Every price-sensitive instruction verifies its own fresh, guardian-signed Pyth Hermes price update on-chain:

```rust
let price = verify_jit_price(
    /* ... */ signed_price_payload, merkle_price_update_bytes, treasury_id, &clock,
)?;
// ≤30-second freshness ceiling — reverts with OracleStale (6006) if stale
```

- No continuously-updated on-chain price account
- Each instruction proves its own price is fresh
- No dual-oracle consensus — single-source Pyth with on-chain freshness check
- No Switchboard integration

### Netting engine security

The netting engine (`68s4vuWUXAaEFF1EM1RUQpw7SFdYZSV3opvtDqoBCs56`) handles cross-tenant risk:

- **Venue registration** — Each product registers as a venue (perps = venue 0, events = venue 1)
- **Novated fill reporting** — Every trade reported for multilateral netting
- **Correlation-matrix cross-margin** — Portfolio margin across correlated positions
- **House book** — CCP default fund sizing and capital adequacy

### Atomic recall security

The yield-router composes atomic recall into liquidation:

- Recall is best-effort/backward compatible — only runs when accounts are present and LP-owned USDC is short
- Shortfall = `needed − lp_on_hand`, capped at `outstanding_yield_receivable`
- Composed in the same transaction as liquidation — no separate step

### CPI safety

Only two CPI targets in the perps path:
- `position-tracker` → `nv-usdc-vault` (deposit/redeem/fees/margin)
- `position-tracker` → Pyth Receiver (price verification)

Both address-checked:

```rust
#[account(address = nv_usdc_vault::ID)]
pub nv_usdc_vault_program: UncheckedAccount<'info>,
```

External lending-venue CPIs fully retired — `lend_mode` hardcoded to 0.

### Market risk-parameter validation

Both `register_market` and `set_market_risk_params` enforce:

```
maintenance_margin_bps * max_leverage_bps < 10_000²
```

---

## Admin-gated instructions

| Instruction | Gate | Purpose |
|-------------|------|---------|
| `register_market` | `pt_config.admin` | Add new perp markets |
| `set_market_fee_bps` | `pt_config.admin` | Adjust trading fees |
| `set_market_risk_params` | `pt_config.admin` | Correct risk parameters |
| `resize_market` | `pt_config.admin` | Expand market account space |

**Pre-mainnet:** Admin key must be rotated to a Squads multisig (M-of-N).

---

## Permissionless cranks

All perps cranks are permissionless — no operator key required:
- `settle_funding` — Funding settlement
- `liquidate` — Position liquidation
- `execute_limit_order` — Limit order fill
- `execute_tp_sl` — TP/SL trigger
- `execute_twap_slice` — TWAP slice execution
- `trigger_burn` — NVSC burn

---

## Audit status

- **No independent third-party audit completed.**
- Target: Q4 2026 (see [`AUDIT_PREP.md`](./AUDIT_PREP.md))
- Bug bounty program covers devnet scope (see [`BUG_BOUNTY.md`](./BUG_BOUNTY.md))
- **Until audit complete, treat all contracts as unaudited experimental software.**

---

## Pre-launch security checklist

- [ ] Full smart contract audit (third-party) completed
- [ ] All P0/P1 findings remediated
- [ ] Admin key rotated to Squads multisig (M-of-N)
- [ ] Upgrade authority transferred to multisig
- [ ] No hardcoded keys or secrets in source
- [ ] Emergency pause mechanism tested
- [ ] Bug bounty program live (mainnet scope)
- [ ] Incident response plan reviewed

---

## Incident response

1. **Detection** — Monitor alerts, review on-chain events
2. **Containment** — Pause affected instruction if needed
3. **Eradication** — Fix root cause, deploy patched program
4. **Recovery** — Resume operations, verify state
5. **Communication** — Notify users, post-mortem

**Contact:** security@noviscia.com · Bug bounty: https://github.com/noviscia/protocol/issues

---

## User security best practices

- Never share private keys or seed phrases
- Use hardware wallets for large amounts
- Verify the domain before connecting
- Beware phishing — Noviscia will never DM asking for keys
- Start with small amounts on devnet
