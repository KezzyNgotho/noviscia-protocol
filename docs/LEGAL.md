# Noviscia Protocol — Terms & Risk Disclosure (Devnet Beta)

**Last updated:** June 2026  
**Scope:** Noviscia perpetuals, margin vault, insurance vault, and related smart contracts on **Solana devnet** only. Not offered to mainnet users until separately announced.

## Terms of use

1. **Experimental software.** Noviscia is under active development. Contracts, keepers, and UIs may change without notice. You use the protocol at your own risk.

2. **No custody.** You retain control of your wallet. Noviscia does not hold private keys or guarantee execution of keeper cranks, oracle updates, or liquidations.

3. **Devnet assets.** Tokens on devnet have no real-world value. Do not use mainnet funds, production secrets, or personally identifiable data in devnet testing.

4. **No investment advice.** Nothing on the app, docs, or APIs constitutes financial, legal, or tax advice.

5. **Eligibility.** You are responsible for complying with laws in your jurisdiction. The protocol may be unavailable where leveraged crypto trading is restricted.

6. **Fees.** Trading, funding, liquidation, and vault fees are set on-chain and may change via governance or admin migration on devnet.

## Risk disclosure

### Perpetual futures

- **Leverage risk:** Small price moves can liquidate positions. You may lose all collateral.
- **Oracle risk:** Marks depend on Pyth/Jupiter/consensus feeds. Stale or manipulated prices can cause unfair liquidations or failed opens.
- **Funding risk:** Hourly funding payments transfer value between longs and shorts. Rates can be positive or negative.
- **Liquidation risk:** Underwater positions may be partially or fully liquidated by permissionless liquidators. Liquidation fees apply.
- **ADL risk:** When open interest exceeds caps, auto-deleveraging may close positions at market without user consent.
- **Smart contract risk:** Bugs, exploits, or failed upgrades can cause loss of funds.

### Margin & vault

- **Idle-lend risk:** USDC margin may be deployed to lending venues. Recall delays can block withdrawals or new trades.
- **nvscUSDC NAV risk:** Vault share price can decrease if marked assets or yields underperform.
- **Insurance vault:** LP deposits backstop bad debt but are not FDIC-insured. Withdrawals may be subject to cooldowns.

### Operational

- Keepers, indexers, and APIs are best-effort. Outages can delay marks, funding accrual, or liquidations.
- Devnet resets, redeploys, and migrations can orphan old accounts.

## Limitation of liability

To the maximum extent permitted by law, Noviscia contributors and operators disclaim liability for any damages arising from use of devnet software, including direct, indirect, incidental, or consequential losses.

## Contact

Report security issues through your project’s designated channel. Do not disclose vulnerabilities publicly before coordinated disclosure.

---

*By connecting a wallet to Noviscia devnet, you acknowledge these terms and risks.*
