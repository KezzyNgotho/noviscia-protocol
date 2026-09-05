//! Noviscia Institutional Sandbox Hub (Module 3).
//!
//! One binary, three tiers:
//!
//! * **Tier 1** — provisioning lives in `scripts/sandbox/provision-local-ledger.ts`
//!   (local solana-test-validator + asset-engine mount + 3 funded pools); this
//!   binary is the substrate those pools stream into.
//! * **Tier 2** — a mock Yellowstone-style subscriber: a virtual slot clock
//!   advances every `SANDBOX_SLOT_MS` (400 ms default → 150 sandbox slots =
//!   one accelerated day), re-derives deterministic desk postures, and pushes
//!   the same `EventEnvelope`s the production pipeline does.
//! * **Tier 3** — the Jito bundle emulator (emulator.rs) on a second port,
//!   JSON-RPC-compatible with the production `JitoClient`, with A-before-B
//!   ordering validation and atomic rollback.
//!
//! The gRPC contract is the SHARED production schema
//! (grpc-pipeline/proto/noviscia.proto) — a sandbox client cannot distinguish
//! this stream from the real one.
mod emulator;
mod posture;

use std::collections::HashMap;
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::broadcast;
use tokio::sync::RwLock;
use tokio_stream::StreamExt;
use tokio_stream::wrappers::BroadcastStream;
use tonic::{Request, Response, Status};

use crate::posture::Posture;
use noviscia::pipeline::{
    noviscia_stream_server::{NovisciaStream, NovisciaStreamServer},
    BundleRequest, BundleResponse, CapacityStatusRequest, CapacityStatusResponse,
    CreditStatusRequest, CreditStatusResponse, DeskStatusRequest, DeskStatusResponse,
    EventEnvelope, MarketStateRequest, MarketStateResponse, PoolStateRequest, PoolStateResponse,
    PositionRequest, PositionResponse, StreamEventsRequest, SubmitTxRequest, SubmitTxResponse,
    TrancheStateRequest, TrancheStateResponse,
};

pub mod noviscia {
    pub mod pipeline {
        tonic::include_proto!("noviscia.pipeline");
    }
}

/// One desk under observation by the mock subscriber.
#[derive(Debug, Clone)]
struct DeskState {
    institution: String,
    mint: String,
    active_principal: i64,
    accumulated_premiums: i64,
    window_start_slot: i64,
    peak_active_utilization: i64,
    last_settlement_timestamp: i64,
    posture: Posture,
}

/// Virtual ledger the mock patch advances every sandbox slot.
#[derive(Clone)]
struct SandboxLedger {
    slot: Arc<AtomicU64>,
    desks: Arc<RwLock<HashMap<String, DeskState>>>,
    events: broadcast::Sender<EventEnvelope>,
}

impl SandboxLedger {
    fn new() -> Self {
        let (events, _) = broadcast::channel(4096);
        let mut desks = HashMap::new();
        // Cold-start posture (Tier 1 hands control to the stream here: desks
        // bookable at genesis, exactly like the on-chain registry).
        for mint in ["So11111111111111111111111111111111111111112", "SandboxUsdcMint", "SandboxNvscMint"] {
            desks.insert(
                format!("sandbox-op:{}", mint),
                DeskState {
                    institution: "sandbox-institution".into(),
                    mint: mint.into(),
                    active_principal: 0,
                    accumulated_premiums: 0,
                    window_start_slot: 0,
                    peak_active_utilization: 0,
                    last_settlement_timestamp: 0,
                    posture: Posture::NoWindow,
                },
            );
        }
        Self {
            slot: Arc::new(AtomicU64::new(0)),
            desks: Arc::new(RwLock::new(desks)),
            events,
        }
    }

    fn current_slot(&self) -> u64 {
        self.slot.load(Ordering::SeqCst)
    }
}

