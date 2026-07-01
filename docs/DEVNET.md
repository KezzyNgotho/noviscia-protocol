# Devnet Runbook — Noviscia Protocol

**Last updated:** July 2026  
**Network:** Solana devnet  
**Deployer wallet:** `pm2tUw22SDofzdfmyJv3jRDhLagwiqYRmCG2BWN23NA`  
**Keypair path:** `~/.config/solana/new-id.json`

---

## Program IDs (devnet, current)

| Program | ID |
|---------|----|
| `escrow` | `CTmCryJca9cFyMRaGdzrhyZeEnjdGLD8ZkEqNcNbvh2D` |
| `position_tracker` | `3zGRWKZq4V3npHbH9Lati46BwgmstTjynWZFFMxarQgY` |
| `nv_usdc_vault` | `CN92hAtnZxbMxPdho8tugi9GDK86UpGwmnbEvk5yzAWC` |
| `lending_integrator` | `Ea5TXHxsVcnKwMAcAsQkpPN88xr8ndBRpNGDkREWrbSZ` |
| `burn_engine` | `nFgJEQSrKEi7FdAKC6vz5HsQ6f9QjQLBuQcQqQy45id` |
| `staking_manager` | `4VDQjH73DiE3zYt66ukyWY7KMMJrxHUZfjkxRHTPDG75` |
| `yield_distributor` | `CrN1o75FGwcSo6ted7eKxw2kYgkaXDVeWmUaTZCTsLtw` |
| `liquidation_vault` | `C5mvuPTN7KHQ1NsXSUcD2tEae9fL1pLrNkZD67jRRuf1` |
| `prediction_market` | `3BTcArdsxKhzF2Msjm3JLy343v6ZvQjPusq3V2zRNbpv` |

**Key devnet mints:**
| Token | Mint |
|-------|------|
| USDC (devnet) | `Cx2bfKM7hcpnreSZxiDaN8q4Ca9i5ViCLxqRTs12JhS5` |
| nvscUSDC | `2TmaUey4Hh2om1kFR77Vw1RDh8H69qcW6UAACVidJeVk` |
| NVSC | `HSaBJHaGa4Hiv1uBYPHQC4ijmnh8237a5LzM8Lyuz1YT` |

---

## What is live on devnet

| Feature | Status | Notes |
|---------|--------|-------|
| USDC-settled perps (SOL/BTC/ETH) | **Live** | 3 tradeable markets; 13 preview |
| Dual-oracle (Pyth + Switchboard) | **Live** | Switchboard can drift on devnet |
| Multi-asset collateral (USDC + SOL) | **Live** | mSOL/jitoSOL wired, mainnet mints only |
| Sovereign Omni-Pool (sweep + recall) | **Live** | Full sweep/recall round-trip proven |
| Idle margin yield (`claim_idle_yield`) | **Live** | EscrowAccount V5 (SPACE=132) |
| Sub-accounts (sub_id 1–255) | **Live** | Isolated UserState + Position + Escrow PDAs |
| Limit orders + TWAP | **Live** | |
| AMM depth / JIT matching | **Live** | |
| Permissionless liquidation crank | **Live** | |
| nvscUSDC vault | **Live** | NAV per share accrues from Omni-Pool yield |
| NVSC staking tiers | **Live** | |
| Per-asset insurance pools | **Live (USDC)** | SOL pool wired, needs seeding |
| Collateral Console UI | **Live** | `/trade/collateral` |
| Analytics dashboard | **Live** | `/analytics` |
| NVSC TGE / mainnet | **Q3 2026** | |

---

## Standard deploy flow

