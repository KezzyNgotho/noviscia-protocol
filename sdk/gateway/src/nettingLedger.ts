export type TradeRecord = { tenant: string; market: string; side: 'long'|'short'; notionalUsdc: number };

export class NettingLedger {
  private trades: TradeRecord[] = [];

  recordTrade(t: TradeRecord) { this.trades.push(t); }

  computeNettingReport(market: string) {
    const marketTrades = this.trades.filter(t => t.market === market);
    const grossLongUsdc = marketTrades.filter(t => t.side === 'long').reduce((s,t) => s + t.notionalUsdc, 0);
    const grossShortUsdc = marketTrades.filter(t => t.side === 'short').reduce((s,t) => s + t.notionalUsdc, 0);
    const nettedExposureUsdc = Math.abs(grossLongUsdc - grossShortUsdc);
    const gross = Math.max(grossLongUsdc, grossShortUsdc);
    const nettingBenefitUsdc = Math.max(0, (grossLongUsdc + grossShortUsdc) - nettedExposureUsdc);
    return { grossLongUsdc, grossShortUsdc, nettedExposureUsdc, nettingBenefitUsdc };
  }

  /** Return unique tenant/trader ids that have trades in this market */
  getTradersForMarket(market: string) {
    const marketTrades = this.trades.filter(t => t.market === market);
    const uniq = Array.from(new Set(marketTrades.map(t => t.tenant)));
    return uniq;
  }
}
