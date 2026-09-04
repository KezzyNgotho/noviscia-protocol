//! # Noviscia Client
//!
//! RPC + Jito bundle submission client for institutional-grade transaction
//! delivery. Handles Jito block engine submission, tip estimation, and
//! bundle status polling.

use serde::{Deserialize, Serialize};
use solana_client::rpc_client::RpcClient;
use solana_sdk::transaction::VersionedTransaction;

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
}

impl std::fmt::Display for ClientError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ClientError::Http(e) => write!(f, "HTTP error: {e}"),
            ClientError::Json(e) => write!(f, "JSON error: {e}"),
            ClientError::BundleRejected(msg) => write!(f, "bundle rejected: {msg}"),
            ClientError::Rpc(msg) => write!(f, "RPC error: {msg}"),
            ClientError::TipEstimationFailed(msg) => write!(f, "tip estimation failed: {msg}"),
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

// ── NovisciaClient ─────────────────────────────────────────────────────────

/// Offline RPC + Jito client. Holds only public addresses — never keys.
pub struct NovisciaClient {
    /// Solana RPC client for read-only queries.
    pub rpc: RpcClient,
    /// Jito block engine endpoint URL (e.g. `https://mainnet.block-engine.jito.wtf/api/v1/bundles`).
    pub jito_endpoint: String,
    /// Optional secondary Jito endpoint for failover.
    pub jito_backup_endpoint: Option<String>,
}

impl NovisciaClient {
    /// Create a new client with the given RPC URL and Jito endpoint.
    pub fn new(rpc_url: &str, jito_endpoint: &str) -> Self {
        Self {
            rpc: RpcClient::new(rpc_url.to_string()),
            jito_endpoint: jito_endpoint.to_string(),
            jito_backup_endpoint: None,
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
        }
    }

    /// Send a Jito bundle to the block engine.
    ///
    /// Encodes each transaction as base-58, selects a tip account, and POSTs
    /// the bundle to the Jito block engine endpoint.
    pub async fn send_jito_bundle(&self, bundle: &JitoBundle) -> Result<String, ClientError> {
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

        let bundle_id = body
            .get("result")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();

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
/// `bs58` crate.
fn base58_encode(data: &[u8]) -> String {
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

// ── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

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
}
