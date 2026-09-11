//! # TVV Arbitrage Execution — sandbox treadmill
//!
//! The pitch spec's three-command integration, verified live against the local
//! sandbox:
//!
//! ```text
//! ./launch_sandbox.sh                                  # 1. boot the sandbox
//! cargo run -p noviscia-client --example tvv_arbitrage_execution   # 2. run this
//! ```
//!
//! This example exercises the exact HFT surface:
//!
//! 1. `NovisciaTvvClient::connect` — spawns the background gRPC feed loop that
//!    ingests `PoolStateUpdate`s into the in-process capacity cache.
//! 2. `check_slot_headroom` — sub-microsecond RAM reads of available headroom.
//! 3. `compile_atomic_jito_bundle` — guardrail check, then two-leg atomic
//!    bundle (Transaction A allotment + Merkle + micro-fee, Transaction B
//!    private arbitrage), signed offline.
//! 4. Submit to the sandbox Jito emulator (spec §2 `POST /api/v1/bundles`)
//!    and prove **zero capital leakage**: a `PROFITABLE` bundle lands with
//!    `capital_leakage: 0`; a FAILING-mode bundle is atomically reverted with
//!    `0` principal and `0` logged premium.
//!
//! Requires the sandbox to be running (`./launch_sandbox.sh` from the repo
//! root) and the `sandbox-hub` binary to be built. Exit code 0 on success.

use std::sync::Arc;
use std::time::{Duration, Instant};

use solana_program::instruction::Instruction;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::{Keypair, Signer};

use noviscia_client::grpc_stream::mint_key;
use noviscia_client::{NovisciaConfig, NovisciaTvvClient, base58_encode};

const FEED_ENDPOINT: &str = "http://127.0.0.1:10000";
const REST_BUNDLES: &str = "http://127.0.0.1:10001/api/v1/bundles";
const REQUESTED_CAPITAL_USDC: u64 = 1_500_000_000; // $1.5M in µUSDC

fn dummy_arb_ix(operator: &Pubkey) -> Instruction {
    // Transaction B: a desk "arbitrage" instruction. The sandbox emulator does
    // not execute it — it validates the A-before-B sequence and the atomic
    // rollback contract. Use a simple system transfer so the payload is real.
    solana_program::system_instruction::transfer(operator, operator, 1)
}

async fn post_json(url: &str, body: &serde_json::Value) -> serde_json::Value {
    let client = reqwest::Client::new();
    let resp = client.post(url).json(body).send().await.unwrap();
    resp.json().await.unwrap()
}

