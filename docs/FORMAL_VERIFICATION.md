# Formal Verification — TVV Post-Swap Carry Invariant

> **Purpose:** A human-checkable, machine-reproducible proof that the TVV gate's carry
> settlement can never book a loss. Grounded in the actual program source, mirrored by an
> independent parity fuzzer, and covered by the program's own Rust unit tests.
>
> **Status:** Live · verified against `programs/noviscia-tvv-gate/src/lib.rs`
> **Last updated:** September 2026

---

## 1. Object

The invariant sits in `settle_run` in `programs/noviscia-tvv-gate/src/lib.rs`.
The claim we verify:

> **I1 (carry no-loss).** For every settle that completes (`RUN_OPEN → RUN_SETTLED`),
> the reserve vault balance after the token transfer is greater than or equal to the vault
> balance recorded at `open_run`. Equivalently, the realized carry on that run is
> non-negative:

```
final_balance  >=  initial_pool_balance        ⇔   realized  >=  0
```

A settle that would violate the claim is **reverted atomically** — the require sits after
the CPI transfer but inside the same instruction, so no token movement persists and no
`RUN_SETTLED` state is committed.

---

## 2. Statement — arithmetic step for step

### 2.1 `open_run` — snapshot the reservation (lib.rs:352–379)

```
352   let initial_balance = ctx.accounts.reserve_vault.amount;   // u64
374   run.initial_pool_balance = initial_balance;
379   run.status = RUN_OPEN;
```

The run records the vault's **opening balance** before capital is deployed. `amount`
(principal) is transferred from the reserve vault to the searcher vault (`token::transfer`,
spl-token, amount = `run.principal`).

### 2.2 `settle_run` — transfer, post-swap read, require (lib.rs:407–445)

```
407   pub fn settle_run(ctx: Context<SettleRun>) -> Result<()> {
409     require!(!cfg.paused,                    Paused);          // gate closed? abort
411     require!(run.status == RUN_OPEN,         RunNotOpen);      // already settled/closed? abort
412     require_keys_eq!(run.searcher, <txn caller>, Unauthorized); // only the searcher settles
415–418 require!(slot - run.opened_slot <= run.ttl_slots, TtlExpired);

420     let return_amount = ctx.accounts.searcher_vault.amount;     // FULL vault balance returns
421–431 token::transfer(from=searcher_vault, to=reserve_vault, amount=return_amount)?;

433–437 let final_balance = read_u64(reserve_vault.data[64..72]);    // POST-transfer read

438–441 require!(final_balance >= run.initial_pool_balance, InvariantViolated);

443     let realized      = final_balance - run.initial_pool_balance;                 // u64
444     let dif_amount    = realized as u128 * DIF_BPS as u128 / NAV_BPS_DENOM as u128; // 20%
445     let realized_net  = (realized as u128).saturating_sub(dif_amount);              // SAFE by I1
446     run.status = RUN_SETTLED;
447     run.credited_yield = realized_net as u64;
463     cfg.realized_yield = cfg.realized_yield.saturating_add(realized_net);
464     cfg.dif_ledger     = cfg.dif_ledger.saturating_add(dif_amount);
465     cfg.run_count += 1;
```

Constants (lib.rs:14–16): `NAV_BPS_DENOM = 10_000`, `DIF_BPS = 2_000` (20% DIF carve-out),
`JLF_HALT_BPS = 5_000` (breaker threshold). Error string for `InvariantViolated` (lib.rs:1162):
*"post-swap invariant violated: final vault balance < initial"*.

### 2.3 The proof obligation

Let

- `B₀ = run.initial_pool_balance` — recorded at open;
- `P  = run.principal` — deployed at open;
- `S  = return_amount` — recalled from the searcher vault at settle (lib.rs:420);
- `B₁ = final_balance` — re-read from the reserve vault **after** the transfer (lib.rs:434–437).

The post-transfer vault balance is `B₁ = (B₀ − P) + S + E`, where `E ≥ 0` is any external
Sierra surplus deposited into the vault mid-run (cannot be negative; token transfers to the
vault only ever add). The instruction requires `B₁ ≥ B₀` (lib.rs:438–441), so:

```
realized = B₁ − B₀ = S − P + E ≥ 0     ∎  (from B₁ ≥ B₀)
```

`realized_net = realized − dif_amount` with `dif_amount = realized·2000/10000 = realized/5`:
the DIF carve is exactly 20% of a **non-negative** realized value, and
`saturating_sub` (lib.rs:445) floors at zero, so `realized_net ≥ 0` trivially.

**Transfer-level failures** (`S` exceeding the searcher vault, or the source lacking
liquidity) fail the spl-token CPI at lib.rs:431 **before** any state is written; **guard
failures** (`Paused`, `RunNotOpen`, `Unauthorized`, `TtlExpired`) fail at lib.rs:409–418
before the transfer. In every rejecting path nothing persists — that is the atomicity of the
invariant, not merely the inequality.

