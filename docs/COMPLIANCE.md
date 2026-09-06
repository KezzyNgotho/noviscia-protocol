# Noviscia Protocol — Compliance Overview (Devnet Beta)

**Last updated:** September 3, 2026
**Scope:** Noviscia CCP — perpetuals (perps via `position-tracker`), the `nv-usdc-vault` USDC omni-pool, NVSC/veNVSC staking, and the netting engines (`netting-engine`/`sovereign-netting`) on **Solana devnet**. This document describes the protocol's current regulatory posture and what changes before mainnet. Informational, not legal advice — see [LEGAL.md](./LEGAL.md).

---

## Non-custodial CCP posture

Noviscia is a **central counterparty** — it interposes on every trade (novation) but never takes custody of user funds:

- All margin, vault deposits, and staked NVSC are held in per-user **Program Derived Accounts (PDAs)**.
- Every state-changing action requires the user's own wallet signature.
- Crank callers trigger permissionless, on-chain-bounded operations — they cannot redirect funds.
- No operator key has any special on-chain privilege; anyone can call cranks.

The CCP model means Noviscia is the buyer to every seller and seller to every buyer — but funds remain non-custodial. This design is the basis for treating Noviscia as software infrastructure rather than a money-services business.

---

## KYC / AML — current devnet posture

- **No KYC/AML checks** on devnet. Devnet tokens have no real-world value.
- No off-chain account system; only a pseudonymous Solana wallet address.
- **Expected to change for mainnet** in applicable jurisdictions. No commitment on which features will require KYC.

---

## Sanctions & jurisdiction restrictions

- Protocol may be unavailable in restricted jurisdictions.
- Users responsible for compliance with local laws.
- No IP geofencing or wallet sanctions screening on devnet — **planned pre-mainnet**.

---

## Data privacy

- All on-chain activity is public (Solana ledger).
- No KYC-grade personal data collected on devnet.
- No data sold or shared for advertising.

---

## Audit & assurance status

- **No third-party audit completed.** Target: Q4 2026 (see [`AUDIT_PREP.md`](./AUDIT_PREP.md)).
- The bug-bounty program (`programs/cluster-4-governance/bug-bounty`) is **deferred** — not live on devnet.
- All contracts should be treated as unaudited experimental software.

---

## On-chain compliance features

| Feature | Status | Description |
|---------|--------|-------------|
| Non-custodial PDAs | Live | All funds in program-derived accounts |
| Permissionless cranks | Live | No operator dependency |
| Oracle freshness check | Live | ≤30s Pyth VAA enforced on every trade |
| Risk-parameter validation | Live | On-chain invariant prevents misconfiguration |
| CCP novation | Live | Interposition on every trade |
| Netting engine | Live | Cross-tenant multilateral netting |
| 5-layer loss waterfall | Live | Default absorption before LPs touched |
| Admin timelock | Planned | 24hr timelock for parameter changes |
| Multisig admin | Planned | Squads M-of-N before mainnet |
| IP geofencing | Planned | Pre-mainnet |
| Wallet sanctions screening | Planned | Pre-mainnet |

---

## Path to mainnet

- [ ] Third-party audit completed and findings remediated
- [ ] Legal review of jurisdictional availability and geofencing
- [ ] Decision on KYC requirements per feature and jurisdiction
- [ ] Updated terms of use and privacy policy
- [ ] Admin key rotated to multisig
- [ ] Insurance fund seeded with target TVL percentage

---

## Contact

Compliance: see [LEGAL.md](./LEGAL.md) or `/more/support`. Security: see [`SECURITY.md`](./SECURITY.md).

---

*This document describes Noviscia's current devnet-beta posture and may change without notice.*
