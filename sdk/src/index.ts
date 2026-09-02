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
