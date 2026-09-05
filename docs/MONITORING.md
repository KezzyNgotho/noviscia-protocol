# Operational Monitoring Runbook

> **Status:** Living runbook; SLO targets live in `SLO_OBSERVABILITY.md`. **Last updated:** September 5, 2026.

Production monitoring requirements before mainnet launch.

## Sentry (Frontend — Already Configured)

Sentry is initialized for client, server, and edge in `app/web/sentry.*.config.ts`.

**Required setup:**
1. Create a Sentry project at sentry.io
2. Set `NEXT_PUBLIC_SENTRY_DSN` in `.env.local` and Vercel env
3. Set `SENTRY_AUTH_TOKEN` for source maps in CI
4. Configure alert rules in Sentry dashboard:
   - **Error spike**: >10 errors/min → Slack/PagerDuty
   - **New error type**: Any first-severity → email
   - **Performance**: LCP >3s or FCP >2s → alert

## On-Chain Monitoring (Needs Setup)

### What to monitor

| Metric | Source | Threshold | Action |
|--------|--------|-----------|--------|
| Insurance fund balance | `vault_usdc` SPL balance | <50,000 USDC | Alert + investigate |
| Protocol vault solvency | `total_assets - total_liabilities` | <0 | CRITICAL — pause protocol |
| Oracle staleness | Pyth price account `publish_slot` | >30s old | Alert — investigate |
| Open interest by market | Market account `long_oi + short_oi` | >80% of max_oi | Alert — cap approaching |
| Liquidation queue depth | Liquidation vault pending count | >50 | Alert — investigate |
| Funding rate divergence | Funding rate vs mark price | >0.5% | Alert — market imbalance |
| Position tracker program slot | `getSlot()` vs current | >10 slots behind | Alert — RPC issue |

### Tools to deploy

1. **Prometheus + Grafana** — metrics collection and dashboards
   - Export on-chain metrics via a polling service (every slot = ~400ms)
   - Key dashboards: vault health, oracle latency, liquidation rate, OI utilization

2. **PagerDuty or Opsgenie** — on-call alerting
   - Critical: vault insolvency, oracle down >60s, protocol paused unexpectedly
   - Warning: OI approaching cap, Sentry error spike

3. **Uptime Robot or Betterstack** — endpoint health checks
   - Monitor: RPC endpoint, indexer (8092), websocket, price-feed, netting-relayer, and the web frontend
   - Check interval: 60 seconds

### On-chain crank health

Liquidations, funding settlement, oracle pulls and revenue sweeps are **permissionless** — any wallet (including the frontend) can execute them, so there is no dedicated keeper to health-check. Monitor:
- Last liquidation / settle transaction per slot window (query `getSignaturesForAddress` on the liquidation-vault, position-tracker and pipeline programs)
- Revenue pipeline sweep residue: gateway `tip-vault`, netting `rent-vault`, JIT premium ledger should be ≈ 0 — if a vault refills and stays non-zero, someone should sweep it

## Incident Response

### Severity Levels

| Level | Description | Response time | Example |
|-------|-------------|---------------|---------|
| **SEV1** | Protocol funds at risk | Immediate | Vault insolvent, oracle manipulation, unauthorized admin action |
| **SEV2** | Service degraded | <1 hour | downtime, oracle stale, liquidations failing |
| **SEV3** | Non-critical issue | <24 hours | UI bug, documentation error, monitoring gap |

### SEV1 Response

1. **Pause protocol** via admin `set_pause_flags` instruction
2. **Verify on-chain state** — check vault balance, position health, oracle prices
3. **Notify team** in incident channel
4. **Root cause analysis** — check recent transactions, service logs, Sentry errors
5. **Fix and resume** — deploy fix, unpause, monitor recovery

### SEV2 Response

1. **Check service logs** — docker logs for the affected service
2. **Restart service** if needed — `docker-compose restart <service>`
3. **Verify recovery** — check heartbeat, metrics, logs
4. **Monitor** for 30 minutes after fix

## Log Aggregation

Currently no centralized logging. **Before mainnet:**
- Add structured JSON logging to all services
- Ship logs to a centralized store (Loki, Datadog, or CloudWatch)
- Key fields: `service`, `level`, `message`, `tx_signature`, `slot`, `timestamp`
