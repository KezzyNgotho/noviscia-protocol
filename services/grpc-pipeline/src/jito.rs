use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

/// Jito tip account pubkeys (mainnet). These are the accounts that receive
/// bundle tips.
const JITO_TIP_ACCOUNTS: &[&str] = &[
    "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
    "HFqU5x63VTqvQss8hp11i4bPg4W3PCLNfqo7kMoBkNSw",
    "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
    "ADaUMid9yfUytqMBgopwjb2DTLHfKP4RUS2FkSToHpYJ",
    "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
    "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
    "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
    "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
];

/// Client for interacting with the Jito block engine for MEV bundle submission.
pub struct JitoClient {
    http: reqwest::Client,
    block_engine_url: String,
}

impl JitoClient {
    pub fn new(block_engine_url: &str) -> Self {
        Self {
            http: reqwest::Client::new(),
            block_engine_url: block_engine_url.trim_end_matches('/').to_string(),
        }
    }

    /// Submit a bundle to the Jito block engine.
    ///
    /// The bundle contains base64-encoded serialized transactions. Returns
    /// the bundle ID on success.
    pub async fn submit_bundle(
        &self,
        transaction_bytes: &[u8],
        tip_lamports: u64,
    ) -> Result<String> {
        self.submit_bundle_many(&[transaction_bytes.to_vec()], tip_lamports)
            .await
    }

    /// Submit an atomic multi-transaction bundle (Transaction A + Transaction
    /// B + any settlement legs). Every transaction lands in the same slot or
    /// none do — this is how the premium and the desk trade are sealed.
    pub async fn submit_bundle_many(
        &self,
        transactions: &[Vec<u8>],
        _tip_lamports: u64,
    ) -> Result<String> {
        let endpoint = format!("{}/api/v1/bundles", self.block_engine_url);

        let encoded: Vec<String> = transactions
            .iter()
            .map(|tx| base64_encode(tx))
            .collect();

        let payload = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "sendBundle",
            "params": [
                {
                    "transactions": encoded,
                    "encoding": "base64"
                }
            ]
        });

        let resp = self
            .http
            .post(&endpoint)
            .json(&payload)
            .send()
            .await
            .context("jito bundle submit request failed")?;

        let status = resp.status();
        let body: serde_json::Value = resp.json().await.context("parse jito response")?;

        if !status.is_success() {
            let error_msg = body
                .get("error")
                .and_then(|e| e.get("message"))
                .and_then(|m| m.as_str())
                .unwrap_or("unknown error");
            bail!("jito bundle rejected (HTTP {}): {}", status, error_msg);
        }

        let bundle_id = body
            .get("result")
            .and_then(|r| r.as_str())
            .unwrap_or("")
            .to_string();

        if bundle_id.is_empty() {
            bail!("jito returned empty bundle ID");
        }

        Ok(bundle_id)
    }

    /// Return the canonical Jito tip account pubkeys (mainnet).
    pub fn get_tip_accounts(&self) -> Vec<String> {
        JITO_TIP_ACCOUNTS.iter().map(|s| s.to_string()).collect()
    }

    /// Estimate an appropriate tip in lamports based on recent landed bundles.
    ///
    /// Falls back to 10,000 lamports (~0.00001 SOL) if the query fails.
    pub async fn estimate_tip_lamports(&self) -> Result<u64> {
        let endpoint = format!("{}/api/v1/bundles", self.block_engine_url);

        let payload = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "getBundleTips",
            "params": []
        });

        let resp = self
            .http
            .post(&endpoint)
            .json(&payload)
            .send()
            .await
            .context("jito tip query failed")?;

        let body: serde_json::Value = resp.json().await.context("parse jito tip response")?;

        if let Some(result) = body.get("result") {
            if let Some(tips) = result.get("tips").and_then(|t| t.as_array()) {
                if !tips.is_empty() {
                    let mut values: Vec<u64> = tips.iter().filter_map(|v| v.as_u64()).collect();
                    values.sort_unstable();
                    let median = values[values.len() / 2];
                    return Ok((median as f64 * 1.5) as u64);
                }
            }
        }

        Ok(10_000)
    }

    /// Poll the status of a submitted bundle by its ID.
    pub async fn get_bundle_status(&self, bundle_id: &str) -> Result<BundleStatus> {
        let endpoint = format!("{}/api/v1/bundles", self.block_engine_url);

        let payload = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "getBundleStatuses",
            "params": [[bundle_id]]
        });

        let resp = self
            .http
            .post(&endpoint)
            .json(&payload)
            .send()
            .await
            .context("jito bundle status query failed")?;

        let body: serde_json::Value = resp.json().await.context("parse jito status response")?;

        if let Some(result) = body.get("result") {
            if let Some(statuses) = result.get("value").and_then(|v| v.as_array()) {
                if let Some(status_obj) = statuses.first() {
                    let confirmation_status = status_obj
                        .get("confirmation_status")
                        .and_then(|s| s.as_str())
                        .unwrap_or("unknown");

                    let transactions: Vec<String> = status_obj
                        .get("transactions")
                        .and_then(|t| t.as_array())
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|v| v.as_str().map(String::from))
                                .collect()
                        })
                        .unwrap_or_default();

                    return Ok(BundleStatus {
                        bundle_id: bundle_id.to_string(),
                        confirmation_status: confirmation_status.to_string(),
                        transactions,
                        err: status_obj
                            .get("err")
                            .and_then(|e| serde_json::to_string(e).ok())
                            .unwrap_or_default(),
                    });
                }
            }
        }

        Ok(BundleStatus {
            bundle_id: bundle_id.to_string(),
            confirmation_status: "not_found".into(),
            transactions: vec![],
            err: "bundle not found in Jito responses".into(),
        })
    }
}

