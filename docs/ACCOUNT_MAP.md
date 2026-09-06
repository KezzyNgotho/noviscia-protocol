# Noviscia — Global Account & PDA Seed Map

> **Purpose:** Authoritative, cross-program reference for every on-chain account, PDA seed, and
> associated authority across the 19 active programs. Generated from `programs/cluster-*/` source.
>
> **Status:** Generated from `programs/cluster-*/` (Anchor). Sync in the same PR as any program change.
> **Last updated:** September 2026 · **Anchor:** 0.31.x
>
> **Conventions**
> - **Seed keying** uses `↦` for static seed strings and `[…, key]` for dynamic suffixes
>   (LE `u64`/`u8` where noted).
> - **Authority** column = signer PDA holding token-account ownership where applicable.
> - **CPI** rows mark seeds consumed from *another* program's constants
>   (`seeds::program = <other::ID>`), the historical source of the sweep/capwire seed bugs
>   (see `docs/AUDIT_GAP_ANALYSIS.md`).
> - PDA display form: `Pubkey::find_program_address([<seeds>], <program-id>)`.

---

## 1. Program roster (IDs)

| Program | Program ID (devnet) |
|---|---|
| nv-usdc-vault | `CN92hAtnZxbMxPdho8tugi9GDK86UpGwmnbEvk5yzAWC` |
| position-tracker | `6uvr2JcP2iMQooG76RjpCtJLoJ4NuptGyRCiMKuDR1ws` |
| noviscia-clearing | `GtTJWLa6MXjZoNucGHWVnE9LpZTw6Dsr5K1gxpM1Q4fe` |
| netting-engine | `68s4vuWUXAaEFF1EM1RUQpw7SFdYZSV3opvtDqoBCs56` |
| clearing-registry | `Hg5QvSsnb22gHexUTnvvfff3EJZxWnsFKRM8bZ8n7Jmo` |
| sovereign-netting | (see `docs/DEVNET.md` §Program IDs) |
| gateway-auction | (see `docs/DEVNET.md` §Program IDs) |
| jit-risk | `3w9GrHBXpMNSc3P3kBWmHwkhEr1u5FBQrTiD4k3NAXwh` |
| noviscia-credit-line | `8usJu6agjifCXYwSsRVoMWqm22h2HUSfebw1zEEHAMYg` |
| noviscia-permissioned-pool | (see `docs/DEVNET.md` §Program IDs) |
| noviscia-capacity | (see `docs/DEVNET.md` §Program IDs) |
| noviscia-tranche-vault | (see `docs/DEVNET.md` §Program IDs) |
| noviscia-asset-engine | `5qpohgfMvV89oRJqcV7MrBxJJ95i7TgZ9VvUNdyZrMKb` |
| liquidation-vault | `Cwma3FfMKhoLkgfrGYgErVPoFWEtHpx7DNc4wArpRHBz` |
| yield-router | `FKaAPPid8B6hUme4w8bFCDzmvE6DpekXpeiR1sgyLwB4` |
| yield-distributor | `CrN1o75FGwcSo6ted7eKxw2kYgkaXDVeWmUaTZCTsLtw` |
| staking-manager | `HjxcKV51A7jxE2iqMCDY7EvWFL9XsheuM43DamWGabqb` |
| token-nvsc | `HSaBJHaGa4Hiv1uBYPHQC4ijmnh8237a5LzM8Lyuz1YT` |
| ve-nvs | (see `docs/DEVNET.md` §Program IDs) |

Full IDs + deploy walkthrough: `docs/DEVNET.md` §Program IDs.

---

## 2. Account registry by program

> Legend for seed tables: **CA** = canonical `#[account]` struct name; **Token** = SPL token
> account (ATA/PDA) owned by the listed authority PDA.

### 2.1 `clearing-registry` (multi-tenant onboarding & venue management)

Accounts: `RegistryConfig` (CA), `Tenant` (CA)

| Seed string | Const | Account | Seeds | Authority |
|---|---|---|---|---|
| `b"registry"` | `REGISTRY_SEED` | `RegistryConfig` | `[REGISTRY_SEED]` | — |
| `b"tenant"` | `TENANT_SEED` | `Tenant` | `[TENANT_SEED, tenant_count]` → `[TENANT_SEED, tenant.id]` | — |

