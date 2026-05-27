import { Connection, PublicKey } from '@solana/web3.js';

/**
 * Price Feed Service - Aggregates prices from multiple oracles
 * 
 * Supported oracles:
 * - Pyth Network (primary)
 * - Switchboard (fallback)
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

  // Switchboard price accounts (devnet)
  private switchboardAccounts: Record<string, string> = {
    'SOL/USD': 'GvDMxPzN1sCj7L26YDK5q362C97eWEw5bUGKgmwBNJS',
    'BTC/USD': 'DkuCVjLXdV4jFQ8uXmBN46oTK2ixjGb7H2CHz9Rqf7MJ',
    'ETH/USD': '8EZwF8pW2ZFLhZbfbFvL3HfxK8yWCDPwCYHcLgXbD74y',
    'USDC/USD': 'EnqJEjTwmdXMEw5RpXN6uU7v6PvKxiNGpgKXzBaUfsp',
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
   * Get aggregated price from multiple oracles
   */
  async getAggregatedPrice(symbol: string): Promise<{ price: number; confidence: number; timestamp: number } | null> {
    try {
      // Fetch from Pyth
      const pythPrice = await this.getPythPrice(symbol);

      // Fetch from Switchboard
      const sbPrice = await this.getSwitchboardPrice(symbol);

      // Return weighted average (60% Pyth, 40% Switchboard)
      if (pythPrice && sbPrice) {
        const price = pythPrice.price * 0.6 + sbPrice.price * 0.4;
        const confidence = Math.min(pythPrice.confidence, sbPrice.confidence);
        return { price, confidence, timestamp: Date.now() };
      }

      // Fallback to either if one fails
      if (pythPrice) return pythPrice;
      if (sbPrice) return sbPrice;

      return null;
    } catch (error) {
      console.error(`❌ Error getting aggregated price for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Get price from Pyth
   */
  private async getPythPrice(symbol: string): Promise<{ price: number; confidence: number } | null> {
    try {
      const account = this.pythAccounts[symbol];
      if (!account) return null;

      // TODO: Decode Pyth account data
      // Pyth stores prices in a specific format with on-chain price data
      // For now, return mock data
      
      // In production:
      // const accountInfo = await this.connection.getAccountInfo(new PublicKey(account));
      // const priceData = decodePythPrice(accountInfo?.data);
      // return { price: priceData.price, confidence: priceData.confidence };

      return {
        price: this.getMockPrice(symbol),
        confidence: 0.01, // 1% confidence
      };
    } catch (error) {
      console.error(`❌ Error getting Pyth price for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Get price from Switchboard
   */
  private async getSwitchboardPrice(symbol: string): Promise<{ price: number; confidence: number } | null> {
    try {
      const account = this.switchboardAccounts[symbol];
      if (!account) return null;

      // TODO: Decode Switchboard account data
      // Similar to Pyth but different format
      
      // In production:
      // const accountInfo = await this.connection.getAccountInfo(new PublicKey(account));
      // const priceData = decodeSwitchboardPrice(accountInfo?.data);
      // return { price: priceData.price, confidence: priceData.confidence };

      return {
        price: this.getMockPrice(symbol),
        confidence: 0.015, // 1.5% confidence
      };
    } catch (error) {
      console.error(`❌ Error getting Switchboard price for ${symbol}:`, error);
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
   * liquidation_price = entry_price * (1 - 1/leverage) for longs
   * liquidation_price = entry_price * (1 + 1/leverage) for shorts
   */
  calculateLiquidationPrice(
    symbol: string,
    side: 'LONG' | 'SHORT',
    leverage: number,
    maintenanceMargin: number = 0.05
  ): number | null {
    const currentPrice = this.getPrice(symbol);
    if (!currentPrice) return null;

    // Simplified: liquidation at 5% maintenance margin
    if (side === 'LONG') {
      return currentPrice * (1 - maintenanceMargin);
    } else {
      return currentPrice * (1 + maintenanceMargin);
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
   * Mock prices for development (replace with real oracle data)
   */
  private getMockPrice(symbol: string): number {
    const basePrices: Record<string, number> = {
      'SOL/USD': 120.5,
      'BTC/USD': 42500.25,
      'ETH/USD': 2250.75,
      'USDC/USD': 1.0,
    };

    // Add small random fluctuation (±1%)
    const base = basePrices[symbol] || 0;
    const fluctuation = (Math.random() - 0.5) * 0.02 * base;
    return base + fluctuation;
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

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Price Feed service shutting down...');
  process.exit(0);
});
