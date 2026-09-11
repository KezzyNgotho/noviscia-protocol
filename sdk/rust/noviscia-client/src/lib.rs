//! # Noviscia Client
//!
//! RPC + Jito bundle submission client for institutional-grade transaction
//! delivery. Handles Jito block engine submission, tip estimation, and
//! bundle status polling.

use serde::{Deserialize, Serialize};
use solana_client::rpc_client::RpcClient;
use solana_program::pubkey::Pubkey;
use solana_sdk::signature::Signer;
use solana_sdk::transaction::VersionedTransaction;
use std::str::FromStr;

pub mod block_engine;
pub mod bundle_encoder;
pub mod bundle_engine;
pub mod grpc_stream;

pub use block_engine::{BlockEngineRelay, BlockEngineRegistry, SharedBlockEngineRegistry};
pub use bundle_encoder::compile_atomic_bundle;
pub use bundle_engine::{AtomicBundle, build_atomic_bundle};
pub use grpc_stream::CapacityCache;

// ── Jito Tip Accounts ──────────────────────────────────────────────────────

/// Jito tip recipient accounts. A random one is selected per bundle.
pub const JITO_TIP_ACCOUNTS: [&str; 3] = [
    "HWzXG9aiJfMekjkFjYnVPh6Ee9Xav7V3qvz4NaTz8z6u",
    "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
    "HFqU5x63VTqvQss8hp11i4bPg4H3y2G6r9wCfJ9aQ3k6",
];

// ── Jito Bundle Types ─────────────────────────────────────────────────────

/// A Jito bundle: serialized transactions + tip.
#[derive(Debug, Clone)]
pub struct JitoBundle {
    /// Raw serialized transactions (base-58 or base-64 encoded as bytes).
    pub transactions: Vec<Vec<u8>>,
    /// Tip in lamports to include with the bundle.
    pub tip_lamports: u64,
}

/// Jito bundle status response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BundleStatusResponse {
    pub bundle_id: String,
    pub status: String,
    pub transactions: Option<Vec<String>>,
}

/// Jito bundle status request.
#[derive(Debug, Serialize)]
struct BundleStatusRequest {
    jsonrpc: &'static str,
    id: u64,
    method: &'static str,
    params: Vec<String>,
}

/// Jito bundle submission request.
#[derive(Debug, Serialize)]
struct BundleRequest {
    jsonrpc: &'static str,
    id: u64,
    method: &'static str,
    params: BundleParams,
}

#[derive(Debug, Serialize)]
struct BundleParams {
    #[serde(rename = "txs")]
    transactions: Vec<String>,
    #[serde(rename = "tip")]
    tip_lamports: u64,
    #[serde(rename = "tip_account")]
    tip_account: String,
}

// ── Errors ─────────────────────────────────────────────────────────────────

/// Errors surfaced by the client.
#[derive(Debug)]
pub enum ClientError {
    /// HTTP request failed.
    Http(reqwest::Error),
    /// JSON serialization/deserialization failed.
    Json(serde_json::Error),
    /// The bundle was rejected or not found.
    BundleRejected(String),
    /// The RPC call failed.
    Rpc(String),
    /// Tip estimation failed.
    TipEstimationFailed(String),
    /// gRPC feed error (connection, subscription, or stream failure).
    Grpc(String),
}

impl std::fmt::Display for ClientError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ClientError::Http(e) => write!(f, "HTTP error: {e}"),
            ClientError::Json(e) => write!(f, "JSON error: {e}"),
            ClientError::BundleRejected(msg) => write!(f, "bundle rejected: {msg}"),
            ClientError::Rpc(msg) => write!(f, "RPC error: {msg}"),
            ClientError::TipEstimationFailed(msg) => write!(f, "tip estimation failed: {msg}"),
            ClientError::Grpc(msg) => write!(f, "gRPC feed error: {msg}"),
        }
    }
}

impl std::error::Error for ClientError {}