/// The mock Yellowstone subscriber: ticks the virtual clock, re-derives desk
/// postures deterministically and emits per-slot EventEnvelopes.
async fn run_mock_subscriber(ledger: SandboxLedger, cadence_ms: u64) {
    let mut tick = tokio::time::interval(Duration::from_millis(cadence_ms));
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        tick.tick().await;
        let slot = ledger.slot.fetch_add(1, Ordering::SeqCst) + 1;
        {
            let desks = ledger.desks.read().await;
            for desk in desks.values() {
                let posture = posture::posture_at(
                    desk.window_start_slot.max(0) as u64,
                    slot,
                    desk.active_principal > 0,
                );
                if posture != desk.posture {
                    let _ = ledger.events.send(EventEnvelope {
                        event_type: "desk_posture".into(),
                        slot: slot as i64,
                        timestamp: (slot * 400 / 1000) as i64,
                        data: serde_json::json!({
                            "institution": desk.institution,
                            "mint": desk.mint,
                            "posture": posture.as_proto_i32(),
                        })
                        .to_string(),
                        tx_signature: String::new(),
                    });
                }
            }
        }
    }
}

struct SandboxNoVisciaStream {
    ledger: SandboxLedger,
    emulator: Arc<emulator::BundleEmulator>,
}

#[tonic::async_trait]
impl NovisciaStream for SandboxNoVisciaStream {
    async fn get_market_state(&self, _req: Request<MarketStateRequest>) -> Result<Response<MarketStateResponse>, Status> {
        Err(Status::unimplemented("market data lives in Tier-2 velocity feeds; not modeled in sandbox"))
    }

    async fn get_position(&self, _req: Request<PositionRequest>) -> Result<Response<PositionResponse>, Status> {
        Err(Status::unimplemented("position feeds are off-sandbox"))
    }

    async fn get_credit_status(&self, _req: Request<CreditStatusRequest>) -> Result<Response<CreditStatusResponse>, Status> {
        Ok(Response::new(CreditStatusResponse {
            wallet: "sandbox-institution".into(),
            credit_limit: 6_000_000_00.0, // $6,000,000 C_sys
            outstanding: 0.0,
            utilization_bps: 0.0,
            toll_rate_bps: 0.0,
            authorized: true,
        }))
    }

    async fn get_pool_state(&self, _req: Request<PoolStateRequest>) -> Result<Response<PoolStateResponse>, Status> {
        Ok(Response::new(PoolStateResponse {
            pool_label: "sandbox-accelerated-pool".into(),
            kyc_required: true,
            total_shares: 10_000_000.0,
            base_reserve: 10_000_000.0,
            quote_reserve: 10_000_000.0,
            lp_count: 3,
            is_paused: false,
        }))
    }

    async fn get_capacity_status(&self, _req: Request<CapacityStatusRequest>) -> Result<Response<CapacityStatusResponse>, Status> {
        let slot = self.ledger.current_slot();
        // Simplest deterministic projection: each active sandbox desk draws
        // down the C_sys line at one step per slot once a window is open.
        let desks = self.ledger.desks.read().await;
        let active = desks.values().filter(|d| d.posture != Posture::NoWindow).count() as i64;
        let frozen = desks.values().any(|d| d.posture == Posture::Breached);
        drop(desks);
        Ok(Response::new(CapacityStatusResponse {
            operator: "sandbox-institution".into(),
            credit_limit: 6_000_000_00,
            active_utilization: active * 1_000_000_00,
            available_balance: 6_000_000_00 - active * 1_000_000_00,
            margin_posted: 0,
            tier: 3,
            premium_multiplier_bps: 4_608, // TVV baseline APY (tenths-bps 4.608%)
            frozen,
            kyc_verified: true,
            slot: slot as i64,
            current_premium_bps: 4_608,
            load_ratio_bps: (active * 1_000_000_00 * 10_000) / 6_000_000_00,
        }))
    }

