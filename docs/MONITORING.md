# Operational Monitoring Runbook

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
| Oracle staleness | Pyth price account `publish_slot` | >30s old | Alert — check keeper |
| Open interest by market | Market account `long_oi + short_oi` | >80% of max_oi | Alert — cap approaching |
| Liquidation queue depth | Liquidation vault pending count | >50 | Alert — keeper backlog |
| Funding rate divergence | Funding rate vs mark price | >0.5% | Alert — market imbalance |
| Keeper wallet SOL balance | RPC balance check | <0.5 SOL | Alert — refuel needed |
| Position tracker program slot | `getSlot()` vs current | >10 slots behind | Alert — RPC issue |

### Tools to deploy

1. **Prometheus + Grafana** — metrics collection and dashboards
   - Export on-chain metrics via a polling service (every slot = ~400ms)
   - Key dashboards: vault health, oracle latency, liquidation rate, OI utilization

2. **PagerDuty or Opsgenie** — on-call alerting
   - Critical: vault insolvency, oracle down >60s, protocol paused unexpectedly
   - Warning: keeper balance low, OI approaching cap, Sentry error spike

3. **Uptime Robot or Betterstack** — endpoint health checks
   - Monitor: RPC endpoint, websocket service, price-feed service, indexer
   - Check interval: 60 seconds

### Keeper health checks

The liquidation keeper (`services/liquidation-keeper/`) needs:
- Heartbeat endpoint (HTTP 200 if keeper is running)
- Last successful liquidation timestamp
- Error rate (failed TX / total TX)
- Restart policy: `restart: unless-stopped` in docker-compose

### Oracle keeper health

The oracle keeper (`scripts/utils/oracle-keeper-devnet.ts`) needs:
- Monitoring of Pyth publish frequency per feed
- Alert if any feed goes >5 minutes without update
- Verify keeper wallet has SOL for TX fees

## Incident Response

### Severity Levels

| Level | Description | Response time | Example |
|-------|-------------|---------------|---------|
| **SEV1** | Protocol funds at risk | Immediate | Vault insolvent, oracle manipulation, unauthorized admin action |
| **SEV2** | Service degraded | <1 hour | Keeper down, oracle stale, liquidations failing |
| **SEV3** | Non-critical issue | <24 hours | UI bug, documentation error, monitoring gap |

### SEV1 Response

1. **Pause protocol** via admin `set_pause_flags` instruction
2. **Verify on-chain state** — check vault balance, position health, oracle prices
3. **Notify team** in incident channel
4. **Root cause analysis** — check recent transactions, keeper logs, Sentry errors
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