#[tokio::main]
async fn main() {
    let trader = Keypair::new();
    let program_id = Pubkey::new_unique();

    let config = Arc::new(NovisciaConfig {
        trader_identity: trader.insecure_clone(),
        noviscia_program_id: program_id,
        kyc_merkle_proof: vec![],
        grpc_endpoint_feed: FEED_ENDPOINT.to_string(),
        jito_relay_url: "http://127.0.0.1:8898".to_string(),
    });

    println!("NovisciaTVV Arbitrage Execution — dry-run vs sandbox");
    println!("  feed      {FEED_ENDPOINT}");
    println!("  bundles   {REST_BUNDLES}");
    println!("  operator  {}", trader.pubkey());

    // 1. Connect — spawns the background feed ingestion loop.
    print!("step 1  connect to feed ... ");
    let client = NovisciaTvvClient::connect(config)
        .await
        .expect("connect to sandbox feed (is ./launch_sandbox.sh running?)");
    println!("ok");

    // 2. Wait for the first pool-state update (cache warm).
    let pool_mint = mint_key("USDC");
    let mut warm = 0u64;
    for _ in 0..50 {
        warm = client.check_slot_headroom(pool_mint);
        if warm > 0 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    assert!(warm > 0, "feed never delivered a PoolStateUpdate for USDC");
    println!("step 2  headroom warm   {warm} µUSDC");

    // 3. check_slot_headroom — measure the hot-path latency.
    let t0 = Instant::now();
    let headroom = client.check_slot_headroom(pool_mint);
    let headroom_latency = t0.elapsed();
    println!(
        "step 3  check_slot_headroom({}) = {headroom} µUSDC in {headroom_latency:?}",
        pool_mint
    );

    // 4. Guardrail: over-capacity request must be rejected with nothing sent.
    let over = client.compile_atomic_jito_bundle(
        pool_mint,
        headroom + 1,
        100,
        vec![dummy_arb_ix(&trader.pubkey())],
    );
    let guardrail_msg = match &over {
        Ok(_) => "COMPILED (unexpected!)".to_string(),
        Err(e) => format!("REJECTED: {e}"),
    };
    println!(
        "step 4  guardrail (request {} > headroom {headroom}) → {guardrail_msg}",
        headroom + 1
    );
    assert!(over.is_err(), "over-capacity bundle must be rejected");

    // 5. Compile the atomic bundle at the requested capacity.
    let requested = REQUESTED_CAPITAL_USDC.min(headroom);
    let t1 = Instant::now();
    let bundle = client
        .compile_atomic_jito_bundle(
            pool_mint,
            requested,
            100,
            vec![dummy_arb_ix(&trader.pubkey())],
        )
        .expect("compile within headroom");
    println!(
        "step 5  compile_atomic_jito_bundle(requested={requested}) → {} legs in {:?}",
        bundle.transactions.len(),
        t1.elapsed()
    );
    assert_eq!(bundle.transactions.len(), 2, "Tx A + Tx B required");

    // 6. Submit via the sandbox Jito emulator (spec §2 REST, base58 payloads).
    let rest_txs: Vec<serde_json::Value> = bundle
        .transactions
        .iter()
        .enumerate()
        .map(|(i, tx)| {
            let payload = base58_encode(&bincode::serialize(tx).unwrap());
            serde_json::json!({
                "sequence": i,
                "payload": payload,
                "description": if i == 0 { "Tx A: allotment + Merkle + micro-fee" } else { "Tx B: private arbitrage" },
            })
        })
        .collect();
    let body = serde_json::json!({
        "bundle_id": "demo-profitable",
        "target_slot": 100,
        "simulated_execution_mode": "PROFITABLE",
        "transactions": rest_txs,
        "jito_tip_lamports": bundle.tip_lamports,
    });
    let resp = post_json(REST_BUNDLES, &body).await;
    println!("step 6  submit PROFITABLE → {resp}");
    assert_eq!(resp["status"], "ACCEPTED");
    assert_eq!(
        resp["metrics"]["capital_leakage"], 0,
        "PROFITABLE bundle must report zero capital leakage"
    );
    println!(
        "        allocated_principal = {} µUSDC, logged_premium = {} µUSD, leakage = {}",
        resp["metrics"]["allocated_principal_units"],
        resp["metrics"]["logged_premium_debt_units"],
        resp["metrics"]["capital_leakage"]
    );

    // 7. Atomic rollback: FAILING-mode bundle must revert with zero leakage.
    let body_fail = serde_json::json!({
        "bundle_id": "demo-failing",
        "target_slot": 101,
        "simulated_execution_mode": "FAILING",
        "transactions": rest_txs,
        "jito_tip_lamports": bundle.tip_lamports,
    });
    let resp_fail = post_json(REST_BUNDLES, &body_fail).await;
    println!("step 7  submit FAILING   → {resp_fail}");
    assert_eq!(resp_fail["status"], "REVERTED");
    assert_eq!(
        resp_fail["metrics"]["capital_leakage"], 0,
        "FAILING bundle must atomically revert with zero leakage"
    );
    println!(
        "        REVERTED -> allocated_principal = {}, logged_premium = {}, leakage = {}",
        resp_fail["metrics"]["allocated_principal_units"],
        resp_fail["metrics"]["logged_premium_debt_units"],
        resp_fail["metrics"]["capital_leakage"]
    );

    println!("done — zero capital leakage verified on both landing and rollback.");
}