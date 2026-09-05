//! Tier 3 — Jito bundle emulator.
//!
//! Serves the JSON-RPC surface the real `JitoClient` (grpc-pipeline jito.rs)
//! hits (`sendBundle` / `getBundleStatuses` / `getTipAccounts`) but is fully
//! in-memory, deterministic, and MEV-cost-free:
//!
//! * **Ordering validation** — every transaction frame is tagged with its
//!   phase: `0xA0` = Transaction A (Noviscia asset-engine capacity/premium
//!   call), `0xB0` = Transaction B (the desk trade). All A frames must precede
//!   every B frame; at least one A is required. A bundle that violates the
//!   A-before-B contract is rejected atomically.
//! * **Atomic rollback** — the emulator applies nothing. If `simulate_fail` is
//!   hon owed the whole bundle is dropped (status Rejected) and no virtual
//!   state materializes — capital insulation is asserted by the fact that the
//!   emulator's memory is unchanged (0 landed, 0 pending after the rollback).
//!
//! Frames: `[tag, len_hi, len_lo, ...payload]` where len is big-endian u16 cap.
#![allow(dead_code)]

use dashmap::DashMap;

/// Phase tag for a Noviscia capacity/premium transaction (Transaction A).
pub const TX_TAG_CAPACITY: u8 = 0xA0;
/// Phase tag for the desk trade / settlement leg (Transaction B).
pub const TX_TAG_TRADE: u8 = 0xB0;

/// Node-local tip accounts (mirrors jito.rs's 8 canonical pubkeys shape).
pub const EMULATOR_TIP_ACCOUNTS: &[&str] = &[
    "SandboxTip1111111111111111111111111111111111",
    "SandboxTip2222222222222222222222222222222222",
    "SandboxTip3333333333333333333333333333333333",
    "SandboxTip4444444444444444444444444444444444",
    "SandboxTip5555555555555555555555555555555555",
    "SandboxTip6666666666666666666666666666666666",
    "SandboxTip7777777777777777777777777777777777",
    "SandboxTip8888888888888888888888888888888888",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    Pending,
    Landed,
    Rejected,
}

impl Status {
    pub fn as_str(&self) -> &'static str {
        match self {
            Status::Pending => "pending",
            Status::Landed => "confirmed", // wire-proof of landed bundles
            Status::Rejected => "rejected",
        }
    }
}

#[derive(Debug, Clone)]
pub struct BundleEntry {
    pub id: String,
    pub status: Status,
    pub tx_count: usize,
    pub desired_capacity: u64,
    pub error: String,
}

/// In-memory Jito-compatible bundle ledger.
pub struct BundleEmulator {
    next_sequence: std::sync::atomic::AtomicU64,
    bundles: DashMap<String, BundleEntry>,
}

impl Default for BundleEmulator {
    fn default() -> Self {
        Self::new()
    }
}

impl BundleEmulator {
    pub fn new() -> Self {
        Self {
            next_sequence: std::sync::atomic::AtomicU64::new(1),
            bundles: DashMap::new(),
        }
    }

    /// Deterministic bundle id, e.g. `sandbox-bundle-0000000007`.
    fn next_id(&self) -> String {
        let n = self
            .next_sequence
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        format!("sandbox-bundle-{:010}", n)
    }

    /// Validate the A-before-B ordering contract.
    fn ordering_error(transactions: &[Vec<u8>]) -> Option<String> {
        if transactions.len() < 2 {
            return Some(format!(
                "bundle requires at least Transaction A + Transaction B (got {})",
                transactions.len()
            ));
        }
        let mut saw_b = false;
        for (i, tx) in transactions.iter().enumerate() {
            let tag = *tx.first().unwrap_or(&0xFF);
            match tag {
                TX_TAG_CAPACITY => {
                    if saw_b {
                        return Some(format!("Transaction A (#{}) after Transaction B — order violated", i));
                    }
                }
                TX_TAG_TRADE => saw_b = true,
                _ => return Some(format!("transaction #{} has unknown phase tag 0x{:02X}", i, tag)),
            }
        }
        if !saw_b {
            return Some("bundle lacks a Transaction B (trade) — nothing to settle".into());
        }
        None
    }

    pub fn tag_frame(tag: u8, payload: &[u8]) -> Vec<u8> {
        let len = payload.len().min(u16::MAX as usize) as u16;
        let mut out = Vec::with_capacity(3 + payload.len());
        out.push(tag);
        out.extend_from_slice(&len.to_be_bytes());
        out.extend_from_slice(payload);
        out
    }

