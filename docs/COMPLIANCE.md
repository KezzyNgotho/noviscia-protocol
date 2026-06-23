# Noviscia Protocol — Compliance Overview (Devnet Beta)

**Last updated:** June 2026
**Scope:** Noviscia perpetuals, margin vault, insurance vault, and NVSC/nvscUSDC on **Solana devnet**. This document describes the protocol's current regulatory posture and what changes before mainnet. It is informational, not legal advice — see [LEGAL.md](./LEGAL.md) for terms of use and risk disclosure.

## Non-custodial posture

Noviscia does not take custody of user funds at any point:

- All margin, vault deposits, and staked NVSC are held in per-user **Program Derived Accounts (PDAs)**, not protocol- or operator-controlled wallets.
- Every state-changing action (deposit, withdraw, open/close position, recall) requires the user's own wallet signature.
- Crank callers and the lending allocator can only trigger permissionless, on-chain-bounded operations (mark updates, funding, recalls into program-registered pools) — they cannot redirect funds to arbitrary destinations or withdraw on a user's behalf. No operator key has any special on-chain privilege here; anyone can call these instructions.

This non-custodial design is the basis for treating Noviscia as software infrastructure rather than a money-services business. It does not by itself guarantee a particular regulatory classification in any jurisdiction.

## KYC / AML — current devnet posture

- The devnet app performs **no KYC/AML checks**. Devnet tokens (test SOL, test USDC, devnet NVSC) have no real-world value, so identity verification is not applicable to the current beta.
- No off-chain account system exists; the only identifier is a connected Solana wallet address, which is itself pseudonymous on-chain public data.
- This posture is **expected to change for mainnet** in jurisdictions or for features where applicable law requires it (see "Path to mainnet" below). No commitment is made here about which features will require KYC — that determination is made closer to mainnet launch with legal counsel.

## Sanctions & jurisdiction restrictions

- Consistent with [LEGAL.md](./LEGAL.md), the protocol may be unavailable to users in jurisdictions where leveraged derivatives trading, or access to this software, is restricted or prohibited.
- Users are responsible for determining whether their use of Noviscia complies with the laws of their jurisdiction, including local restrictions on derivatives, virtual assets, and sanctions regimes.
- The frontend does not currently implement IP-based geofencing or wallet-address sanctions screening on devnet. **Both are planned pre-mainnet items** (see [LAUNCH_ROADMAP.md](./LAUNCH_ROADMAP.md), Phase 1 hardening) and are not yet implemented anywhere in this codebase.

## Data privacy

- All on-chain activity (positions, trades, vault balances, governance votes) is public by nature of the Solana ledger.
- The web app and API may log wallet addresses and RPC request metadata for reliability, debugging, and abuse mitigation. No KYC-grade personal data (name, address, government ID, etc.) is collected on devnet.
- No data is currently sold or shared with third parties for advertising purposes.

## Audit & assurance status

- **No third-party smart-contract audit has been completed as of this writing.** A third-party audit is a tracked pre-mainnet milestone — see [AUDIT_PREP.md](./AUDIT_PREP.md) for the engagement checklist and [LAUNCH_ROADMAP.md](./LAUNCH_ROADMAP.md) for sequencing (target: pre-mainnet, Q3 2026).
- A [bug bounty program](./BUG_BOUNTY.md) covers devnet scope in the interim; see `/more/bug-bounty` in the app.
- Until an audit is complete, all contracts should be treated as unaudited experimental software, per [LEGAL.md](./LEGAL.md).

## Path to mainnet

Before any mainnet launch, the following compliance-related items are expected to be addressed (tracked in [LAUNCH_ROADMAP.md](./LAUNCH_ROADMAP.md) Phase 1–2):

- [ ] Third-party smart-contract audit completed and findings remediated.
- [ ] Legal review of jurisdictional availability and any required geofencing/sanctions screening.
- [ ] Decision on KYC requirements, if any, per feature and jurisdiction.
- [ ] Updated terms of use and privacy policy reflecting real-asset usage.
- [ ] Public disclosure of operator/admin key custody arrangements (multisig, timelocks).

This list reflects current planning intent and is **not a commitment or guarantee** of mainnet launch timing or feature availability in any jurisdiction.

## Contact

Compliance-related questions: see the contact channels in [LEGAL.md](./LEGAL.md) or `/more/support` in the app. Security issues should go through the [bug bounty program](./BUG_BOUNTY.md), not public channels.

---

*This document describes Noviscia's current devnet-beta posture and may change without notice as the protocol evolves toward mainnet.*