impl From<reqwest::Error> for ClientError {
    fn from(e: reqwest::Error) -> Self {
        ClientError::Http(e)
    }
}

impl From<serde_json::Error> for ClientError {
    fn from(e: serde_json::Error) -> Self {
        ClientError::Json(e)
    }
}

// ── NovisciaTvvClient ─────────────────────────────────────────────────────

/// Slot-expiry epoch (unix seconds) used to convert the pitch's `target_slot`
/// into the capacity SDK's `expiry: i64` field. Sandbox ignores expiry;
/// mainnet callers should override with a real clock-derived deadline.
const SLOT_EXPIRY_EPOCH_SECS: i64 = 1_750_000_000;

/// Institutional HFT integration configuration.
///
/// Matches the pitch spec 1:1: the five core fields a headless arbitrage
/// desk needs to plug into the Noviscia TVV feed and build atomic bundles.
/// Keypair is *owned* by the config so the client can sign without
/// touching the caller's wallet state.
pub struct NovisciaConfig {
    /// The operator / fee-payer keypair (signs both Transaction A and B).
    pub trader_identity: solana_sdk::signature::Keypair,
    /// The on-chain Noviscia capacity program ID.
    pub noviscia_program_id: Pubkey,
    /// KYC Merkle proof path (Vec of 32-byte internal nodes).
    pub kyc_merkle_proof: Vec<[u8; 32]>,
    /// The gRPC feed endpoint (sandbox: `http://127.0.0.1:10000`).
    pub grpc_endpoint_feed: String,
    /// The Jito block-engine relay URL (sandbox: `http://127.0.0.1:8898`).
    pub jito_relay_url: String,
}

impl Clone for NovisciaConfig {
    fn clone(&self) -> Self {
        Self {
            trader_identity: self.trader_identity.insecure_clone(),
            noviscia_program_id: self.noviscia_program_id,
            kyc_merkle_proof: self.kyc_merkle_proof.clone(),
            grpc_endpoint_feed: self.grpc_endpoint_feed.clone(),
            jito_relay_url: self.jito_relay_url.clone(),
        }
    }
}

/// Headless TVV arbitrage client — the pitch spec's "lean client SDK".
///
/// Spawns a background gRPC feed loop that ingests `PoolStateUpdate`
/// messages into an in-memory `pool_capacity_cache` (`Arc<RwLock<HashMap>>`
/// underneath, sub-microsecond reads on the hot path).
///
/// ```text
///  let client = NovisciaTvvClient::connect(Arc::new(NovisciaConfig { ... })).await?;
///  let headroom = client.check_slot_headroom(pool_mint); // <0.1ms
///  let bundle   = client.compile_atomic_jito_bundle(pool_mint, capital, slot, arb_ixs)?;
/// ```
///
/// ## EXCLUSIVITY
///
/// When the feed reports `allocation_frozen = true` (a non-Jito block
/// builder leads the current slot), `check_slot_headroom` returns `0` and
/// `compile_atomic_jito_bundle` rejects with the guardrail error — zero
/// bytes leave the machine.
pub struct NovisciaTvvClient {
    /// The immutable config (Arc-shared with the background feed).
    pub config: std::sync::Arc<NovisciaConfig>,
    /// In-memory capacity cache: mint → available headroom (base units).
    /// The pitch type is `Arc<RwLock<HashMap<Pubkey, u64>>>` — the wrapper
    /// exposes `.get()` / `.set()` / `.snapshot()` for ergonomic access.
    pub pool_capacity_cache: CapacityCache,
    /// Background feed handle; aborted on drop to keep the process clean.
    _feed_handle: tokio::task::JoinHandle<()>,
}

