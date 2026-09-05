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

### Jito Bundles

Build one-slot-atomic bundles and submit to the Jito Block Engine with `jtRisk`/credit-bundle flows:

```ts
import {
  JitoBundleClient, assembleVersionedTransactions,
  resolveBundleTipLamports, selectTipAccount,
} from '@noviscia/sdk';

const engine = new JitoBundleClient(); // defaults to mainnet engine
const tipAccount = selectTipAccount(); // random pick from the 8 live tip accounts

const txs = assembleVersionedTransactions(
  [groupOfInstructions],           // one array of instructions per bundle tx (max 5)
  {
    feePayer,
    recentBlockhash,
    tip: {
      tipAccount,
      tipPayer,
      lamports: resolveBundleTipLamports(await engine.getBundleTipLimits(), DEFAULT_TIP_LAMPORTS),
    },
  },
);
// sign each tx, then:
const bundleId = await engine.sendBundle(txs); // { bundle_id }
const status = await engine.getBundleStatuses([bundleId]); // 'Pending' | 'Landed' | 'Rejected'
```

Operational notes (from the September 2026 devnet field-test, `scripts/e2e/e2e-jito-devnet-probe.ts`):

- **Devnet engine is decommissioned** (`devnet.block-engine.jito.wtf` → NXDOMAIN); `JitoBundleClient`
  defaults to the **mainnet** engine. Unit-test bundle assembly against `fetch` mocks (`jito.test.ts`).
- Tip accounts **rotate** — do not hard-pin. Fresh picks use the live `getTipAccounts` RPC; the built-in
  `KNOWN_JITO_TIP_ACCOUNTS` constant is an offline fallback and is only current as of its last edit.
  Rotate it whenever the mainnet set changes.
- The shared public mainnet engine rate-limits `sendBundle`/`getBundleTipLimits` HTTP to **~1 req/s per
  IP without an API key** (HTTP 429 / `-32097`). Treat `getBundleTipLimits` as optional — when it is not
  exposed or fails, fall back to the `DEFAULT_TIP_LAMPORTS` floor, and back off on 429.
- The tip transfer is appended to the **first** transaction, so it only pays if that transaction's
  intra-bundle assertions pass ("tip goes through conditionally"). Its payer must sign the first tx.

See `PARTICIPANT_ACCESS.md` for governance of bundle building in production.

## Environment Variables

All program IDs can be overridden via environment variables:

| Env Var | Default (devnet) |
|---------|-----------------|
| `NEXT_PUBLIC_ESCROW_PROGRAM_ID` | `2WPb3...CZ` |
| `POSITION_TRACKER_PROGRAM_ID` | `6uvr2...ws` |
| `NEXT_PUBLIC_BURN_PROGRAM_ID` | `nFgJE...id` |
| `NEXT_PUBLIC_STAKING_PROGRAM_ID` | `HjxcK...qb` |
| `NEXT_PUBLIC_NV_USDC_VAULT_PROGRAM_ID` | `CN92h...WC` |
| `NEXT_PUBLIC_YIELD_DISTRIBUTOR_PROGRAM_ID` | `CrN1o...tw` |
| `NEXT_PUBLIC_LIQUIDATION_VAULT_PROGRAM_ID` | `Cwma3...z` |
| `NETTING_ENGINE_PROGRAM_ID` | `68s4v...56` |
| `YIELD_ROUTER_PROGRAM_ID` | `FKaAP...B4` |
| `CROSS_BORDER_PROGRAM_ID` | `C3uoi...bv` |
| `CLEARING_REGISTRY_PROGRAM_ID` | `Hg5Qv...mo` |
| `NEXT_PUBLIC_SPOT_DEX_PROGRAM_ID` | `8C4tr...iN` |
| `NEXT_PUBLIC_PROTOCOL_LP_VAULT_PROGRAM_ID` | `2WUt2...kd` |
| `NEXT_PUBLIC_BUG_BOUNTY_PROGRAM_ID` | `A8Uk9...SK` |
| `NEXT_PUBLIC_TOKEN_NVSC_PROGRAM_ID` | `HSaBJ...YT` |
| `NEXT_PUBLIC_PREDICTION_MARKET_PROGRAM_ID` | `GtTJW...fe` |

Set `SOLANA_RPC_DEVNET` or `NEXT_PUBLIC_SOLANA_RPC` to override the RPC endpoint.

## License

MIT