### 2.2 `gateway-auction` (execution-slot premium auction)

Accounts: `GatewayLedger` (CA)

| Seed string | Const | Account | Seeds | Authority |
|---|---|---|---|---|
| `b"gateway"` | `GATEWAY_SEED` | `GatewayLedger` | `[GATEWAY_SEED]` | — |
| `b"tip-vault"` | `TIP_VAULT_SEED` | tip USDC ATA | `[TIP_VAULT_SEED]` | `GatewayLedger` PDA |

### 2.3 `jit-risk` (JIT risk-slot marketplace)

Accounts: `MarketplaceState` (CA), `MmRegistration` (CA), `CapacityReceipt` (CA)

| Seed string | Const | Account | Seeds | Authority |
|---|---|---|---|---|
| `b"marketplace"` | `MARKETPLACE_SEED` | `MarketplaceState` | `[MARKETPLACE_SEED]` | — |
| `b"usdc_vault"` | `USDC_VAULT_SEED` | marketplace USDC ATA | `[USDC_VAULT_SEED]` | `MarketplaceState` PDA |
| `b"mm"` | `MM_SEED` | `MmRegistration` | `[MM_SEED, mm.key]` | — |
| `b"slice"` | `SLICE_SEED` | `CapacityReceipt` | `[SLICE_SEED, mm.key, slot_key.to_le_bytes()]` | `MarketplaceState` PDA |

### 2.4 `liquidation-vault` (auto-deleveraging, insurance funding)

Accounts: `VaultState` (CA), `UserVaultAccount` (CA), `MintVaultState` (CA), `MintUserVaultAccount` (CA)

| Seed string | Account | Seeds | Authority |
|---|---|---|---|
| `b"vault_state"` | `VaultState` | `[b"vault_state"]` | — |
| `b"user_vault"` | `UserVaultAccount` | `[b"user_vault", user.key]` | — |
| `b"mint-vault"` | `MintVaultState` | `[b"mint-vault", mint.key]` | `MintVaultState` PDA |
| `b"mint-user-vault"` | `MintUserVaultAccount` | `[b"mint-user-vault", user.key, mint.key]` | — |

### 2.5 `netting-engine` (multilateral netting & novation)

Accounts: `NettingConfig` (CA), `Venue` (CA), `NetPosition` (CA), `NettingSet` (CA), `HouseBook` (CA)

| Seed string | Const | Account | Seeds | Authority |
|---|---|---|---|---|
| `b"config"` | `CONFIG_SEED` | `NettingConfig` | `[CONFIG_SEED]` | `NettingConfig` PDA (CPI signer) |
| `b"venue"` | `VENUE_SEED` | `Venue` | `[VENUE_SEED, venue_count]` → `[VENUE_SEED, venue.id]` | — |
| `b"position"` | `POSITION_SEED` | `NetPosition` | `[POSITION_SEED, venue.key, trader.key]` | — |
| `b"netting"` | `NETTING_SEED` | `NettingSet` | `[NETTING_SEED, trader.key]` | — |
| `b"housebook"` | `HOUSEBOOK_SEED` | `HouseBook` | `[HOUSEBOOK_SEED]` | — |

### 2.6 `noviscia-asset-engine` (institutional asset lifecycle)

Accounts: `AssetRegistry` (CA), `AssetPool` (CA), `InstitutionalCreditLine` (CA), `DeskPosition` (CA),
`AssetLpPosition` (CA); LP mint = token mint.

