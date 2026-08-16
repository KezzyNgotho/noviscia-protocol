import { Gateway } from './index';
import { NettingLedger } from './nettingLedger';
import { TenantSandbox } from './tenantSandbox';

export type ExecutionRequest = { tenant: string; adapter: string; market?: string; side?: 'long'|'short'; notionalUsdc?: number; params?: any };

export class ExecutionEngine {
  gateway: Gateway;
  ledger: NettingLedger;
  constructor(gw: Gateway, ledger: NettingLedger) { this.gateway = gw; this.ledger = ledger; }

  async execute(req: ExecutionRequest, signer: any, sandbox?: TenantSandbox) {
    // tenant isolation
    if (sandbox && sandbox.tenantId !== req.tenant) throw new Error('sandbox-mismatch');
    if (sandbox && !sandbox.canAccess(req.adapter)) throw new Error('adapter-not-allowed');

    // record intent in ledger (for netting)
    if (req.market && req.side && req.notionalUsdc) {
      this.ledger.recordTrade({ tenant: req.tenant, market: req.market, side: req.side, notionalUsdc: req.notionalUsdc });

      // simple policy: when opposing-side netting benefit exceeds threshold, record a netting settlement
      const rpt = this.ledger.computeNettingReport(req.market);
      const threshold = Math.max(1000, Math.floor((rpt.grossLongUsdc + rpt.grossShortUsdc) * 0.2));
      if (rpt.nettingBenefitUsdc >= threshold) {
        // PoC: call gateway.settleNetting to publish report
        this.gateway.settleNetting(req.market, rpt);
      }

      // if account value > required margin by a sizeable delta, trigger an atomic recall to redeploy idle margin
      // (PoC heuristic: recall when nettingBenefit is large and there's a sandbox)
      if (sandbox && rpt.nettingBenefitUsdc > 0) {
        // recall up to nettingBenefitUsdc / 2 as a PoC amount
        const recallAmount = Math.floor(rpt.nettingBenefitUsdc / 2);
        if (recallAmount > 0) this.gateway.recallForMargin(sandbox.id, recallAmount);
      }
    }

    // build and optionally dry-run via gateway
    const result = await this.gateway.executeAdapterAction(req.adapter, { market: req.market, side: req.side, sizeUsdc: req.notionalUsdc, params: req.params }, signer, sandbox?.id);

    if (sandbox) {
      sandbox.recordExecution({ adapter: req.adapter, payload: { market: req.market, side: req.side, notionalUsdc: req.notionalUsdc } });
    }

    return result;
  }
}
