Noviscia SDK Gateway (PoC)

Purpose
- Provide a single entrypoint for third-party apps to interact with Noviscia products.
- Offer an in-memory sandbox mode for safe dry-run of user payloads without touching chain state.

Quick start

```bash
cd sdk/gateway
npm install
npm run build
npm test
```

Next steps
- Implement concrete adapters (perps, spot, payments)
- Add authorization / tenant isolation via signer/session PDAs and tenant-scoped sandbox access
- Integrate the sandbox with a simulated program state for richer dry-runs and replayable traces

Hardening controls
- `GatewayOptions` lets operators enforce guardrails at runtime:
	- `maxRecallUsdc` caps recall size per request.
	- `maxAdapterPayloadBytes` rejects oversized adapter payloads.
	- `requireSandboxForExecution` prevents direct execution outside isolation.
	- `defaultCommitment` controls confirmation level for signed submissions.
- Sandboxes now enforce:
	- strict ID format (`3-64` chars, `[a-zA-Z0-9:_-]`)
	- duplicate ID rejection
	- explicit deletion via `deleteSandbox(id)`
- Adapter registration now rejects duplicates.
- `executeAdapterAction(..., { submit: true })` signs, sends, and confirms adapter transactions.
- `recallForMarginOnChain(...)` deterministically submits recall transactions and stores the resulting signature in sandbox history.
 
On-chain CPI hooks (PoC)
- `NettingSettlement.settleMarket(market)` will attempt to construct on-chain
	`netting-engine::consolidate` instructions for traders present in the ledger
	when the local IDL is available at `target/idl/netting_engine.json`. It
	publishes the built instruction metadata to `Gateway.lastNetting` for
	inspection in tests.
- `Gateway.recallForMargin(..., opts)` supports an `onChain` flow that builds
	a `yield_router::recall_for_margin` instruction when the caller/keypair,
	vault USDC mint and accounts, and venue ATA are provided. If these are not
	present the method falls back to recording a recall intent in the sandbox.
- `Gateway.recallForMarginOnChain(...)` performs deterministic recall
	transaction submission and confirmation, then stores the resulting signature
	in sandbox history.
- `Gateway.executeAdapterAction(..., { submit: true })` signs, sends, and
	confirms adapter transactions through the configured connection.

Testing
- Unit tests under `sdk/gateway/test` exercise PoC and the built-in
	instruction-construction paths. To run them:

```bash
cd noviscia-protocal
cd sdk/gateway
npm test
npm run build
npm run typecheck
```

E2E (local validator)

You can run a lightweight E2E smoke test against a local `solana-test-validator` or any RPC endpoint by setting `SOLANA_RPC_URL` before running the e2e script.

Example (local validator):

```bash
# start a local validator in another terminal
solana-test-validator --reset &

# point the test runner at the local RPC
export SOLANA_RPC_URL=http://127.0.0.1:8899
cd sdk/gateway
npm run e2e
```

The `e2e` script is designed to be safe: it will skip when no `SOLANA_RPC_URL` is provided, making it CI-friendly.

Limitations
- The SDK still expects the caller to own key custody and signing policy.
- `submit: true` enables transaction submission, but not wallet management or
	seed derivation policy.
