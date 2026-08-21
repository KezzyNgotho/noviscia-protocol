import { Connection } from '@solana/web3.js';
import * as http from 'http';

/**
 * Price Feed Service - Fetches prices from Pyth
 * 
 * Supported oracles:
 * - Pyth Network (primary)
 * 
 * Pairs: SOL/USD, BTC/USD, ETH/USD, USDC/USD
 */
export class PriceFeedService {
  private connection: Connection;
  private rpcUrl: string;
  private prices: Map<string, { price: number; confidence: number; timestamp: number }> = new Map();

  // Pyth price accounts (devnet)
  private pythAccounts: Record<string, string> = {
    'SOL/USD': 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3FxpuPgKmNzWN', // Example, use real devnet account
    'BTC/USD': '99B2bTijsU6f1GCTVIYCcff5d6gKSrfo4E3q6f1215j',
    'ETH/USD': '5SSkm8NtrFQDonaunFeujPgMxrnAz8HS2roMkAtUvipJ',
    'USDC/USD': 'Gnt27xtC473ZT2Mw5u8wZ68Z3gULkSqsPJQ5Tz1Rr7Q',
  };

  constructor(rpcUrl: string = process.env.SOLANA_RPC_DEVNET || '') {
    this.rpcUrl = rpcUrl;
    this.connection = new Connection(rpcUrl, 'confirmed');
  }

  /**
   * Start price feed polling
   */
  async start(): Promise<void> {
    console.log('💹 Price Feed Service started');

    // Update prices every 5 seconds
    setInterval(() => {
      this.updatePrices().catch(console.error);
    }, 5000);

    // Initial update
    await this.updatePrices();
  }

  /**
   * Update all prices
   */
  private async updatePrices(): Promise<void> {
    try {
      for (const symbol of ['SOL/USD', 'BTC/USD', 'ETH/USD', 'USDC/USD']) {
        const price = await this.getAggregatedPrice(symbol);
        if (price) {
          this.prices.set(symbol, price);
          this.emit('price', symbol, price); // Emit for WebSocket broadcast
        }
      }
    } catch (error) {
      console.error('❌ Error updating prices:', error);
    }
  }

  /**
   * Get aggregated price (Pyth)
   */
  async getAggregatedPrice(symbol: string): Promise<{ price: number; confidence: number; timestamp: number } | null> {
    try {
      return await this.getPythPrice(symbol);
    } catch (error) {
      console.error(`❌ Error getting aggregated price for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Get price from Pyth
   */
  private async getPythPrice(symbol: string): Promise<{ price: number; confidence: number; timestamp: number } | null> {
    const feedHex: Record<string, string> = {
      'SOL/USD': process.env.PYTH_SOL_FEED_HEX || 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d',
      'BTC/USD': 'e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
      'ETH/USD': 'ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
      'USDC/USD': 'eaa020c61cc4797128134ce9572db7b777001d538a9f38636d33b7b1d20a9302',
    };
    const hex = feedHex[symbol];
    if (!hex) return null;
    try {
      const url = `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${hex}&parsed=true`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;
      const json = (await res.json()) as { parsed?: { price?: { price: string; conf: string; expo: number } }[] };
      const p = json.parsed?.[0]?.price;
      if (!p) return null;
      const scale = 10 ** Math.abs(p.expo);
      const price = Number(p.price) / scale;
      const confidence = Number(p.conf) / scale;
      return { price, confidence, timestamp: Date.now() };
    } catch (error) {
      console.error(`❌ Error getting Pyth price for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Get current price
   */
  getPrice(symbol: string): number | null {
    const priceData = this.prices.get(symbol);
    return priceData?.price || null;
  }

  /**
   * Get all prices
   */
  getAllPrices(): Record<string, number> {
    const allPrices: Record<string, number> = {};
    for (const [symbol, data] of this.prices.entries()) {
      allPrices[symbol] = data.price;
    }
    return allPrices;
  }

  /**
   * Calculate liquidation price
   * 
    * liquidation_price = entry_price * (1 - 5 * maintenance_margin / leverage) for longs
    * liquidation_price = entry_price * (1 + 5 * maintenance_margin / leverage) for shorts
   */
  calculateLiquidationPrice(
    symbol: string,
    side: 'LONG' | 'SHORT',
    leverage: number,
    maintenanceMargin: number = 0.05
  ): number | null {
    const currentPrice = this.getPrice(symbol);
    if (!currentPrice) return null;

    const leverageFactor = Math.max(leverage, 1);
    const liquidationBuffer = (maintenanceMargin * 5) / leverageFactor;

    if (side === 'LONG') {
      return currentPrice * (1 - liquidationBuffer);
    } else {
      return currentPrice * (1 + liquidationBuffer);
    }
  }

  /**
   * Calculate PnL
   */
  calculatePnL(
    side: 'LONG' | 'SHORT',
    entryPrice: number,
    size: number,
    symbol: string
  ): { pnl: number; pnlPercentage: number } | null {
    const currentPrice = this.getPrice(symbol);
    if (!currentPrice) return null;

    let pnl: number;
    if (side === 'LONG') {
      pnl = (currentPrice - entryPrice) * size;
    } else {
      pnl = (entryPrice - currentPrice) * size;
    }

    const pnlPercentage = (pnl / (entryPrice * size)) * 100;
    return { pnl, pnlPercentage };
  }

  /**
   * Simple event emitter (for WebSocket broadcast)
   */
  private listeners: Map<string, Function[]> = new Map();

  on(event: string, callback: Function): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
  }

  private emit(event: string, ...args: any[]): void {
    const callbacks = this.listeners.get(event) || [];
    callbacks.forEach((cb) => cb(...args));
  }
}

// Start service
const priceFeed = new PriceFeedService();
priceFeed.start().catch(console.error);

const HEALTH_PORT = parseInt(process.env.HEALTH_PORT || '8082', 10);
const start = Date.now();
const healthServer = http.createServer((_req, res) => {
  const all = priceFeed.getAllPrices();
  const body = JSON.stringify({ status: 'ok', uptime: Math.floor((Date.now() - start) / 1000), prices: all });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(body);
});
healthServer.listen(HEALTH_PORT, () => console.log(`[health] listening on :${HEALTH_PORT}`));

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Price Feed service shutting down...');
  process.exit(0);
});