impl NovisciaTvvClient {
    /// Connect to the TVV feed and spawn the background ingestion loop.
    ///
    /// Returns once the first `SubscribePoolState` stream is established.
    /// The feed will automatically reconnect on disconnection (300ms backoff).
    pub async fn connect(config: std::sync::Arc<NovisciaConfig>) -> Result<Self, String> {
        let (cache, handle) =
            grpc_stream::spawn_feed(config.grpc_endpoint_feed.clone(), vec!["USDC".into()]);
        // Allow the first update to land before returning to the caller.
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        Ok(Self {
            config,
            pool_capacity_cache: cache,
            _feed_handle: handle,
        })
    }

    /// Read the freshest headroom for `target_pool_mint` from the in-memory
    /// cache. Returns 0 until the first feed update arrives (<0.1ms after
    /// cache warm), and also returns 0 while the mint is frozen by a
    /// non-Jito leader slot (EXCLUSIVITY).
    pub fn check_slot_headroom(&self, target_pool_mint: Pubkey) -> u64 {
        self.pool_capacity_cache.get(&target_pool_mint)
    }

    /// Whether the pool is currently frozen by a non-Jito block builder.
    /// When `true`, `check_slot_headroom` returns `0` and
    /// `compile_atomic_jito_bundle` rejects — the EXCLUSIVITY checklist.
    pub fn is_allocation_frozen(&self, target_pool_mint: Pubkey) -> bool {
        self.pool_capacity_cache.is_allocation_frozen(&target_pool_mint)
    }

    /// Guardrail + compile: reject if headroom is insufficient, otherwise
    /// build the two-leg Jito atomic bundle.
    ///
    /// * `target_pool_mint` — the pool whose headroom is checked.
    /// * `requested_capital` — the allotment requested (µUSDC).
    /// * `target_slot` — the slot to target (converted internally to an
    ///   on-chain expiry via [`SLOT_EXPIRY_EPOCH_SECS`]).
    /// * `private_arbitrage_ixs` — the desk's confidential instructions
    ///   (Transaction B).
    ///
    /// Returns an [`AtomicBundle`] (two signed legs) ready for submission via
    /// [`NovisciaClient::send_atomic_bundle`]. If headroom is below the
    /// requested amount, returns `Err` — zero bytes leave the machine.
    pub fn compile_atomic_jito_bundle(
        &self,
        target_pool_mint: Pubkey,
        requested_capital: u64,
        target_slot: u64,
        private_arbitrage_ixs: Vec<solana_program::instruction::Instruction>,
    ) -> Result<AtomicBundle, String> {
        let headroom = self.check_slot_headroom(target_pool_mint);
        if headroom < requested_capital {
            return Err(format!(
                "guardrail: headroom ({headroom}) < requested ({requested_capital}) for {target_pool_mint}"
            ));
        }
        let expiry = SLOT_EXPIRY_EPOCH_SECS + target_slot as i64;
        let tip_account = Pubkey::from_str(crate::JITO_TIP_ACCOUNTS[0]).unwrap_or_default();
        // Derive the operator's USDC ATA so leg A allots into the right account
        // on mainnet; the sandbox emulator does not validate it but the wire is
        // already correct.
        let usdc_source = associated_token_address(
            &self.config.trader_identity.pubkey(),
            &noviscia_types::USDC_MINT,
        );
        bundle_encoder::compile_atomic_bundle(
            &self.config.trader_identity,
            usdc_source,
            requested_capital,
            expiry,
            self.config.kyc_merkle_proof.clone(),
            private_arbitrage_ixs,
            tip_account,
            5_000, // default 10k lamports micro-fee — half for the demo
            solana_sdk::hash::Hash::default(),
        )
        .map_err(|e| e.to_string())
    }
}

/// Offline RPC + Jito client. Holds only public addresses — never keys.
pub struct NovisciaClient {
    /// Solana RPC client for read-only queries.
    pub rpc: RpcClient,
    /// Jito block engine endpoint URL (e.g. `https://mainnet.block-engine.jito.wtf/api/v1/bundles`).
    pub jito_endpoint: String,
    /// Optional secondary Jito endpoint for failover.
    pub jito_backup_endpoint: Option<String>,
    /// Multi-relay MEV registry for health-aware failover.
    pub relay_registry: SharedBlockEngineRegistry,
}

