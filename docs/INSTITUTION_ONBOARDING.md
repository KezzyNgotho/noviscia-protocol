# Noviscia Institutional Desk Onboarding — Devnet Runbook

> **Status:** Live on devnet · **Last updated:** 2026-09-06
> **Target reader:** a quant/HFT desk (or an LP) that wants to test the institutional capacity
> engine for real. This is the operational step-by-step — for *why* each gate exists, see
> `PARTICIPANT_ACCESS.md` (borrower court), `TVV_FINANCIAL_ENGINEERING.md` (rental market),
> `MASTER_LOAN_AGREEMENT.md` (contract), and `KEY_MANAGEMENT_GOVERNANCE.md` (three-tier keys).
>
> **Honesty guard:** everything below is **devnet**. A governed multi-sig, finite mainnet
> liquidity, KYB on-ramp, API tokens, and desk whitelisting are still pending (see §12 the
> Honest Gate). Simulate-first at §4 before moving real test tokens.

---

## 1. Who this is for

| Flow | Who | Access | Path |
|---|---|---|---|
| **Borrowing desk** (HFT / MM) | machine-to-machine, sub-ms | low-latency SDK assembling atomic Jito bundles | §7–§11 |
| **Capital provider** (LP) | human, regulated, high-security | institutional web dashboard + enterprise custody | §8 (deposit) |

Institutions never interact through the retail UI. The engine is headless; the contracts are the
product surface. Everything here either signs a transaction against the on-chain programs or
packages one into a Jito bundle.

---

## 2. What is live today (verifiable on-chain)

| Entity | Address | On-chain state (2026-09-06) |
|---|---|---|
| `noviscia-capacity` host (asset_* + jit_risk + risk_* handlers) | `EDBr2VFWweFDzKR4cTT5j3TPGvPd9imoP8F76YK1o9oe` | owner `BPFLoaderUpgradeab1e…`, 892,416 B, upgrade-auth = deployer |
| wSOL `AssetPool` | `9v12r3KZbFpN6gdC3n482MkWEzYGwfGYjK1v7aCAPxdh` | supported, vault + fee-vault + LP-mint provisioned |
| wSOL pool vault / fee vault / LP mint | `Ftrna3TPy6C…` / `4sD4EeEz…` / `Bh5qnQCg…` | token, token, mint |
| USDC pool | derive `assetPoolPDA(USDC_MINT, pid)` | supported |
| NVSC pool | derive `assetPoolPDA(NVSC_MINT, pid)` | supported |
| Credit line `pm2tUw22SDofzdfmyJv3jRDhLagwiqYRmCG2BWN23NA` | `AifRX9brGfJmJpDcBDtpf4bbkNM65pCBYXHkrVAWPcw5` | `C_sys` = 6,000,000,000,000 raw; window OPEN |
| 24h floating window | — | opened 2026-09-06 at slot 494190470; breach ≈ slot 494424470 |

Mints: USDC `Cx2bfKM7hcpnreSZxiDaN8q4Ca9i5ViCLxqRTs12JhS5`, NVSC
`4BXiDT5o9J6aQdJNd36QE1L2YvQqedEKSP1wuQdSgJkg`, wSOL `So11111111111111111111111111111111111111112`.

Per-asset pricing (bps of principal, charged up-front, 90% of premiums accrue to LPs):

| Asset | Base rate | Premium cap | Dec. |
|---|---|---|---|
| USDC | 8 bps | 250 bps | 6 |
| wSOL | 12 bps | 300 bps | 9 |
| NVSC | 30 bps | 500 bps | 9 |

Window = **24h (216,000 slots) + 2h grace (18,000 slots)** at 400ms slots; banner
taught by `windowPosture(windowStartSlot, currentSlot)` in `sdk/src/assetEngine.ts:678`.

---

## 3. Prerequisites

- Node ≥ 18, `npx tsx`, the repo checkout (`sdk/` + `scripts/devnet/`), and/or
  `npm i @noviscia/sdk`.
- A funded devnet wallet (labels: **admin** = capacity-authority holder, **desk** = borrower).
  Devnet SOL faucets are rate-limited; budget ≥ 5 SOL for fees + top-ups.