| Seed string | Const | Account | Seeds | Authority |
|---|---|---|---|---|
| `b"asset-registry"` | `REGISTRY_SEED` | `AssetRegistry` | `[REGISTRY_SEED]` | — |
| `b"asset-pool"` | `ASSET_POOL_SEED` | `AssetPool` | `[ASSET_POOL_SEED, mint.key]` | — |
| `b"asset-vault"` | `ASSET_VAULT_SEED` | principal USDC ATA | `[ASSET_VAULT_SEED, mint.key]` | asset-authority PDA |
| `b"asset-fees"` | `ASSET_FEE_VAULT_SEED` | premium fee ATA | `[ASSET_FEE_VAULT_SEED, mint.key]` | asset-authority PDA |
| `b"asset-authority"` | `ASSET_AUTHORITY_SEED` | vault signer | `[ASSET_AUTHORITY_SEED, mint.key]` | — |
| `b"credit-line"` | `CREDIT_LINE_SEED` | `InstitutionalCreditLine` | `[CREDIT_LINE_SEED, institution.key]` | — |
| `b"desk-position"` | `DESK_POSITION_SEED` | `DeskPosition` | `[DESK_POSITION_SEED, trader.key, pool.mint]` | — |
| `b"asset-lp-mint"` | `ASSET_LP_MINT_SEED` | LP token mint | `[ASSET_LP_MINT_SEED, pool.mint]` | — |
| `b"asset-lp-position"` | `ASSET_LP_POSITION_SEED` | `AssetLpPosition` | `[ASSET_LP_POSITION_SEED, pool.mint, provider.key]` | — |

### 2.7 `noviscia-capacity` (single-slot clearing & risk)

Accounts: `CapacityConfig` (CA), `CongestionOracle` (CA), `ClientAccount` (CA), `SlotLedger` (CA)

| Seed string | Const | Account | Seeds | Authority |
|---|---|---|---|---|
| `b"capacity"` | `CAPACITY_SEED` | `CapacityConfig` | `[CAPACITY_SEED]` | — |
| `b"congestion"` | `CONGESTION_SEED` | `CongestionOracle` | `[CONGESTION_SEED]` | — |
| `b"client"` | `CLIENT_SEED` | `ClientAccount` | `[CLIENT_SEED, operator.key]` | — |
| `b"slot-ledger"` | `SLOT_LEDGER_SEED` | `SlotLedger` | `[SLOT_LEDGER_SEED, operator.key]` | — |
| `b"treasury"` | `TREASURY_SEED` | treasury USDC ATA | `[TREASURY_SEED]` | treasury-auth PDA |
| `b"treasury-auth"` | `TREASURY_AUTH_SEED` | treasury authority | `[TREASURY_AUTH_SEED]` | — |

### 2.8 `noviscia-clearing` (broad market clearing)

Accounts: `ClearingConfig` (CA), `TimelockedAdmin` (CA), `Market` (CA), `UserPosition` (CA),
`ResolutionProof` (CA)

| Seed string | Const | Account | Seeds | Authority |
|---|---|---|---|---|
| `b"clr-config"` | `CLR_CONFIG_SEED` | `ClearingConfig` | `[CLR_CONFIG_SEED]` | `ClearingConfig` PDA (CPI signer) |
| `b"timelocked-admin"` | `TIMELOCKED_ADMIN_SEED` | `TimelockedAdmin` | `[TIMELOCKED_ADMIN_SEED]` | — |
| `b"market"` | `MARKET_SEED` | `Market` | `[MARKET_SEED, creator.key, end_time.to_le_bytes()]` | — |
| `b"position"` | `POSITION_SEED` | `UserPosition` | `[POSITION_SEED, user.key, market.key]` | — |
| `b"resolution"` | `RESOLUTION_SEED` | `ResolutionProof` | `[RESOLUTION_SEED, market.key]` | — |
| `b"fee-staging"` | `FEE_STAGING_SEED` | *(defined; unused in seeds)* | — | — |
| **CPI** `nv_usdc_vault::VAULT_CONFIG_SEED` | `b"nv-vault-config"` | `VaultConfig` | `[VAULT_CONFIG_SEED, vault_config.usdc_mint]`, `seeds::program = nv_usdc_vault` | — |
| **CPI** `nv_usdc_vault::VAULT_AUTHORITY_SEED` | `b"nv-vault-authority"` | authority PDA | `[VAULT_AUTHORITY_SEED, usdc_mint]`, `seeds::program = nv_usdc_vault` | — |

### 2.9 `noviscia-credit-line`

Accounts: `CreditLine` (CA), `Borrower` (CA)

| Seed string | Const | Account | Seeds | Authority |
|---|---|---|---|---|
| `b"credit-line"` | `CREDIT_LINE_SEED` | `CreditLine` | `[CREDIT_LINE_SEED]` | — |
| `b"credit-vault"` | `CREDIT_VAULT_SEED` | credit USDC ATA | `[CREDIT_VAULT_SEED]` | `CreditLine` PDA |
| `b"toll-vault"` | `TOLL_VAULT_SEED` | toll USDC ATA | `[TOLL_VAULT_SEED]` | `CreditLine` PDA |
| `b"borrower"` | `BORROWER_SEED` | `Borrower` | `[BORROWER_SEED, borrower_owner.key]` | — |

