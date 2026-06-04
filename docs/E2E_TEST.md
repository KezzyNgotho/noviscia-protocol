# End-to-end testing (devnet)

## UI flow (wallet connected)

Run `cd app/web && npm run dev`, then walk the product flow bar:

| # | Route | What to verify |
|---|--------|----------------|
| 1 | `/earn/vault` | NAV loads · deposit/mint NVSCUSDC · charts update |
| 2 | `/earn/loans` | Live cards open vault / margin / perps |
| 3 | `/earn/vault?tab=margin` | Init escrow · deposit USDC · auto-lend ON |
| 4 | `/trade/perps` | Collateral · small SOL-PERP long · position opens |
| 5 | `/manage/positions` | Open row matches perps |
| 6 | `/trade/perps` | Close position · margin returns |
| 7 | `/earn/stake` | Stake panel · governance loads |
| 8 | `/earn/rewards` | Metrics · claim yield (if vault funded) |

**Removed from perps (not required):** local LLM parse, AI copilot, session agent panel.

## On-chain automation

```bash
cd noviscia-protocal
./scripts/sync-idls.sh          # after anchor build
npm run init:devnet-rewire      # venues + oracle + reservoirs
npm run verify:e2e              # runs phase1–5 + prints UI checklist
```

Keeper (lend, oracle, NAV):

```bash
npm run keeper:dev
```

## If verify scripts fail with `offset is out of range` on escrow

On-chain **escrow PDA** was created with an older program layout. IDL expects the current `EscrowAccount` size.

**Fix (pick one):**

1. **New devnet wallet** — connect a fresh keypair in the app so a new escrow is initialized.
2. **Redeploy + re-init** — `anchor deploy --provider.cluster devnet`, then `npm run init:devnet-rewire`.
3. **Phase 1 skip** — use `verify:phase5` and `verify:phase2` only after escrow is recreated; legacy `verify:phase1` hits the old single `pool` PDA.

## Quick commands

```bash
npm run verify:phase2   # perps open/close
npm run verify:phase5   # multi-venue lend + recall
VERIFY_SKIP_ONCHAIN=1 npm run verify:e2e   # UI checklist only
```
