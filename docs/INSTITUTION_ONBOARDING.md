# Noviscia Institutional Desk Onboarding — Devnet Runbook

> **Status:** Live on devnet · **Last updated:** 2026-09-07
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
| Desk registration (`register_mm` whitelist) | Yes (jit_risk registry) | Admission runbook + ceiling cap gate (§15) — devnet test desks via `scripts/devnet/register-mm-admission-devnet.ts` |
| Merkle KYC proof | Yes — `credit_line.kyc_merkle_root` | **Live + enforced** — root committed, allocation verifies the keccak sorted-pair proof; invalid proof rejected (`KycProofInvalid`). Runbook §15.6 |

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
         creditLinePDA, deskPositionPDA, assetPoolPDA,
         assetComputeKycHash, assetBuildKycMerkleTree, assetVerifyKycProof } from '@noviscia/sdk';

const desk  = Keypair.fromSecretKey(/* desk signer */);
const pid   = new PublicKey(EDBr2_TEST_PROGRAM_ID);      // EDBr2VFW…
const pool  = assetPoolPDA(WSOL, pid);
const cl    = creditLinePDA(desk.publicKey, pid);
const pos   = deskPositionPDA(desk.publicKey, WSOL, pid);

// premium = principal × 12bps (wSOL), floored at min
const premium = computePremium(amount, 12, 0n);
// target_slot must be ≥ the execution slot — program only checks the ordering
const currentSlot = await conn.getSlot('confirmed');

// credit-line KYC leaf = keccak256(institution ‖ expiry) (no tier — differs from
// the capacity host's operator‖tier‖expiry leaf). Build a tree, post its root with
// asset_set_kyc_root (Risk Committee), then prove a member leaf at allocate time.
const leaves = [bigintExpiry1, bigintExpiry2].map((e) =>
  assetComputeKycHash(desk.publicKey, e));
const { root, proofForIndex } = assetBuildKycMerkleTree(leaves);
// ... asset_set_kyc_root(root) signed by the Risk Committee ...
const proof = proofForIndex(0).map((node) => new Uint8Array(node));
assert(assetVerifyKycProof(leaves[0], proof, root));

