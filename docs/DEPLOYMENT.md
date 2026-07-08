# Deployment and Maintenance Guide

**Last updated:** July 7, 2026

> This document previously described a Postgres/Redis/Prisma/PM2/AWS-Lambda stack with a standalone `app/api` service — none of that exists in this repo. Rewritten to match the actual architecture: a single Vercel-deployed Next.js app, Anchor on-chain programs, and a handful of independently-dockerized optional services.

## Prerequisites

- Node.js 20+ (see `app/web/.nvmrc`)
- Rust + Solana CLI + Anchor 0.31.1 (see `Anchor.toml` `[toolchain]`)
- A Vercel account (frontend hosting)
- Docker, only if you're running one of the optional `services/*` separately

## Repository layout (what actually gets deployed)

```
programs/            Anchor on-chain programs — see docs/DEVNET.md for deploy flow
app/web/              Next.js 14 app — deployed to Vercel (vercel.json), NOT a separate API server
services/            Independently-dockerized, optional, NOT required for core perps trading:
  indexer/              Persistent fills/positions/order history
  price-feed/           Price feed relay
  websocket/            Realtime ingest
  ai-orchestrator/      Optional local AI layer
  ai-rebalancer/        Optional local AI layer
  squid/                Subsquid-based indexer (own TypeORM/Postgres, internal to this service)
```

Core perps trading (open/close/liquidate/funding/TP-SL/limit orders) needs only the on-chain programs and the Next.js app — none of `services/*` are in that path. They exist for supplementary features (persistent history, an optional AI layer) and are deployed separately (Railway/Fly/Docker), never on Vercel.

## Environment Setup

```bash
git clone <this repo>
cd noviscia-protocal
npm install
cd app/web && npm install && cd ../..
```

Frontend environment variables: copy `app/web/.env.example` → `app/web/.env.local` for local dev, or set the same keys in Vercel's dashboard for deployed environments. See [`DEVNET.md`](./DEVNET.md#environment-variables-web-app) for which ones matter most.

## Program deployment (devnet)

See [`DEVNET.md`](./DEVNET.md) for the full, current, verified deploy flow — `anchor build`, `solana program extend` if needed, `solana program deploy` (or `anchor deploy`), then copy the fresh IDL into `app/web/app/idl/`. Program IDs are fixed and upgraded in place; see the table in `DEVNET.md` or `Anchor.toml`.

## Frontend deployment (Vercel)

```bash
cd app/web
npm run build   # sanity-check locally before pushing
```

Vercel deploy is git-integration-based (push to the connected branch) — `vercel.json` already sets the framework, build command, and API route timeouts. First-time setup: set the project's **root directory to `app/web`** in Vercel's project settings, and populate the environment variables from `.env.example` (see `DEVNET.md`). No separate CDN/S3 step is needed — Vercel handles static + serverless.

## Optional services (`services/*`)

Each has its own `Dockerfile` and can be deployed independently (Railway, Fly.io, or plain Docker) wherever it's needed — none of them run on Vercel. Consult each service's own `package.json` scripts and Dockerfile; this repo does not currently document a unified multi-service deploy script (a prior version of this document implied one — `./scripts/deploy/deploy_all.sh` — that script does not exist in the repo; verify before relying on any deploy script referenced in older docs).

## Mainnet deployment

Not yet performed — target Q3 2026, post-audit (see [`LAUNCH_ROADMAP.md`](./LAUNCH_ROADMAP.md) and [`AUDIT_REPORT.md`](./AUDIT_REPORT.md)). The mechanical steps will mirror devnet (program deploy + IDL copy + Vercel env swap to mainnet RPC/program IDs), gated on:

- [ ] Independent security audit complete, findings resolved
- [ ] Mainnet program IDs finalized and locked (see `Anchor.toml`'s `[programs.mainnet]` section — currently placeholder-style IDs, not yet real deployments)
- [ ] Production Pyth price feed IDs swapped in (devnet Hermes feed IDs differ from mainnet)
- [ ] Deposit caps and risk parameters reviewed

## Troubleshooting

### Program deploy fails with "invalid program argument"

Binary exceeds allocated space:

```bash
solana program extend <PROGRAM_ID> 10240 --keypair ~/.config/solana/new-id.json --url devnet
```

### Frontend build fails on Vercel but works locally

Check `next.config.js` — `typescript.ignoreBuildErrors` and `eslint.ignoreDuringBuilds` are both intentionally `true` (Solana SDK dependencies otherwise break strict Vercel builds), so a Vercel-only failure is more likely an environment-variable gap than a type error. Cross-check against `.env.example`.

### RPC issues

Use a premium devnet/mainnet RPC (Helius/Ankr), not the public `api.devnet.solana.com` — see [`DEVNET.md`](./DEVNET.md#rpc-requirements) for the specifics and a known Node `fetch`/IPv6 flakiness gotcha.

## Security checklist

- [ ] `.env`/`.env.local` never committed (already gitignored — verify before any new env file is added)
- [ ] Vercel environment variables set per-environment (Production/Preview/Development) deliberately, not copy-pasted blind
- [ ] Program upgrade authority is a known, controlled keypair (see `DEVNET.md`'s deployer wallet)
- [ ] Regular security audits scheduled (see `AUDIT_PREP.md`)
- [ ] Incident response plan documented (see `INCIDENT_RUNBOOK.md`)

## Support

- App: https://noviscia.com
- Documentation: https://noviscia.com/more/docs
- Discord: https://discord.gg/Noviscia-protocol
- Email: ngothokezz18@gmail.com
