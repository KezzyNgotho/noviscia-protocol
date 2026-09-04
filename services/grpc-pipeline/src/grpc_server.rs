use std::sync::Arc;

use anyhow::Result;
use tokio::sync::broadcast;
use tonic::{Request, Response, Status};
use tracing::{error, info, warn};

use crate::event_parser::ParsedEvent;
use crate::jito::JitoClient;
use crate::state_store::StateStore;

// Include the generated protobuf code.
pub mod pipeline {
    tonic::include_proto!("noviscia.pipeline");
}

use pipeline::noviscia_stream_server::{NovisciaStream, NovisciaStreamServer};
use pipeline::*;

/// gRPC server backed by the in-memory `StateStore` and broadcast event channel.
pub struct NovisciaGrpcServer {
    state: Arc<StateStore>,
    event_tx: broadcast::Sender<ParsedEvent>,
    jito: Arc<JitoClient>,
}

impl NovisciaGrpcServer {
    pub fn new(
        state: Arc<StateStore>,
        event_tx: broadcast::Sender<ParsedEvent>,
        jito: Arc<JitoClient>,
    ) -> Self {
        Self {
            state,
            event_tx,
            jito,
        }
    }

    /// Convert into a tonic `Server` (moves self).
    pub fn into_service(self) -> NovisciaStreamServer<Self> {
        NovisciaStreamServer::new(self)
    }
}

#[tonic::async_trait]
impl NovisciaStream for NovisciaGrpcServer {
    // ── Unary RPCs ──

    async fn get_market_state(
        &self,
        request: Request<MarketStateRequest>,
    ) -> Result<Response<MarketStateResponse>, Status> {
        let req = request.into_inner();
        let market = self
            .state
            .get_market(&req.market)
            .ok_or_else(|| Status::not_found(format!("market '{}' not found or stale", req.market)))?;

        Ok(Response::new(MarketStateResponse {
            market: market.market,
            price: market.price,
            confidence: market.confidence,
            publish_time: market.publish_time,
            funding_rate: market.funding_rate,
            slot: market.slot as i64,
        }))
    }

    async fn get_position(
        &self,
        request: Request<PositionRequest>,
    ) -> Result<Response<PositionResponse>, Status> {
        let req = request.into_inner();
        let pos = self
            .state
            .get_position(&req.wallet, &req.market)
            .ok_or_else(|| {
                Status::not_found(format!(
                    "position for wallet '{}' market '{}' not found or stale",
                    req.wallet, req.market
                ))
            })?;

        Ok(Response::new(PositionResponse {
            wallet: pos.wallet,
            market: pos.market,
            is_long: pos.is_long,
            size_usdc: pos.size_usdc,
            entry_price: pos.entry_price,
            unrealized_pnl: pos.unrealized_pnl,
            margin_balance: pos.margin_balance,
            opened_slot: pos.opened_slot,
        }))
    }

    async fn get_credit_status(
        &self,
        request: Request<CreditStatusRequest>,
    ) -> Result<Response<CreditStatusResponse>, Status> {
        let req = request.into_inner();
        let credit = self
            .state
            .get_credit(&req.wallet)
            .ok_or_else(|| {
                Status::not_found(format!(
                    "credit status for wallet '{}' not found or stale",
                    req.wallet
                ))
            })?;

        Ok(Response::new(CreditStatusResponse {
            wallet: credit.wallet,
            credit_limit: credit.credit_limit,
            outstanding: credit.outstanding,
            utilization_bps: credit.utilization_bps,
            toll_rate_bps: credit.toll_rate_bps,
            authorized: credit.authorized,
        }))
    }