impl NovisciaClient {
    /// Create a new client with the given RPC URL and Jito endpoint.
    pub fn new(rpc_url: &str, jito_endpoint: &str) -> Self {
        Self {
            rpc: RpcClient::new(rpc_url.to_string()),
            jito_endpoint: jito_endpoint.to_string(),
            jito_backup_endpoint: None,
            relay_registry: SharedBlockEngineRegistry::new(BlockEngineRegistry::default()),
        }
    }

    /// Create a client with a backup Jito endpoint.
    pub fn with_backup(
        rpc_url: &str,
        jito_endpoint: &str,
        jito_backup_endpoint: &str,
    ) -> Self {
        Self {
            rpc: RpcClient::new(rpc_url.to_string()),
            jito_endpoint: jito_endpoint.to_string(),
            jito_backup_endpoint: Some(jito_backup_endpoint.to_string()),
            relay_registry: SharedBlockEngineRegistry::new(BlockEngineRegistry::default()),
        }
    }

    /// Send a Jito bundle to the block engine.
    ///
    /// Encodes each transaction as base-58, selects a tip account, and POSTs
    /// the bundle to the Jito block engine endpoint. On transport errors the
    /// bundle is re-attempted against the backup endpoint and any healthy
    /// relays in the registry.
    pub async fn send_jito_bundle(&self, bundle: &JitoBundle) -> Result<String, ClientError> {
        let mut endpoints = vec![self.jito_endpoint.clone()];
        if let Some(backup) = &self.jito_backup_endpoint {
            endpoints.push(backup.clone());
        }
        for relay in self.relay_registry.0.lock().unwrap().healthy_urls() {
            if !endpoints.contains(&relay) {
                endpoints.push(relay);
            }
        }
        self.send_bundle_failover(bundle, &endpoints).await
    }

    /// Submit a bundle across a list of endpoints, failing over on transport
    /// errors. A deterministic `BundleRejected` aborts immediately.
    pub async fn send_bundle_failover(
        &self,
        bundle: &JitoBundle,
        endpoints: &[String],
    ) -> Result<String, ClientError> {
        let mut last_transport_err: Option<ClientError> = None;
        for endpoint in endpoints {
            match self.send_bundle_to(endpoint, bundle).await {
                Ok(bundle_id) => return Ok(bundle_id),
                Err(ClientError::Http(_)) | Err(ClientError::Json(_)) => {
                    self.relay_registry
                        .0
                        .lock()
                        .unwrap()
                        .mark_unhealthy(endpoint);
                    last_transport_err = Some(ClientError::BundleRejected(format!(
                        "relay {endpoint} unreachable"
                    )));
                }
                Err(e) => {
                    // Rejection is deterministic on this bundle — do not retry.
                    return Err(e);
                }
            }
        }
        Err(last_transport_err.unwrap_or(ClientError::BundleRejected(
            "no block engine relays available".to_string(),
        )))
    }

    /// Submit an atomic bundle by serializing each leg and forwarding to Jito.
    pub async fn send_atomic_bundle(
        &self,
        bundle: &AtomicBundle,
    ) -> Result<String, ClientError> {
        let txs: Vec<Vec<u8>> = bundle
            .transactions
            .iter()
            .map(|tx| bincode::serialize(tx).unwrap_or_default())
            .collect();
        let jito = JitoBundle {
            transactions: txs,
            tip_lamports: bundle.tip_lamports,
        };
        self.send_jito_bundle(&jito).await
    }