```bash
# 1. Build all programs
cd noviscia-protocal
anchor build

# 2. Check deployer balance (need ~15+ SOL for all 3 programs)
solana balance pm2tUw22SDofzdfmyJv3jRDhLagwiqYRmCG2BWN23NA --url devnet

# 3. Extend program space if binary grew (run before deploy if unsure)
solana program extend CTmCryJca9cFyMRaGdzrhyZeEnjdGLD8ZkEqNcNbvh2D 10240 \
  --keypair ~/.config/solana/new-id.json --url devnet
solana program extend 3zGRWKZq4V3npHbH9Lati46BwgmstTjynWZFFMxarQgY 10240 \
  --keypair ~/.config/solana/new-id.json --url devnet
solana program extend CN92hAtnZxbMxPdho8tugi9GDK86UpGwmnbEvk5yzAWC 10240 \
  --keypair ~/.config/solana/new-id.json --url devnet

# 4. Deploy
anchor deploy --provider.cluster devnet \
  --provider.wallet ~/.config/solana/new-id.json \
  -p escrow
anchor deploy --provider.cluster devnet \
  --provider.wallet ~/.config/solana/new-id.json \
  -p nv-usdc-vault
anchor deploy --provider.cluster devnet \
  --provider.wallet ~/.config/solana/new-id.json \
  -p position-tracker

# 5. Copy IDLs to web app
cp target/idl/escrow.json app/web/app/idl/escrow.json
cp target/idl/nv_usdc_vault.json app/web/app/idl/nv_usdc_vault.json
cp target/idl/position_tracker.json app/web/app/idl/position_tracker.json

# 6. Run migrations (after escrow redeploy)
npx tsx scripts/migrate-escrow-account-v5-devnet.ts
npx tsx scripts/migrate-vault-config-omnipool-devnet.ts
npx tsx scripts/migrate-vault-config-utilization-devnet.ts
npx tsx scripts/migrate-user-state-clearing-cascade-devnet.ts
```

---

## Recovering SOL from stranded buffers

Failed deploys leave upload buffers open. Reclaim the SOL:

```bash
solana program show --buffers --keypair ~/.config/solana/new-id.json --url devnet
solana program close <BUFFER_ADDRESS> --keypair ~/.config/solana/new-id.json --url devnet
```

---

## RPC requirements

**Critical:** Use Alchemy devnet RPC, not `api.devnet.solana.com`, for the web app. The public endpoint does not support `signatureSubscribe`, which causes a false "stale oracle" error in the UI even when oracles are fresh.

```
NEXT_PUBLIC_SOLANA_RPC=https://solana-devnet.g.alchemy.com/v2/<YOUR_KEY>
```

---

## EscrowAccount space history

| Version | SPACE | New fields |
|---------|-------|-----------|
| V3 | 108 | Original |
| V4 | 116 | `sol_balance` (u64) |
| V5 (current) | 132 | `fee_index_snapshot` (u128) |

Migration: `migrate_escrow_account_v5` is permissionless (payer ≠ user). Script `scripts/migrate-escrow-account-v5-devnet.ts` handles both V3 and V4 accounts idempotently.

---

## Troubleshooting

### "Error: invalid program argument" on deploy

New binary exceeds allocated account space. Fix:

```bash
solana program extend <PROGRAM_ID> 10240 --keypair ~/.config/solana/new-id.json --url devnet
```

Then retry deploy.

### "Program's authority does not match authority provided"

Wrong keypair. Always pass `--provider.wallet ~/.config/solana/new-id.json` explicitly. The deployer is `pm2tUw22SDofzdfmyJv3jRDhLagwiqYRmCG2BWN23NA`, not the default `~/.config/solana/id.json`.

### "ConstraintSeeds" on escrow migration

The migration script passed `user: payer.publicKey` instead of the account owner extracted from raw bytes. The fix in V5: `MigrateEscrowAccountV5` uses `payer: Signer` (pays rent) + `user: UncheckedAccount` (PDA seed only, no signature required). Script reads owner from account bytes `[8..40]`.

### Oracle shows stale / "stale oracle" error