const ix = buildAllocateAssetCapacityIx(pid, {
  mint: WSOL,
  institution: desk.publicKey,      // the credit-line holder
  trader: desk.publicKey,           // signer
  traderTokenAccount: deskWsolAta,
  requestedAmount: amount,
  targetSlot: BigInt(currentSlot + 1000),
  expectedPremium: premium,
  expiry: bigintExpiry1,            // must match the leaf you prove
  merkleProof: proof,               // sorted-pair path to the committed root
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
| Sumsub/KYB on-ramp + Merkle proof | **Live + enforced**: `credit_line.kyc_merkle_root` posted on-chain (keccak sorted-pair tree), allocation verifies the proof → invalid proof rejected (`KycProofInvalid`) on EDBr devnet, runbook §15.6 | Sumsub UI/kid-the-key material is production scope; leaf schema is provider-agnostic (`keccak256(institution ‖ expiry)`) |
| Desk whitelist / `register_mm` admission | Admission runbook + ceiling cap gate; `suspend_mm`/`activate_mm` live (deployed to `3w9Gr`, §15) | Per-desk KYB attestation (signing authority) is a committee/off-chain step; no trustless link from the credit line's `kyc_merkle_root` to a desk yet (honest note below) |
| API tokens (`X-Noviscia-App-Token`) | Issuance + authz wiring live | Scoped reads enforced on the indexer; per-desk/admission-derived providers are production scope (`/developer/api`) |
| C++ SDK crate | **Live (byte parity)**: `sdk/cpp/` full twin of the npm + Rust SDKs — 30/30 builders byte-verified against the **Rust** twin (account order + signer/writable flags + borsh payload): capacity `initialize`…`withdraw_treasury` and asset-engine `asset_initialize`…`asset_withdraw_fees`; LP PDAs, ed25519 off-curve checks, keccak Merkle leaves, U128 math — see `sdk/cpp/README.md` § Parity notes (incl. two known npm-twin divergences) | mainnet scope |

Everything in §4–§13 is the **developer-grade** path that works on devnet today. Treat devnet
results as engineering evidence, not deployment-readiness.

---

## 15. Desk Admission & Lifecycle (ops process)

`register_mm` is the single on-chain whitelist gate into the Jit-Risk marketplace. A desk cannot
buy, rent, reserve, or settle any capacity without an entry in `MmRegistration` (status ACTIVE).
This section pins the *operating procedure* around that gate — who may be admitted, at what
ceiling, and how a desk moves between ACTIVE and SUSPENDED.

### 15.1 Admission gates

A desk is admitted only when **all** of these hold, in order:

1. **KYB attestation** — desk principal passed review (Sumsub/alternate acceptable attester; §14).
   On-chain this is a *precedent committed by the signing authority*, not an automated check —
   see the honest note in §15.5.
2. **Committee / risk sign-off** — the marketplace authority signs `risk_register_mm`; the
   authority key is the same one the desk keys to in [`MASTER_LOAN_AGREEMENT.md`](MASTER_LOAN_AGREEMENT.md).
3. **Ceiling within `C_desk`** — requested ceiling ≤ **$1,500,000** (single-desk cap from
   [`QUANTIFIED_RISK_PACK.md`](QUANTIFIED_RISK_PACK.md) §desk_cap_bps = 1_500 bps). Enforced
   **on-chain** (`validate_mm_ceiling` → `JitRiskError::CreditCeilingTooHigh`) and mirrored
   client-side so a bad ceiling never reaches a submit.
4. **Liquidity headroom** — ceiling ≤ writable base × ψ, i.e. ≤
   `(pool vault balance − safety floor F) × writable_bps / 10_000`. This pool-liquidity
   concentration guard is enforced by the admission runbook (pool liquidity changes with the
   vault, so it cannot be a static constant) and re-checked before every admission.

### 15.2 Ceiling sizing

- Default / demo desk: **$20,000** (as `e2e-jit-risk-devnet.ts`).
- Standard institutional desk: up to **$500,000** — the max slice default, without concentration.
- Ceiling above $500k requires committee sign-off in the admission ticket; **$1.5M is the hard
  cap** and needs the strongest review (desk collateral, volume track record, fresh KYB).

### 15.3 Lifecycle

| State | Entered by | Blocks |
|---|---|---|
| ACTIVE (status 1) | `register_mm` | — |
| SUSPENDED (status 2) | `suspend_mm` (authority) | new slices refused on-chain (`MmNotActive`/`MmSuspended`) |
| ACTIVE (status 1) | `activate_mm` (authority) | — |

Suspension is immediate and on-chain: the text starting *before* the suspension keeps its
in-flight status and settles normally — only *new* capacity is barred. Reactivation restores the
desk; both transitions are authority-only and auditable via `MmRegistered` / `MmSuspended` /
`MmActive` events.

### 15.4 Runbook

```bash
# Admit a desk at the default $20k ceiling — uses the persisted runbook desk
# (scripts/devnet/.runbook-desk.json), funded once, reused on every run
npx tsx scripts/devnet/register-mm-admission-devnet.ts

# Admit a specific desk at a specific ceiling (liquidity-headroom checked live)
npx tsx scripts/devnet/register-mm-admission-devnet.ts --desk=<desk-pubkey> --ceiling=120000

# Include the suspend → capacity-refused probe + full lifecycle, ending ACTIVE
npx tsx scripts/devnet/register-mm-admission-devnet.ts --with-activate
```

Notes
- The admin signer must be the marketplace authority (`~/.config/solana/new-id.json`).
- `--with-activate` is **live** (no longer post-breach gated): `activate_mm` was deployed to
  `3w9Gr` together with the on-chain ceiling cap. Every run closes with the desk ACTIVE.
- The refusal probe signs with the desk keypair (as in `e2e-jit-risk-devnet.ts`); for a
  `--desk` whose secret is unknown it is skipped with the suspension itself proven on-chain.
- **Layout change note:** the marketplace upgrade that deployed `activate_mm` + the ceiling cap
  also extended `MmRegistration` (the consolidation-era layout, 107 B). The pre-upgrade deskA /
  deskB accounts (90 B, from the e2e registry `scripts/e2e/.desks.json`) are **orphaned** on
  3w9Gr — they predate the new layout and are no longer decodable by the program. Use a fresh or
  persisted runbook desk for new admissions; `deskB` remains useful only as the USDC funder.

### 15.5 Honest note

Two distinct registries exist today: the credit-line's **desks** (`AssetRegistry`) and the
marketplace's **MMs** (`MmRegistration`). They are operated by the same authority but are **not
linked on-chain** — nothing yet proves that an active `MmRegistration` corresponds to a
KYB-cleared credit-line desk.

What **is** live on EDBr devnet today: every credit line carries a `kyc_merkle_root`, and
`asset_allocate_capacity` rejects a non-validating proof (`KycProofInvalid`) once that root is
committed by the Risk Committee — proven end-to-end by the §15.6 runbook. The remaining gap is
the *link*, not the *mechanism*: pinning `kyc_merkle_root` to the `mm` key (a registry-consistency
check or a proof in `register_mm`) is a follow-up. Until then, treat desk admission as enforced
by policy at the authority step, with on-chain program-level gates (status + ceiling + suspension
+ Merkle KYC) proven as engineered.

### 15.6 Credit-line KYC runbook

Proves provider-agnostic Merkle KYC live on the EDBr host (workstream #3):

```bash
# Default: reuse the persisted institution (scripts/devnet/.runbook-kyc-inst.json)
npx tsx scripts/devnet/set-credit-line-kyc-devnet.ts

# Rotate to a brand-new institution (fresh credit line, zero KYC root)
npx tsx scripts/devnet/set-credit-line-kyc-devnet.ts --fresh
```

What it asserts, on-chain, in order:

1. **A. Root unset → proof skipped** — an allocation with a bogus/empty proof *succeeds* while
   `credit_line.kyc_merkle_root == 0` (the documented §14 gap, demonstrated live). This is a
   **real borrow** (0.2 wSOL stays on the desk), so later phases account for it.
2. **B. Root committed** — Risk Committee (`~/.config/solana/new-id.json`) posts the rooted tree
   built from `assetComputeKycHash(institution, expiry)`; read-back asserts
   `credit_line.kyc_merkle_root == root`.
3. **C. Same bogus proof rejected** — the identical allocate now fails with `KycProofInvalid`.
4. **D. Valid proof passes** — a member-leaf proof for the same institution+expiry succeeds and
   opens the 24h floating window.
5. **E. Root rotation revokes** — the committee posts a rotated root without a previously-valid
   leaf; that old leaf's proof now fails on-chain (observed `{"Custom":6018}` = `KycProofInvalid`).

Leaf schema honesty note: the asset-engine leaf is `keccak256(institution ‖ expiry_BE)` — **no
tier byte** — which deliberately differs from the capacity host's `keccak256(operator ‖ tier ‖
expiry)`. The expiry is *committed into the leaf*, so expiration is enforced by root rotation
(revoking a stale leaf), not by an on-chain wall-clock check.

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
- C++ twin + parity notes: `sdk/cpp/README.md` (30/30 byte-parity vs Rust twin; known npm divergences)
