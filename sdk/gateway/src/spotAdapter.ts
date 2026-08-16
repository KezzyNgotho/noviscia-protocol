import { ProductAdapter } from './index';
import { PublicKey, Keypair, Transaction } from '@solana/web3.js';

export class SpotAdapter implements ProductAdapter {
  name = 'spot-dex';
  requiredAccounts(): PublicKey[] { return []; }
  async buildActionTx(params: any, signer: Keypair): Promise<Transaction> {
    // PoC: build an empty tx placeholder representing a spot swap order
    const tx = new Transaction();
    // In a real adapter: construct CPI or direct program ix to the DEX or on-chain router
    return tx;
  }
}