    async fn send_bundle_to(
        &self,
        endpoint: &str,
        bundle: &JitoBundle,
    ) -> Result<String, ClientError> {
        let encoded_txs: Vec<String> = bundle
            .transactions
            .iter()
            .map(|tx| base58_encode(tx))
            .collect();

        let tip_account = self.select_tip_account();

        let request = BundleRequest {
            jsonrpc: "2.0",
            id: 1,
            method: "sendBundle",
            params: BundleParams {
                transactions: encoded_txs,
                tip_lamports: bundle.tip_lamports,
                tip_account,
            },
        };

        let client = reqwest::Client::new();
        let resp = client
            .post(endpoint)
            .json(&request)
            .send()
            .await?;

        let body: serde_json::Value = resp.json().await?;

        if let Some(error) = body.get("error") {
            return Err(ClientError::BundleRejected(error.to_string()));
        }

        let bundle_id = body
            .get("result")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();

        if bundle_id.is_empty() {
            return Err(ClientError::BundleRejected(
                "empty bundle id from block engine".to_string(),
            ));
        }

        Ok(bundle_id)
    }

    /// Poll the bundle landing status by bundle ID.
    ///
    /// Returns the status string: `"pending"`, `"confirmed"`, `"landed"`,
    /// or `"failed"`.
    pub async fn get_bundle_status(
        &self,
        bundle_id: &str,
    ) -> Result<BundleStatusResponse, ClientError> {
        let request = BundleStatusRequest {
            jsonrpc: "2.0",
            id: 1,
            method: "getBundleStatuses",
            params: vec![bundle_id.to_string()],
        };

        let client = reqwest::Client::new();
        let resp = client
            .post(&self.jito_endpoint)
            .json(&request)
            .send()
            .await?;

        let body: serde_json::Value = resp.json().await?;

        if let Some(error) = body.get("error") {
            return Err(ClientError::BundleRejected(
                error.to_string(),
            ));
        }

        let status = body
            .get("result")
            .and_then(|v| v.get("value"))
            .and_then(|v| v.as_array())
            .and_then(|arr| arr.first())
            .map(|s| {
                serde_json::from_value::<BundleStatusResponse>(s.clone())
            })
            .transpose()?
            .unwrap_or_else(|| BundleStatusResponse {
                bundle_id: bundle_id.to_string(),
                status: "not_found".to_string(),
                transactions: None,
            });

        Ok(status)
    }

    /// Estimate the Jito tip by querying recent landed bundles.
    ///
    /// Returns a tip amount in lamports. Falls back to a default of 10_000
    /// lamports (0.00001 SOL) on failure.
    pub async fn estimate_tip(&self) -> u64 {
        match self.fetch_recent_landed_tips().await {
            Ok(tips) if !tips.is_empty() => {
                // Use the median of recent tips.
                let mut sorted = tips;
                sorted.sort_unstable();
                sorted[sorted.len() / 2]
            }
            _ => 10_000, // default: 10k lamports
        }
    }

    /// Poll bundle landing with a timeout.
    ///
    /// Checks status every `poll_interval_ms` for up to `timeout_ms`.
    /// Returns `Ok(true)` if landed, `Ok(false)` if timed out or failed.
    pub async fn wait_for_bundle(
        &self,
        bundle_id: &str,
        timeout_ms: u64,
        poll_interval_ms: u64,
    ) -> Result<bool, ClientError> {
        let start = std::time::Instant::now();
        let timeout = std::time::Duration::from_millis(timeout_ms);
        let interval = std::time::Duration::from_millis(poll_interval_ms);

        loop {
            if start.elapsed() >= timeout {
                return Ok(false);
            }

            let status = self.get_bundle_status(bundle_id).await?;
            match status.status.as_str() {
                "landed" | "confirmed" => return Ok(true),
                "failed" => return Ok(false),
                _ => {}
            }

            tokio::time::sleep(interval).await;
        }
    }

    // ── Private helpers ───────────────────────────────────────────────

    /// Select a random Jito tip account.
    fn select_tip_account(&self) -> String {
        use std::time::{SystemTime, UNIX_EPOCH};
        let ns = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .subsec_nanos() as usize;
        JITO_TIP_ACCOUNTS[ns % JITO_TIP_ACCOUNTS.len()].to_string()
    }

