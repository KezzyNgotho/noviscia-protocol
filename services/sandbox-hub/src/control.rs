//! Control plane — the time-acceleration configurator (§3 of the spec).
//!
//! `PUT /api/v1/sandbox/control-plane` lets a developer compress time to
//! stress-test the 24-hour clearing window, the 2-hour grace period, and soft
//! locks without waiting on wall-clock. The config is stored in shared Rust
//! state so the mock subscriber can act on `simulate_clearing_failure` live.
#![allow(dead_code)]

use serde::{Deserialize, Serialize};

/// The accelerated-clock configuration held by the sandbox hub.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ControlPlaneConfig {
    /// Real-time → sandbox-time compression, e.g. 1,440× (spec default).
    pub time_compression_multiplier: u64,
    /// When `true` the mock subscriber forces clearing to fail: the target
    /// wallet's window is driven to OVERDUE instead of clearing.
    pub simulate_clearing_failure: bool,
    /// Wallet observed for the sentinel/clearing-failure drill.
    pub target_institution_wallet: String,
}

impl Default for ControlPlaneConfig {
    fn default() -> Self {
        Self {
            time_compression_multiplier: 1_440,
            simulate_clearing_failure: false,
            target_institution_wallet: "sandbox-institution".into(),
        }
    }
}

/// Effective real-world 24-hour clearing window, compressed to sandbox time.
/// Spec reference: 1,440× → 60 seconds.
pub fn effective_24h_window_duration_seconds(multiplier: u64) -> u64 {
    (86_400.0 / multiplier.max(1) as f64).round() as u64
}

/// Effective real-world 2-hour grace period, compressed to sandbox time.
/// Spec reference: 1,440× → 5 seconds.
pub fn effective_2h_grace_period_seconds(multiplier: u64) -> u64 {
    (7_200.0 / multiplier.max(1) as f64).round() as u64
}

/// The constant action executed once a window expires without settlement.
pub const SIMULATED_ACTION: &str = "ENFORCE_HARD_TIMEOUT_ON_EXPIRY";

#[derive(Debug, Deserialize)]
pub struct ControlPlaneRequest {
    pub time_compression_multiplier: Option<u64>,
    pub simulate_clearing_failure: Option<bool>,
    pub target_institution_wallet: Option<String>,
}

/// Apply a `PUT /api/v1/sandbox/control-plane` body to the shared config and
/// return the spec-conformant JSON response (with system logs).
pub fn apply_put(body: &str, config: &mut ControlPlaneConfig) -> serde_json::Value {
    let req: ControlPlaneRequest = match serde_json::from_str(body) {
        Ok(r) => r,
        Err(_) => {
            return response_error(
                "NOV_100_INVALID_CONTROL_REQUEST",
                "control-plane body failed to parse",
            )
        }
    };
    if let Some(m) = req.time_compression_multiplier {
        config.time_compression_multiplier = m.max(1);
    }
    if let Some(f) = req.simulate_clearing_failure {
        config.simulate_clearing_failure = f;
    }
    if let Some(w) = req.target_institution_wallet {
        config.target_institution_wallet = w;
    }
    build_response(config)
}

pub fn response_error(code: &str, message: &str) -> serde_json::Value {
    serde_json::json!({
        "sandbox_state": "REJECTED",
        "error": { "code": code, "message": message },
    })
}