- No wallet needed for §4/Sandbox — the simulated lifecycle runs fully off-network.

---

## 4. Step 0 — Simulate the full life-cycle first (no funds, 1,440×)

The sandbox stacks the *same* builders against a compressed clock, so posture progression
(Open → Overdue → Breached), premiums, and settlement are observable **before** any live token
moves:

```bash
# Tier-1: throwaway validator with pools + credit line provisioned
npx tsx scripts/sandbox/provision-local-ledger.ts --apply --up

# Accelerated harness: 24h window in 60s (1440×) — see docs/SANDBOX_HUB.md
npx tsx scripts/sandbox/e2e-sandbox-verification.ts
```

The compression math is pinned in `sdk/src/sandboxAccelerator.ts` and re-verified against the
live emulator (`services/sandbox-hub`). If a flow breaks here, do **not** try it on devnet.

---

## 5. Step 1 — Accredit as a participant

| Gate | On-chain? | Live today on devnet? |
|---|---|---|
| Master Loan Agreement / KYB review | No (off-chain, enforced by issuer) | Contract in `docs/MASTER_LOAN_AGREEMENT.md`; Sumsub KYB flow is **scaffolded** in the web app |
| Three-tier RBAC (breaker/committee/council) | Yes — `AssetRegistry` pins 3 keys | **Cold-start = single deployer key** `pm2tUw22…`; Squads split is a mainnet target |
| Desk registration (`register_mm` whitelist) | Yes (jit_risk registry) | Devnet = test desks via scripts; no production whitelist process |
| Merkle KYC proof | Yes — `credit_line.kyc_merkle_root` | **Root unset → proof is skipped** (see §9) |

If your desk needs its own identity (not the deployer), generate a keypair and provision it
(§7.2) — do not piggyback the cold-start deployer for anything you care about.

---

## 6. Step 2 — Environment

```bash
export SOLANA_RPC_DEVNET="${SOLANA_RPC_DEVNET:-https://api.devnet.solana.com}"
# capacity authority / Treasury signer (cold-start = deployer)
export ANCHOR_WALLET="$HOME/.config/solana/new-id.json"

# Optional: a distinct desk borrower identity
# export AE_INSTITUTION_KEYPAIR_PATH="$HOME/.config/solana/desk-id.json"
```

Verify the host is the ID you think it is:

```bash
solana program show EDBr2VFWweFDzKR4cTT5j3TPGvPd9imoP8F76YK1o9oe --url "$SOLANA_RPC_DEVNET"
solana balance "$SOLANA_RPC_DEVNET"   # admin + desk both need lamports for fees
```

---

## 7. Step 3 — Provision your desk credit line

### 7.1 Cold-start (the live one, institution == deployer)

Already provisioned on devnet. Read it back:

```bash
solana account AifRX9brGfJmJpDcBDtpf4bbkNM65pCBYXHkrVAWPcw5 --url "$SOLANA_RPC_DEVNET"
# total_credit_limit (LE u64 @72) = 6,000,000,000,000 → C_sys $6,000,000 @ 6-dec
```

### 7.2 A distinct desk identity

The capwiring script is **idempotent** — a re-run only fills gaps:

```bash
export AE_INSTITUTION_KEYPAIR_PATH="$HOME/.config/solana/desk-id.json"
npx tsx scripts/e2e/e2e-asset-engine-capwire-devnet.ts            # plan, sends nothing
npx tsx scripts/e2e/e2e-asset-engine-capwire-devnet.ts --apply      # provision credit line
```

This mints the desk's own `credit-line` PDA, sets `total_credit_limit` = prescribed C_sys, and
verifies registry/pool caps on-chain.

---

## 8. Step 4 — Deposit liquidity (LP flow)

LPs fund a pool's vault under an ERC-4626 share ledger. Reference flow (per-mint) is in
`scripts/devnet/open-capacity-window-devnet.ts` — the deposit half:

