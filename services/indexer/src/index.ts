import { Connection, PublicKey } from '@solana/web3.js';

/**
 * Novisca Indexer - Listens to on-chain events and indexes them
 * 
 * Events indexed:
 * - Trades (from escrow)
 * - Position opens/closes
 * - Yield distributions
 * - Staking events
 * - Burn events
 */
export class NoviscaIndexer {
  private connection: Connection;
  private rpcUrl: string;
  private lastProcessedSlot: number = 0;

  constructor(rpcUrl: string = process.env.SOLANA_RPC_DEVNET || '') {
    this.rpcUrl = rpcUrl;
    this.connection = new Connection(rpcUrl, 'confirmed');
  }

  async start(): Promise<void> {
    console.log('📊 Novisca Indexer started');

    // Get current slot as starting point
    this.lastProcessedSlot = await this.connection.getSlot();

    // Start listening for new blocks
    this.connection.onSlotChange((slotInfo) => {
      if (slotInfo.slot > this.lastProcessedSlot) {
        this.processNewSlot(slotInfo.slot).catch(console.error);
        this.lastProcessedSlot = slotInfo.slot;
      }
    });

    console.log(`✅ Listening from slot ${this.lastProcessedSlot}`);
  }

  /**
   * Process new slot and index events
   */
  async processNewSlot(slot: number): Promise<void> {
    try {
      console.log(`📍 Processing slot ${slot}`);

      const block = await this.connection.getBlock(slot);
      if (!block || !block.transactions) return;

      for (const tx of block.transactions) {
        if (!tx.meta || !tx.transaction) continue;

        // Check for errors
        if (tx.meta.err) {
          continue; // Skip failed transactions
        }

        // Parse transaction
        const signature = tx.transaction.signatures[0];
        await this.indexTransaction(signature, tx);
      }
    } catch (error) {
      console.error(`❌ Error processing slot ${slot}:`, error);
    }
  }

  /**
   * Index a single transaction
   */
  async indexTransaction(signature: string, tx: any): Promise<void> {
    try {
      const logs = tx.meta?.logMessages || [];

      // Check for program events
      for (const log of logs) {
        if (log.includes('Trade')) {
          await this.indexTradeEvent(signature, log);
        } else if (log.includes('Yield')) {
          await this.indexYieldEvent(signature, log);
        } else if (log.includes('Burn')) {
          await this.indexBurnEvent(signature, log);
        } else if (log.includes('Stake')) {
          await this.indexStakingEvent(signature, log);
        }
      }
    } catch (error) {
      console.error(`❌ Error indexing transaction ${signature}:`, error);
    }
  }

  /**
   * Index trade event
   */
  async indexTradeEvent(signature: string, log: string): Promise<void> {
    try {
      console.log(`📈 Indexing trade event: ${signature}`);

      // Parse event data from log
      // Example: "Program log: Trade { wallet: ..., symbol: ..., size: ... }"

      // TODO: Extract data and store in database
      // TODO: Update TVL metrics
      // TODO: Update user positions
      // TODO: Broadcast via WebSocket
    } catch (error) {
      console.error('❌ Error indexing trade:', error);
    }
  }

  /**
   * Index yield event
   */
  async indexYieldEvent(signature: string, log: string): Promise<void> {
    try {
      console.log(`💰 Indexing yield event: ${signature}`);

      // TODO: Extract yield data
      // TODO: Store distribution
      // TODO: Update user balances
    } catch (error) {
      console.error('❌ Error indexing yield:', error);
    }
  }

  /**
   * Index burn event
   */
  async indexBurnEvent(signature: string, log: string): Promise<void> {
    try {
      console.log(`🔥 Indexing burn event: ${signature}`);

      // TODO: Extract burn data (amount, NVSC burned)
      // TODO: Update total burned metrics
      // TODO: Update supply reduction
    } catch (error) {
      console.error('❌ Error indexing burn:', error);
    }
  }

  /**
   * Index staking event
   */
  async indexStakingEvent(signature: string, log: string): Promise<void> {
    try {
      console.log(`🔒 Indexing staking event: ${signature}`);

      // TODO: Extract staking data (stake/unstake/claim)
      // TODO: Update user tier
      // TODO: Update staking metrics
    } catch (error) {
      console.error('❌ Error indexing staking:', error);
    }
  }

  /**
   * Get indexing status
   */
  async getStatus(): Promise<any> {
    try {
      const currentSlot = await this.connection.getSlot();
      return {
        status: 'running',
        lastProcessedSlot: this.lastProcessedSlot,
        currentSlot,
        behindSlots: currentSlot - this.lastProcessedSlot,
      };
    } catch (error) {
      return {
        status: 'error',
        error: String(error),
      };
    }
  }
}

// Start indexer
const indexer = new NoviscaIndexer();
indexer.start().catch(console.error);

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Indexer shutting down...');
  process.exit(0);
});