### 2.10 `noviscia-permissioned-pool` (on-chain KYC/AML ring)

Accounts: `PoolConfig` (CA), `LpEntry` (CA)

| Seed string | Const | Account | Seeds | Authority |
|---|---|---|---|---|
| `b"pool"` | `POOL_SEED` | `PoolConfig` | `[POOL_SEED, label]` | — |
| `b"pool-vault"` | `POOL_VAULT_SEED` | base/quote pool vault ATA | `[POOL_VAULT_SEED, b"base", label]` / `[POOL_VAULT_SEED, b"quote", label]` | `PoolConfig` PDA |
| `b"lp-entry"` | `LP_ENTRY_SEED` | `LpEntry` | `[LP_ENTRY_SEED, pool_config.key, lp_wallet.key]` | — |
| `b"lp-mint"` | `LP_MINT_SEED` | LP token mint | `[LP_MINT_SEED, label]` | — |
| `b"insurance"` | `INSURANCE_SEED` | insurance ATA | `[INSURANCE_SEED, label]` | `PoolConfig` PDA |

### 2.11 `noviscia-tranche-vault` (protected / institutional tranching)

Accounts: `TrancheConfig` (CA), `TrancheVault` (CA), `TranchePosition` (CA)

| Seed string | Const | Account | Seeds | Authority |
|---|---|---|---|---|
| `b"tranches"` | `TRANCHES_SEED` | `TrancheConfig` | `[TRANCHES_SEED]` | — |
| `b"protected-vault"` | `PROTECTED_VAULT_SEED` | protected vault ATA | `[PROTECTED_VAULT_SEED]` and `[PROTECTED_VAULT_SEED, b"token"]` | `TrancheConfig` PDA |
| `b"insti-vault"` | `INSTI_VAULT_SEED` | institutional vault ATA | `[INSTI_VAULT_SEED]` and `[INSTI_VAULT_SEED, b"token"]` | `TrancheConfig` PDA |
| `b"position"` | `POSITION_SEED` | `TranchePosition` | `[POSITION_SEED, owner.key]` | — |

### 2.12 `nv-usdc-vault` (omni-pool fee spine)

Accounts: `VaultConfig` (CA), `UserVaultState` (CA), `MintPool` (CA), `UserMintVault` (CA),
`InsuranceBuffer` (CA), `AssetRiskConfig` (CA), `AssetExposureTracker` (CA), `PrincipalPartition`
(CA), `InsuranceFundState` (CA), `InsuranceStaker` (CA), `TimelockedAdmin` (CA), `SleevePolicy` (CA),
`WithdrawalTracker` (CA), `ProtocolWithdrawalTracker` (CA)

