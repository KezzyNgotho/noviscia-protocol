# Noviscia Security & Maturity Audit — Program-by-Program

Audited against on-disk source, September 2026. Only 3 programs exist on disk
(`nv-usdc-vault`, `burn-engine`, `token-nvsc`); everything else was absorbed at
Stages 0–3. Severity: **CRITICAL** = direct loss of funds; **HIGH** = exploit or
compliance break in a live path; **MED** = bookkeeping/design divergence.

---

## 1. `nv-usdc-vault` — TVV handlers + contexts (`lib.rs`

### CRIT-1 — `tvv_s2_liquidate` can siphon a desk's margin to an arbitrary account
`TvvS2Liquidate.waterfall_vault` is `#[account(mut)] Account<TokenAccount>` with
**no seed/owner/address constraint** (`lib.rs:5353`). The transfer
(`lib.rs:5067`) sends the desk's margin there signed by the vault-authority PDA.
Any caller can pass their own ATA as `waterfall_vault` and, once a desk is frozen,
walk straight out with 100% of `margin_posted`.
**Fix:** pin `waterfall_vault` to a PDA `[S2_WATERFALL_VLT_SEED, vault_config.key()]`
ATA owned by `vault_authority`, and require `waterfall.vault_config == vault_config.key()`.

### CRIT-2 — TVV tolls book unbacked NAV/`fee_index` growth (insolvency path)
`tvv_s1_repay` (`lib.rs:4822-4832`) and `tvv_s2_settle_eod`
(`lib.rs:5012-5022`) add 90% of the toll to `total_assets` and stage it into
`pending_fee_index` — but **no corresponding USDC ever enters `vault_usdc`**.
Compare `pay_toll` (`lib.rs:1794-1844`), which physically transfers the full
90/10 split before bumping NAV. The TVV path violates the documented invariant
"Σ released ≡ Σ staged revenue (micro-cent reconciliation)" (`lib.rs:487`):
`claim_yield` (`lib.rs:1336`) then pays out **real USDC** against this phantom
index, and `redeem_nvusdc` pays against inflated `total_assets` until the next
`sync_total_assets` re-baselines. Result: vault drains to insolvency, or claims
become unpayable. In S2 the `_treasury` cut is additionally **discarded**
(`lib.rs:5012`), never collected from anyone.
**Fix:** mirror `pay_toll` — desk transfers the **full toll**: 90% into
`vault_usdc` (which backs the NAV bump), 10% into treasury.

### CRIT-3 — S1 double-draw same slot overwrites the receipt
`tvv_s1_draw` writes `receipt.principal = amount` on an `init_if_needed` account
(`lib.rs:4753-4775`). Two draws in one slot → second draw **overwrites** the
receipt; repay returns only the last draw's principal; the first draw's principal
is a free loan. `draws_this_slot` accumulates (ceiling is safe) but the receipt is
not.
**Fix:** aggregate into the receipt (`receipt.principal += amount`), or make the
receipt `init` (reject a second same-slot draw).

---

### HIGH-4 — S1 repay never enforces same-slot/bundle return
`tvv_s1_repay` (`lib.rs:4788`) checks slot matches the receipt and not-settled, but
**never checks `Clock::slot == receipt.slot_key`**. A desk can draw at slot N and
repay minutes later — a standing, uncollateralized loan the "lossless by
construction" axiom forbids.
**Fix:** require `clock.slot == slot_key` at repay, and/or enforce that an
unsettled S1 receipt blocks further S1 draws and auto-freezes the S2 line.

### HIGH-5 — Permissionless freeze + caller-free `loss` liquidate = griefing
`tvv_s2_freeze` (`lib.rs:5041`) is permissionless, and `tvv_s2_liquidate`
(`lib.rs:5052`) accepts a caller-supplied `loss` up to 100% of posted margin with
no evidence the desk is actually underwater. `S2_MARGIN_FLOOR_BPS` and
`margin_haircut_floor` are **defined but never used on-chain** — there is no
marking of desk PnL/collateral on-chain at all. Any actor can freeze any healthy
desk and strip its margin.
**Fix:** freeze requires a keeper-set trigger (health below floor, oracle-attested),
bond liquidators, compute `loss` on-chain from `drawn - collateral_value` instead
of a free param, and add an un-freeze path.

### HIGH-6 — S2 credit/ledger not pinned to `vault_config` (cross-vault confusion)
`TvvS2Draw/Repay/Settle/Freeze/Liquidate` constrain `credit`/`ledger` only by
`has_one = desk`, **not** by `credit.vault_config == vault_config.key()`. A desk
vetted/capped in vault A can pass vault B's accounts and draw from B's USDC under
A's (different) limit/margin. `tvv_s1_draw`'s `credit` gate has the same gap.
**Fix:** add `constraint = credit.vault_config == vault_config.key()` (and on
`ledger`).

### HIGH-7 — KYC/KYT gate is real for deposits but not for TVV credit
- `router_deposit_liquidity` / swap check `expires_at` and `KycExpired`
  (`lib.rs:4429-4433, 4512-4515`) → the proof + expiry _are_ enforced for the router.
- `tvv_s2_open_credit` verifies merkle proof + `lp.is_active` but **never checks
  `lp.expires_at`** (`lib.rs:4855-4871`); the `KycExpired` error is never raised there.
- After open, `tvv_s2_draw`/`repay` and `tvv_s1_draw` re-check **no** current KYC
  standing — they only check `credit.frozen`.
- `router_revoke_lp` (`lib.rs:4394`) and merkle-root rotation do **not** propagate
  to the S2 credit: a revoked/lapsed desk keeps drawing until someone freezes.