    async fn get_tranche_state(&self, _req: Request<TrancheStateRequest>) -> Result<Response<TrancheStateResponse>, Status> {
        Ok(Response::new(TrancheStateResponse {
            tranche_label: "T1-senior".into(),
            nav_usdc: 7_000_000_00,
            total_shares: 7_000_000,
            share_price: 100_000,
            loss_cap_bps: 100,
            accepts_deposits: true,
        }))
    }

    async fn get_desk_status(&self, req: Request<DeskStatusRequest>) -> Result<Response<DeskStatusResponse>, Status> {
        let r = req.into_inner();
        let key = format!("sandbox-op:{}", r.mint);
        let slot = r.current_slot as u64;
        let desks = self.ledger.desks.read().await;
        let desk = desks.get(&key).ok_or_else(|| Status::not_found(format!("no desk for mint {}", r.mint)))?;
        // The caller supplies the observed slot; the posture is pure.
        let posture = posture::posture_at(desk.window_start_slot.max(0) as u64, slot, desk.active_principal > 0);
        Ok(Response::new(DeskStatusResponse {
            institution: desk.institution.clone(),
            mint: desk.mint.clone(),
            active_principal: desk.active_principal,
            accumulated_premiums: desk.accumulated_premiums,
            window_start_slot: desk.window_start_slot,
            peak_active_utilization: desk.peak_active_utilization,
            last_settlement_timestamp: desk.last_settlement_timestamp,
            posture: posture.as_proto_i32(),
        }))
    }

    type StreamEventsStream = Pin<Box<dyn tokio_stream::Stream<Item = Result<EventEnvelope, Status>> + Send + 'static>>;

    async fn stream_events(&self, _req: Request<StreamEventsRequest>) -> Result<Response<Self::StreamEventsStream>, Status> {
        let stream = BroadcastStream::new(self.ledger.events.subscribe())
            .map(|r| r.map_err(|e| Status::internal(format!("sandbox event stream error: {}", e))));
        Ok(Response::new(Box::pin(stream)))
    }

    async fn submit_transaction(&self, req: Request<SubmitTxRequest>) -> Result<Response<SubmitTxResponse>, Status> {
        let _r = req.into_inner();
        Ok(Response::new(SubmitTxResponse {
            success: true,
            signature: "sandbox-sig".into(),
            error: String::new(),
            bundle_id: String::new(),
        }))
    }

