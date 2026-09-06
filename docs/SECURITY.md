# Security Best Practices & Audit Guide

**Last updated:** September 6, 2026
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

- **Venue registration** — Each product registers as a venue (perps = venue 0; other venues may follow)
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
- Revenue sweeps — `sweep_netting_rent` (sovereign-netting), gateway/jit premium sweeps (feed omni-pool NAV)

---

### Post-consolidation cluster security & maturity evaluation

Per-cluster hardening posture after the 19→4 consolidation (`CONSOLIDATION.md`), measured
across the live hosts. Counts are raw source markers over each crate's `src/` (devnet,
unaudited — see `AUDIT_PREP.md`).

**C1 · Clearing-Core (CCP)** — `netting-engine 68s4…` (host: `credit_line.rs` + `sovereign.rs`),
`position-tracker`, `noviscia-clearing`, `clearing-registry`
- Maturity: netting-engine 42/42 · position-tracker 105 · clearing 48 · registry 14 — heaviest authority surface in the system.
- Primitive density (netting-engine): `require!` 79 · seeds 48 · `init_if_needed` 4 · CPI invokes 4 · Pyth mentions 1. Position-tracker is the densest crate anywhere: seeds 266 · `require!` 289 · `init_if_needed` 30 · CPI invokes 123 · Pyth 262.
- Risk shape: oracle dependency + settlement correctness dominate. Pyth pull-oracle freshness is enforced (JIT oracle section above); netting/clearing ledgers are mutualized (non-custodial, no SPL movement) so the exposure surface is ledger-state, not token custody.

**C2 · TVV Gate** — `noviscia-capacity JDsM…` (host: `asset_engine.rs` + `jit_risk.rs`), `gateway-auction`, `yield-router`
- Maturity: capacity 66/66 · auction + router smaller suites; consolidated single authority spin.
- Primitive density (capacity): `has_one` 23 · `require!` 106 · seeds 94 · `constraint` 30 · `init_if_needed` 2 · CPI invokes 2 (sweep → vault) · **Pyth 0**.
- Risk shape: 400ms slot is the trust-critical window (capacity rental, JIT risk, asset-engine credit). No external oracle; pricing flows through position-tracker/Pyth at C1 or venue quotes. Sweep CPIs into `nv-usdc-vault` are fee-spine re-pointed (marketplace PDA allowlisted).

**C3 · Vault & Tranches** — `nv-usdc-vault CN92…` (host: `router_pool.rs` + `tranche_pool.rs`)
- Maturity: vault 77/77 (incl. tranche 9 + router 11 + 5 unification across same-binary loss↔default-fund).
- Primitive density (vault): `require!` 184 · seeds 143 · `constraint` 65 · `has_one` 8 · `init_if_needed` 9 · signers 49 · **CPI invokes 0** (sub-custody transfers only) · Pyth 0.
- Risk shape: single `vault_config.admin` spine governs vault + tranche + router (one authority boundary). Token custody is centralized in-program (largest token-handling surface in the protocol); timelocked-admin seed present (`b"timelocked-admin"`).

**C4 · Ecosystem & Governance** — `token-nvsc`, `ve-nvs`, `staking-manager`, `yield-distributor`, `liquidation-vault`
- Maturity: locked no-upgrade during phase-1 sandbox (D5); deploy maps muted in `Anchor.toml`, IDLs stable.
- Risk shape: governance/ve-key plumbing only — no custody, no oracle. Lowest exposure, intentionally pinned.

**Cross-cluster observations (from consolidation, not newly introduced):**
- Authority hops cut 19 → 13 deploy entries; no two-cluster CPI trust boundary remains for the
  former `credit-line`/`jit-risk`/`tranche-vault`/`permissioned-pool` edges.
- Vault fee-spine (C3) accepts both consolidated market/revenue/credit-line PDAs and legacy
  standalone IDs — a deliberate dual-accept window during migration; tighten to consolidated
  IDs only after devnet state migration (see `REVIEW_CONSOLIDATION.md` §6).

### Audit status

- **No independent third-party audit completed.**
- Target: Q4 2026 (see [`AUDIT_PREP.md`](./AUDIT_PREP.md))
- Bug-bounty program (`programs/cluster-4-governance/bug-bounty`) is **deferred** — not live on devnet; a responsible-disclosure email contact applies meanwhile.
- **Until audit complete, treat all contracts as unaudited experimental software.**

---

## Pre-launch security checklist

- [ ] Full smart contract audit (third-party) completed
- [ ] All P0/P1 findings remediated
- [ ] Admin key rotated to Squads multisig (M-of-N)
- [ ] Upgrade authority transferred to multisig
- [ ] No hardcoded keys or secrets in source
- [ ] Emergency pause mechanism tested
- [ ] Bug bounty program live (mainnet scope) — deferred, planned post-audit
- [ ] Incident response plan reviewed

---

## Incident response

1. **Detection** — Monitor alerts, review on-chain events
2. **Containment** — Pause affected instruction if needed
3. **Eradication** — Fix root cause, deploy patched program
4. **Recovery** — Resume operations, verify state
5. **Communication** — Notify users, post-mortem

**Contact:** security@noviscia.com · Issue tracker: https://github.com/noviscia/protocol/issues (responsible disclosure until the bug-bounty program is live on mainnet)

---

## User security best practices

- Never share private keys or seed phrases
- Use hardware wallets for large amounts
- Verify the domain before connecting
- Beware phishing — Noviscia will never DM asking for keys
- Start with small amounts on devnet
