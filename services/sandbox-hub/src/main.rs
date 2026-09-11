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
//!   the same `EventEnvelope`s the production pipeline does. The spec-conformant
//!   headless surface (`Noviscia Sandbox API Specification v1`) is served
//!   here too:
//!     - `:10000` gRPC `noviscia.sandbox.v1.MarketVelocityStream.SubscribePoolState`
//!     - `:10001` REST `POST /api/v1/bundles` (Jito bundle emulator, spec §2),
//!       `GET /api/v1/sandbox/vault` + `POST /api/v1/sandbox/settle` (NAV /
//!       institutional settlement ledger)
//!     - `:10002` control plane `PUT /api/v1/sandbox/control-plane` (spec §3)
//! * **Tier 3** — the Jito bundle emulator (emulator.rs) on a second port,
//!   JSON-RPC-compatible with the production `JitoClient`, with A-before-B
//!   ordering validation and atomic rollback.
//!
//! The gRPC contract is the SHARED production schema
//! (grpc-pipeline/proto/noviscia.proto) — a sandbox client cannot distinguish
//! this stream from the real one — plus the spec `noviscia_sandbox.proto`
//! (`noviscia.sandbox.v1`, built from `proto/noviscia_sandbox.proto`).
mod control;
mod emulator;
mod posture;
mod ring;
mod vault;

use std::collections::HashMap;
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{broadcast, RwLock};
use tokio_stream::{wrappers::BroadcastStream, StreamExt};
use tonic::{Request, Response, Status};

use crate::control::ControlPlaneConfig;
use crate::posture::Posture;
use noviscia::pipeline::{
    noviscia_stream_server::{NovisciaStream, NovisciaStreamServer},
    BundleRequest, BundleResponse, CapacityStatusRequest, CapacityStatusResponse,
    CreditStatusRequest, CreditStatusResponse, DeskStatusRequest, DeskStatusResponse,
    EventEnvelope, MarketStateRequest, MarketStateResponse, PoolStateRequest, PoolStateResponse,
    PositionRequest, PositionResponse, StreamEventsRequest, SubmitTxRequest, SubmitTxResponse,
    TrancheStateRequest, TrancheStateResponse,
};
use sandbox::v1::{
    market_velocity_stream_server::{MarketVelocityStream, MarketVelocityStreamServer},
    PoolStateUpdate, PoolSubscriptionRequest,
};

pub mod noviscia {
    pub mod pipeline {
        tonic::include_proto!("noviscia.pipeline");
    }
}

pub mod sandbox {
    pub mod v1 {
        tonic::include_proto!("noviscia.sandbox.v1");
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
    /// Control-plane config (spec §3): time compression + clearing-failure drill.
    control: Arc<RwLock<ControlPlaneConfig>>,
    /// Vault NAV + institutional settlement ledger (per-block compounding).
    vault: Arc<vault::VaultLedger>,
    /// Bounded lock-free ingestion ring (checklist II.6): subscriber → pump.
    ring: std::sync::Arc<ring::EventRing<EventEnvelope>>,
}

impl SandboxLedger {
    fn new() -> Self {
        let (events, _) = broadcast::channel(4096);
        let mut desks = HashMap::new();
        // Cold-start posture (Tier 1 hands control to the stream here: desks
        // bookable at genesis, exactly like the on-chain registry).
        for mint in [
            "So11111111111111111111111111111111111111112",
            "SandboxUsdcMint",
            "SandboxNvscMint",
        ] {
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
            control: Arc::new(RwLock::new(ControlPlaneConfig::default())),
            vault: Arc::new(vault::VaultLedger::new()),
            ring: Arc::new(ring::EventRing::new(ring::DEFAULT_RING_CAPACITY)),
        }
    }

    fn current_slot(&self) -> u64 {
        self.slot.load(Ordering::SeqCst)
    }

