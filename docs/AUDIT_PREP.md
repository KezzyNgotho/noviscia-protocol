# Security Audit Preparation Package

Use this checklist when engaging a third-party auditor (target: pre-mainnet Q3 2026).

## Programs in scope

| Program | Path | Priority |
|---------|------|----------|
| escrow | `programs/escrow/src/lib.rs` | P0 |
| position-tracker | `programs/position-tracker/src/lib.rs`, `phase2.rs`, `session.rs` | P0 |
| lending-integrator | `programs/lending-integrator/src/lib.rs` | P0 |
| liquidation-vault | `programs/liquidation-vault/src/lib.rs` | P1 |
| nv-usdc-vault | `programs/nv-usdc-vault/src/lib.rs` | P1 |
| staking-manager | `programs/staking-manager/src/lib.rs` | P1 |

## Known design choices (not bugs)

- Oracle-fill perps (not CLOB-matched); Phoenix is UI reference only
- Limit/TWAP orders are off-chain until user fills or session delegate signs
- Devnet lending uses `LEND_MODE_INTERNAL`; external CPI is gated by admin `set_lend_mode`
- Cross-margin uses portfolio equity helper; isolated is default

## Test artifacts

```bash
npm run verify:phase1
npm run verify:phase2
npm run verify:e2e
anchor test
```

## Off-chain scope

- Keeper key custody (`KEEPER_KEYPAIR_JSON` on Railway)
- Indexer SQL injection / auth on ingest routes
- Session policy and API key storage (Postgres)

## Deliverables requested from auditor

- Executive summary + severity-rated findings
- Remediation verification window
- Public summary for `docs/SECURITY.md` (optional)