| Seed string | Const | Account | Seeds | Authority |
|---|---|---|---|---|
| `b"nv-vault-config"` | `VAULT_CONFIG_SEED` | `VaultConfig` | `[VAULT_CONFIG_SEED, usdc_mint]` | — |
| `b"nv-vault-authority"` | `VAULT_AUTHORITY_SEED` | vault signer | `[VAULT_AUTHORITY_SEED, usdc_mint]` | — |
| `b"nv-vault-usdc"` | `VAULT_USDC_SEED` | vault USDC ATA | `[VAULT_USDC_SEED, usdc_mint]` | vault-authority PDA |
| `b"nvscusdc-mint"` | `NVSCUSDC_MINT_SEED` | nvscUSDC mint | `[NVSCUSDC_MINT_SEED, usdc_mint]` | — |
| `b"mint-pool"` | `MINT_POOL_SEED` | `MintPool` | `[MINT_POOL_SEED, vault_config.key, collateral_mint.key]` | — |
| `b"mint-pool-authority"` | `MINT_POOL_AUTHORITY_SEED` | mint-pool signer | `[MINT_POOL_AUTHORITY_SEED, mint_pool.key]` | — |
| `b"mint-pool-vault"` | `MINT_POOL_VAULT_SEED` | mint-pool ATA | `[MINT_POOL_VAULT_SEED, mint_pool.key]` | mint-pool-auth PDA |
| `b"user-mint-vault"` | `USER_MINT_VAULT_SEED` | `UserMintVault` | `[USER_MINT_VAULT_SEED, user.key, mint_pool.key]` | — |
| `b"insurance-buffer"` | `INSURANCE_BUFFER_SEED` | `InsuranceBuffer` | `[INSURANCE_BUFFER_SEED, vault_config.key]` | — |
| `b"asset-risk"` | `ASSET_RISK_CONFIG_SEED` | `AssetRiskConfig` | `[ASSET_RISK_CONFIG_SEED, vault_config.key, mint]` | — |
| `b"asset-exposure"` | `ASSET_EXPOSURE_SEED` | `AssetExposureTracker` | `[ASSET_EXPOSURE_SEED, vault_config.key, asset_risk.mint]` | — |
| `b"nv-treasury"` | `TREASURY_SEED` | treasury USDC ATA | `[TREASURY_SEED, vault_config.key, usdc_mint]` | treasury-auth PDA |
| `b"nv-treasury-authority"` | `TREASURY_AUTHORITY_SEED` | treasury signer | `[TREASURY_AUTHORITY_SEED, vault_config.key]` | — |
| `b"principal-partition"` | `PRINCIPAL_PARTITION_SEED` | `PrincipalPartition` | `[PRINCIPAL_PARTITION_SEED, vault_config.key]` | — |
| `b"timelocked-admin"` | `TIMELOCKED_ADMIN_SEED` | `TimelockedAdmin` | `[TIMELOCKED_ADMIN_SEED]` | — |
| `b"sleeve-policy"` | `SLEEVE_POLICY_SEED` | `SleevePolicy` | `[SLEEVE_POLICY_SEED]` | — |
| `b"user-vault-state"` | `USER_VAULT_STATE_SEED` | `UserVaultState` | `[USER_VAULT_STATE_SEED, user.key, vault_config.key]` | — |
| `b"withdrawal-trk"` | `WITHDRAWAL_TRACKER_SEED` | `WithdrawalTracker` | `[WITHDRAWAL_TRACKER_SEED, user.key]` | — |
| `b"proto-withdrawal"` | `PROTOCOL_WITHDRAWAL_SEED` | `ProtocolWithdrawalTracker` | `[PROTOCOL_WITHDRAWAL_SEED]` | — |
| `b"insurance-staker"` | `INSURANCE_STAKER_SEED` | `InsuranceStaker` | `[INSURANCE_STAKER_SEED, user.key, vault_config.key]` | — |
| `b"insurance-fund-state"` | `INSURANCE_FUND_STATE_SEED` | `InsuranceFundState` | `[INSURANCE_FUND_STATE_SEED, vault_config.key]` | — |

### 2.13 `position-tracker` (JIT perp engine)

Accounts (primary): `PtConfig` (CA), `Market` (CA), `PortfolioRiskConfig` (CA), `Portfolio` (CA),
`MarginAccount` (CA), `Position` (CA), `LimitOrder` (CA), `SessionDelegate` (CA), `TwapOrder` (CA),
`Referral` (CA), `OrderCommitment` (CA), `OracleConsensus` (CA), `TimelockedAdmin` (CA),
`CollateralConfig` (CA), `CollateralBalance` (CA), `PriceFeed` (CA), `PortfolioHealthBitmap` (CA),
`PositionHealthTracker` (CA), `MarketVolatilityTracker` (CA)