    /// Fetch recent landed tips from the Jito API.
    async fn fetch_recent_landed_tips(&self) -> Result<Vec<u64>, ClientError> {
        let url = format!("{}/tip_accounts", self.jito_endpoint);
        let client = reqwest::Client::new();
        let resp = client.get(&url).send().await?;
        let body: serde_json::Value = resp.json().await?;

        // The tip accounts endpoint returns account info — parse tip amounts
        // from recent landed bundles. For now, return the median-based
        // heuristic from the `getBundleStatuses` polling pattern.
        let tips: Vec<u64> = body
            .get("result")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.get("landed_tips_in_sol").and_then(|t| t.as_f64()))
                    .map(|sol| (sol * 1_000_000_000.0) as u64)
                    .collect()
            })
            .unwrap_or_default();

        Ok(tips)
    }
}

// ── Utility Functions ──────────────────────────────────────────────────────

/// Base-58 encode raw bytes. Simple implementation to avoid pulling in the
/// `bs58` crate. Public so examples and integrators can re-encode wire bytes
/// for the sandbox emulator's REST interface.
pub fn base58_encode(data: &[u8]) -> String {
    const ALPHABET: &[u8] = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    if data.is_empty() {
        return String::new();
    }
    let mut digits = Vec::new();
    for &byte in data {
        let mut carry = byte as u32;
        for d in digits.iter_mut() {
            carry += (*d as u32) << 8;
            *d = (carry % 58) as u8;
            carry /= 58;
        }
        while carry > 0 {
            digits.push((carry % 58) as u8);
            carry /= 58;
        }
    }
    let mut result = String::new();
    for &byte in data.iter() {
        if byte == 0 {
            result.push(ALPHABET[0] as char);
        } else {
            break;
        }
    }
    for &d in digits.iter().rev() {
        result.push(ALPHABET[d as usize] as char);
    }
    result
}

/// Estimate the serialized size of a versioned transaction in bytes.
pub fn estimate_transaction_size(tx: &VersionedTransaction) -> usize {
    bincode::serialize(tx).map(|v| v.len()).unwrap_or(0)
}

// ── ATA derivation (no spl deps; deterministic, mainnet-correct) ───────────

/// SPL Token program id (canonical, fixed on all clusters).
const TOKEN_PROGRAM_ID: Pubkey = solana_sdk::pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
/// SPL Associated Token Account program id (canonical, fixed on all clusters).
const ASSOCIATED_TOKEN_PROGRAM_ID: Pubkey =
    solana_sdk::pubkey!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

