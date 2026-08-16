import { NettingLedger } from './nettingLedger';
import { Gateway } from './index';
import * as anchor from '@coral-xyz/anchor';
import { Keypair, PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import fs from 'fs';
import path from 'path';

export class NettingSettlement {
  ledger: NettingLedger;
  gateway: Gateway;
  constructor(ledger: NettingLedger, gateway: Gateway) {
    this.ledger = ledger;
    this.gateway = gateway;
  }

  /** Create a settlement report for a market and publish it to the gateway (PoC)
   * In production this would batch reports and submit a CPI to `netting-engine`.
   */
  /**
   * Create a settlement report for a market and publish it to the gateway (PoC)
   * Attempts to construct on-chain CPI instructions for `netting-engine` when
   * the local IDL is available and trader list can be derived. Falls back to
   * publishing the report to gateway state for inspection/testing.
   */
  settleMarket(market: string) {
    const report = this.ledger.computeNettingReport(market);

    // Build a real transaction object when possible, while keeping the sync PoC report API.
    void (async () => {
      try {
        const traders = (this.ledger as any).getTradersForMarket ? (this.ledger as any).getTradersForMarket(market) : [];
        const tx = await this.gateway.buildNettingSettlementTransaction({
          market,
          traders,
          feePayer: undefined,
          signer: Keypair.generate(),
        });

        (this.gateway as any).lastNetting = (this.gateway as any).lastNetting || {};
        (this.gateway as any).lastNetting[market] = {
          report,
          builtInstructions: tx.instructions.map((ix: TransactionInstruction) => ({
            programId: ix.programId.toBase58(),
            keys: ix.keys.length,
            dataLen: ix.data.length,
          })),
          transactionSize: tx.serializeMessage().length,
        };
      } catch {
        (this.gateway as any).lastNetting = (this.gateway as any).lastNetting || {};
        (this.gateway as any).lastNetting[market] = report;
      }
    })();

    // publish to gateway state for immediate feedback (tests rely on this)
    (this.gateway as any).lastNetting = (this.gateway as any).lastNetting || {};
    (this.gateway as any).lastNetting[market] = report;
    return report;
  }
}

export default NettingSettlement;