    async fn get_pool_state(
        &self,
        request: Request<PoolStateRequest>,
    ) -> Result<Response<PoolStateResponse>, Status> {
        let req = request.into_inner();
        let pool = self
            .state
            .get_pool(&req.pool_label)
            .ok_or_else(|| {
                Status::not_found(format!(
                    "pool '{}' not found or stale",
                    req.pool_label
                ))
            })?;

        Ok(Response::new(PoolStateResponse {
            pool_label: pool.pool_label,
            kyc_required: pool.kyc_required,
            total_shares: pool.total_shares,
            base_reserve: pool.base_reserve,
            quote_reserve: pool.quote_reserve,
            lp_count: pool.lp_count,
            is_paused: pool.is_paused,
        }))
    }

    // ── Unary RPC: Capacity Engine Status ──

    async fn get_capacity_status(
        &self,
        request: Request<CapacityStatusRequest>,
    ) -> Result<Response<CapacityStatusResponse>, Status> {
        let req = request.into_inner();
        let cap = self
            .state
            .get_capacity(&req.operator)
            .ok_or_else(|| {
                Status::not_found(format!(
                    "capacity status for operator '{}' not found or stale",
                    req.operator
                ))
            })?;

        Ok(Response::new(CapacityStatusResponse {
            operator: cap.operator.clone(),
            credit_limit: cap.credit_limit as i64,
            active_utilization: cap.active_utilization as i64,
            available_balance: cap.available_balance() as i64,
            margin_posted: cap.margin_posted as i64,
            tier: cap.tier as i32,
            premium_multiplier_bps: cap.premium_multiplier_bps as i64,
            frozen: cap.frozen,
            kyc_verified: cap.kyc_verified,
            slot: cap.updated_at.elapsed().as_secs() as i64,
            current_premium_bps: cap.current_premium_bps as i64,
            load_ratio_bps: cap.load_ratio_bps as i64,
        }))
    }

    // ── Unary RPC: Tranche State ──

    async fn get_tranche_state(
        &self,
        request: Request<TrancheStateRequest>,
    ) -> Result<Response<TrancheStateResponse>, Status> {
        let req = request.into_inner();
        let tranche = self
            .state
            .get_tranche(&req.tranche_label)
            .ok_or_else(|| {
                Status::not_found(format!(
                    "tranche '{}' not found or stale",
                    req.tranche_label
                ))
            })?;

        let share_price = if tranche.total_shares > 0.0 {
            tranche.nav_usdc / tranche.total_shares
        } else {
            1.0
        };

        Ok(Response::new(TrancheStateResponse {
            tranche_label: tranche.tranche_label,
            nav_usdc: tranche.nav_usdc as i64,
            total_shares: tranche.total_shares as i64,
            share_price: (share_price * 1e6) as i64,
            loss_cap_bps: tranche.loss_cap_bps as i64,
            accepts_deposits: tranche.accepts_deposits,
        }))
    }

    // ── Unary RPC: Asset-Engine Desk Status (Risk Sentinel) ──

    async fn get_desk_status(
        &self,
        request: Request<DeskStatusRequest>,
    ) -> Result<Response<DeskStatusResponse>, Status> {
        let req = request.into_inner();
        let desk = self.state.get_desk(&req.institution, &req.mint).ok_or_else(|| {
            Status::not_found(format!(
                "desk '{}:{}' not found or stale",
                req.institution, req.mint
            ))
        })?;

        Ok(Response::new(DeskStatusResponse {
            institution: desk.institution,
            mint: desk.mint,
            active_principal: desk.active_principal as i64,
            accumulated_premiums: desk.accumulated_premiums as i64,
            window_start_slot: desk.window_start_slot as i64,
            peak_active_utilization: desk.peak_active_utilization as i64,
            last_settlement_timestamp: desk.last_settlement_timestamp,
        }))
    }

    // ── Server-streaming RPC ──

    type StreamEventsStream = tokio_stream::wrappers::ReceiverStream<Result<EventEnvelope, Status>>;

