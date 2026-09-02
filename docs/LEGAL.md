# Noviscia Protocol — Terms & Risk Disclosure (Devnet Beta)

**Last updated:** September 3, 2026 (mechanism descriptions below corrected to match the current protocol design — legal/liability language unchanged)  
**Scope:** Noviscia CCP — perpetuals (via `position-tracker`), the `nv-usdc-vault` USDC omni-pool, NVSC/veNVSC staking, and the netting engines — and related smart contracts on **Solana devnet** only. Not offered to mainnet users until separately announced.

## Terms of use

1. **Experimental software.** Noviscia is under active development. Contracts and UIs may change without notice. You use the protocol at your own risk.

2. **No custody.** You retain control of your wallet. Noviscia does not hold private keys or guarantee execution of permissionless cranks, oracle updates, or liquidations.

3. **Devnet assets.** Tokens on devnet have no real-world value. Do not use mainnet funds, production secrets, or personally identifiable data in devnet testing.

4. **No investment advice.** Nothing on the app, docs, or APIs constitutes financial, legal, or tax advice.

5. **Eligibility.** You are responsible for complying with laws in your jurisdiction. The protocol may be unavailable where leveraged crypto trading is restricted.

6. **Fees.** Trading, funding, liquidation, and vault fees are set on-chain and may change via governance or admin migration on devnet.

## Risk disclosure

### Perpetual futures

- **Leverage risk:** Small price moves can liquidate positions. You may lose all collateral. On some markets, leverage up to 50x is offered — a 1% adverse price move against a fully-leveraged position can trigger liquidation.
- **Oracle risk:** Marks depend on a Pyth price feed, verified fresh (≤30 seconds old) on-chain at the moment of every trade action. A stale or unavailable feed will block trading rather than execute against an old price, but does not eliminate all price-manipulation risk on the underlying feed itself.
- **Funding risk:** Funding payments transfer value between longs and shorts based on relative open-interest imbalance, settled via a permissionless on-chain instruction (not a fixed hourly schedule). Rates can be positive or negative for either side.
- **Liquidation risk:** Underwater positions may be fully liquidated by any participant (including, by design, the position's own owner) once equity falls below the maintenance margin threshold. The liquidation penalty is the position's entire remaining collateral, split between the liquidator and the protocol.
- **ADL risk:** An auto-deleveraging instruction exists on-chain for extreme insurance-fund-exhaustion scenarios and may close positions at market without user consent; exact current trigger conditions have not been independently re-verified as of this update.
- **Smart contract risk:** Bugs, exploits, or failed upgrades can cause loss of funds. One such bug (a market risk-parameter misconfiguration) was found and corrected on devnet in July 2026 — see `docs/SECURITY.md`'s findings log.

### Margin & vault

- **Vault NAV risk:** Margin is held as shares of a single USDC vault; share price (NAV) can in principle decrease if the vault's assets or yield sources underperform, though its only current inputs (trading fees, liquidation penalties) are additive by construction.
- **Insurance fund:** A per-market reserve is funded automatically from a slice of liquidation penalties — it is not a separate LP-deposit product, is not FDIC-insured, and may be insufficient to cover all bad debt in extreme conditions, in which case the vault's broader NAV absorbs the remainder.

### Operational

- All cranks (oracle refresh, liquidation, ADL, bad-debt coverage) are permissionless — no single operator controls them. However, if no participant calls them for an extended period, marks or liquidations may be delayed.
- Devnet resets, redeploys, and migrations can orphan old accounts.

## Limitation of liability

To the maximum extent permitted by law, Noviscia contributors and operators disclaim liability for any damages arising from use of devnet software, including direct, indirect, incidental, or consequential losses.

## Contact

Report security issues through your project’s designated channel. Do not disclose vulnerabilities publicly before coordinated disclosure.

---

*By connecting a wallet to Noviscia devnet, you acknowledge these terms and risks.*