| Seed string | Const | Account | Seeds | Authority |
|---|---|---|---|---|
| `b"pt-config"` | `PT_CONFIG_SEED` | `PtConfig` | `[PT_CONFIG_SEED]` | — |
| `b"market"` | `MARKET_SEED` | `Market` | `[MARKET_SEED, feed_id]` | — |
| `b"position"` | `POSITION_SEED` | `Position` | `[POSITION_SEED, trader.key, market.key, sub_id]` | — |
| `b"collateral-vault"` | `COLLATERAL_VAULT_SEED` | per-position collateral ATA | `[COLLATERAL_VAULT_SEED, position.key]` | PtConfig/Position authority |
| `b"settlement-vault"` | `SETTLEMENT_VAULT_SEED` | settlement ATA | `[SETTLEMENT_VAULT_SEED]` | `PtConfig` PDA |
| `b"limit-order"` | `LIMIT_ORDER_SEED` | `LimitOrder` | `[LIMIT_ORDER_SEED, trader.key, market.key, sub_id, order_id.to_le_bytes()]` | — |
| `b"limit-order-vault"` | `LIMIT_ORDER_VAULT_SEED` | `LimitOrder` ATA | `[LIMIT_ORDER_VAULT_SEED, limit_order.key]` | `PtConfig` PDA |
| `b"market-book"` | `MARKET_BOOK_SEED` | order book | `[MARKET_BOOK_SEED, market.key]` | — |
| `b"session-delegate"` | `SESSION_DELEGATE_SEED` | `SessionDelegate` | `[SESSION_DELEGATE_SEED, owner.key]` | — |
| `b"twap-order"` | `TWAP_ORDER_SEED` | `TwapOrder` | `[TWAP_ORDER_SEED, trader.key, market.key]` | — |
| `b"twap-vault"` | `TWAP_VAULT_SEED` | `TwapOrder` ATA | `[TWAP_VAULT_SEED, twap_order.key]` | `PtConfig` PDA |
| `b"referral"` | `REFERRAL_SEED` | `Referral` | `[REFERRAL_SEED, trader.key]` | — |
| `b"portfolio-risk-config"` | `PORTFOLIO_RISK_CONFIG_SEED` | `PortfolioRiskConfig` | `[PORTFOLIO_RISK_CONFIG_SEED]` | — |
| `b"order-commitment"` | `ORDER_COMMITMENT_SEED` | `OrderCommitment` | `[ORDER_COMMITMENT_SEED, trader.key, market.key]` | — |
| `b"oracle-consensus"` | `ORACLE_CONSENSUS_SEED` | `OracleConsensus`; **const unused in seeds** | — | — |
| `b"portfolio"` | `PORTFOLIO_SEED` | `Portfolio` | `[PORTFOLIO_SEED, owner.key]`; vault `[PORTFOLIO_SEED, owner.key, b"vault"]` | — |
| `b"price-feed"` | `PRICE_FEED_SEED` | `PriceFeed` | `[PRICE_FEED_SEED, market.key]` | — |
| `b"portfolio-health-bitmap"` | `PORTFOLIO_HEALTH_BITMAP_SEED` | `PortfolioHealthBitmap` | `[PORTFOLIO_HEALTH_BITMAP_SEED, portfolio.owner.key]` | — |
| `b"insurance-vault"` | `INSURANCE_VAULT_SEED` | insurance ATA | `[INSURANCE_VAULT_SEED]` | `PtConfig` PDA |
| `b"position-health-tracker"` | `POSITION_HEALTH_TRACKER_SEED` | `PositionHealthTracker` | `[POSITION_HEALTH_TRACKER_SEED, position.key]` | — |
| `b"market-volatility"` | `MARKET_VOLATILITY_SEED` | `MarketVolatilityTracker` | `[MARKET_VOLATILITY_SEED, market.key]` | — |
| `b"margin-account"` | `MARGIN_ACCOUNT_SEED` | `MarginAccount` | `[MARGIN_ACCOUNT_SEED, trader.key]` | — |
| `b"margin-vault"` | `MARGIN_VAULT_SEED` | `MarginAccount` ATA | `[MARGIN_VAULT_SEED, trader.key]` | `PtConfig` PDA |
| `b"timelocked-admin"` | *(literal)* | `TimelockedAdmin` | `[b"timelocked-admin"]` | — |
| `b"pyth-feed-registry"` | *(literal)* | Pyth feed registry | `[b"pyth-feed-registry"]` | — |
| `b"collateral-config"` | *(literal)* | `CollateralConfig` | `[b"collateral-config", mint.key]` | — |
| `b"collateral-balance"` | *(literal)* | `CollateralBalance` | `[b"collateral-balance", owner.key, collateral_mint.key]` | — |
| **CPI** `b"user-vault-state"` | *(mirrors vault)* | nv `UserVaultState` | `[b"user-vault-state", user.key, vault_config.key]`, `seeds::program = nv_usdc_vault` | — |
| **CPI** `nv_usdc_vault::VAULT_CONFIG_SEED` | `b"nv-vault-config"` | nv `VaultConfig` | `[VAULT_CONFIG_SEED, usdc_mint]`, `seeds::program = nv_usdc_vault::ID` | — |
| **CPI** `nv_usdc_vault::VAULT_AUTHORITY_SEED` | `b"nv-vault-authority"` | nv authority PDA | `[VAULT_AUTHORITY_SEED, usdc_mint]` | — |
| **CPI** `nv_usdc_vault::MINT_POOL_SEED` | `b"mint-pool"` | nv `MintPool` | `[MINT_POOL_SEED, vault_config.key, collateral_config.mint]`, `seeds::program = nv_usdc_vault::ID` | — |

