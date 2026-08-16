import { PublicKey } from '@solana/web3.js';

export type MarketSpec = {
  name: string;
  feedHex: string; // pyth feed id hex
  programId?: PublicKey; // optional on-chain program for market
  maxLeverage?: number;
}

export class MarketRegistry {
  private registry = new Map<string, MarketSpec>();

  register(m: MarketSpec) {
    this.registry.set(m.name, m);
  }
  get(name: string) { return this.registry.get(name); }
  list() { return Array.from(this.registry.values()); }
}
