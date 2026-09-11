# Noviscia Protocol

A **central counterparty (CCP) clearing house for Solana** — a single omni-pool nets
offsetting risk across tenants, runs all margin as a yield-bearing vault (`nvscUSDC`), and
absorbs defaults through a funded 5-layer waterfall before LPs are touched.

> **🕒 This repository is being prepared for public release.** The protocol source — on-chain
> programs, verification corpus, SDKs, and tooling — is currently held in a private
> monorepo while it is finalized and audited, and will be open-sourced here soon.

**Status:** devnet operational · mainnet target Q1 2027 (post-audit)

---

## Coming soon

- On-chain programs (settlement, margin, risk) with invariant verification
- Adversarial parity fuzz suite and the formal verification corpus
- Client SDKs (TypeScript / Rust / C++)
- Sandbox emulator harness and devnet measurement reports

Until the release lands, the deployed devnet programs remain live and verifiable on-chain.
For institutional review or security disclosures, contact the maintainers via the project's
opening announcement.

## License

Apache-2.0 — see `LICENSE`.