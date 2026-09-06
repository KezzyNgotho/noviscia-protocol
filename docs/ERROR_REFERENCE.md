# Noviscia — Cross-Program Error Reference

> **Purpose:** Deterministic error-code catalog for all 19 programs. Integrators can resolve any
> on-chain error number from the RPC / UI to a variant and its meaning.
>
> **Status:** Generated from `programs/cluster-*/` (Anchor 0.31.x). Sync in the same PR as any
> program change. **Last updated:** September 2026

---

## 1. How error codes work here

| Source | Rule | Space |
|---|---|---|
| Custom program errors (`#[error_code]` enums) | `code = 6000 + variant_index` (declaration order, 0-based) | 6000–~6150 |
| Switchboard reading errors (`XOracleError`, both clearing & position-tracker) | explicit base, `code = 500 + variant_index` | 500–507 |
| Anchor framework/constraint errors (seeds, discriminator, etc.) | Anchor's own `Error` space (below 6000; stable per anchor-lang version) | < 1000 / 1000–4000 |

Two verified framework codes (from this repo's test logs, anchor-lang 0.31):

| code | Anchor variant | Trigger |
|---|---|---|
| 2006 | `ErrorCode::ConstraintSeeds` | PDA derived from supplied seeds `≠` account at the `seeds::program` owner (root class of the CPI seed bugs — see [`ACCOUNT_MAP.md`](ACCOUNT_MAP.md) §3) |
| 3004 | `ErrorCode::AccountDidNotSerialize` | Account size/mutation inconsistency (fixed in `save_position_to_info` overrun) |

> Note: numeric values of anchor framework errors can shift with the anchor-lang patch; both above
> were reproduced on the pinned `0.31.x`. All program-space codes below are raw transaction error
> numbers surfaced by the RPC (`instruction_error.custom.0`) and are the **same** numbers to map in
> the UI error tables.

## 2. Per-program catalog

### 2.1 `noviscia-clearing` — `ClearingError` (base 6000)

```
6000 TitleTooLong                      6001 DescriptionTooLong
6002 CategoryTooLong                   6003 InvalidOutcomeCount
6004 OutcomeNameTooLong                6005 InvalidEndTime
6006 FeeTooHigh                        6007 InvalidProbability
6008 ProbabilitiesMustSumTo100         6009 InvalidOracleBinding
6010 Paused                            6011 OperationPaused
6012 MarketNotActive                   6013 MarketEnded
6014 MarketAlreadyResolved             6015 MarketNotEnded
6016 MarketNotResolved                 6017 MarketActive
6018 MarketNotCancelled                6019 ResolutionNotProposed
6020 ResolutionStillPending            6021 DisputeWindowClosed
6022 ResolutionAlreadyConfirmed        6023 OracleRequired
6024 ManualOnly                        6025 OracleStale
6026 PriceDeviationExceeded            6027 PriceDeviationAbsoluteExceeded
6028 OracleProgramMismatch             6029 Unauthorized
6030 NotCreator                        6031 MismatchedOutcome
6032 AlreadyClaimed                    6033 AdminSuperseded
6034 TimelockPending                   6035 TimelockNotElapsed
6036 InvalidAdminTimelock              6037 InvalidNettingVenue
6038 NettingNotConfigured              6039 InvalidConfigLayout
6040 InvalidConfigDiscriminator        6041 StateHashMismatch
6042 InvalidRefund                     6043 NoFeesAvailable
6044 InvalidAmount                     6045 InvalidOutcome
6046 Overflow                          6047 InsufficientLiquidity
6048 OracleConfidenceTooHigh           6049 SwitchboardFeedMissing
6050 SwitchboardFeedRejected           6051 InvalidSwitchboardFeed
6052 EmptySweepBatch                   6053 DuplicatePositionInBatch
6054 InvalidSweepPosition
```

### 2.2 `position-tracker` — `PositionError` (base 6000)

```
6000 Paused                            6001 Unauthorized
6002 MarketInactive                    6003 InvalidSize
6004 InvalidPrice                      6005 LeverageExceeded
6006 InsufficientMargin                6007 OracleStale
6008 FeedIdMismatch                    6009 PositionHealthy
6010 PositionInsolvent                 6011 SettlementVaultInsufficient
6012 MathOverflow                      6013 InvalidAccountSize
6014 TriggerNotMet                     6015 OrderExpired
6016 DelegateInvalid                   6017 TwapComplete
6018 TwapIntervalNotElapsed            6019 FundingSettleTooSoon
6020 AdlNotEligible                    6021 AdlInvalidCounterposition
6022 OrdersNotCompatible               6023 UnsafeLeverageConfig
6024 PortfolioRiskConfigMissing        6025 PortfolioRiskFeedMissing
6026 PortfolioRiskAccountInvalid       6027 PortfolioRiskAccountsMissing
6028 ReduceOnlyViolation               6029 CloseAmountExceedsPosition
6030 CloseBelowMinimum                 6031 RemoveMarginInsufficient
6032 NoPositionForMargin               6033 StopTriggerNotMet
6034 InvalidOrderType                  6035 InvalidTif
6036 PriceDeviationExceeded            6037 CommitmentExpired
6038 CommitmentMismatch                6039 CommitmentInvalid
6040 CommitmentNotFound                6041 SignatureVerificationFailed
6042 PortfolioNotFound                 6043 PortfolioVaultMismatch
6044 PortfolioInsufficientFreeShares   6045 PortfolioMaxPositions
6046 PortfolioAccountsMissing          6047 TimelockNotExpired
6048 NoPendingMigration                6049 NoPendingMigrationToCancel
6050 MigrationAlreadyExpired           6051 InvalidTimelockDuration
6052 SameAdminProposed                 6053 FeedNotRegistered
6054 FeedRegistryFull                  6055 FeedAlreadyRegistered
6056 AdminSuperseded                   6057 DelegationTooLong
6058 DelegationTooShort                6059 MissingAccounts
6060 OracleTwapDeviationExceeded       6061 PositionSizeExceedsCap
6062 OpenInterestExceedsCap            6063 OperationPaused
6064 EmergencyPaused                   6065 InvalidCircuitBreakerValue
6066 PartialLiqCooldownActive          6067 PositionHealthyForPartialLiq
6068 CollateralNotRegistered           6069 CollateralDepositZero
6070 InsufficientCollateralBalance     6071 CollateralOracleStale
6072 CollateralWithdrawalExceedsFree   6073 InvalidMintPoolPda
6074 BitmapStale                       6075 BitmapMismatch
6076 HealthTrackerMismatch             6077 BitmapOverflow
6078 MarketInDutchAuction              6079 MarketNotInDutchAuction
6080 DutchAuctionGracePeriod           6081 VolatilityTrackerMismatch
6082 OrderBookFull                     6083 OrderBookMismatch
6084 MakerPriceDeviationExceeded       6085 InsufficientBookDepth
6086 MakerOrderNotResting              6087 MakerPriceMismatch
6088 MakerOrderTooLarge                6089 MakerPositionInUse
6090 UnsupportedMarginMode             6091 PriceDeviationAbsoluteExceeded
6092 OracleTwapDeviationOpenCloseExceeded 6093 InsufficientLiquidityForLiquidation
6094 InsufficientVaultLiquidity        6095 ReentrancyDetected
6096 LiquidationSlippageExceeded       6097 EmergencyPauseActive
6098 FundingDeltaExceedsCap            6099 MaxPositionsExceeded
6100 InsuranceFundBelowFloor           6101 StateHashMismatch
6102 FundingRateLimitExceeded          6103 OracleConfidenceTooHigh
6104 InvalidAccount                    6105 SwitchboardFeedMissing
6106 SwitchboardFeedRejected
```

### 2.3 `nv-usdc-vault` — `VaultError` (base 6000)

```
6000 Unauthorized                      6001 InvalidAmount
6002 Paused                            6003 InvalidNav
6004 InsufficientShares                6005 InsufficientLiquidity
6006 InvalidBuffer                     6007 Overflow
6008 Underflow                         6009 InvalidAccountSize
6010 UtilizationTooHigh                6011 RedemptionCapExceeded
6012 WithdrawalRateLimited             6013 MintPoolDisabled
6014 NothingToClaim                    6015 NothingToCompound
6016 InsuranceBufferFloorBreached      6017 AssetCeilingExceeded
6018 AssetRiskDisabled                 6019 PrincipalPartitionViolation
6020 InvalidPartitionParams            6021 SlippageSharesTooLow
6022 SlippageRedeemTooLow              6023 AdminMigrationPending
6024 NoPendingMigration                6025 MigrationNotEffective
6026 NotCurrentAdmin                   6027 SameAdminProposed
6028 AdminSuperseded                   6029 InsufficientMintPoolLiquidity
6030 DefaultFundInsufficient           6031 CcpEquityInsufficient
6032 InvalidCcpTarget                  6033 ReserveCutExceedsAmount
6034 YieldReceivableInsufficient       6035 OperationCooldownActive
6036 CooldownActive                    6037 InsufficientBalance
6038 NoRewardsAvailable                6039 InvalidSleevePolicySplit
6040 CoreSleeveViolation               6041 AlphaSleeveViolation
```

### 2.4 `jit-risk` — `JitRiskError` (base 6000)

```
6000 Frozen            6001 Unauthorized   6002 ZeroAmount     6003 AmountTooLarge
6004 MmNotRegistered   6005 MmNotActive    6006 MmSuspended    6007 MathOverflow
6008 InvalidWritableBps 6009 InvalidRiskBudget 6010 InvalidMaxSlotAge 6011 InvalidParams
6012 DeltaBelowFloor   6013 DeltaAboveCeiling 6014 CapacityExhausted 6015 CreditExceeded
6016 ReceiptExists     6017 ReceiptNotFound 6018 ReceiptNotReserved 6019 ReceiptExpired
6020 ReceiptNotExpired 6021 InvalidDelta   6022 LossRatioFreeze 6023 InsufficientVaultBalance
6024 InvalidInsuranceSource 6025 InsuranceSourceTruncated
```

### 2.5 `noviscia-asset-engine` — `AssetError` (base 6000)

```
6000 InvalidTargetSlot    6001 InsufficientPoolLiquidity  6002 CreditLimitExceeded
6003 ArithmeticOverflow   6004 AssetNotActive             6005 AssetCapacityCeilingExceeded
6006 PremiumMismatch      6007 ZeroAmount                 6008 EnginePaused
6009 CreditLineFrozen     6010 UnauthorizedAuthority      6011 UnsupportedDecimals
6012 InvalidDecimals      6013 InvalidPremiumConfiguration 6014 InvalidMint
6015 NoLiquidityToRecredit 6016 InsufficientDeskBalance   6017 FeeVaultEmpty
6018 KycProofInvalid      6019 WindowOverdue              6020 WindowBreached
6021 NothingToSettle      6022 LateFeeMismatch            6023 InsufficientPrincipalPayment
6024 InsufficientPremiumPayment 6025 AssetUnsupported      6026 ZeroShares
6027 InsufficientLpShares 6028 InsufficientIdleReserve   6029 LpPositionOwnerMismatch
6030 InvalidLpSplit
```

### 2.6 `liquidation-vault` — `VaultError` (base 6000; name collides with nv-usdc-vault)

```
6000 InvalidAmount        6001 WithdrawCooldownActive    6002 InsufficientShares
6003 InsufficientVaultLiquidity 6004 VaultCapacityExceeded 6005 NoProfitToDistribute
6006 InvalidLiquidation   6007 Overflow                  6008 Underflow
6009 Unauthorized         6010 VaultHealthy              6011 NoWithdrawRequest
6012 WithdrawRequestPending 6013 WithdrawRequestCooldownActive 6014 InvalidAccountSize
```

### 2.7 `netting-engine` — `NettingError` (base 6000)

```
6000 Unauthorized            6001 Paused                6002 VenueLimitReached
6003 InvalidVenueId          6004 VenueAlreadyExists    6005 VenuePaused
6006 NotVenueOwner           6007 InvalidSide           6008 Overflow
6009 ConsolidationCooldownActive 6010 TooManyNettingSets 6011 InvalidConfigLayout
6012 InvalidConfigDiscriminator 6013 SetAlreadyEmpty    6014 NotDeltaNeutral
```

### 2.8 `clearing-registry` — `RegistryError` (base 6000)

```
6000 Unauthorized     6001 RegistryPaused     6002 TenantLimitReached
6003 InvalidFeeBps    6004 InvalidStatus      6005 TenantNotActive
6006 InvalidVenueKind 6007 InvalidNettingConfig 6008 MathOverflow
```

### 2.9 `gateway-auction` — `AuctionError` (base 6000)

```
6000 BidNotTop         6001 RequiresSettlement  6002 AuctionNotElapsed
6003 SlotAlreadySettled 6004 NoAuction          6005 StaleSlot
6006 ZeroTip           6007 InvalidRecipient    6008 NoRefund
6009 NotPrevBidder
```

### 2.10 `noviscia-capacity` — `CapacityError` (base 6000)

```
6000 Unauthorized        6001 ClientFrozen      6002 EnginePaused
6003 KycProofInvalid     6004 KycExpired        6005 CreditCapacityInsufficient
6006 UtilizationExceedsGrant 6007 SlotMismatch  6008 SlotNotEnded
6009 AlreadySettled      6010 ZeroAmount        6011 BadPricing
6012 ArithmeticOverflow  6013 MarginInsufficient 6014 InvalidSignature
```

### 2.11 `noviscia-credit-line` — `CreditLineError` (base 6000)

```
6000 TollRange      6001 CapInvalid      6002 Unauthorized
6003 NotAuthorized  6004 ZeroAmount      6005 Overflow
6006 OverCreditLimit 6007 OverGlobalCap  6008 InsufficientVault
6009 RepayExceedsOutstanding 6010 UnderfundedRepay 6011 OverBorrowerCap
```

### 2.12 `noviscia-permissioned-pool` — `PoolError` (base 6000)

```
6000 Unauthorized      6001 FeeTooHigh         6002 InsuranceCutExceedsFee
6003 ZeroAmount        6004 ZeroShares         6005 PoolPaused
6006 PoolEmpty         6007 LpNotVerified      6008 LpNotActive
6009 InvalidMerkleProof 6010 KycExpired        6011 ExceedsAllocationLimit
6012 InsufficientShares 6013 SlippageExceeded
```

### 2.13 `noviscia-tranche-vault` — `TrancheError` (base 6000)

```
6000 Unauthorized       6001 VaultPaused     6002 ZeroAmount
6003 ProtectedCapExceeded 6004 ProtectedShareExceeded 6005 LossCapExceeded
6006 NoShares           6007 ArithmeticOverflow 6008 WrongTranche
```

### 2.14 `sovereign-netting` — `SovereignError` (base 6000)

```
6000 Unauthorized       6001 NotReporter       6002 Disabled
6003 MathOverflow       6004 InvalidRate       6005 InvalidUrCap
6006 InvalidAlpha       6007 InvalidBucketGeometry 6008 TooManyReporters
6009 BidBelowMinimum    6010 CapacityBreach    6011 AuctionSlotLocked
6012 ZeroAmount         6013 Insolvency        6014 SleeveBreach
```

### 2.15 `staking-manager` — `StakingError` (base 6000)

```
6000 InvalidAmount      6001 AmountTooLow      6002 InsufficientStake
6003 CooldownActive     6004 NoRewards         6005 MaxPositionsExceeded
6006 PositionNotFound   6007 InsufficientLiquidationVault 6008 InvalidLiquidationVaultAmount
6009 InsufficientLiquidationVaultShares 6010 CircuitBreakerActive 6011 EmergencyShutdown
6012 OracleDeviationTooHigh 6013 InsufficientMargin 6014 PositionWouldBeLiquidated
6015 Overflow           6016 Underflow         6017 Unauthorized
6018 VotingClosed       6019 AlreadyExecuted   6020 QuorumNotMet
6021 VotingStillOpen    6022 ProposalFailed    6023 ProtocolPaused
6024 InvalidAccountSize 6025 StakingFeeVaultNotEmpty 6026 AlreadyVoted
6027 UnknownProposalAction 6028 InvalidProposalParams 6029 NoValidVeAccount
6030 ZeroVoteWeight     6031 TimelockPending   6032 NotAuthorizedToExecute
6033 MissingNettingConfig
```

### 2.16 `token-nvsc` — `TokenError` (base 6000)

```
6000 InvalidAmount  6001 InvalidMetadata  6002 TokenNotInitialized  6003 Unauthorized
```

### 2.17 `ve-nvs` — `VeError` (base 6000)

```
6000 InvalidLockEnd  6001 LockExpired  6002 StillLocked  6003 Overflow
```

### 2.18 `yield-distributor` — `YieldError` (base 6000)

```
6000 InvalidAmount  6001 NoYield  6002 Overflow  6003 Underflow
6004 Unauthorized   6005 UnauthorizedCaller  6006 InsufficientFees  6007 CompensationExceedsEarned
```

### 2.19 `yield-router` — `YieldRouterError` (base 6000)

```
6000 InvalidAmount  6001 Unauthorized  6002 Paused  6003 VenueNotWhitelisted
6004 DeploymentCapExceeded  6005 VenueLimitReached  6006 InvalidDeploymentCap
```

### 2.20 `XOracleError` (shared, base 500 — clearing & position-tracker, identical)

```
500 WrongSwitchboardOwner      501 AggregatorTooSmall
502 BadAggregatorDiscriminator 503 InsufficientOracleResults
504 StaleSwitchboardFeed       505 NonPositiveAggregatorValue
506 AggregatorScaleOutOfRange  507 CrossOracleSkew
```

> `507 CrossOracleSkew` = Pyth vs Switchboard diverge by > ±35 bps (fixed-point 1e6).

## 3. Common failure signatures (diagnosis aid)

| Symptom | Likely code(s) | Diagnosis |
|---|---|---|
| `ConstraintSeeds` 2006 on sweep/cap-wired flows | 2006 | Foreign-PDA CPI seeded against wrong `program` (see `ACCOUNT_MAP.md` §3) |
| `AccountDidNotSerialize` 3004 on settle/claim | 3004 | Account struct mutated during the tx (see sweep fixes) |
| `WaitForSoftConfirmation` / "not confirmed" | — | TX expired before confirmed; retry via bundle |
| `MismatchedOutcome` 6031 / `AlreadyClaimed` 6032 | 6031 / 6032 | Market settlement vs claim ordering in sweep e2e (`scripts/e2e/`) |
| `PositionHealthBitmap`/`HealthTrackerMismatch` 6075/6076 | 6075 / 6076 | Portfolio risk-bucket drift; run margin refresh |
| `TokenNotInitialized` 6002 | 6002 | NVSC mint not initialized on the target cluster |

## 4. Maintenance

- Regenerate with: extract each `#[error_code]` enum and index variants in declaration order
  (`grep -n '#\[error_code\]' programs/cluster-*//src` marks the enums).
- New variant appended to the **end** of the enum to preserve existing codes.
- Renaming/removing a variant breaks RPC clients tracking codes — ban in the audit gate
  (`mainnet-readiness` checklist).