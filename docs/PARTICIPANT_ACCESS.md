# Noviscia Participant Access — Borrowers vs Capital Providers

> **Version 1.0** — institutional-access contract. How each participant class actually
> reaches and drives the Total Value Velocity (TVV) engine.

Institutions never interact with Noviscia through a web browser or a standard dApp UI. The
system is a **headless, infrastructure-level API and software pipeline**. There are exactly two
participant flows, deliberately asymmetric:

- **Institutional Borrowing Desks (HFTs / Market Makers)** — machine-to-machine, sub-millisecond,
  via a low-latency SDK compiling atomic bundles.
- **Capital Providers (Liquidity Providers)** — human-owned, regulated, high-security, via the
  institutional web dashboard and enterprise custody.

Both flows converge on the same on-chain pools and the same smart contracts; only the access
mechanism differs.

---

## 1. The Institutional Borrower Access Flow (HFTs & Market Makers)

Borrowers do not borrow "on-chain" with a hot wallet. Their trading black-box embeds a Noviscia
SDK that speaks to the off-chain engine, which packages intents into atomic single-slot bundles
and routes them to the Jito Block Engine.

```
 [ HFT Automated Trading Bot ]
              │
              ▼ (Step 1: Spot → Noviscia Local SDK)
┌──────────────────────────────────────────────┐
│        Noviscia Local SDK Client             │
│  · houses the pre-computed Merkle KYC proof  │
│  · holds the persistent gRPC (Yellowstone)   │
│    low-latency feed connection               │
└──────────────────────┬───────────────────────┘
                       │
                       ▼ (Step 2: Sub-ms local validation)
┌──────────────────────────────────────────────┐
│        Noviscia Low-Latency Engine           │
│  · verifies credit limits in RAM cache       │
│  · assembles the atomic Jito bundle package  │
└──────────────────────┬───────────────────────┘
                       │
                       ▼ (Step 3: Direct validator routing)
┌──────────────────────────────────────────────┐
│      Jito Block Engine / Validator Core      │
│  [Tx A: allocate capacity + micro-premium]   │
│  [Tx B: desk's private arbitrage trade]      │
└──────────────────────────────────────────────┘
```

### Borrower lifecycle (step-by-step)

