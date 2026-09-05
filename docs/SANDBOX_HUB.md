# Noviscia Institutional Sandbox Hub

> **Purpose:** The three-tier local sandbox where the institutional capacity engine, the
> accelerated clearing window, and the Jito bundle path can be exercised byte-for-byte against
> real program binaries and the production gRPC schema, without ever touching devnet fees, MEV
> land mines, or mainnet keys.
>
> **Status:** Live (Module 3) · **Last updated:** September 2026

---

## 1. Why a sandbox

The production stack (see `ARCHITECTURE.md`, `SLO_OBSERVABILITY.md` and `DELIVERY-2/2026-Q3.md`
backlog) consumes three expensive, nondeterministic resources:

1. **A live Solana validator** for the asset-engine state machine (`5qpoh…ZrMKb`),
2. **A Yellowstone Geyser stream** + Redis for the 400ms account snapshot pipeline,
3. **The real Jito block engine** for atomic premium+trade bundles.

None of those are appropriate for an institutional demo or a CI regression run. The Sandbox Hub
replaces each with a deterministic, local, free counterpart while keeping the **same gRPC
contract**, the **same on-chain program**, and the **same 4-test institutional verification
checklist**.

### The 1,440× clock

The on-chain clearing window is measured in **real slots**:

| Constant | Real slots | Meaning |
|---|---|---|
| `WINDOW_SLOTS` | 216,000 | one Solana day — the desk's clearing window |
| `GRACE_SLOTS` | 18,000 | grace before a position is deemed breached |

The sandbox projects the slot domain at **1,440×** (86,400 s → 60 s):

| Sandbox constant | Sandbox slots | Wall-clock @ 400ms |
|---|---|---|
| `WINDOW_SANDBOX_SLOTS` | 150 | 60 s |
| `GRACE_SANDBOX_SLOTS` | 12.5 | 5 s |

Breach is therefore deterministic: `windowStart + 150 + 12.5` sandbox slots — a full lifecycle
that takes a real day becomes a 65-second institutional demo.

---

## 2. The three tiers

### Tier 1 — Local ledger

`scripts/sandbox/provision-local-ledger.ts` bootstraps an isolated `solana-test-validator`
(word: **LEDGER**) and:

- mounts the **committed** asset-engine program keypair at the canonical
  `5qpoh…ZrMKb` (the same program you deploy / verify against devnet),
- **mints fresh local USDC (6dp) + NVSC (9dp)** (wSOL = native) and funds the operator
  with 10,000,000 USDC + 10,000,000 NVSC,
- then **reuses the cap-wire instruction sequence** (`e2e-asset-engine-capwire-devnet.ts`)
  against `http://127.0.0.1:8899`: `initialize` (three-tier = operator cold start) →
  `register_asset` × 3 → `set_asset_support` × 3 → `initialize_credit_line` (C_sys = $6,000,000)
  → `update_credit_limit` → `update_asset_params` (per-asset C_desk = $1,500,000).

```bash
npx tsx scripts/sandbox/provision-local-ledger.ts           # validator up, nothing sent
npx tsx scripts/sandbox/provision-local-ledger.ts --apply   # create mints + provision
npx tsx scripts/sandbox/provision-local-ledger.ts --up      # keep the validator running (Ctrl-C to stop)
```

Requires `solana-test-validator`, `solana`, `spl-token` on PATH (the solana active-release
install) and `target/deploy/noviscia_asset_engine.so` + its keypair.

### Tier 2 — Mock gRPC stream

`services/sandbox-hub` (Rust, tonic) serves the **production schema**
(`grpc-pipeline/proto/noviscia.proto` — no sandbox-only fields) on
`127.0.0.1:50151`:

- a virtual **slot clock** advances every `SANDBOX_SLOT_MS` (default 400ms),
- an in-memory desk ledger re-derives **deterministic postures**
  (`windowPosture`, mirroring `noviscia-asset-engine` lib.rs) per slot,
- `StreamEvents` pushes `EventEnvelope`s exactly like the real pipeline,
- `GetCapacityStatus` / `GetDeskStatus` / `GetPoolState` / `GetTrancheState` materialize
  the state the Tier-1 ledger *would* hold.