    /// Base-units view of the pool: `$10M` expressed in micro-USDC.
    const POOL_TOTAL_BASE_UNITS: u64 = 10_000_000_000_000_u64;
}

/// The mock Yellowstone subscriber: ticks the virtual clock, re-derives desk
/// postures deterministically and emits per-slot EventEnvelopes.
///
/// Under `simulate_clearing_failure` (control plane, spec §3) it runs the
/// sentinel drill: the target wallet's desk is armed into an open window ~10
/// slots before expiry and the subscriber emits the spec's `SENTINEL
/// TRIGGERED` / `OVERDUE` transition once the window clears with no settlement.
async fn run_mock_subscriber(ledger: SandboxLedger, cadence_ms: u64) {
    let mut tick = tokio::time::interval(Duration::from_millis(cadence_ms));
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        tick.tick().await;
        let slot = ledger.slot.fetch_add(1, Ordering::SeqCst) + 1;
        {
            let mut desks = ledger.desks.write().await;
            let ctrl = ledger.control.read().await;

            if ctrl.simulate_clearing_failure {
                // Sentinel drill: arm the target wallet's desk (mapped to the
                // USDC desk) into an open-but-expiring window, then let the
                // posture machine flip it to OVERDUE at window end.
                let arm_slots = 140;
                for desk in desks.values_mut() {
                    if desk.mint != "SandboxUsdcMint" {
                        continue;
                    }
                    if desk.posture == Posture::Overdue || desk.posture == Posture::Breached {
                        continue; // once locked, stay locked
                    }
                    if desk.window_start_slot <= 0 {
                        desk.window_start_slot = slot as i64 - arm_slots;
                        desk.active_principal = 1_500_000_00; // $1.5M (cents)
                    }
                }
            }

            for desk in desks.values_mut() {
                let posture = posture::posture_at(
                    desk.window_start_slot.max(0) as u64,
                    slot,
                    desk.active_principal > 0,
                );
                if posture != desk.posture {
                    let sentinel = posture == Posture::Overdue && ctrl.simulate_clearing_failure;
                    desk.posture = posture;
                    let mut data = serde_json::json!({
                        "institution": desk.institution,
                        "mint": desk.mint,
                        "posture": posture.as_proto_i32(),
                    });
                    if sentinel {
                        data["sentinel"] = serde_json::json!("clearing_failure — status flipped to OVERDUE, borrowing capacity locked");
                    }
                    let envelope = EventEnvelope {
                        event_type: if sentinel {
                            "sentinel_clearing_failure".into()
                        } else {
                            "desk_posture".into()
                        },
                        slot: slot as i64,
                        timestamp: (slot * cadence_ms / 1000) as i64,
                        data: data.to_string(),
                        tx_signature: String::new(),
                    };
                    let _ = ledger.events.send(envelope.clone());
                    // Checklist II.6 — slot states also flow through the bounded
                    // lock-free ring; the pump task drains it asynchronously (the
                    // broadcast is the network fan-out, the ring is the local
                    // ingestion buffer).
                    let _ = ledger.ring.push(envelope);
                }
            }

            // COMPOUNDING (control plane, spec §3): while a desk has capital
            // deployed and has not breached, accrue the per-block premium
            // straight into vault NAV and announce the drip — this is the
            // "NAV appreciates block-by-block" proof an integrator can watch
            // live through `GET /api/v1/sandbox/vault`.
            if ctrl.premium_compounding_enabled {
                for desk in desks.values() {
                    if desk.active_principal <= 0 || desk.posture == Posture::Breached {
                        continue;
                    }
                    let active_micro = (desk.active_principal as u64).saturating_mul(10_000);
                    let drip = ledger.vault.compound_block(
                        active_micro,
                        vault::BASE_PREMIUM_RATE_TENTHS_BPS,
                    );
                    if drip > 0 {
                        let envelope = EventEnvelope {
                            event_type: "vault_compounding".into(),
                            slot: slot as i64,
                            timestamp: (slot * cadence_ms / 1000) as i64,
                            data: serde_json::json!({
                                "institution": desk.institution,
                                "mint": desk.mint,
                                "dripped_premium_units": drip,
                                "vault_nav_units": ledger.vault.nav_units(),
                            })
                            .to_string(),
                            tx_signature: String::new(),
                        };
                        let _ = ledger.events.send(envelope.clone());
                        let _ = ledger.ring.push(envelope);
                    }
                }
            }
        }
    }
}

