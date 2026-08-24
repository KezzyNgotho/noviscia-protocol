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
- [ ] Oracle price feed redundancy (Pyth primary, backup)
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

## Target Timeline

| Milestone | Target | Status |
|-----------|--------|--------|
| Audit engagement | Q3 2026 | Not started |
| Audit complete | Q4 2026 | Not started |
| Bug bounty live | Q4 2026 | Not started |
| Multisig deployment | Q4 2026 | Not started |
| Mainnet soft launch | Q1 2027 | Not started |
| Mainnet public launch | Q1 2027 | Not started |