**Fix:** check `lp.expires_at > now` at open; re-verify `credit.kyc_expiry > now`
on every S2 draw and S1 draw; cascade `revoke → freeze` the desk's credit.

---

### MED-8 — S2 toll uses `margin_bps` as the rate and drops the treasury cut
`tvv_s2_settle_eod` computes toll as `gross_volume × margin_bps / 10_000`
(`lib.rs:5008`) — the 30% *margin* policy reused as a *toll* rate, and the
10% treasury share is silently discarded.

### MED-9 — Documented caps not enforced on-chain
`C_desk` (15%) and `C_sys` (60%) are only commented; `TvvS1Configure` caps the
ceiling at 60% but nothing bounds a **single desk** to 15% of the pool on S1, and
S2 limits are only as strict as the admin set them at open time.

### MED-10 — Dead/confusing TVV state
`S2_MARGIN_FLOOR_BPS`, `margin_haircut_floor`, `INSURANCE_USE_WINDOW_CAP` are
unused by any handler; `ledger.pnl`/`net_notional` are updated but PnL is never
marked against anything; the `router_leaf == [0;32]` guard in open-credit is dead
(account is `init`); `S2DeskCredit.toll`-type revenue no longer reconciles to a
token leg.

---

## 2. `nv-usdc-vault` — tranche_pool.rs

- `allocate_loss` order (institutional absorbs first, protected capped at
  `loss_cap_bps`) is correct and unit-tested. No on-chain handler currently calls
  it for the TVV waterfall (`simulate_waterfall` in `tvv.rs` is pure/standalone) —
  the real tranche write-down leg was **not** wired into `tvv_s2_liquidate`.
  The waterfall is modeled, proven, but operationally incomplete.
- `accrue_one` has a min-interval guard; time-based accrual mints NAV from nothing
  by design — capped by `APY` set by admin, acceptable but must be reconciled to
  the actual USDC backing (see CRIT-2; same class of risk if the admin APY is set
  above real fee income).

---

## 3. `nv-usdc-vault` — router_pool.rs (KYC gate)

- **Strong:** keccak leaf `keccak(wallet‖tier‖expiry)`, sorted-pair merkle
  verification, tier deposit caps, expiry checks on deposit/swap. Solid, tested.
- Gaps: root rotation/revoke don't cascade to TVV credit (HIGH-7); `LpTier` caps
  apply only to router deposits, not to S2 draw limits; `set_kyc_merkle_root` may
  be set to `[0;32]` by authority (denial, not theft).

---

## 4. `nv-usdc-vault` — fee spine / insurance mechanics (lib.rs)

- `pay_toll` is the **honest reference**: full amount transferred, split 90/10 in
  cash, NAV bump fully backed. TVV handlers must adopt it.
- `accrue_slot_yield` linear release, capped by `pending_fee_index` — good.
- `claim_yield` pays real USDC against `fee_index` — correct only if every staged
  delta was physically funded (violated by CRIT-2).
- `sync_total_assets` re-baselines to physical balance — the safety net that
  CRIT-2 relies on to not *permanently* inflate NAV. Good pattern, insufficient
  against same-window redemptions.
- Admin spine (timelock, migration) looks sound.

---

## 5. `burn-engine`

- `trigger_burn` burns `nvsc_amount = burn_amount` (USDC-denominated) directly from
  the NVSC vault with no price/ratio leg — the "buyback" destroys NVSC tokens equal
  to accumulated USDC regardless of market price, and `accumulated_usdc` is
  decremented by the full USDC. The intended keeper swap-then-burn is authority-
  gated (`has_one = authority`), so not an exploit, but the accounting does not
  represent a real buyback at market.
- `force_set_authority` backdoor is pinned to the hardcoded deployer key — document
  as trusted-admin; consider burning it post-launch.
- Migration logic bounds sizes correctly. No overflow paths (checked arithmetic).

## 6. `token-nvsc`

- `mint_tokens` authorizes via `has_one = authority`; `total_supply` is a stored
  field that is **never enforced** — unbounded mint below that ceiling is
  bookkeeping-only. `burn_tokens` is standard self-burn. `transfer_authority`
  syncs the SPL mint authority — good (audit P1-7 honored).

---

## Bottom line — "is the engine real?"

The **math engine is real**: the SDK twins (`tvv.ts`, `noviscia-tvv`,
`economics/velocity/waterfall`) are internally consistent, byte-parity with the
pure on-chain functions, and fully unit-tested (192 TS + 5 Rust + 89 on-chain
passing). The protective design (margin floor, 6-step waterfall order, insurance
rate-limit, CPI seed discipline, checked arithmetic) is genuinely implemented in
the pure layer.

What is **not** yet real is the revenue-cash loop: the TVV handlers book yield
without collecting its cash (CRIT-2), can route margin anywhere (CRIT-1), lose S1
receipts in a slot (CRIT-3), and never mark desks "underwater" before liquidation
(HIGH-5). Until those four are fixed, the on-chain program cannot be considered
production-safe, and the waterfall's deeper layers are modeled-but-unwired.

## Remediation order
1. CRIT-1 pin `waterfall_vault` (PDA ATA).
2. CRIT-2 collect full toll as real transfers (mirror `pay_toll`) in S1 repay + S2 settle.
3. CRIT-3 aggregate S1 receipt principal across same-slot draws (or reject re-entry).
4. HIGH-6 pin `credit.vault_config == vault_config.key()` everywhere.
5. HIGH-7 enforce KYC expiry at open + on draws; cascade revoke→freeze.
6. HIGH-4 enforce same-slot S1 repay.
7. HIGH-5 keeper-gated freeze + on-chain-computed `loss` + un-freeze.
8. MED-8..10 cleanup + wire tranche write-down into liquidate.
9. Re-run full test battery + re-audit diffs.