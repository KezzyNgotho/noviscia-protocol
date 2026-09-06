/**
 * @noviscia/sdk — Universal Noviscia Developer SDK.
 *
 * Single entry point exposing:
 *   - ids:         every program id + mint, env-overridable
 *   - addresses:   PDA derivation for position-tracker, netting-engine,
 *                  yield-router, nv-usdc-vault, burn/staking fee routing
 *   - NovisciaClient: anchor program wrappers over the whole stack
 *   - CollateralGateway: the Unified Collateral Gateway (deposit / withdraw /
 *                  open / liquidate / recall) — intent → instructions
 *   - translate / digest: payload translators (execution, clearing, netting
 *                  report, liquidation, recall)
 *   - sandbox:     simulate-first dry-runs, account-existence pre-checks,
 *                  JIT price fetching
 */
export * from './ids';
export * from './addresses';
export { NovisciaClient, loadCliWallet, type NovisciaClientOptions } from './client';
export { CollateralGateway, type Side, type CollateralIntent } from './collateral';
export {
  translate, translateExecutionOrder, translateClearingOrder, translateNettingReport,
  translateRecall, translateLiquidation, digest,
  type TranslationKind, type TranslationRequest, type TranslationResult,
} from './payloads';
export {
  simulate, assertAccountsExist, toAccountMetas, fetchJitPrice,
  SandboxSimulator,
  type SimulationReport, type SimulatedPosition, type SimulatedMarketData, type MarginCheckResult,
} from './sandbox';
export {
  TenantOnboarding,
  CLEARING_REGISTRY_PROGRAM_ID as REGISTRY_PROGRAM_ID,
  type TenantRegistrationParams,
  type ExistingTenantParams,
  type NewTenantParams,
  type TenantAccounts,
} from './tenantOnboarding';
export {
  JitRiskClient,
  JIT_RISK_PROGRAM_ID,
} from './jitRisk';
export {
  CreditLineClient,
  CREDIT_LINE_PROGRAM_ID,
  LP_NAV_SPLIT_BPS,
  TREASURY_SPLIT_BPS,
  getBorrowerUsdc,
  type CreditLineState,
  type BorrowerState,
} from './creditLine';
export {
  ASSET_ENGINE_PROGRAM_ID,
  registryPDA,
  assetPoolPDA,
  assetVaultPDA,
  assetFeeVaultPDA,
  assetAuthorityPDA,
  creditLinePDA,
  deskPositionPDA,
  assetLpMintPDA,
  assetLpPositionPDA,
  anchorDiscriminator,
  buildInitializeIx,
  buildRegisterAssetIx,
  buildUpdateAssetParamsIx,
  buildSetAssetSupportIx,
  buildInitializeCreditLineIx,
  buildUpdateCreditLimitIx,
  buildSetCreditFrozenIx,
  buildSetPausedIx,
  buildAllocateAssetCapacityIx,
  buildRecreditAssetCapacityIx,
  buildSetKycRootIx,
  buildSettleDailyIx,
  buildDepositAssetLiquidityIx,
  buildWithdrawAssetLiquidityIx,
  buildWithdrawAssetFeesIx,
  registerAssetDefault,
  computePremium,
  computeLateFee,
  windowPosture,
  computeDepositShares,
  computeLpWithdrawValue,
  computeLpSharePrice,
  NVSC_PROFILE,
  USDC_PROFILE,
  WSOL_PROFILE,
  WINDOW_SLOTS,
  GRACE_SLOTS,
  LATE_FEE_BASE,
  LATE_FEE_RATE_BPS,
  type AssetParams,
  type AssetEngineRegistry,
  type InstitutionalCreditLine,
  type DeskPosition,
  type AssetPool,
  type WindowPosture,
} from './assetEngine';
export {
  JitoBundleClient,
  JitoRpcError,
  assembleVersionedTransactions,
  buildTipInstruction,
  selectTipAccount,
  resolveBundleTipLamports,
  JITO_BLOCK_ENGINE_URLS,
  KNOWN_JITO_TIP_ACCOUNTS,
  BUNDLE_MAX_TRANSACTIONS,
  DEFAULT_TIP_LAMPORTS,
  type BundleTipLimits,
  type JitoBundleStatus,
  type AssembleBundleOptions,
} from './jito';
export {
  leaderIsJito,
  guardNonJitoLeaderSlot,
  assertJitoLeader,
  NonJitoLeaderError,
  type LeaderEligibility,
} from './ability';
export {
  referenceTvvParams,
  defaultTvvParams,
  seniorTrancheUsdCents,
  juniorTrancheUsdCents,
  totalSlotsPerYear,
  eligibleSlots,
  systemicCapUsdCents,
  deskCapUsdCents,
  activeUtilizationUsdCents,
  slotFeeMicroUsd,
  grossRevenueUsdCents,
  netRevenueUsdCents,
  difAllocationUsdCents,
  totalLpYieldUsdCents,
  seniorYieldUsdCents,
  juniorYieldUsdCents,
  circuitBreakerDrainUsdCents,
  juniorDrainRatioBps,
  hardLockTriggered,
  ECONOMICS_BPS,
  MICRO_DOLLARS_PER_CENT,
  SLOT_SECONDS_NUM,
  SLOT_SECONDS_DEN,
  SECONDS_PER_YEAR,
  type TvvParams,
} from './economics';
export {
  FIXED_1E18,
  SLOTS_PER_SECOND_NUM,
  SLOTS_PER_SECOND_DEN,
  SLOTS_PER_DAY,
  COMPOUNDING_PERIODS_PER_YEAR,
  capitalTurnoverPerYear,
  slotPremiumScalingFactor,
  perTurnPremiumMicroUsd,
  aggregatedPremiumBps,
  dailyTransactionalPowerUsdCents,
  dailyVolumeVelocityUsd,
  grossApyTenthsBps,
  grossApyTenthsBpsAtActiveVolume,
  perSlotRevenueUsdCents,
  formulaDReconciles,
  jitoGapBps,
  jitoTipSlippageUsdCents,
  compoundedApyTenthsBps,
} from './velocity';
export {
  ACCELERATION,
  REAL_SLOTS_PER_DAY,
  REAL_GRACE_SLOTS,
  WINDOW_SANDBOX_SLOTS,
  GRACE_SANDBOX_SLOTS,
  SANDBOX_CADENCE_MS,
  realToSandboxSlots,
  sandboxToRealSlots,
  postureAt,
  Posture as SandboxPosture,
  windowWallClockSeconds,
} from './sandboxClock';
export {
  describePosture,
  frozenDesks,
  anyFrozen,
  sandboxSlotsToWallMs,
  type FrozenDesk,
} from './sandboxAccelerator';
export {
  DEFAULT_INPUTS,
  inputsToParams,
  computeWorkbook,
  referenceWorkbook,
  stressTestSpreadsheet,
  buildWorkbookCsv,
  excelSlotsPerYear,
  excelEligibleSlots,
  excelActiveVolume,
  excelMicroPremium,
  excelGrossRevenue,
  excelNetRevenue,
  excelLpPayout,
  type SpreadsheetInputs,
  type Workbook,
  type StressResult,
} from './spreadsheet';
