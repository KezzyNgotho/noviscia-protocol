import { Gateway, Sandbox } from './index';
import { PortfolioEngine } from './portfolio';

export class RiskOrchestrator {
  gateway: Gateway;
  constructor(gw: Gateway) { this.gateway = gw; }

  scanSandbox(sb: Sandbox) {
    const pe = new PortfolioEngine(sb);
    const report = pe.computePortfolioRisk({
      defaultMaintenanceMarginBps: 1000,
    });

    const payload = {
      type: report.marginShortfall > 0 ? 'margin_shortfall' : 'healthy',
      report,
      ts: Date.now(),
    };

    sb.write('last_risk_scan', payload);
    if (report.marginShortfall > 0) {
      sb.write('last_alert', payload);
      return { alert: true, report };
    }

    sb.write('last_ok', payload);
    return { alert: false, report };
  }
}
