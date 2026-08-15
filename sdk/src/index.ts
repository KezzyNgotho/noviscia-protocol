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
  type SimulationReport,
} from './sandbox';