```bash
cd services/sandbox-hub
SANDBOX_GRPC_PORT=50151 SANDBOX_SLOT_MS=400 cargo run --release --bin sandbox-hub
```

### Tier 3 — Jito bundle emulator

The same binary serves a **JSON-RPC-compatible** replica of the Jito block engine on
`127.0.0.1:8898` (`sendBundle` / `getBundleStatuses` / `getTipAccounts`), so the production
`JitoClient` (grpc-pipeline `jito.rs`) and the SDK's `JitoBundleClient` can target it unchanged:

- **A-before-B ordering validation** — Transaction A (Noviscia capacity/premium call) must
  precede Transaction B (the trade); violating bundles are rejected atomically (`-32097`),
- **`SANDBOX_SIMULATE_FAIL=1`** forces the atomic-abort path: the whole bundle is dropped,
  nothing materializes, and the *landed / pending* ledger stays zero (capital insulation),
- bundle rows record `pending` / `confirmed` / `rejected` for `getBundleStatuses`.

---

## 3. Reference implementations

| Piece | Where |
|---|---|
| Slot projection + posture state machine | `sdk/src/sandboxClock.ts` (TS twin of `services/sandbox-hub/src/posture.rs`) |
| Freeze model / harness helpers | `sdk/src/sandboxAccelerator.ts` |
| Rust posture + emulator | `services/sandbox-hub/src/{posture.rs,emulator.rs}` |
| Tier-1 provisioning | `scripts/sandbox/provision-local-ledger.ts` |
| Verification session | `scripts/sandbox/e2e-sandbox-verification.ts` |

`posture.rs`, `sandboxClock.ts` and the harness must agree **to the slot**; both are pinned by
tests (`cargo test` in `services/sandbox-hub`; `src/sandboxClock.test.ts` in the SDK). The
emulator's unit tests assert the atomicity contract independently of any network.

---

## 4. The 4-phase development sequence

| Phase | Input | Output | Verified where |
|---|---|---|---|
| 1 **Provision** | Tier-1 ledger | pools + credit line + C_desk | `provision-local-ledger.ts` checks |
| 2 **Stream** | Tier-2 mock subscriber | 400ms posture stream | ssh gRPC `StreamEvents` / `GetDeskStatus` |
| 3 **Bundle** | Tier-3 emulator | atomic A→B landing + abort | `cargo test` emulator suite |
| 4 **Accelerate** | 1,440× clock | 150+12.5-slot window, freeze | `sandboxClock.test.ts` + harness Test 3 |

---

## 5. The institutional verification checklist (4 tests)

Run with `npx tsx scripts/sandbox/e2e-sandbox-verification.ts`. Set `SANDBOX_HUB_URL`
(e.g. `http://127.0.0.1:8898`) to additionally verify Test 1 against the **live Rust**
emulator; unset, Tests 1–2 run against an in-process port with identical semantics.

### Test 1 — Atomic reversion / capital insulation

A `$1M`-capacity bundle fails mid-emulation → the whole thing reverts → pool NAV
`$10,000,000` is byte-identical and no partial state exists.

### Test 2 — Sub-2ms gRPC ingestion

500 event envelopes decode with `median < 2ms` and `max < 2ms`. In the session it lands at
single-digit microseconds; the budget is deliberately generous (2ms = 5 slots of headroom at
400ms cadence).

### Test 3 — Time-accelerated credit freeze

Three desks; two breach at `windowStart+162.5` sandbox slots → the freeze predicate isolates
exactly the breached desks and no further credit is issued; a 1-day window collapses to 60 s.

### Test 4 — Multi-asset auto-compounding yield

A 1,000-slot loop compounds premium at the TVV baseline APY (4.608% → 4,608 tenths-bps, from
`velocity.ts`) while LP share supply stays constant: the 1,000-slot session annualizes within
2% of the audited APY.

```bash
npx tsx scripts/sandbox/e2e-sandbox-verification.ts
# → 19 passed, 0 failed (set SANDBOX_HUB_URL for the live-Rust 20th check)
```