# Noviscia Protocol — Privacy Policy

**Last updated:** July 2026  
**Effective:** Upon accessing noviscia.com or any Noviscia interface

---

## 1. Overview

Noviscia is a non-custodial, on-chain protocol. The protocol itself does not collect, store, or process personal data. This policy covers only the **web interface** at noviscia.com and any associated APIs.

---

## 2. Data we do not collect

Noviscia does not collect:

- Names, email addresses, or contact information
- Government-issued ID or KYC documentation
- IP addresses stored beyond a single request session
- Cookies used for tracking or cross-site profiling
- Private keys, seed phrases, or wallet credentials

---

## 3. What the interface reads from your wallet

When you connect a wallet (Phantom, Backpack, Solflare, or any wallet-adapter-compatible wallet), the interface reads:

- Your **public key** (wallet address) — used to derive on-chain account addresses and display your positions, balances, and transaction history
- **On-chain transaction data** — positions, margin balances, vault shares, staking state, and fill history as stored on the Solana ledger (all of this is publicly visible on-chain regardless of whether you use this interface)

Your private key is never transmitted to any server. All transaction signing occurs locally in your wallet application.

---

## 4. On-chain data is public

All actions you take on Noviscia — deposits, withdrawals, trades, liquidations, governance votes — are recorded on the Solana blockchain. This data is permanently public and visible to anyone. Noviscia has no ability to delete or obscure on-chain records.

---

## 5. Third-party services

The interface integrates with:

| Service | Purpose | Data sent |
|---------|---------|-----------|
| **Helius / Alchemy RPC** | Solana RPC provider | Unsigned transaction data, account addresses |
| **Pyth Network (Hermes)** | Oracle price feeds | No personal data |
| **Jupiter** | Token swap routing | Token amounts, wallet address (for swap quote) |
| **Vercel** | Frontend hosting | Standard HTTP request logs (IP, user-agent); subject to Vercel's privacy policy |

Noviscia does not sell data to third parties and does not use advertising networks.

---

## 6. Local storage

The interface may use browser `localStorage` to persist:

- Selected wallet provider preference
- UI preferences (e.g., selected market, leverage setting)
- Session-scoped state (e.g., pending order form values)

No personal data is stored in `localStorage`. You can clear this at any time via your browser settings.

---

## 7. Analytics

Noviscia does not run third-party analytics trackers (no Google Analytics, Mixpanel, Segment, or equivalent). The only telemetry is standard Vercel access logs, which are retained for a limited period per Vercel's policy.

---

## 8. Devnet beta

During the current devnet beta phase, all on-chain data is on Solana devnet and carries no real-world value. Devnet data may be reset or purged at any time by Solana validators without notice.

---

## 9. Changes to this policy

Material changes will be announced via the project Discord. The "Last updated" date above reflects the most recent revision.

---

## 10. Contact

Privacy questions: keziengotho18@gmail.com  
Security disclosures: see [`SECURITY.md`](SECURITY.md)

---

*By using the Noviscia interface, you acknowledge that on-chain interactions are public and irreversible.*