```ts
import { Connection, Keypair, Transaction } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { buildDepositAssetLiquidityIx, assetPoolPDA } from '@noviscia/sdk';

const conn  = new Connection(process.env.SOLANA_RPC_DEVNET!);
const lp    = Keypair.fromSecretKey(/* your LP key */);
const WSOL  = new PublicKey('So11111111111111111111111111111111111111112');
const pool  = assetPoolPDA(WSOL, PROGRAM_ID);

const wsolAta = await getAssociatedTokenAddress(WSOL, lp.publicKey);
const lpAta   = await getAssociatedTokenAddress(pool.lp_mint, lp.publicKey);

// wrap native SOL → wsolAta first (SystemProgram.transfer + syncNative), then:
const ix = buildDepositAssetLiquidityIx(PROGRAM_ID, WSOL, lp.publicKey, wsolAta, lpAta, amount);
const tx = new Transaction().add(ix);  // sign+send with lp keypair
```

The resulting shares mint to your `providerLpTokenAccount`; share price auto-compounds as
premiums settle (see `computeLpSharePrice`).

---

## 9. Step 5 — Allocate (borrow) + open the 24h window

The desk draws asset out of the pool vault into its own token account. The **first** allocation
on a credit line flips `window_start_slot = current_slot` — that is exactly how the 24h floating
window opened on 2026-09-06 (slot 494190470).

```ts
import { windowPosture, computePremium, buildAllocateAssetCapacityIx,
         creditLinePDA, deskPositionPDA, assetPoolPDA } from '@noviscia/sdk';

const desk  = Keypair.fromSecretKey(/* desk signer */);
const pid   = new PublicKey(EDBr2_TEST_PROGRAM_ID);      // EDBr2VFW…
const pool  = assetPoolPDA(WSOL, pid);
const cl    = creditLinePDA(desk.publicKey, pid);
const pos   = deskPositionPDA(desk.publicKey, WSOL, pid);

// premium = principal × 12bps (wSOL), floored at min
const premium = computePremium(amount, 12, 0n);
// target_slot must be ≥ the execution slot — program only checks the ordering
const currentSlot = await conn.getSlot('confirmed');

const ix = buildAllocateAssetCapacityIx(pid, {
  mint: WSOL,
  institution: desk.publicKey,      // the credit-line holder
  trader: desk.publicKey,           // signer
  traderTokenAccount: deskWsolAta,
  requestedAmount: amount,
  targetSlot: BigInt(currentSlot + 1000),
  expectedPremium: premium,
  expiry: BigInt(Math.floor(Date.now()/1000)) + 3600n,
  merkleProof: [],                   // [] — KYC root unset on-chain; proof skipped
});
```

Rules to respect (or reversion errors):

- **Window timing is the credit contract.** Open = 24h, Overdue = +2h grace (late-fee meter runs
  `computeLateFee`), Breached = frozen. `asset_allocate_capacity` rejects while frozen.
- `targetSlot` is a monotonic check only — pass `currentSlot + N`, don't try to schedule.
- Allocation is subject to pool idle ≥ request and `max_capacity` ceilings.

---

## 10. Step 6 — Verify the round trip

The reference script prints the on-chain readback:

```bash
npx tsx scripts/devnet/open-capacity-window-devnet.ts
```

or verify manually:

```ts
const info = await conn.getAccountInfo(creditLinePDA(desk.publicKey, pid));
// decode: total@72, active@80, window_start_slot@120, premiums@136, frozen@152 (LE u64/u8)
const posture = windowPosture(BigInt(cl.window_start_slot), BigInt(await conn.getSlot()));
console.log(position.pool active, cl.active_utilization, posture);
```

Example from the live window (2026-09-06): allocate 200,000,000 wSOL → premium 240,000
(= 0.2 × 12/10,000), pool `idle` dropped to 7,300,000,000, `credit_line.active` = 200,000,000,
`WindowPosture=Open`.

---

## 11. Step 7 — Pay it down / settle a window

- **Release unused slot capital** on the same day:

```ts
const ix = buildRecreditAssetCapacityIx(pid, WSOL, desk.publicKey, desk.publicKey,
                                        deskWsolAta, 80_000_000n); // return unused wSOL
```