1. Check RPC — `api.devnet.solana.com` does not support `signatureSubscribe`. Switch to Alchemy.
2. If using Alchemy: oracle is genuinely stale — run the oracle refresh crank: `npx tsx scripts/refresh-oracle-devnet.ts`.
3. Switchboard feeds on devnet are sparsely maintained and can drift. Position-tracker falls back to Pyth-only consensus when Switchboard staleness guard triggers.

### "Simulation failed / AccountOwnedByWrongProgram" on vault deposit

Escrow was deployed after nv-usdc-vault and still expects the old vault program ID. Re-deploy escrow with the current vault ID in scope, or run `anchor deploy -p escrow`.

### "Account not found" on IDL operations

The on-chain IDL metadata account (`AJ6L6…`) is stale. The web app uses local `app/web/app/idl/*.json` files — not the on-chain IDL. Ignore this error unless debugging anchor CLI directly.

### write transactions failing in bulk (rate limiting)

Public devnet RPC rate-limits bulk writes. Add `await sleep(500)` between transactions in scripts, or switch to Alchemy.

---

## Permissionless cranks

No trusted operator is required. Anyone can run these:

| Crank | Script / instruction |
|-------|---------------------|
| Oracle mark push | `accrue_funding_if_due` on each open position |
| Lend idle USDC | `lend_idle_venue` via escrow auto-lend |
| Vault sweep to Omni-Pool | `sweep_to_pool` on nv-usdc-vault |
| Liquidation | `liquidate_permissionless` on position-tracker |
| Burn trigger | `trigger_burn` on burn-engine |
| Yield distribution | `distribute_yield` on yield-distributor |

---

## Environment variables (web app)

| Variable | Required | Default |
|----------|----------|---------|
| `NEXT_PUBLIC_SOLANA_RPC` | Yes | `https://api.devnet.solana.com` |
| `NEXT_PUBLIC_ESCROW_PROGRAM_ID` | No | hardcoded devnet ID |
| `NEXT_PUBLIC_POSITION_TRACKER_PROGRAM_ID` | No | hardcoded devnet ID |
| `NEXT_PUBLIC_NV_USDC_VAULT_PROGRAM_ID` | No | hardcoded devnet ID |
| `NEXT_PUBLIC_USDC_MINT` | No | hardcoded devnet mint |
| `NEXT_PUBLIC_BURN_VAULT_USDC` | No | burn-state USDC ATA |
| `NEXT_PUBLIC_IDLE_YIELD_APY_BPS` | No | `1200` (12% APY display) |

---

## Verifying a deployment

```bash
# 1. Check program deployed correctly
solana program show CTmCryJca9cFyMRaGdzrhyZeEnjdGLD8ZkEqNcNbvh2D --url devnet

# 2. Check vault config exists
solana account $(npx tsx -e "
  const { PublicKey } = require('@solana/web3.js');
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('nv-vault-config'), new PublicKey('Cx2bfKM7hcpnreSZxiDaN8q4Ca9i5ViCLxqRTs12JhS5').toBuffer()],
    new PublicKey('CN92hAtnZxbMxPdho8tugi9GDK86UpGwmnbEvk5yzAWC')
  );
  console.log(pda.toBase58());
") --url devnet

# 3. Test idle yield flow
#   a. Open a position to reserve margin
#   b. Wait for fee_index to tick (or call accrue_vault_yield)
#   c. Call claim_idle_yield — should CPI to vault and credit escrow
#   d. Verify escrow.usdc_balance increased and fee_index_snapshot updated

# 4. Test multi-asset collateral
#   a. Deposit SOL into CollateralPosition via deposit_collateral(SOL_MINT, amount)
#   b. Open a position — remaining_accounts should include [sol_oracle, sol_collateral_pos]
#   c. Verify position opens with sol collateral counted at 80% LTV

# 5. Test sub-account
#   a. create_sub_account(1, "test")
#   b. initialize_escrow_sub(1)
#   c. open_position_sub — verify separate UserState PDA from sub_id=0
```
