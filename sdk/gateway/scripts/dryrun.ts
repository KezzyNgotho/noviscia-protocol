import { Connection, Keypair } from '@solana/web3.js';
import { Gateway } from '../src/index';
import { SpotAdapter } from '../src/spotAdapter';
import { PerpsAdapter } from '../src/perpsAdapter';
import { MarketRegistry } from '../src/marketRegistry';
import { RiskOrchestrator } from '../src/riskOrchestrator';
import * as anchor from '@coral-xyz/anchor';
import * as fs from 'fs';

async function main(){
  const conn = new Connection(process.env.SOLANA_RPC_DEVNET || 'https://api.devnet.solana.com');
  const gw = new Gateway(conn);
  const marketReg = new MarketRegistry();
  marketReg.register({ name: 'SOL-PERP', feedHex: 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d' });

  gw.registerAdapter(new SpotAdapter());
  const idlPath = process.env.PT_IDL || '../../target/idl/position_tracker.json';
  const ptProgramId = new anchor.web3.PublicKey(process.env.POSITION_TRACKER_PROGRAM || '3zGRWKZq4V3npHbH9Lati46BwgmstTjynWZFFMxarQgY');
  gw.registerAdapter(new PerpsAdapter(idlPath, ptProgramId));

  const sb = gw.createSandbox('demo-tenant');
  const risk = new RiskOrchestrator(gw);

  // Add a sample position and dry-run perps open
  const kp = Keypair.generate();
  const perps = gw.adapters.get('perps')!;
  const res = await gw.executeAdapterAction('perps', { size: 100_000 }, kp, 'demo-tenant');
  console.log('perps-dryrun', res);

  // Populate a fake position into the sandbox
  sb.write('positions',[{ id: 'p1', market: 'SOL-PERP', notionalUsdc: 100_000, side: 'long', entryPrice: 75_000, collateralUsdc: 50 }]);

  const scan = risk.scanSandbox(sb);
  console.log('risk-scan', scan);
}

main().catch((e)=>{ console.error(e); process.exit(1); });