/// Checklist II.6 — dedicated drain thread for the lock-free ingestion ring.
/// Blocks on the bounded receiver so every frame is delivered in order; the
/// bound + this dedicated consumer keep producer backpressure bounded.
fn run_ingestion_pump(ledger: SandboxLedger) {
    let rx = ledger.ring.subscriber();
    let events = ledger.events.clone();
    std::thread::spawn(move || {
        for frame in rx {
            let _ = events.send(frame);
        }
    });
}

struct SandboxNoVisciaStream {
    ledger: SandboxLedger,
    emulator: Arc<emulator::BundleEmulator>,
}

#[tonic::async_trait]
impl NovisciaStream for SandboxNoVisciaStream {
    async fn get_market_state(
        &self,
        _req: Request<MarketStateRequest>,
    ) -> Result<Response<MarketStateResponse>, Status> {
        Err(Status::unimplemented(
            "market data lives in Tier-2 velocity feeds; not modeled in sandbox",
        ))
    }

    async fn get_position(
        &self,
        _req: Request<PositionRequest>,
    ) -> Result<Response<PositionResponse>, Status> {
        Err(Status::unimplemented("position feeds are off-sandbox"))
    }

    async fn get_credit_status(
        &self,
        _req: Request<CreditStatusRequest>,
    ) -> Result<Response<CreditStatusResponse>, Status> {
        Ok(Response::new(CreditStatusResponse {
            wallet: "sandbox-institution".into(),
            credit_limit: 6_000_000_00.0, // $6,000,000 C_sys
            outstanding: 0.0,
            utilization_bps: 0.0,
            toll_rate_bps: 0.0,
            authorized: true,
        }))
    }