- **24h settlement** — principal + premium (+ late fee if grace breached) in the *exact
  borrowed asset*, via `buildSettleDailyIx` (treasury signs; premium splits 90/10 LP/protocol
  into the pool's fee vault). After settlement the window can be re-opened by a fresh allocation.

Late-fee meter works on elapsed blocks past maturity; see §12 of `TVV_FINANCIAL_ENGINEERING.md`
for the breached-window consequences (frozen draws, outstanding-desk flag).

---

## 12. Step 8 — Headless / Jito bundle integration (the real flow)

A desk's production posture is `PARTICIPANT_ACCESS.md` §1: local SDK → atomic single-slot
bundle → Jito Block Engine.

```ts
import { JitoBundleClient, assembleVersionedTransactions } from '@noviscia/sdk'; // sdk/src/jito.ts
import { buildCreditBundle } from '@noviscia/sdk';                               // sdk/src/creditLine.ts
```

- `assembleVersionedTransactions` puts the fee tip on the **first** txn so the tip is paid only
  if the allocation assertions pass (no tip burn on reversion).
- `buildCreditBundle` splices `[allocate …]` with the desk's own trade into one bundle head.
- Tip accounts rotate per send; `getTipAccounts`/`getBundleStatuses` are client methods.

Devnet has **no block engine** (decommissioned — NXDOMAIN), so landing-rate measurement needs
mainnet. On devnet you can still build + dry-run the bundle against the emulator
(`services/sandbox-hub`, gRPC `:10000`).

---

## 13. Step 9 — Monitor the window

The observer proves the deterministic freeze on-chain (no clock-warp on public devnet):

```bash
npx tsx scripts/devnet/observe-capacity-window-devnet.ts
# writes devnet-window-observation.json; exit 0=Open / 2=Overdue / 3=Breached
```

Schedule it for ~24h/26h after `window_start_slot` (see `docs/DEVNET.md`, "Asset engine
cap-wiring" for the live numbers) if you hold a drawn window.

---

## 14. The Honest Gate — what a real institution still cannot do on devnet

| Need | Status | Blocker |
|---|---|---|
| Mainnet liquidity + real yield | Devnet only | mainnet TGE/governance Q1 2027; Jito landing untested on mainnet |
| Three-tier governed multisig | Cold-start single key | Squads ceremony is mainnet scope (`KEY_MANAGEMENT_GOVERNANCE.md` §3) |
| Sumsub/KYB on-ramp + Merkle proof | Scaffolded; root unset on-chain | KYB integration wiring |
| Desk whitelist / `register_mm` admission | Test desks only | operations process |
| API tokens (`X-Noviscia-App-Token`) | Issuance + authz wiring live | Scoped reads enforced on the indexer; per-desk/admission-derived providers are production scope (`/developer/api-tokens`) |
| C++ SDK crate | Roadmap | — |

Everything in §4–§13 is the **developer-grade** path that works on devnet today. Treat devnet
results as engineering evidence, not deployment-readiness.

---

## Reference

- Program ID / mints / PDA seeds: `sdk/src/ids.ts`, `sdk/src/assetEngine.ts` (§20–§185)
- Builder signatures: `sdk/src/assetEngine.ts` — `buildAllocateAssetCapacityIx` (437),
  `buildRecreditAssetCapacityIx` (480), `buildSettleDailyIx` (533), `buildDepositAssetLiquidityIx`
  (567), `buildWithdrawAssetLiquidityIx` (599), `buildWithdrawAssetFeesIx` (630)
- Worked script: `scripts/devnet/open-capacity-window-devnet.ts` (deposit + allocate + verify)
- Provisioning: `scripts/e2e/e2e-asset-engine-capwire-devnet.ts` (idempotent; set
  `AE_INSTITUTION_KEYPAIR_PATH` for a distinct desk)
- Contracts: `MASTER_LOAN_AGREEMENT.md` · `PARTICIPANT_ACCESS.md` · `TVV_FINANCIAL_ENGINEERING.md`
- Keys/ops: `KEY_MANAGEMENT_GOVERNANCE.md` · `THREAT_MODEL.md` · `ONCALL_RUNBOOK.md`