/// Build the spec response for the current config.
pub fn build_response(config: &ControlPlaneConfig) -> serde_json::Value {
    let mult = config.time_compression_multiplier;
    let window_s = effective_24h_window_duration_seconds(mult);
    let grace_s = effective_2h_grace_period_seconds(mult);
    let wallet = &config.target_institution_wallet;
    let logs = if config.simulate_clearing_failure {
        vec![
            format!("[00:00:01] System boot. Clock acceleration multiplier active at {mult}x."),
            format!("[00:00:15] Wallet {wallet} initiated JIT allocation. Countdown active."),
            format!("[00:01:15] 24h Window Cleared ({window_s}s Real-time). No settlement transaction detected."),
            "[00:01:16] SENTINEL TRIGGERED: Inbound instruction submitted to Anchor ledger.".to_string(),
            format!("[00:01:17] LEDGER UPDATE: Wallet {wallet} status flipped to OVERDUE. Borrowing capacity locked."),
        ]
    } else {
        vec![
            format!("[00:00:01] System boot. Clock acceleration multiplier active at {mult}x."),
            format!("[00:00:15] Wallet {wallet} initiated JIT allocation. Countdown active."),
            format!("[00:01:15] 24h Window Cleared ({window_s}s Real-time). Settlement verified. Clearing path healthy."),
        ]
    };
    serde_json::json!({
        "sandbox_state": "MODIFIED",
        "parameters": {
            "effective_24h_window_duration_seconds": window_s,
            "effective_2h_grace_period_seconds": grace_s,
            "simulated_action": SIMULATED_ACTION,
        },
        "system_logs": logs,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spec_defaults_present() {
        let cfg = ControlPlaneConfig::default();
        assert_eq!(cfg.time_compression_multiplier, 1_440);
        assert_eq!(
            effective_24h_window_duration_seconds(cfg.time_compression_multiplier),
            60
        );
        assert_eq!(
            effective_2h_grace_period_seconds(cfg.time_compression_multiplier),
            5
        );
    }

    #[test]
    fn compression_scales_linearly() {
        assert_eq!(effective_24h_window_duration_seconds(2_880), 30);
        assert_eq!(effective_24h_window_duration_seconds(7_200), 12);
        assert_eq!(effective_2h_grace_period_seconds(7_200), 1);
    }

    #[test]
    fn put_body_applies_and_builds_spec_response() {
        let mut cfg = ControlPlaneConfig::default();
        let resp = apply_put(
            r#"{"time_compression_multiplier":1440,"simulate_clearing_failure":true,"target_institution_wallet":"W1ntMute1111111111111111111111111111111111"}"#,
            &mut cfg,
        );
        assert_eq!(resp["sandbox_state"], "MODIFIED");
        assert_eq!(
            resp["parameters"]["effective_24h_window_duration_seconds"],
            60
        );
        assert_eq!(resp["parameters"]["effective_2h_grace_period_seconds"], 5);
        assert_eq!(
            resp["parameters"]["simulated_action"],
            "ENFORCE_HARD_TIMEOUT_ON_EXPIRY"
        );
        let logs = resp["system_logs"].as_array().unwrap();
        assert_eq!(logs.len(), 5);
        let joined = logs
            .iter()
            .map(|l| l.as_str().unwrap())
            .collect::<Vec<_>>()
            .join("\n");
        assert!(joined.contains("Clock acceleration multiplier active at 1440x."));
        assert!(joined.contains("W1ntMute1111111111111111111111111111111111"));
        assert!(joined.contains("status flipped to OVERDUE. Borrowing capacity locked."));
        assert_eq!(cfg.simulate_clearing_failure, true);
        assert_eq!(
            cfg.target_institution_wallet,
            "W1ntMute1111111111111111111111111111111111"
        );
    }

    #[test]
    fn healthy_clearing_path_short_log() {
        let cfg = ControlPlaneConfig {
            simulate_clearing_failure: false,
            ..ControlPlaneConfig::default()
        };
        let resp = build_response(&cfg);
        assert_eq!(resp["sandbox_state"], "MODIFIED");
        let logs = resp["system_logs"].as_array().unwrap();
        assert_eq!(logs.len(), 3);
        assert!(logs
            .iter()
            .find(|l| l.as_str().unwrap().contains("Settlement verified"))
            .is_some());
    }

    #[test]
    fn malformed_body_rejected() {
        let mut cfg = ControlPlaneConfig::default();
        let resp = apply_put("not json at all", &mut cfg);
        assert_eq!(resp["sandbox_state"], "REJECTED");
        assert!(
            cfg.simulate_clearing_failure == false,
            "config must not mutate on bad body"
        );
    }
}
