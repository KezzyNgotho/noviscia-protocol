mod event_parser;
mod grpc_server;
mod jito;
mod searcher;
mod state_store;
mod swaps;
mod yellowstone_subscriber;

use std::env;

use anyhow::Result;
use solana_sdk::signature::{Keypair, Signer};
use tokio::sync::broadcast;
use tracing_subscriber::EnvFilter;

use crate::event_parser::ParsedEvent;
use crate::grpc_server::NovisciaGrpcServer;
use crate::jito::JitoClient;
use crate::searcher::Searcher;
use crate::state_store::StateStore;
use crate::yellowstone_subscriber::YellowstoneSubscriber;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,noviscia_grpc_pipeline=debug")),
        )
        .compact()
        .init();

    let yellowstone_endpoint =
        env::var("YELLOWSTONE_ENDPOINT").unwrap_or_else(|_| "http://127.0.0.1:10000".into());
    let redis_url =
        env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".into());
    let grpc_port: u16 = env::var("GRPC_PORT")
        .unwrap_or_else(|_| "50051".into())
        .parse()?;
    let jito_block_engine_url = env::var("JITO_BLOCK_ENGINE_URL")
        .unwrap_or_else(|_| "https://mainnet.block-engine.jito.wtf".into());

    tracing::info!(%yellowstone_endpoint, %redis_url, %grpc_port, %jito_block_engine_url, "starting noviscia grpc-pipeline");

    // Shared state
    let state = std::sync::Arc::new(StateStore::new());
    let (event_tx, _event_rx) = broadcast::channel::<ParsedEvent>(4096);
    let jito_client = std::sync::Arc::new(JitoClient::new(&jito_block_engine_url));

    // Searcher-owned keypair that pays conditional leader tips. Without it,
    // bundles are relayed tip-free (which the live auction skips). The value is
    // the 64-byte seed base64-encoded (needs no external decoder dependency).
    let tip_payer = match env::var("TIP_PAYER_KEYPAIR") {
        Ok(raw) => {
            let bytes = crate::event_parser::base64_decode(&raw)
                .ok_or_else(|| anyhow::anyhow!("TIP_PAYER_KEYPAIR must be base64"))?;
            let keypair = Keypair::from_bytes(&bytes)
                .map_err(|e| anyhow::anyhow!("invalid TIP_PAYER_KEYPAIR seed: {e}"))?;
            Some(keypair)
        }
        Err(_) => None,
    };
    if let Some(ref payer) = tip_payer {
        tracing::info!(payer = %payer.pubkey(), "conditional leader tip enabled");
    }

    // Searcher (IDENTIFY) configuration.
    let min_net_spread_bps: u64 = env::var("SEARCHER_MIN_NET_SPREAD_BPS")
        .unwrap_or_else(|_| "50".into())
        .parse()?;
    let max_slot_size_usdc: u64 = env::var("SEARCHER_MAX_SLOT_SIZE_USDC")
        .unwrap_or_else(|_| "10000000".into())
        .parse()?;
    let searcher = Searcher::new(min_net_spread_bps, max_slot_size_usdc);
    tracing::info!(min_net_spread_bps, max_slot_size_usdc, "searcher configured");

    // Optionally seed the cross-DEX price book from a JSON snapshot
    // (devnet / local execution). Production replaces this with a live per-venue
    // Geyser account subscription.
    if let Ok(seed) = env::var("POOL_BOOK_SEED") {
        swaps::load_book_seed(&state, &seed)?;
        tracing::info!(pools = state.arb_book().len(), "pool book seeded");
    }

    // Spawn the Yellowstone subscriber (Solana data ingestion).
    let subscriber_state = state.clone();
    let subscriber_tx = event_tx.clone();
    let subscriber_handle = tokio::spawn(async move {
        let mut subscriber =
            YellowstoneSubscriber::new(&yellowstone_endpoint, subscriber_state, subscriber_tx);
        if let Err(e) = subscriber.run().await {
            tracing::error!(error = %e, "yellowstone subscriber failed");
        }
    });

    // Spawn the searcher scan loop (IDENTIFY): polls the pool book and emits
    // opportunities the bundle builder may size to the gate's ceiling.
    let scan_state = state.clone();
    let scan_searcher = searcher.clone();
    let poll_ms: u64 = env::var("SEARCHER_POLL_MS")
        .unwrap_or_else(|_| "1000".into())
        .parse()?;
    let scan_handle = tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_millis(poll_ms));
        loop {
            interval.tick().await;
            let book = scan_state.arb_book();
            if book.is_empty() {
                continue;
            }
            let slot = scan_state.last_slot();
            let opportunity = scan_searcher.find_arbitrage(&book, slot, scan_searcher.max_slot_size_usdc);
            match opportunity {
                Some(opp) => tracing::info!(
                    slug = format!("{}-{}", opp.mint_a, opp.mint_b),
                    slot,
                    %opp.net_spread_bps,
                    %opp.expected_profit_usdc,
                    %opp.size_b,
                    %opp.impact_bps,
                    buy_venue = opp.buy.venue.as_str(),
                    sell_venue = opp.sell.venue.as_str(),
                    "opportunity detected",
                ),
                None => tracing::debug!("no profitable route in current book"),
            }
        }
    });

    // Spawn the tonic gRPC server.
    let grpc_server = NovisciaGrpcServer::new(state.clone(), event_tx, jito_client.clone(), tip_payer);
    let grpc_addr = format!("0.0.0.0:{}", grpc_port)
        .parse()
        .expect("valid listen address");

    let grpc_handle = tokio::spawn(async move {
        let svc = grpc_server.into_service();
        if let Err(e) = tonic::transport::Server::builder()
            .add_service(svc)
            .serve(grpc_addr)
            .await
        {
            tracing::error!(error = %e, "grpc server failed");
        }
    });

    tracing::info!(port = grpc_port, "grpc-pipeline listening");

    // Run until Ctrl-C.
    tokio::select! {
        _ = tokio::signal::ctrl_c() => {
            tracing::info!("shutdown signal received");
        }
        _ = subscriber_handle => {
            tracing::warn!("yellowstone subscriber exited");
        }
        _ = scan_handle => {
            tracing::warn!("searcher scan loop exited");
        }
        _ = grpc_handle => {
            tracing::warn!("grpc server exited");
        }
    }

    Ok(())
}