    async fn submit_bundle(&self, req: Request<BundleRequest>) -> Result<Response<BundleResponse>, Status> {
        let r = req.into_inner();
        let simulate_fail = std::env::var("SANDBOX_SIMULATE_FAIL").map(|_| true).unwrap_or(false);
        let (id, status) = self
            .emulator
            .submit(&r.transactions, r.desired_capacity.max(0) as u64, simulate_fail);
        Ok(Response::new(BundleResponse {
            success: status == emulator::Status::Landed,
            bundle_id: id.clone(),
            status: status.as_str().into(),
            error: self
                .emulator
                .status(&id)
                .map(|e| e.error)
                .unwrap_or_default(),
        }))
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let grpc_port: u16 = std::env::var("SANDBOX_GRPC_PORT").ok().and_then(|v| v.parse().ok()).unwrap_or(50151);
    let emulator_port: u16 = std::env::var("SANDBOX_EMULATOR_PORT").ok().and_then(|v| v.parse().ok()).unwrap_or(8898);
    let cadence_ms: u64 = std::env::var("SANDBOX_SLOT_MS").ok().and_then(|v| v.parse().ok()).unwrap_or(400);

    let ledger = SandboxLedger::new();
    let emulator = Arc::new(emulator::BundleEmulator::new());
    let service = SandboxNoVisciaStream {
        ledger: ledger.clone(),
        emulator: emulator.clone(),
    };

    tokio::spawn(run_mock_subscriber(ledger, cadence_ms));

    let grpc_addr = format!("127.0.0.1:{}", grpc_port);
    let grpc_listener = tokio::net::TcpListener::bind(&grpc_addr).await?;
    tracing::info!("sandbox gRPC (Tier 2) listening on {}", grpc_addr);

    let emulator_addr = format!("127.0.0.1:{}", emulator_port);
    let emulator_listener = tokio::net::TcpListener::bind(&emulator_addr).await?;
    tracing::info!(
        "Jito bundle emulator (Tier 3) listening on {} — sendBundle/getBundleStatuses/getTipAccounts",
        emulator_addr
    );

    let grpc_task = tokio::spawn(async move {
        tonic::transport::Server::builder()
            .add_service(NovisciaStreamServer::new(service))
            .serve_with_incoming_shutdown(
                tokio_stream::wrappers::TcpListenerStream::new(grpc_listener),
                async { std::future::pending::<()>().await },
            )
            .await
    });

    let emulator_task = tokio::spawn(run_http_emulator(emulator_listener, emulator));

    tokio::select! {
        r = grpc_task => r??,
        r = emulator_task => r??,
    }
    Ok(())
}

/// Minimal HTTP/1.1 JSON-RPC listener for the emulator port. Deliberately
/// dependency-free: one POST endpoint, Content-Length framed, matching the
/// Jito block-engine surface the production client (grpc-pipeline jito.rs)
/// calls.
async fn run_http_emulator(
    listener: tokio::net::TcpListener,
    emulator: Arc<emulator::BundleEmulator>,
) -> anyhow::Result<()> {
    loop {
        let (mut socket, _) = listener.accept().await?;
        let emu = emulator.clone();
        tokio::spawn(async move {
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            let mut buf = Vec::with_capacity(8192);
            let mut tmp = [0u8; 8192];
            let mut header_done = false;
            let mut content_length = 0usize;
            loop {
                let n = match socket.read(&mut tmp).await {
                    Ok(0) => break,
                    Ok(n) => n,
                    Err(_) => break,
                };
                buf.extend_from_slice(&tmp[..n]);
                if !header_done {
                    if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                        let headers = String::from_utf8_lossy(&buf[..pos]);
                        content_length = headers
                            .lines()
                            .find_map(|l| {
                                let l = l.trim();
                                let key = l.split(':').next()?.trim();
                                if key.eq_ignore_ascii_case("content-length") {
                                    l.split(':').nth(1)?.trim().parse().ok()
                                } else {
                                    None
                                }
                            })
                            .unwrap_or(0);
                        header_done = true;
                    }
                }
                if header_done && buf.len() >= pos_body_start(&buf) + content_length {
                    break;
                }
            }
            let body_start = pos_body_start(&buf);
            let body = if content_length > 0 {
                String::from_utf8_lossy(&buf[body_start..(body_start + content_length).min(buf.len())]).to_string()
            } else {
                String::new()
            };
            let simulate_fail = std::env::var("SANDBOX_SIMULATE_FAIL").map(|_| true).unwrap_or(false);
            let resp = emu.process_jsonrpc(&body, simulate_fail).to_string();
            let _ = socket
                .write_all(
                    format!(
                        "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                        resp.len(),
                        resp
                    )
                    .as_bytes(),
                )
                .await;
        });
    }
}

fn pos_body_start(buf: &[u8]) -> usize {
    buf.windows(4)
        .position(|w| w == b"\r\n\r\n")
        .map(|p| p + 4)
        .unwrap_or(buf.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use posture::*;

    #[test]
    fn projected_window_matches_spec() {
        assert_eq!(WINDOW_SANDBOX_SLOTS, 150.0);
        assert_eq!(GRACE_SANDBOX_SLOTS, 12.5);
        assert_eq!(real_to_sandbox_slots(REAL_SLOTS_PER_DAY), 150.0);
        assert_eq!(real_to_sandbox_slots(REAL_GRACE_SLOTS), 12.5);
        assert_eq!(ACCELERATION, 1_440);
    }
}