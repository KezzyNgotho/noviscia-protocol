# @noviscia/sdk

Universal developer SDK for the **Noviscia** clearing-house protocol on Solana.

## Features

- **16 program IDs** — env-overridable, with PDA derivation for every program
- **NovisciaClient** — Anchor program wrappers over the full stack (position-tracker, netting-engine, yield-router, nv-usdc-vault, burn-engine, staking-manager)
- **Unified Collateral Gateway** — single surface for deposit / withdraw / open / liquidate / recall instructions
- **Payload translators** — intent → wire-format for execution, clearing, netting, liquidation, and recall
- **Sandbox simulator** — dry-run margin checks and PnL computation without on-chain state
- **Tenant onboarding** — register as a clearing tenant via the clearing-registry
- **Cross-border rails** — stablecoin settlement primitives (research-phase)

## Install

```bash
npm install @noviscia/sdk
# or
yarn add @noviscia/sdk
```

Requires Node >= 18 (global `fetch`).

## Quick Start

### Program IDs & PDA Derivation

```ts
import { PROGRAM_IDS, ptAddresses, vaultAddresses, USDC_MINT } from '@noviscia/sdk';
import { PublicKey } from '@solana/web3.js';

// All 16 program IDs — override via env vars
console.log(PROGRAM_IDS.positionTracker.toBase58());

// Derive PDAs for a trader's SOL market position
const market = new PublicKey('...');
const trader = new PublicKey('...');
const addrs = ptAddresses(trader, market, 0);
console.log(addrs.position.toBase58());     // position PDA
console.log(addrs.collateralVault.toBase58()); // collateral vault PDA

// Vault PDAs
const vault = vaultAddresses(USDC_MINT, trader);
console.log(vault.vaultConfig.toBase58());
```

### Unified Collateral Gateway

```ts
import { CollateralGateway, NovisciaClient } from '@noviscia/sdk';

const client = new NovisciaClient({ rpc: 'https://api.devnet.solana.com' });
const gw = new CollateralGateway(client);

// Deposit 100 USDC into the omni-pool
const depositIx = await gw.deposit(trader, 100_000_000);

// Open a long position on SOL
const openIx = await gw.openPosition(
  trader, market, 0, 'long', 50_000_000,
  priceUpdateAccount, signedPayload, merkleUpdate,
  guardianSet, pythConfig, treasury,
);
```

### Sandbox Simulator

```ts
import { SandboxSimulator } from '@noviscia/sdk';

const sim = new SandboxSimulator();
sim.setMarket('SOL', { price: 150, fundingIndex: 0, maxLeverageBps: 500000, maintenanceMarginBps: 199 });

const pos = sim.simulateFill('SOL', true, 10_000_000, 150, 10_000_000, 199);
const health = sim.checkPositionHealth(pos, 155);
console.log(health.ok); // true — unrealized profit
```

### Payload Translators

```ts
import { translate, digest } from '@noviscia/sdk';

const result = translate({
  kind: 'execution',
  data: { symbol: 'SOL', side: 'long', sizeUsdc: 50_000_000, market, priceUpdateAccount, guardianSet, pythConfig, treasury },
});
console.log(result.summary); // "execution long 50,000,000 USDC SOL"
console.log(digest(result.payload!)); // SHA-256 of wire payload
```

## Environment Variables

All program IDs can be overridden via environment variables:

| Env Var | Default (devnet) |
|---------|-----------------|
| `NEXT_PUBLIC_ESCROW_PROGRAM_ID` | `2WPb3...` |
| `POSITION_TRACKER_PROGRAM_ID` | `6uvr2...` |
| `NEXT_PUBLIC_BURN_PROGRAM_ID` | `nFgJE...` |
| `NEXT_PUBLIC_STAKING_PROGRAM_ID` | `HjxcK...` |
| `NEXT_PUBLIC_NV_USDC_VAULT_PROGRAM_ID` | `CN92h...` |
| `NEXT_PUBLIC_YIELD_DISTRIBUTOR_PROGRAM_ID` | `CrN1o...` |
| `NEXT_PUBLIC_LIQUIDATION_VAULT_PROGRAM_ID` | `Cwma3...` |
| `NETTING_ENGINE_PROGRAM_ID` | `68s4v...` |
| `YIELD_ROUTER_PROGRAM_ID` | `FKaAP...` |
| `CROSS_BORDER_PROGRAM_ID` | `C3uoi...` |
| `CLEARING_REGISTRY_PROGRAM_ID` | `Hg5Qv...` |
| `NEXT_PUBLIC_SPOT_DEX_PROGRAM_ID` | `8C4tr...` |

Set `SOLANA_RPC_DEVNET` or `NEXT_PUBLIC_SOLANA_RPC` to override the RPC endpoint.

## License

MIT
