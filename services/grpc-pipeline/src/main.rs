mod event_parser;
mod grpc_server;
mod jito;
mod state_store;
mod yellowstone_subscriber;

use std::env;

use anyhow::Result;
use tokio::sync::broadcast;
use tracing_subscriber::EnvFilter;

use crate::event_parser::ParsedEvent;
use crate::grpc_server::NovisciaGrpcServer;
use crate::jito::JitoClient;
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

    // Spawn the tonic gRPC server.
    let grpc_server = NovisciaGrpcServer::new(state.clone(), event_tx, jito_client.clone());
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
        _ = grpc_handle => {
            tracing::warn!("grpc server exited");
        }
    }

    Ok(())
}