---

## 3. Verified in code — unit tests (lib.rs:1241–1313)

`cargo test -p noviscia-tvv-gate` covers the invariant algebra directly:

| Test | Line | Verifies |
|---|---|---|
| `cap_bounds_are_bps_of_reserve` | 1241 | per-run cap is a bps slice of the reserve |
| `invariant_arithmetic_credits_positive_spread` | 1249 | `final ≥ initial` ⇒ positive spread credited |
| `settle_splits_twenty_percent_to_dif` | 1258 | `dif = realized·2000/10000`, `realized_net = 80%` |
| `breaker_trips_at_fifty_percent_jlf_drawdown` | 1267 | insurance fund halt at heavy drawdown |
| `netting_subtracts_hedged_from_gross` | 1289 | risk exposure netting math |
| `projected_breach_uses_net_after_pull` | 1295 | projected-concentration breach on net exposure |

Additionally `overflow-checks = true` is set on the gate's release profile, so any scalar
overflow anywhere in `settle_run` panics-to-revert rather than wrapping.

---

## 4. Independent parity fuzzer — adversarial replay

`scripts/chaos/adversarial-invariant-fuzz.ts` replays the exact arithmetic above
(statement-for-statement, BigInt, fuzzed over u64 ranges) against **50,000 adversarial
scenario injections** and asserts:

- **P1** no accepted settlement books `realized < 0` (leakage ≡ 0);
- **P2** every rejection is atomic (an attempted run either lands fully or reverts fully);
- **P3** the reserve never finishes below its opening balance;
- **P2b** a reorg re-fire of an already-settled run is denied by the run-state guard.

Scenario families: negative slippage, oracle stall, healthy carry, front-run drain,
reorg double-settle, insufficient-funds probe, u64 overflow probe, external-surplus
misattribution.

Baseline (seed `20260912`, committed — see `tests/chaos/chaos-invariant-report.json`):

```
attempted 50,000 · rejected 23,863 · accepted 26,137 · leakage $0.00
P1, P2, P3, P2b — all pass
```

Replay any run exactly with `FUZZ_SEED=<hex>`; regenerate the committed baseline with:

```bash
npm run chaos:invariant:baseline      # FUZZ_SEED=20260912, writes:
#   tests/chaos/chaos-invariant-report.json   — full evidence (committed)
#   app/web/lib/data/chaos-summary.json       — radar-surfaced baseline (committed)
```

The fuzzer is an independent **sandbox replay**, not a chain transaction: it re-derives the
program's own arithmetic so a reviewer can re-verify the invariant without touching an RPC.

---

## 5. Compute-unit budget — the adversarial setting is bounded

The invariant-carrying instruction (`settle_run`) performs **no hash syscalls**. Its cost is:

1. account loading + Anchor discriminations — constant;
2. one spl-token `Transfer` CPI (searcher→reserve) — constant;
3. two scalar arithmetic chains (`realized`, `dif`, `realized_net`) in u128 — constant;
4. two ledger `saturating_add` writes + run bookkeeping — constant.

The whole body is **O(1) with respect to every input**, apart from the single
`asset_index(&run.asset_mint)` linear scan over the bounded whitelist (≤ `MaxAssets`,
lib.rs:1170). Solana's per-instruction budget is 1.4M CU; the structural upper bound of the
settle path is a small constant well inside it. Formal CU instrumentation of the deployed
binary (via transaction meta `computeUnitsConsumed`) is on the mainnet readiness list.

**KYC/keccak note (honest):** the consolidated `noviscia-tvv-gate` binary contains **no**
keccak/merkle verifier — Merkle-KYC (keccak `hashv` syscall, ~150 CU/iteration) was an
asset-engine-layer feature that did not carry into the post-consolidation hot path
(see `docs/INSTITUTION_ONBOARDING.md` §15 for the engineered-but-superseded design).
Admission/KYC are handled off-chain by the sentinel; the on-chain settle path that our
invariant protects is deliberately hash-free, which is also what keeps its CU budget tiny.

---

## 6. Repro script (auditor)

```bash
# 1. Program unit tests          — invariant algebra in Rust
cargo test -p noviscia-tvv-gate

# 2. Parity fuzzer (baseline)    — replay the committed evidence
npm run chaos:invariant:baseline

# 3. Any-seed replay             — byte-identical output for a given seed
FUZZ_SEED=<hex> npx tsx scripts/chaos/adversarial-invariant-fuzz.ts
```

Every claim above cites a real source line in `programs/noviscia-tvv-gate/src/lib.rs` and a
concrete, reproducible command. There is no closed-source layer and no artifact in this file
that cannot be regenerated by the commands shown.

---

Related: `docs/CODE_ACCESSIBILITY_MATRIX.md` (what an independent verifier can access),
`docs/INSTITUTIONAL_PROOF_PACKAGE.md` (conviction checklist), `docs/AUDIT_REPORT.md`.