    /// Submit a bundle. `simulate_fail` forces the atomic abort path — the
    /// bundle is recorded as Rejected, zero virtual state materializes.
    pub fn submit(&self, transactions: &[Vec<u8>], desired_capacity: u64, simulate_fail: bool) -> (String, Status) {
        if let Some(err) = Self::ordering_error(transactions) {
            let id = self.next_id();
            self.bundles.insert(
                id.clone(),
                BundleEntry {
                    id: id.clone(),
                    status: Status::Rejected,
                    tx_count: transactions.len(),
                    desired_capacity,
                    error: err,
                },
            );
            return (id, Status::Rejected);
        }
        let id = self.next_id();
        if simulate_fail {
            self.bundles.insert(
                id.clone(),
                BundleEntry {
                    id: id.clone(),
                    status: Status::Rejected,
                    tx_count: transactions.len(),
                    desired_capacity,
                    error: "emulated failure — bundle dropped, capital insulated".into(),
                },
            );
            (id, Status::Rejected)
        } else {
            self.bundles.insert(
                id.clone(),
                BundleEntry {
                    id: id.clone(),
                    status: Status::Landed,
                    tx_count: transactions.len(),
                    desired_capacity,
                    error: String::new(),
                },
            );
            (id, Status::Landed)
        }
    }

    pub fn status(&self, id: &str) -> Option<BundleEntry> {
        self.bundles.get(id).map(|e| e.clone())
    }

    pub fn landed_count(&self) -> usize {
        self.bundles.iter().filter(|e| e.status == Status::Landed).count()
    }

    pub fn pending_count(&self) -> usize {
        self.bundles.iter().filter(|e| e.status == Status::Pending).count()
    }

    pub fn rejected_count(&self) -> usize {
        self.bundles.iter().filter(|e| e.status == Status::Rejected).count()
    }

    /// JSON-RPC body processing — the exact shape served over HTTP.
    pub fn process_jsonrpc(&self, body: &str, simulate_fail: bool) -> serde_json::Value {
        let parsed: serde_json::Value = match serde_json::from_str(body) {
            Ok(v) => v,
            Err(_) => {
                return serde_json::json!({
                    "jsonrpc": "2.0", "id": null,
                    "error": {"code": -32700, "message": "parse error"}
                })
            }
        };
        let method = parsed.get("method").and_then(|m| m.as_str()).unwrap_or("");
        let id = parsed.get("id").cloned().unwrap_or(serde_json::Value::Null);
        match method {
            "sendBundle" => {
                let params = &parsed["params"];
                let txs: Vec<Vec<u8>> = params
                    .get(0)
                    .and_then(|p| p.get("transactions"))
                    .and_then(|t| t.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_str())
                            .map(|b64| base64_decode(b64))
                            .collect()
                    })
                    .unwrap_or_default();
                let capacity = params
                    .get(0)
                    .and_then(|p| p.get("desiredCapacity"))
                    .and_then(|c| c.as_u64())
                    .unwrap_or(0);
                let (bundle_id, status) = self.submit(&txs, capacity, simulate_fail);
                if status == Status::Rejected {
                    serde_json::json!({
                        "jsonrpc": "2.0", "id": id,
                        "error": {"code": -32097, "message": format!("bundle rejected: {}", self.status(&bundle_id).map(|e| e.error).unwrap_or_default())}
                    })
                } else {
                    serde_json::json!({ "jsonrpc": "2.0", "id": id, "result": bundle_id })
                }
            }
            "getBundleStatuses" => {
                let ids: Vec<String> = parsed["params"][0]
                    .as_array()
                    .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                    .unwrap_or_default();
                let value: Vec<serde_json::Value> = ids
                    .iter()
                    .map(|bid| {
                        self.status(bid).map(|e| {
                            serde_json::json!({
                                "bundle_id": e.id,
                                "confirmation_status": e.status.as_str(),
                                "transactions": [],
                                "err": e.status == Status::Rejected,
                            })
                        }).unwrap_or_else(|| {
                            serde_json::json!({
                                "bundle_id": bid,
                                "confirmation_status": "not_found",
                                "transactions": [],
                                "err": "bundle not found in Jito sandbox",
                            })
                        })
                    })
                    .collect();
                serde_json::json!({ "jsonrpc": "2.0", "id": id, "result": { "value": value } })
            }
            "getTipAccounts" => {
                serde_json::json!({ "jsonrpc": "2.0", "id": id, "result": EMULATOR_TIP_ACCOUNTS })
            }
            _ => serde_json::json!({
                "jsonrpc": "2.0", "id": id,
                "error": {"code": -32601, "message": format!("method not found: {}", method)}
            }),
        }
    }
}