1. **Infrastructure setup.** During corporate onboarding the desk embeds the Noviscia SDK crate
   directly into its core algorithmic trading black-box. The SDK keeps a dedicated, persistent
   gRPC connection (Yellowstone *Dragon's Mouth*) to a co-located bare-metal RPC node, streaming
   live pool metrics in under 2 milliseconds.

2. **Opportunity spike.** The HFT bot detects a spatial arbitrage opportunity on a Solana
   order-book venue and needs, e.g., **$5,000,000 USDC instantly** to execute.

3. **SDK handshake.** Instead of waiting for a blockchain confirmation, the bot calls the local
   SDK function. The SDK automatically appends the desk's Sumsub/SAS Merkle KYC proof and passes
   the allocation request to the Noviscia engine.

4. **Atomic packaging.** The engine confirms the desk's credit ceiling in local RAM and assembles
   the bundle: **Transaction A** (the engine call that allocates the 5M USDC and records the
   micro-premium) is placed directly ahead of **Transaction B** (the desk's private arbitrage
   trade) — same block, same slot, atomic.

5. **Block execution.** The compiled bundle is sent to the validator. The trade completes inside
   the 400ms block window, risk dissolves at block close, and capital returns to the pool's idle
   base. The borrower never manually holds or manages the loan; execution is automated via code
   constraints.

### What exists in the repo today

| Pipeline stage | Implementation |
|---|---|
| Local SDK client | `@noviscia/sdk` (TS) and the Rust SDK crates (`noviscia-credit-line`, `noviscia-asset-engine-sdk`); KYC-proof plumbing via the Merkle-root builders |
| Persistent gRPC / Yellowstone feed | `services/grpc-pipeline/src/yellowstone_subscriber.rs` — Geyser gRPC subscription over Noviscia program IDs with reconnect/backoff |
| Atomic bundle assembly | `sdk/src/creditLine.ts` → `buildCreditBundle` (single-block `[pull, repay]` with venue swaps spliced in); Rust reference: `sdk/rust/noviscia-credit-line/examples/single_block_arb_bundle.rs` |
| On-chain execution | `noviscia-asset-engine` (`allocate_asset_capacity` → `settle_daily`) and `noviscia-credit-line` |
| Jito tip submission / lander | **go-live wiring**: bundle *assembly* is implemented; tip-payer routing into the Jito Block Engine is the remaining integration (see gap analysis) |

---

## 2. The Liquidity Provider Access Flow (Capital Providers)

LPs operate on a macro timeline (depositing for weeks or months to compound organic yield) and
follow a traditional, high-security institutional onboarding path.

```
 [ Enterprise Fund / LP ]
        │
        ▼ onboards via web dashboard
        ▼ passes Sumsub corporate KYB
┌──────────────────────────────────────────────┐
│     Noviscia Institutional Web Dashboard     │
│  · enterprise custody wallet connect         │
│    (Fireblocks / Anchorage)                  │
│  · embedded Sumsub corporate KYB             │
└──────────────────────┬───────────────────────┘
                       │ (off-chain relayer)
                       ▼ SAS cryptographic stamp on-chain
┌──────────────────────────────────────────────┐
│       Noviscia Smart Contract                │
│  · allocates to SOL / USDC / NVSC vault      │
│  · mints internal vault shares               │
│    (nUSDC / nSOL / nNVSC)                    │
└──────────────────────┬───────────────────────┘
                       ▼
        Passively compounding yield (micro-premiums
        flow into the vault; no manual re-staking)
```

### LP lifecycle (step-by-step)

1. **Compliance gateway.** The fund visits the institutional web dashboard
   (`/liquidity-hub`, `/institutional/*`) and connects an enterprise custody wallet (Fireblocks,
   Anchorage), completing corporate compliance through the embedded Sumsub interface.

2. **On-chain attestation.** Once approved, an off-chain relayer writes a permanent cryptographic
   stamp on the Solana Attestation Service (SAS) bound to the fund's corporate wallet address —
   enforced provider-agnostically by the `noviscia-permissioned-pool` KYC/AML ring.

3. **Vault deposit.** The LP transfers assets into the pool's primary SOL, USDC, or NVSC vault.
   `noviscia-asset-engine`'s `deposit_asset_liquidity` receives the tokens.

4. **Accounting share minting.** The Anchor contract reads the SAS stamp to verify compliance,
   receives the tokens, and mints the internal vault shares (**nUSDC**, **nSOL**, **nNVSC**)
   representing the fund's ownership stake in the pool (ERC-4626 share ledger).

5. **Passive yield accrual.** Capital sits in the vault. As desks draw single-slot capacity and
   settle during the 24h clearing window, the collected micro-premiums are split to the LPs
   (`lp_yield_split_bps = 9,000` → vault NAV), automatically compounding the nToken price
   without manual re-staking.

### What exists in the repo today

| Pipeline stage | Implementation |
|---|---|
| Institutional web dashboard | `app/web/app/institutional/*`, `app/web/app/liquidity-hub/*` (asset-lifecycle, LP of the vault band) |
| Enterprise custody connect | Wallet-standard + institutional custody wiring in `app/web` providers |
| Sumsub corporate KYB | Compliance-flow references in `app/web/app/institutional/asset-lifecycle/page.tsx`; KYB is an off-chain gate whose proof enters via Merkle roots |
| Provider-agnostic KYC/AML ring (de-KYC) | `programs/active/noviscia-permissioned-pool` |
| SAS attestation stamp | Off-chain relayer writing an on-chain attestation pointer (relayer wiring in `services/`; stamp consumption in `noviscia-permissioned-pool`) |
| Deposit → share mint | `noviscia-asset-engine` `deposit_asset_liquidity` → ERC-4626 `asset_lp_mint`/`asset_lp_position` |
| Auto-compounding | `lp_yield_split_bps` premium split (Part 2 LP vaults) |

---

## 3. Scannable Access Overview

| User classification | Primary technical interface | Execution trigger method | Critical latency threshold |
|---|---|---|---|
| HFT / Market Maker | Low-latency Rust/C++ SDK crate (`@noviscia/sdk`, `noviscia-*-sdk` crates) | Automated algorithmic API calls (Jito bundles) | **Hyper-critical (<2ms)** |
| Liquidity Provider | Regulated institutional web UI (`/liquidity-hub`, `/institutional/*`) | Manual, high-security multi-sig transfers (Fireblocks / Anchorage) | Asynchronous (minutes/hours) |

---

*The borrower path maximizes machine velocity; the LP path maximizes custody assurance. Both are
enforced by the same on-chain pools and governed by the Master Loan Agreement for desks.*