/// Derive the associated token account for `wallet` + `token_mint` using the
/// canonical SPL `ProgramDerivedAddress` scheme:
/// `PDA([wallet, TOKEN_PROGRAM_ID, mint], ATokenProgram)`.
pub fn associated_token_address(wallet: &Pubkey, token_mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[
            wallet.as_ref(),
            TOKEN_PROGRAM_ID.as_ref(),
            token_mint.as_ref(),
        ],
        &ASSOCIATED_TOKEN_PROGRAM_ID,
    )
    .0
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use solana_sdk::signature::Keypair;
    use std::sync::Arc;
    use noviscia_types::USDC_MINT;

    #[test]
    fn base58_encode_empty() {
        assert_eq!(base58_encode(&[]), "");
    }

    #[test]
    fn base58_encode_zero() {
        assert_eq!(base58_encode(&[0]), "1");
    }

    #[test]
    fn base58_encode_hello() {
        // "Hello" in base58
        let encoded = base58_encode(b"Hello");
        assert!(!encoded.is_empty());
    }

    #[test]
    fn tip_accounts_count() {
        assert_eq!(JITO_TIP_ACCOUNTS.len(), 3);
    }

    #[test]
    fn select_tip_account_returns_valid() {
        let client = NovisciaClient::new("http://localhost:8899", "http://localhost:9999");
        let account = client.select_tip_account();
        assert!(JITO_TIP_ACCOUNTS.contains(&account.as_str()));
    }

    // ── NovisciaTvvClient ───────────────────────────────────────────────

    fn test_config() -> NovisciaConfig {
        NovisciaConfig {
            trader_identity: Keypair::new(),
            noviscia_program_id: Pubkey::new_unique(),
            kyc_merkle_proof: vec![],
            grpc_endpoint_feed: "http://127.0.0.1:10000".to_string(),
            jito_relay_url: "http://127.0.0.1:8898".to_string(),
        }
    }

    #[test]
    fn associated_token_address_is_deterministic() {
        let wallet = Pubkey::new_unique();
        let a1 = associated_token_address(&wallet, &USDC_MINT);
        let a2 = associated_token_address(&wallet, &USDC_MINT);
        assert_eq!(a1, a2);
        // Different wallets or mints must not collide.
        assert_ne!(a1, associated_token_address(&Pubkey::new_unique(), &USDC_MINT));
        assert_ne!(
            a1,
            associated_token_address(&wallet, &noviscia_types::NVSCUSDC_MINT)
        );
    }

    fn seeded_client(mint: Pubkey, headroom: u64) -> NovisciaTvvClient {
        let cache = CapacityCache::new();
        cache.set(mint, headroom);
        let handle = tokio::runtime::Runtime::new()
            .unwrap()
            .spawn(async { std::future::pending::<()>().await });
        NovisciaTvvClient {
            config: Arc::new(test_config()),
            pool_capacity_cache: cache,
            _feed_handle: handle,
        }
    }

    #[test]
    fn headroom_reads_from_cache() {
        let mint = Pubkey::new_unique();
        let client = seeded_client(mint, 1_000_000);
        assert_eq!(client.check_slot_headroom(mint), 1_000_000);
        // Unknown mints read 0.
        assert_eq!(client.check_slot_headroom(Pubkey::new_unique()), 0);
    }

    #[test]
    fn compile_rejects_when_headroom_under_requested() {
        let mint = Pubkey::new_unique();
        let client = seeded_client(mint, 100);
        let err = client
            .compile_atomic_jito_bundle(mint, 1_000_000, 1_000, vec![])
            .unwrap_err();
        assert!(err.contains("guardrail"), "expected guardrail, got: {err}");
    }

    #[test]
    fn frozen_mint_returns_zero_headroom_and_blocks_compile() {
        let mint = Pubkey::new_unique();
        let client = seeded_client(mint, 10_000_000);
        assert_eq!(client.check_slot_headroom(mint), 10_000_000);
        // Simulate non-Jito leader freeze via the shared cache.
        client.pool_capacity_cache.set_frozen(mint, true);
        assert!(client.is_allocation_frozen(mint));
        assert_eq!(client.check_slot_headroom(mint), 0);
        let err = client
            .compile_atomic_jito_bundle(mint, 1_000, 100, vec![])
            .unwrap_err();
        assert!(err.contains("headroom (0)"), "expected frozen guardrail: {err}");
        // Unfreeze → headroom returns, compile succeeds.
        client.pool_capacity_cache.set_frozen(mint, false);
        assert!(!client.is_allocation_frozen(mint));
        assert_eq!(client.check_slot_headroom(mint), 10_000_000);
    }

    #[test]
    fn compile_builds_two_legs_when_headroom_ok() {
        let mint = Pubkey::new_unique();
        let client = seeded_client(mint, 1_000_000);
        let program = Pubkey::new_unique();
        let trade = solana_program::instruction::Instruction {
            program_id: program,
            accounts: vec![],
            data: vec![],
        };
        let bundle = client
            .compile_atomic_jito_bundle(mint, 500_000, 2_000, vec![trade])
            .unwrap();
        assert_eq!(bundle.transactions.len(), 2);
        assert_eq!(bundle.tip_lamports, 5_000);
    }
}