fn base64_decode(s: &str) -> Vec<u8> {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = Vec::with_capacity(s.len() / 4 * 3);
    let mut buf: u32 = 0;
    let mut bits = 0usize;
    for c in s.bytes() {
        if c == b'=' {
            break;
        }
        let val = match TABLE.iter().position(|&t| t == c) {
            Some(v) => v as u32,
            None => continue,
        };
        buf = (buf << 6) | val;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn a(payload: &[u8]) -> Vec<u8> {
        BundleEmulator::tag_frame(TX_TAG_CAPACITY, payload)
    }
    fn b(payload: &[u8]) -> Vec<u8> {
        BundleEmulator::tag_frame(TX_TAG_TRADE, payload)
    }

    #[test]
    fn ordering_atomic_landing() {
        let emu = BundleEmulator::new();
        let (id, status) = emu.submit(&[a(&[1, 2]), b(&[3, 4])], 100_000, false);
        assert_eq!(status, Status::Landed);
        assert_eq!(emu.status(&id).unwrap().tx_count, 2);
        assert_eq!(emu.landed_count(), 1);
        assert_eq!(emu.rejected_count(), 0);
    }

    #[test]
    fn ordering_trade_before_capacity_rejected() {
        let emu = BundleEmulator::new();
        let (_id, status) = emu.submit(&[b(&[1]), a(&[2])], 100_000, false);
        assert_eq!(status, Status::Rejected);
        assert_eq!(emu.landed_count(), 0);
        assert_eq!(emu.pending_count(), 0);
        assert!(emu.status(&_id).unwrap().error.contains("order violated"));
    }

    #[test]
    fn atomic_rollback_on_simulated_failure() {
        let emu = BundleEmulator::new();
        let (_id, status) = emu.submit(&[a(&[1]), b(&[2])], 100_000, true);
        assert_eq!(status, Status::Rejected);
        // Capital insulation: nothing landed, nothing pending — a rejected
        // bundle leaves zero drift on the virtual clearing state.
        assert_eq!(emu.landed_count(), 0);
        assert_eq!(emu.pending_count(), 0);
        assert_eq!(emu.rejected_count(), 1); // traceable, but never "applied"
    }

    #[test]
    fn single_transaction_rejected() {
        let emu = BundleEmulator::new();
        let (id, status) = emu.submit(&[a(&[9])], 100_000, false);
        assert_eq!(status, Status::Rejected);
        assert!(emu.status(&id).unwrap().error.contains("at least"));
    }

    #[test]
    fn jsonrpc_send_get_status_roundtrip() {
        let emu = BundleEmulator::new();
        let a_b64 = base64_encode(&a(&[1]));
        let b_b64 = base64_encode(&b(&[2]));
        let send = serde_json::json!({
            "jsonrpc": "2.0", "id": 1, "method": "sendBundle",
            "params": [{
                "transactions": [a_b64, b_b64],
                "encoding": "base64",
                "desiredCapacity": 100
            }]
        });
        let resp = emu.process_jsonrpc(&send.to_string(), false);
        let bundle_id = resp["result"].as_str().unwrap().to_string();
        let probe = serde_json::json!({
            "jsonrpc": "2.0", "id": 2, "method": "getBundleStatuses",
            "params": [[bundle_id]]
        });
        let status = emu.process_jsonrpc(&probe.to_string(), false);
        assert_eq!(status["result"]["value"][0]["confirmation_status"], "confirmed");
    }

    #[test]
    fn jsonrpc_fail_flag_drops_bundle() {
        let emu = BundleEmulator::new();
        let send = serde_json::json!({
            "jsonrpc": "2.0", "id": 1, "method": "sendBundle",
            "params": [{
                "transactions": [base64_encode(&a(&[1])), base64_encode(&b(&[2]))],
                "encoding": "base64"
            }]
        });
        let resp = emu.process_jsonrpc(&send.to_string(), true);
        assert_eq!(resp["error"]["code"], -32097);
        assert_eq!(emu.status(&"sandbox-bundle-0000000001".to_string()).unwrap().status, Status::Rejected);
        assert_eq!(emu.landed_count() + emu.pending_count(), 0);
    }

    #[test]
    fn tip_accounts_non_empty() {
        let emu = BundleEmulator::new();
        let resp = emu.process_jsonrpc(&serde_json::json!({"jsonrpc":"2.0","id":1,"method":"getTipAccounts","params":[]}).to_string(), false);
        assert_eq!(resp["result"].as_array().unwrap().len(), EMULATOR_TIP_ACCOUNTS.len());
    }

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
}