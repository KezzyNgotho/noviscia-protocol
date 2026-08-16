import { Sandbox } from './index';

export type PositionRow = {
  id: string;
  market: string;
  notionalUsdc: number;
  side: 'long' | 'short';
  entryPrice: number;
  collateralUsdc: number;
  maintenanceMarginBps?: number;
};

export type PortfolioRiskOptions = {
  marketCorrelations?: Record<string, Record<string, number>>;
  defaultMaintenanceMarginBps?: number;
};

export type PortfolioRiskReport = {
  totalExposureUsdc: number;
  totalCollateralUsdc: number;
  totalRequiredMargin: number;
  marginShortfall: number;
  nettingBenefitUsdc: number;
  marketBreakdown: Array<{
    market: string;
    grossExposureUsdc: number;
    netExposureUsdc: number;
    requiredMarginUsdc: number;
    correlationFactor: number;
  }>;
};

export class PortfolioEngine {
  sandbox: Sandbox;
  constructor(sb: Sandbox) { this.sandbox = sb; }

  addPosition(p: PositionRow) {
    const cur = this.sandbox.read('positions') || [];
    cur.push(p);
    this.sandbox.write('positions', cur);
  }

  listPositions(): PositionRow[] { return this.sandbox.read('positions') || []; }

  computeRequiredMargin(leverage = 2): { required: number; collateral: number; shortfall: number } {
    const report = this.computePortfolioRisk({ defaultMaintenanceMarginBps: Math.round(10000 / leverage) });
    return {
      required: report.totalRequiredMargin,
      collateral: report.totalCollateralUsdc,
      shortfall: report.marginShortfall,
    };
  }

  computePortfolioRisk(options: PortfolioRiskOptions = {}): PortfolioRiskReport {
    const positions = this.listPositions();
    const defaultMaintenanceMarginBps = options.defaultMaintenanceMarginBps ?? 1000;
    const marketCorrelations = options.marketCorrelations ?? {};

    const byMarket = new Map<string, { grossExposureUsdc: number; netExposureUsdc: number; collateralUsdc: number; requiredMarginUsdc: number; correlationFactor: number }>();

    for (const pos of positions) {
      const market = pos.market;
      const bucket = byMarket.get(market) ?? {
        grossExposureUsdc: 0,
        netExposureUsdc: 0,
        collateralUsdc: 0,
        requiredMarginUsdc: 0,
        correlationFactor: 1,
      };

      const signedNotional = pos.side === 'long' ? pos.notionalUsdc : -pos.notionalUsdc;
      bucket.grossExposureUsdc += Math.abs(pos.notionalUsdc);
      bucket.netExposureUsdc += signedNotional;
      bucket.collateralUsdc += pos.collateralUsdc ?? 0;
      byMarket.set(market, bucket);
    }

    const marketBreakdown = Array.from(byMarket.entries()).map(([market, bucket]) => {
      const maintenance = ((marketCorrelations[market]?.[market] ?? 1) * (defaultMaintenanceMarginBps / 10000));
      const requiredMargin = Math.max(0, Math.abs(bucket.netExposureUsdc)) * maintenance;
      const correlationFactor = marketCorrelations[market]?.[market] ?? 1;
      return {
        market,
        grossExposureUsdc: bucket.grossExposureUsdc,
        netExposureUsdc: bucket.netExposureUsdc,
        requiredMarginUsdc: requiredMargin,
        correlationFactor,
      };
    });

    const totalExposureUsdc = positions.reduce((sum, pos) => sum + Math.abs(pos.notionalUsdc), 0);
    const totalCollateralUsdc = positions.reduce((sum, pos) => sum + (pos.collateralUsdc ?? 0), 0);
    const grossLong = positions.filter((pos) => pos.side === 'long').reduce((sum, pos) => sum + pos.notionalUsdc, 0);
    const grossShort = positions.filter((pos) => pos.side === 'short').reduce((sum, pos) => sum + pos.notionalUsdc, 0);
    const netExposure = Math.abs(grossLong - grossShort);
    const nettingBenefitUsdc = Math.max(0, totalExposureUsdc - netExposure);
    const totalRequiredMargin = Math.max(0, netExposure) * (defaultMaintenanceMarginBps / 10000);

    return {
      totalExposureUsdc,
      totalCollateralUsdc,
      totalRequiredMargin,
      marginShortfall: Math.max(0, totalRequiredMargin - totalCollateralUsdc),
      nettingBenefitUsdc,
      marketBreakdown,
    };
  }
}