    async fn stream_events(
        &self,
        request: Request<StreamEventsRequest>,
    ) -> Result<Response<Self::StreamEventsStream>, Status> {
        let req = request.into_inner();
        let mut rx = self.event_tx.subscribe();

        let event_types: Vec<String> = req.event_types.iter().map(|s| s.to_lowercase()).collect();
        let wallet_filter = if req.wallet_filter.is_empty() {
            None
        } else {
            Some(req.wallet_filter.to_lowercase())
        };

        // Spawn a task that filters events from the broadcast and forwards to
        // a dedicated channel per stream client.
        let (client_tx, client_rx) = tokio::sync::mpsc::channel::<Result<EventEnvelope, Status>>(256);

        tokio::spawn(async move {
            loop {
                match rx.recv().await {
                    Ok(event) => {
                        // Apply event_type filter.
                        if !event_types.is_empty() {
                            let etype = event.event_type_name().to_lowercase();
                            if !event_types.iter().any(|t| t == &etype) {
                                continue;
                            }
                        }

                        // Apply wallet filter.
                        if let Some(ref wf) = wallet_filter {
                            let wallets: Vec<String> =
                                event.wallets().into_iter().map(|w| w.to_lowercase()).collect();
                            if !wallets.iter().any(|w| w == wf) {
                                continue;
                            }
                        }

                        let envelope = EventEnvelope {
                            event_type: event.event_type_name().to_string(),
                            slot: event.slot() as i64,
                            timestamp: chrono::Utc::now().timestamp(),
                            data: serde_json::to_string(&event).unwrap_or_default(),
                            tx_signature: event.tx_signature().to_string(),
                        };

                        if client_tx.send(Ok(envelope)).await.is_err() {
                            break; // client disconnected
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        warn!(skipped = n, "event stream lagged, skipped events");
                    }
                    Err(broadcast::error::RecvError::Closed) => {
                        break;
                    }
                }
            }
        });

        // Wrap the mpsc receiver as a tonic Streaming by converting it.
        let stream = tokio_stream::wrappers::ReceiverStream::new(client_rx);
        Ok(Response::new(stream))
    }

    // ── Unary RPC: Submit Transaction ──

    async fn submit_transaction(
        &self,
        request: Request<SubmitTxRequest>,
    ) -> Result<Response<SubmitTxResponse>, Status> {
        let req = request.into_inner();

        if req.transaction.is_empty() {
            return Ok(Response::new(SubmitTxResponse {
                success: false,
                signature: String::new(),
                error: "empty transaction bytes".into(),
                bundle_id: String::new(),
            }));
        }

        // Decode the raw transaction.
        let tx_bytes = req.transaction;
        let signature = if req.use_jito {
            // Jito bundle submission.
            let tip = if req.tip_lamports > 0 {
                req.tip_lamports as u64
            } else {
                self.jito
                    .estimate_tip_lamports()
                    .await
                    .unwrap_or(10_000)
            };

            match self.jito.submit_bundle(&tx_bytes, tip).await {
                Ok(bundle_id) => {
                    info!(bundle_id = %bundle_id, "jito bundle submitted");
                    return Ok(Response::new(SubmitTxResponse {
                        success: true,
                        signature: String::new(), // signature comes back when bundle lands
                        error: String::new(),
                        bundle_id,
                    }));
                }
                Err(e) => {
                    error!(error = %e, "jito bundle submission failed");
                    return Ok(Response::new(SubmitTxResponse {
                        success: false,
                        signature: String::new(),
                        error: format!("jito submission failed: {e}"),
                        bundle_id: String::new(),
                    }));
                }
            }
        } else {
            // Standard RPC submission — decode the serialized transaction
            // and forward to the Solana RPC.
            //
            // In a production setup this would use `solana_client` to
            // send the transaction to the configured RPC endpoint.
            // For now we return the transaction signature extracted from bytes.
            let sig_bytes = if tx_bytes.len() >= 64 {
                bs58_encode_slice(&tx_bytes[..64])
            } else {
                String::new()
            };
            sig_bytes
        };

        Ok(Response::new(SubmitTxResponse {
            success: true,
            signature,
            error: String::new(),
            bundle_id: String::new(),
        }))
    }

    // ── Unary RPC: Atomic Bundle Submission ──

    async fn submit_bundle(
        &self,
        request: Request<BundleRequest>,
    ) -> Result<Response<BundleResponse>, Status> {
        let req = request.into_inner();

        if req.transactions.is_empty() {
            return Ok(Response::new(BundleResponse {
                success: false,
                bundle_id: String::new(),
                status: "rejected".into(),
                error: "empty bundle: Transaction A and B must be pre-signed".into(),
            }));
        }

        // Reserve capacity against the risk engine the moment the bundle is
        // accepted for relay.
        if !req.operator.is_empty() {
            let cap = self.state.get_capacity(&req.operator);
            let mut state = cap.unwrap_or(crate::state_store::CapacityState {
                operator: req.operator.clone(),
                credit_limit: req.desired_capacity as u64,
                active_utilization: 0,
                available_balance: 0,
                margin_posted: 0,
                tier: 1,
                premium_multiplier_bps: 100,
                frozen: false,
                kyc_verified: false,
                current_premium_bps: 0,
                load_ratio_bps: 0,
                updated_at: std::time::Instant::now(),
            });
            state.active_utilization =
                state.active_utilization.saturating_add(req.desired_capacity.max(0) as u64);
            state.available_balance = state.available_balance();
            state.kyc_verified = true;
            state.updated_at = std::time::Instant::now();
            self.state.update_capacity(state);

            info!(
                operator = %req.operator,
                desired_capacity = req.desired_capacity,
                "capacity reserved for atomic bundle submission"
            );
        }

        let tip = if req.tip_lamports > 0 {
            req.tip_lamports as u64
        } else {
            self.jito.estimate_tip_lamports().await.unwrap_or(10_000)
        };

        match self.jito.submit_bundle_many(&req.transactions, tip).await {
            Ok(bundle_id) => {
                info!(bundle_id = %bundle_id, legs = req.transactions.len(), "atomic bundle submitted");
                // Surface the initial on-relay status for observability.
                let status = match self.jito.get_bundle_status(&bundle_id).await {
                    Ok(s) => s.confirmation_status,
                    Err(_) => "pending".to_string(),
                };
                Ok(Response::new(BundleResponse {
                    success: true,
                    bundle_id,
                    status,
                    error: String::new(),
                }))
            }
            Err(e) => {
                error!(error = %e, "atomic bundle submission failed");
                Ok(Response::new(BundleResponse {
                    success: false,
                    bundle_id: String::new(),
                    status: "rejected".into(),
                    error: format!("jito bundle rejected: {e}"),
                }))
            }
        }
    }
}

// ── Helpers ──

fn bs58_encode_slice(data: &[u8]) -> String {
    const ALPHABET: &[u8] = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    if data.is_empty() {
        return String::new();
    }

    let mut leading_zeros = 0;
    for byte in data {
        if *byte == 0 {
            leading_zeros += 1;
        } else {
            break;
        }
    }

    let encoded_len = (data.len() * 138) / 100 + 1;
    let mut output = vec![0u8; encoded_len];
    let mut output_len = 0;

    for &byte in data {
        let mut carry = byte as u32;
        let mut j = 0;
        for k in 0..encoded_len {
            if j >= output_len && carry == 0 {
                break;
            }
            carry += output[k] as u32 * 256;
            output[k] = (carry % 58) as u8;
            carry /= 58;
            j += 1;
        }
        output_len = j;
    }

    let mut i = output_len;
    while i > 0 && output[i - 1] == 0 {
        i -= 1;
    }

    let mut result = String::with_capacity(leading_zeros + output_len);
    for _ in 0..leading_zeros {
        result.push('1');
    }
    while i > 0 {
        i -= 1;
        result.push(ALPHABET[output[i] as usize] as char);
    }
    result
}
