# Mainnet Readiness Checklist

**Status:** Pre-mainnet · Devnet-only
**Last updated:** 2026-09-03

---

## Pre-Deployment Requirements

### Security
- [ ] External audit by reputable firm (OtterSec, Neodyme, or Zellic)
- [ ] All P0/P1 audit findings resolved
- [ ] Bug bounty program live (Immunefi or equivalent) — deferred, planned post-audit (`programs/cluster-4-governance/bug-bounty`)
- [ ] Admin key rotated to Squads multisig (M-of-N)
- [ ] No hardcoded keys or secrets in source code

### Smart Contracts
- [ ] All on-chain programs compiled with matching Anchor version
- [ ] Program binary hashes recorded before deploy
- [ ] Upgrade authority transferred to multisig
- [ ] Emergency pause mechanism tested
- [ ] Rent-exempt minimums verified for all PDAs
- [ ] Re-entrancy and overflow checks audited

### Infrastructure
- [ ] Production RPC providers provisioned (Helius, Triton, or QuickNode — paid tier)
- [ ] Indexer backed by dedicated Postgres (not serverless)
- [ ] Redis cluster for rate limiting and caching
- [ ] Monitoring: Sentry (errors), Prometheus + Grafana (metrics), PagerDuty (alerts)
- [ ] Log aggregation (Datadog, Logflare, or equivalent)
- [ ] DDoS protection (Cloudflare or equivalent)

### Frontend
- [ ] All env vars set in Vercel dashboard (not .env.local)
- [ ] CSP headers configured for wallet connections
- [ ] Error boundaries on all critical routes
- [ ] Sentry error tracking live
- [ ] Performance budget (LCP < 2.5s, CLS < 0.1)

### Operational
- [ ] Incident response runbook reviewed and tested
- [ ] Netting-relayer runs on dedicated infrastructure (keeps netting floors + default-fund target live)
- [ ] Permissionless crank readiness verified (liquidations, funding, revenue sweeps — no dedicated keeper estate required)
- [ ] Oracle price feed: Pyth (JIT pull-oracle) verified on mainnet
- [ ] Liquidation path tested under load (permissionless `liquidate` on `position-tracker`)
- [ ] Insurance fund seeded with target TVL percentage

### Compliance
- [ ] Terms of service reviewed by legal counsel
- [ ] Privacy policy published
- [ ] Geo-blocking for restricted jurisdictions
- [ ] KYC/AML integration (if required by jurisdiction)

---

## Migration Steps (Devnet → Mainnet)

1. **Deploy programs** — Use `scripts/deploy/upgrade-*-devnet.sh` as templates; swap RPC endpoint to mainnet
2. **Verify programs** — `solana program show <ID>` on mainnet, confirm deployment slot
3. **Register IDLs** — `anchor idl upgrade` for each program on mainnet
4. **Initialize vaults** — Call `initialize_vault_config` with mainnet USDC mint (`EPjFWa...`)
5. **Seed insurance fund** — Transfer initial USDC to insurance vault
6. **Deploy netting-relayer** — Update RPC endpoint, keypair, and poll interval in `docker-compose.yml` / service config
7. **Deploy frontend** — Vercel production branch, env vars verified
8. **Smoke test** — Open/close small position on mainnet with real USDC
9. **Monitor** — Watch error rates, liquidation events, oracle staleness for 24h
10. **Announce** — Public launch after 48h of stable operation

---

## Rollback Plan

If critical issues are discovered post-deploy:

1. **Pause** — Call emergency pause on affected programs (if multisig supports it)
2. **Revert** — Deploy previous program version using `solana program deploy --force`
3. **Halt relayers** — Stop the netting-relayer and any automated cranks
4. **Communicate** — Status page update within 15 minutes
5. **Investigate** — Root cause analysis before any re-deploy

---

## Solana Network Degradation Architecture

The CCP implements a four-tier defense-in-depth model for Solana network degradation events (congestion, halts, or slot-time spikes).

### Network Health Tiers

| Tier | Avg Slot Time | Action |
|------|---------------|--------|
| **NORMAL** | ≤ 600ms | Standard operation |
| **DEGRADED** | ≤ 2s | `pause_opens` on-chain; priority fees 2×; Jito fallback ready |
| **CRITICAL** | ≤ 5s | `pause_opens + pause_deposits`; Jito bundle submission; 4× priority fees; liquidations escalated |
| **HALT** | > 5s | Emergency pause all; cranks resume on recovery |

### Components

Liquidation, funding settlement, oracle pulls and revenue sweeps are **permissionless** on-chain — any wallet can execute them, so the frontend doubles as the crank and no dedicated keeper estate is required.

1. **Protocol safety rails** — `pause_opens` / `pause_deposits` flags live in `PtConfig` and are settable immediately by admin (no keeper path — direct instructions)
2. **Permissionless liquidation/funding** — any caller runs the liquidation-vault / position-tracker cranks; the first signer in a slot wins
3. **Revenue pipeline (permissionless sweeps)** — gateway `settle`, netting `sweep_netting_rent`, JIT `sweep_premiums` are unwalled Calls that anyone (or the earn UI) can execute
4. **Netting relayer** — keeps `NettingSet.margin_required_usdc` and the house-book default-fund target live so the netting policy gates position opens

### Default Fund Sizing (Network Recovery Factor)

The default fund target must account for the maximum expected recovery delay during network degradation:

```
DF_target = max(VaR_99, Expected_Shortfall_99) × (1 + recovery_factor)
```

Where `recovery_factor` estimates the additional exposure accumulated while liquidations cannot execute:

- Normal conditions: `recovery_factor = 0.10` (10% buffer)
- Historical Solana degradation events: 30s–5min average recovery
- Worst-case scenario (full halt): up to 30min
- Pre-signed fallback queue: eliminates gap for positions known at halt time
- Jito bundles: provides alternative execution path during degraded conditions

**Conservative sizing**: `DF_target = VaR_99 × 1.25` (25% buffer covers up to ~2hr of degraded operation without liquidation execution)

### Loss Waterfall (On-Chain)

```
Insurance Fund → Default Fund → CCP Equity → Settlement Vault
```

Implemented in `programs/cluster-1-clearing-core/position-tracker/src/helpers.rs` via `pay_winner_from_waterfall`.

---

## Target Timeline

| Milestone | Target | Status |
|-----------|--------|--------|
| Audit engagement | Q3 2026 | Not started |
| Audit complete | Q4 2026 | Not started |
| Bug bounty live (deferred, post-audit) | Q4 2026 | Not started |
| Multisig deployment | Q4 2026 | Not started |
| Mainnet soft launch | Q1 2027 | Not started |
| Mainnet public launch | Q1 2027 | Not started |