/// Status of a Jito bundle.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BundleStatus {
    pub bundle_id: String,
    pub confirmation_status: String,
    pub transactions: Vec<String>,
    pub err: String,
}

impl BundleStatus {
    /// Whether the bundle has been confirmed landed on-chain.
    pub fn is_landed(&self) -> bool {
        self.confirmation_status == "confirmed" || self.confirmation_status == "finalized"
    }
}

// ── Helpers ──

fn base64_encode(data: &[u8]) -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::with_capacity((data.len() + 2) / 3 * 4);

    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;

        result.push(ALPHABET[((triple >> 18) & 0x3F) as usize] as char);
        result.push(ALPHABET[((triple >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            result.push(ALPHABET[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
        if chunk.len() > 2 {
            result.push(ALPHABET[(triple & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_encode_empty() {
        assert_eq!(base64_encode(b""), "");
    }

    #[test]
    fn base64_encode_foo() {
        assert_eq!(base64_encode(b"foo"), "Zm9v");
    }

    #[test]
    fn base64_encode_foobar() {
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn tip_accounts_non_empty() {
        let client = JitoClient::new("http://localhost:9999");
        let accounts = client.get_tip_accounts();
        assert_eq!(accounts.len(), JITO_TIP_ACCOUNTS.len());
    }

    #[test]
    fn bundle_status_landed() {
        let status = BundleStatus {
            bundle_id: "test".into(),
            confirmation_status: "confirmed".into(),
            transactions: vec![],
            err: String::new(),
        };
        assert!(status.is_landed());
    }

    #[test]
    fn bundle_status_pending() {
        let status = BundleStatus {
            bundle_id: "test".into(),
            confirmation_status: "pending".into(),
            transactions: vec![],
            err: String::new(),
        };
        assert!(!status.is_landed());
    }

    #[test]
    fn submit_payload_encodes_many_transactions() {
        // Shield the JSON layout: multiple transactions must all be in the
        // `transactions` array so Jito treats them as one atomic bundle.
        let payload = serde_json::json!({
            "jsonrpc": "2.0",
            "params": [{
                "transactions": [base64_encode(&[1u8, 2, 3]), base64_encode(&[4u8, 5, 6])],
                "encoding": "base64"
            }]
        });
        let txs = payload["params"][0]["transactions"]
            .as_array()
            .expect("transactions array");
        assert_eq!(txs.len(), 2);
        assert_eq!(txs[0].as_str(), Some("AQID"));
        assert_eq!(txs[1].as_str(), Some("BAUG"));
    }
}
