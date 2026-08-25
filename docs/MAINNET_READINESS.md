# Mainnet Readiness Checklist

**Status:** Pre-mainnet · Devnet-only
**Last updated:** 2026-08-24

---

## Pre-Deployment Requirements

### Security
- [ ] External audit by reputable firm (OtterSec, Neodyme, or Zellic)
- [ ] All P0/P1 audit findings resolved
- [ ] Bug bounty program live (Immunefi or equivalent)
- [ ] Admin key rotated to Squads multisig (M-of-N)
- [ ] No hardcoded keys or secrets in source code

### Smart Contracts
- [ ] All 16 programs compiled with matching Anchor version
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
- [ ] Keeper bots run on dedicated infrastructure (Railway/Fly/AWS)
- [ ] Oracle price feed: Pyth (JIT pull-oracle) verified on mainnet
- [ ] Liquidation bot tested under load
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
6. **Configure keeper** — Update RPC endpoint, keypair, and program IDs in keeper config
7. **Deploy frontend** — Vercel production branch, env vars verified
8. **Smoke test** — Open/close small position on mainnet with real USDC
9. **Monitor** — Watch error rates, liquidation events, oracle staleness for 24h
10. **Announce** — Public launch after 48h of stable operation

---

## Rollback Plan

If critical issues are discovered post-deploy:

1. **Pause** — Call emergency pause on affected programs (if multisig supports it)
2. **Revert** — Deploy previous program version using `solana program deploy --force`
3. **Halt keeper** — Stop all automated trading/liquidation bots
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
| **CRITICAL** | ≤ 5s | `pause_opens + pause_deposits`; Jito bundle submission; 4× priority fees; liquidations pre-signed |
| **HALT** | > 5s | Emergency pause all; pre-signed fallback queue drains on recovery |

### Components

1. **Network Health Monitor** (`services/liquidation-keeper/src/network-health.ts`)
   - Rolling 60-sample slot-time tracker, polled every 2s
   - Emits state transitions to auto-pause controller and alert system

2. **Auto-Pause Controller** (`services/liquidation-keeper/src/auto-pause.ts`)
   - Sends admin instructions to `PtConfig` to set `pause_opens` / `pause_deposits`
   - Rate-limited to one instruction per 10 slots (~4s)

3. **Jito Bundle Submission** (`services/liquidation-keeper/src/jito-bundle.ts`)
   - Atomic bundle submission during degraded conditions
   - Falls back to standard escalated-fee submission if Jito unreachable

4. **Pre-Signed Fallback Queue** (`services/liquidation-keeper/src/fallback-queue.ts`)
   - Pre-signs liquidation transactions during degraded conditions
   - Submits on network recovery (60s TTL, FIFO eviction, max 3 attempts)

5. **Risk Engine Network-Aware Thresholds** (`services/risk-engine/src/index.ts`)
   - Default fund utilization alert thresholds tighten during degradation:
     - NORMAL: 80% elevated, 100% critical
     - DEGRADED: 60% elevated, 80% critical
     - CRITICAL: 45% elevated, 65% critical
     - HALT: 30% elevated, 50% critical

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

Implemented in `programs/position-tracker/src/helpers.rs` via `pay_winner_from_waterfall`.

---

## Target Timeline

| Milestone | Target | Status |
|-----------|--------|--------|
| Audit engagement | Q3 2026 | Not started |
| Audit complete | Q4 2026 | Not started |
| Bug bounty live | Q4 2026 | Not started |
| Multisig deployment | Q4 2026 | Not started |
| Mainnet soft launch | Q1 2027 | Not started |
| Mainnet public launch | Q1 2027 | Not started |