### 2.14 `sovereign-netting` (cross-tenant netting + revenue)

Accounts: `MetricsState` (CA), `RevenueState` (CA)

| Seed string | Const | Account | Seeds | Authority |
|---|---|---|---|---|
| `b"metrics"` | `METRICS_SEED` | `MetricsState` | `[METRICS_SEED]` | — |
| `b"revenue"` | `REVENUE_SEED` | `RevenueState` | `[REVENUE_SEED]` | — |
| `b"rent-vault"` | `RENT_VAULT_SEED` | rent USDC ATA | `[RENT_VAULT_SEED]` | `MetricsState` PDA |

### 2.15 `staking-manager` (NVSC staking + governance)

Accounts: `GovernanceState` (CA), `Proposal` (CA), `CrossMarginAccount` (CA), `LiquidationVault`
(CA), `CircuitBreaker` (CA), `StakeAccount` (CA), `VaultState` (CA), `TimelockedAdmin` (CA),
`StakingFeePool` (CA), `StakerFeeClaim` (CA), `VoterRecord` (CA)

| Seed string | Const | Account | Seeds | Authority |
|---|---|---|---|---|
| `b"staking-vault"` | `STAKING_VAULT_AUTHORITY_SEED` | staking-vault signer | `[STAKING_VAULT_AUTHORITY_SEED]` | — |
| `b"stake"` | *(literal)* | `StakeAccount` | `[b"stake", user.key]` | — |
| `b"staking-fee-pool"` | `STAKING_FEE_POOL_SEED` | `StakingFeePool` | `[STAKING_FEE_POOL_SEED]`; ATA `[STAKING_FEE_POOL_SEED, b"vault"]` | staking-vault auth PDA |
| `b"staker-fee-claim"` | `STAKER_FEE_CLAIM_SEED` | `StakerFeeClaim` | `[STAKER_FEE_CLAIM_SEED, user.key]` | — |
| `b"sm-timelocked-admin"` | `TIMELOCKED_ADMIN_SEED` | `TimelockedAdmin` | `[TIMELOCKED_ADMIN_SEED]` | — |
| **CPI** `b"config"` | `NETTING_CONFIG_SEED` | netting `NettingConfig` | `[NETTING_CONFIG_SEED]`, `seeds::program = netting engine` | — |
| `b"governance"` | `GOVERNANCE_SEED` | `GovernanceState` | `[GOVERNANCE_SEED]` | — |
| `b"proposal"` | `PROPOSAL_SEED` | `Proposal` | `[PROPOSAL_SEED, governance.key, proposal_count.to_le_bytes()]` → `[…, proposal.id]` | — |
| `b"voter_record"` | *(literal)* | `VoterRecord` | `[b"voter_record", proposal.key, voter.key]` | — |

### 2.16 `token-nvsc` (NVSC governance token)

Accounts: `TokenConfig` (CA). Thin mint/burn wrapper around SPL Token.

| Seed string | Account | Seeds | Authority |
|---|---|---|---|
| `b"token_config"` | `TokenConfig` | `[b"token_config", mint.key]` | — |

### 2.17 `ve-nvs` (vote-escrowed NVSC)

Accounts: `VeRegistry` (CA), `VeAccount` (CA)

| Seed string | Const | Account | Seeds | Authority |
|---|---|---|---|---|
| `b"ve-registry"` | `REGISTRY_SEED` | `VeRegistry` | `[REGISTRY_SEED]` | — |
| `b"ve"` | `VE_SEED` | `VeAccount` | `[VE_SEED, authority.key]` | — |
| `b"ve-vault"` | `VAULT_SEED` | ve vault ATA | `[VAULT_SEED]` | `VeRegistry` PDA |