    async fn get_pool_state(
        &self,
        _req: Request<PoolStateRequest>,
    ) -> Result<Response<PoolStateResponse>, Status> {
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

    async fn get_capacity_status(
        &self,
        _req: Request<CapacityStatusRequest>,
    ) -> Result<Response<CapacityStatusResponse>, Status> {
        let slot = self.ledger.current_slot();
        // Simplest deterministic projection: each active sandbox desk draws
        // down the C_sys line at one step per slot once a window is open.
        let desks = self.ledger.desks.read().await;
        let active = desks
            .values()
            .filter(|d| d.posture != Posture::NoWindow)
            .count() as i64;
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

    async fn get_tranche_state(
        &self,
        _req: Request<TrancheStateRequest>,
    ) -> Result<Response<TrancheStateResponse>, Status> {
        Ok(Response::new(TrancheStateResponse {
            tranche_label: "T1-senior".into(),
            nav_usdc: 7_000_000_00,
            total_shares: 7_000_000,
            share_price: 100_000,
            loss_cap_bps: 100,
            accepts_deposits: true,
        }))
    }

    async fn get_desk_status(
        &self,
        req: Request<DeskStatusRequest>,
    ) -> Result<Response<DeskStatusResponse>, Status> {
        let r = req.into_inner();
        let key = format!("sandbox-op:{}", r.mint);
        let slot = r.current_slot as u64;
        let desks = self.ledger.desks.read().await;
        let desk = desks
            .get(&key)
            .ok_or_else(|| Status::not_found(format!("no desk for mint {}", r.mint)))?;
        // The caller supplies the observed slot; the posture is pure.
        let posture = posture::posture_at(
            desk.window_start_slot.max(0) as u64,
            slot,
            desk.active_principal > 0,
        );
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

    type StreamEventsStream =
        Pin<Box<dyn tokio_stream::Stream<Item = Result<EventEnvelope, Status>> + Send + 'static>>;

    async fn stream_events(
        &self,
        _req: Request<StreamEventsRequest>,
    ) -> Result<Response<Self::StreamEventsStream>, Status> {
        let stream = BroadcastStream::new(self.ledger.events.subscribe())
            .map(|r| r.map_err(|e| Status::internal(format!("sandbox event stream error: {}", e))));
        Ok(Response::new(Box::pin(stream)))
    }

    async fn submit_transaction(
        &self,
        req: Request<SubmitTxRequest>,
    ) -> Result<Response<SubmitTxResponse>, Status> {
        let _r = req.into_inner();
        Ok(Response::new(SubmitTxResponse {
            success: true,
            signature: "sandbox-sig".into(),
            error: String::new(),
            bundle_id: String::new(),
        }))
    }

    async fn submit_bundle(
        &self,
        req: Request<BundleRequest>,
    ) -> Result<Response<BundleResponse>, Status> {
        let r = req.into_inner();
        let simulate_fail = std::env::var("SANDBOX_SIMULATE_FAIL")
            .map(|_| true)
            .unwrap_or(false);
        let (id, status) = self.emulator.submit(
            &r.transactions,
            r.desired_capacity.max(0) as u64,
            simulate_fail,
        );
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

/// Spec-conformant ingestion engine (spec §1): `MarketVelocityStream`.
///
/// Streams `PoolStateUpdate`s per requested mint on the spec cadence. The
/// update carries the pool's idle capital, intra-slot active credit
/// utilization and the current premium rate — the TVV market-velocity feed an
/// institutional client integrates against.
struct SandboxVelocityStreamV1 {
    ledger: SandboxLedger,
    cadence_ms: u64,
}

#[tonic::async_trait]
impl MarketVelocityStream for SandboxVelocityStreamV1 {
    type SubscribePoolStateStream =
        Pin<Box<dyn tokio_stream::Stream<Item = Result<PoolStateUpdate, Status>> + Send + 'static>>;

    async fn subscribe_pool_state(
        &self,
        req: Request<PoolSubscriptionRequest>,
    ) -> Result<Response<Self::SubscribePoolStateStream>, Status> {
        let r = req.into_inner();
        if r.app_token.is_empty() {
            return Err(Status::unauthenticated(
                "app_token is required by the sandbox bearer contract",
            ));
        }
        // Empty selection == subscribe to the whole sandbox pool (all 3 mints).
        let mints: Vec<String> = if r.asset_mints.is_empty() {
            vec![
                "So11111111111111111111111111111111111111112".into(),
                "SandboxUsdcMint".into(),
                "SandboxNvscMint".into(),
            ]
        } else {
            r.asset_mints
        };

        let ledger = self.ledger.clone();
        let cadence = self.cadence_ms.max(1);
        let stream = async_stream_sandbox::pool_stream(ledger, cadence, mints);
        Ok(Response::new(Box::pin(stream)))
    }
}

/// Tiny adapter module to build the async stream without pulling in
/// `async-stream` (the hub stays dependency-light).
mod async_stream_sandbox {
    use super::*;

    pub(super) fn pool_stream(
        ledger: SandboxLedger,
        cadence_ms: u64,
        mints: Vec<String>,
    ) -> impl tokio_stream::Stream<Item = Result<PoolStateUpdate, Status>> + Send + 'static {
        async_stream_bridge(ledger, cadence_ms, mints)
    }

    fn async_stream_bridge(
        ledger: SandboxLedger,
        cadence_ms: u64,
        mints: Vec<String>,
    ) -> impl tokio_stream::Stream<Item = Result<PoolStateUpdate, Status>> + Send + 'static {
        // A channel-based pull stream: a producer loop ticks the cadence and
        // pushes one update per mint; the consumer stream yields them in order.
        use tokio::sync::mpsc;
        use tokio_stream::wrappers::ReceiverStream;

        let (tx, rx) = mpsc::channel::<PoolStateUpdate>(64);
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(Duration::from_millis(cadence_ms));
            tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            loop {
                tick.tick().await;
                let slot = ledger.current_slot();
                let desks = ledger.desks.read().await;
                // Exclusivity gate: while the control plane arms a non-Jito
                // leader, every update streams `allocation_frozen = true` so
                // client SDKs freeze allocation (checklist EXCLUSIVITY).
                let allocation_frozen = ledger.control.read().await.simulate_non_jito_leader;
                for mint in &mints {
                    let (total_idle, active) = match desks.get(&format!("sandbox-op:{mint}")) {
                        Some(desk) => {
                            let active_micro =
                                (desk.active_principal.max(0) as u64).saturating_mul(10_000);
                            (
                                SandboxLedger::POOL_TOTAL_BASE_UNITS.saturating_sub(active_micro),
                                active_micro,
                            )
                        }
                        None => (SandboxLedger::POOL_TOTAL_BASE_UNITS, 0),
                    };
                    if tx
                        .send(PoolStateUpdate {
                            slot,
                            asset_mint: mint.clone(),
                            total_idle_capital: total_idle,
                            active_credit_utilization: active,
                            // Repo convention: greedy/tenths-bps APY (4.608%).
                            current_premium_rate_bps: 4_608,
                            allocation_frozen,
                        })
                        .await
                        .is_err()
                    {
                        return;
                    }
                }
            }
        });
        ReceiverStream::new(rx).map(Ok)
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

    let grpc_port: u16 = std::env::var("SANDBOX_GRPC_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(10000);
    let emulator_port: u16 = std::env::var("SANDBOX_EMULATOR_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(8898);
    let bundles_port: u16 = std::env::var("SANDBOX_BUNDLES_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(10001);
    let control_port: u16 = std::env::var("SANDBOX_CONTROL_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(10002);
    let cadence_ms: u64 = std::env::var("SANDBOX_SLOT_MS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(400);

    let ledger = SandboxLedger::new();
    let emulator = Arc::new(emulator::BundleEmulator::new());
    let service = SandboxNoVisciaStream {
        ledger: ledger.clone(),
        emulator: emulator.clone(),
    };
    let velocity = SandboxVelocityStreamV1 {
        ledger: ledger.clone(),
        cadence_ms,
    };

    tokio::spawn(run_mock_subscriber(ledger.clone(), cadence_ms));
    run_ingestion_pump(ledger.clone());

    let grpc_addr = format!("127.0.0.1:{}", grpc_port);
    let grpc_listener = tokio::net::TcpListener::bind(&grpc_addr).await?;
    tracing::info!(
        "sandbox gRPC listening on {} (legacy noviscia.pipeline + spec noviscia.sandbox.v1 MarketVelocityStream)",
        grpc_addr
    );

    let emulator_addr = format!("127.0.0.1:{}", emulator_port);
    let emulator_listener = tokio::net::TcpListener::bind(&emulator_addr).await?;
    tracing::info!(
        "Jito bundle emulator (legacy JSON-RPC) listening on {} — sendBundle/getBundleStatuses/getTipAccounts",
        emulator_addr
    );

    let bundles_addr = format!("127.0.0.1:{}", bundles_port);
    let bundles_listener = tokio::net::TcpListener::bind(&bundles_addr).await?;
    tracing::info!(
        "Spec REST bundles listening on {} — POST /api/v1/bundles",
        bundles_addr
    );

    let control_addr = format!("127.0.0.1:{}", control_port);
    let control_listener = tokio::net::TcpListener::bind(&control_addr).await?;
    tracing::info!(
        "Spec control plane listening on {} — PUT /api/v1/sandbox/control-plane",
        control_addr
    );

    let grpc_task = tokio::spawn(async move {
        tonic::transport::Server::builder()
            .add_service(NovisciaStreamServer::new(service))
            .add_service(MarketVelocityStreamServer::new(velocity))
            .serve_with_incoming_shutdown(
                tokio_stream::wrappers::TcpListenerStream::new(grpc_listener),
                async { std::future::pending::<()>().await },
            )
            .await
    });

    let emulator_task = tokio::spawn(run_http_emulator(emulator_listener, emulator.clone()));
    let bundles_task = tokio::spawn(run_http_rest(bundles_listener, emulator, ledger.clone()));
    let control_task = tokio::spawn(run_http_control(control_listener, ledger.clone()));

    tokio::select! {
        r = grpc_task => r??,
        r = emulator_task => r??,
        r = bundles_task => r??,
        r = control_task => r??,
    }
    Ok(())
}

/// Minimal HTTP/1.1 listener. Deliberately dependency-free: one request per
/// connection, Content-Length framed, method+path+body returned for dispatch.
struct HttpRequest {
    method: String,
    path: String,
    body: String,
}

async fn read_http_request(socket: &mut tokio::net::TcpStream) -> Option<HttpRequest> {
    use tokio::io::AsyncReadExt;
    let mut buf = Vec::with_capacity(8192);
    let mut tmp = [0u8; 8192];
    let mut header_done = false;
    let mut content_length = 0usize;
    let mut request_line = String::new();
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
                request_line = headers.lines().next().unwrap_or_default().to_string();
                content_length = headers
                    .lines()
                    .skip(1)
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
        String::from_utf8_lossy(&buf[body_start..(body_start + content_length).min(buf.len())])
            .to_string()
    } else {
        String::new()
    };
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let path = parts.next().unwrap_or("").to_string();
    if method.is_empty() {
        None
    } else {
        Some(HttpRequest { method, path, body })
    }
}

async fn write_json_response(
    socket: &mut tokio::net::TcpStream,
    status_line: &str,
    value: &serde_json::Value,
) {
    use tokio::io::AsyncWriteExt;
    let resp = value.to_string();
    let _ = socket
        .write_all(
            format!(
                "{status_line}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                resp.len(),
                resp
            )
            .as_bytes(),
        )
        .await;
}

/// Legacy Tier-3 JSON-RPC emulator (sendBundle / getBundleStatuses /
/// getTipAccounts) — the surface the production `JitoClient` hits.
async fn run_http_emulator(
    listener: tokio::net::TcpListener,
    emulator: Arc<emulator::BundleEmulator>,
) -> anyhow::Result<()> {
    loop {
        let (mut socket, _) = listener.accept().await?;
        let emu = emulator.clone();
        tokio::spawn(async move {
            let req = match read_http_request(&mut socket).await {
                Some(r) => r,
                None => return,
            };
            let simulate_fail = std::env::var("SANDBOX_SIMULATE_FAIL")
                .map(|_| true)
                .unwrap_or(false);
            let resp = emu.process_jsonrpc(&req.body, simulate_fail);
            write_json_response(&mut socket, "HTTP/1.1 200 OK", &resp).await;
        });
    }
}

/// Spec §2 + vault surface on `:10001`.
///
/// * `POST /api/v1/bundles`             → emulator spec lifecycle (ACCEPTED /
///   REVERTED); landed PROFITABLE bundles open a clearing invoice.
/// * `GET  /api/v1/sandbox/vault`        → NAV + open premium debt snapshot
///   (the block-by-block compounding readout).
/// * `POST /api/v1/sandbox/settle`       → pays the invoice (sweeps open debt
///   into NAV) and unlocks every desk (posture → NoWindow).
async fn run_http_rest(
    listener: tokio::net::TcpListener,
    emulator: Arc<emulator::BundleEmulator>,
    ledger: SandboxLedger,
) -> anyhow::Result<()> {
    loop {
        let (mut socket, _) = listener.accept().await?;
        let (emu, l) = (emulator.clone(), ledger.clone());
        tokio::spawn(async move {
            let req = match read_http_request(&mut socket).await {
                Some(r) => r,
                None => return,
            };
            match (req.method.as_str(), req.path.as_str()) {
                ("POST", "/api/v1/bundles") => {
                    let simulate_fail = std::env::var("SANDBOX_SIMULATE_FAIL")
                        .map(|_| true)
                        .unwrap_or(false);
                    let resp = emu.process_rest_bundle(&req.body, simulate_fail);
                    // A landed PROFITABLE bundle opened an invoice: hand its
                    // logged premium to the settlement ledger (COMPOUNDING).
                    if resp["status"] == "ACCEPTED" {
                        if let Some(premium) =
                            resp["metrics"]["logged_premium_debt_units"].as_u64()
                        {
                            l.vault.observe_landed_bundle(premium);
                        }
                    }
                    write_json_response(&mut socket, "HTTP/1.1 200 OK", &resp).await;
                }
                ("GET", "/api/v1/sandbox/vault") => {
                    let slot = l.current_slot();
                    let posture = l
                        .desks
                        .read()
                        .await
                        .get("sandbox-op:SandboxUsdcMint")
                        .map(|d| d.posture.as_proto_i32())
                        .unwrap_or(0);
                    let resp = l.vault.snapshot_json(slot, posture);
                    write_json_response(&mut socket, "HTTP/1.1 200 OK", &resp).await;
                }
                ("POST", "/api/v1/sandbox/settle") => {
                    let slot = l.current_slot();
                    let sweep = l.vault.pay_invoice(slot);
                    let mut desks = l.desks.write().await;
                    for desk in desks.values_mut() {
                        desk.window_start_slot = 0;
                    }
                    drop(desks);
                    let envelope = EventEnvelope {
                        event_type: "clearing_settlement".into(),
                        slot: slot as i64,
                        timestamp: (slot * 400 / 1000) as i64,
                        data: serde_json::json!({
                            "institution": "sandbox-institution",
                            "status": "SETTLED",
                            "swept_invoice_units": sweep.swept,
                            "nav_before": sweep.nav_before,
                            "nav_after": sweep.nav_after,
                            "desk_unlocked": true,
                        })
                        .to_string(),
                        tx_signature: String::new(),
                    };
                    let _ = l.events.send(envelope.clone());
                    let _ = l.ring.push(envelope);
                    let resp = serde_json::json!({
                        "status": "SETTLED",
                        "swept_invoice_units": sweep.swept,
                        "nav_before": sweep.nav_before,
                        "nav_after": sweep.nav_after,
                        "swept_at_slot": sweep.swept_at_slot,
                        "sweep_count": l.vault.sweep_count(),
                        "desk_unlocked": true,
                        "desk_posture": 0,
                    });
                    write_json_response(&mut socket, "HTTP/1.1 200 OK", &resp).await;
                }
                _ => {
                    let resp = serde_json::json!({
                        "status": "REJECTED",
                        "error": { "code": "NOV_100_METHOD_NOT_ALLOWED", "message": "expected POST /api/v1/bundles, GET /api/v1/sandbox/vault or POST /api/v1/sandbox/settle" },
                    });
                    write_json_response(&mut socket, "HTTP/1.1 404 Not Found", &resp).await;
                }
            }
        });
    }
}

/// Spec §3 — control plane (time-acceleration configurator) on `:10002`.
/// `PUT /api/v1/sandbox/control-plane` mutates the shared clock config which
/// the mock subscriber observes (simulate_clearing_failure → sentinel drill).
async fn run_http_control(
    listener: tokio::net::TcpListener,
    ledger: SandboxLedger,
) -> anyhow::Result<()> {
    loop {
        let (mut socket, _) = listener.accept().await?;
        let l = ledger.clone();
        tokio::spawn(async move {
            let req = match read_http_request(&mut socket).await {
                Some(r) => r,
                None => return,
            };
            if req.method == "PUT" && req.path == "/api/v1/sandbox/control-plane" {
                let mut control = l.control.write().await;
                let resp = control::apply_put(&req.body, &mut control);
                write_json_response(&mut socket, "HTTP/1.1 200 OK", &resp).await;
            } else {
                let resp = control::response_error(
                    "NOV_100_METHOD_NOT_ALLOWED",
                    "expected PUT /api/v1/sandbox/control-plane",
                );
                write_json_response(&mut socket, "HTTP/1.1 404 Not Found", &resp).await;
            }
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