### 2.18 `yield-distributor`

Accounts: `State` (CA), `UserYieldAccount` (CA), `ProtocolFeeAccount` (CA)

| Seed string | Const | Account | Seeds | Authority |
|---|---|---|---|---|
| `b"yield-authority"` | `YIELD_DISTRIBUTOR_AUTHORITY_SEED` | distributor signer | `[YIELD_DISTRIBUTOR_AUTHORITY_SEED]` | — |
| `b"protocol_fees"` | *(literal)* | `ProtocolFeeAccount` | `[b"protocol_fees"]` | — |
| `b"user_yield"` | *(literal)* | `UserYieldAccount` | `[b"user_yield", user.key]` | yield-authority PDA |
| `b"burn_state"` | *(literal)* | burn-state ATA | `[b"burn_state"]` | yield-authority PDA |

### 2.19 `yield-router` (yield deployment & atom recall)

Accounts: `YieldRouterConfig` (CA), `VenueRegistry` (CA), `WhitelistedVenue` (CA)

| Seed string | Const | Account | Seeds | Authority |
|---|---|---|---|---|
| `b"yr-config"` | `YR_CONFIG_SEED` | `YieldRouterConfig` | `[YR_CONFIG_SEED]` | — |
| `b"yr-venue-registry"` | `VENUE_REGISTRY_SEED` | `VenueRegistry` | `[VENUE_REGISTRY_SEED]` | — |
| `b"yr-venue"` | `WHITELISTED_VENUE_SEED` | `WhitelistedVenue` | `[WHITELISTED_VENUE_SEED, venue_count.to_le_bytes()]` → `[…, venue_index.to_le_bytes()]` | — |
| **CPI** `nv_usdc_vault::VAULT_CONFIG_SEED` | `b"nv-vault-config"` | nv `VaultConfig` | `[VAULT_CONFIG_SEED, usdc_mint]`, `seeds::program = nv_usdc_vault::ID` | — |
| **CPI** `nv_usdc_vault::VAULT_AUTHORITY_SEED` | `b"nv-vault-authority"` | nv authority PDA | `[VAULT_AUTHORITY_SEED, usdc_mint]` | — |

---

## 3. Cross-program CPI seed interlock

Three programs consume *foreign* PDA seeds in CPI / unchecked-account positions. **All of them must
use `seeds::program = <owner::ID>`**; the past absence of that clause caused the
`ConstraintSeeds` (2006) failures fixed during the sweep e2e work (see
[`AUDIT_GAP_ANALYSIS.md`](AUDIT_GAP_ANALYSIS.md)).

| Consumer | Foreign seed constant | Needs `seeds::program =` |
|---|---|---|
| `noviscia-clearing` | `nv_usdc_vault::VAULT_CONFIG_SEED`, `VAULT_AUTHORITY_SEED` | `nv_usdc_vault::ID` |
| `position-tracker` | `nv_usdc_vault::VAULT_CONFIG_SEED`, `VAULT_AUTHORITY_SEED`, `MINT_POOL_SEED` | `nv_usdc_vault::ID` |
| `yield-router` | `nv_usdc_vault::VAULT_CONFIG_SEED`, `VAULT_AUTHORITY_SEED` | `nv_usdc_vault::ID` |
| `staking-manager` | netting-engine `b"config"` (`NETTING_CONFIG_SEED`) | netting-engine `ID` |

> **Note:** `noviscia-clearing` §2.8 includes the two vault CPI seeds for exactness; the
> `ClaimUserFunds` path still derives `vault_config`/`vault_authority` against the clearing program
> id — a known latent follow-up (adding the override currently overflows the SBF stack frame; needs
> a struct split). Tracked in `AUDIT_GAP_ANALYSIS.md`.

---

## 4. Machine checks

- Regenerate/mine this table with:
  `grep -rn 'seeds = \[' programs/cluster-*//src | grep -v '/\.cache/'`
- Accounts: `grep -rln '#\[account\]' programs/cluster-*//src`
- Discriminators: Anchor account discriminator = `sha256("account:<StructName>")[0..8]`.
- Keep in sync per `INDEX.md` maintenance rule 1.