use std::sync::Arc;

use anyhow::{bail, Result};
use futures::StreamExt;
use tokio::sync::broadcast;
use tracing::{debug, info, warn};

use yellowstone_grpc_client::GeyserGrpcClient;
use yellowstone_grpc_proto::prelude::SubscribeRequest;
use yellowstone_grpc_proto::prelude::subscribe_update::UpdateOneof;

use crate::event_parser::parse_logs_for_events;
use crate::event_parser::ParsedEvent;
use crate::state_store::StateStore;

/// Noviscia program IDs that we filter on.
const NOVISCIA_PROGRAM_IDS: &[&str] = &[
    "8usJu6agjifCXYwSsRVoMWqm22h2HUSfebw1zEEHAMYg", // credit-line
    "Pp1Pool11111111111111111111111111111111111111111", // permissioned-pool
    "6uvr2JcP2iMQooG76RjpCtJLoJ4NuptGyRCiMKuDR1ws", // position-tracker
    "HQ26VTfoBVmGFY1JsFp5HmMT3rjLNoLJH6zurm8TL9xR", // gateway-auction
];

/// Maximum reconnect attempts before giving up.
const MAX_RECONNECT_ATTEMPTS: u32 = 20;
/// Base delay between reconnect attempts (doubles each retry).
const BASE_RECONNECT_DELAY_MS: u64 = 1_000;

/// Subscribes to the Yellowstone Dragon's Mouth gRPC stream, filters for
/// transactions involving Noviscia programs, parses their log events, and
/// broadcasts parsed events while updating the shared `StateStore`.
pub struct YellowstoneSubscriber {
    endpoint: String,
    state: Arc<StateStore>,
    event_tx: broadcast::Sender<ParsedEvent>,
}

impl YellowstoneSubscriber {
    pub fn new(
        endpoint: &str,
        state: Arc<StateStore>,
        event_tx: broadcast::Sender<ParsedEvent>,
    ) -> Self {
        Self {
            endpoint: endpoint.to_string(),
            state,
            event_tx,
        }
    }

    /// Run the subscriber with automatic reconnection. Blocks until unrecoverable error.
    pub async fn run(&mut self) -> Result<()> {
        let mut attempt = 0u32;
        loop {
            match self.run_session().await {
                Ok(()) => {
                    tracing::info!("yellowstone session ended gracefully");
                    return Ok(());
                }
                Err(e) => {
                    attempt += 1;
                    if attempt >= MAX_RECONNECT_ATTEMPTS {
                        bail!("yellowstone: exceeded max reconnect attempts ({MAX_RECONNECT_ATTEMPTS}): {e}");
                    }
                    let delay = BASE_RECONNECT_DELAY_MS * 2u64.pow(attempt - 1);
                    warn!(error = %e, attempt, delay_ms = delay, "yellowstone disconnected, reconnecting");
                    tokio::time::sleep(tokio::time::Duration::from_millis(delay)).await;
                }
            }
        }
    }

    /// Single session: connect, subscribe, and process updates until disconnection.
    async fn run_session(&self) -> Result<()> {
        let mut client = GeyserGrpcClient::build_from_shared(self.endpoint.clone())
            .map_err(|e| anyhow::anyhow!("build yellowstone client: {e}"))?
            .connect()
            .await
            .map_err(|e| anyhow::anyhow!("connect to yellowstone: {e}"))?;

        // Build a subscribe request filtered to our program IDs.
        let program_ids: Vec<String> = NOVISCIA_PROGRAM_IDS.iter().map(|s| s.to_string()).collect();

        let mut transactions = std::collections::HashMap::new();
        transactions.insert(
            "noviscia_transactions".to_string(),
            yellowstone_grpc_proto::prelude::SubscribeRequestFilterTransactions {
                account_include: program_ids.clone(),
                account_exclude: vec![],
                account_required: vec![],
                vote: Some(false),
                failed: Some(false),
                signature: None,
            },
        );

        let request = SubscribeRequest {
            transactions,
            commitment: Some(1), // confirmed
            ..Default::default()
        };

        let (_sink, mut rx) = client
            .subscribe_with_request(Some(request))
            .await
            .map_err(|e| anyhow::anyhow!("subscribe failed: {e}"))?;

        info!("yellowstone subscription active, streaming events");

        while let Some(message_result) = rx.next().await {
            let message = message_result?;
            if let Some(update) = message.update_oneof {
                match update {
                    UpdateOneof::Transaction(tx_update) => {
                        self.handle_transaction(tx_update).await;
                    }
                    UpdateOneof::Slot(slot_update) => {
                        debug!(slot = slot_update.slot, "slot update");
                    }
                    _ => {}
                }
            }
        }

        Ok(())
    }

    /// Process a single transaction update: extract logs, parse events, update state.
    async fn handle_transaction(&self, tx: yellowstone_grpc_proto::prelude::SubscribeUpdateTransaction) {
        let slot = tx.slot;

        let Some(ref tx_info) = tx.transaction else {
            return;
        };

        // Extract signature from bytes.
        let signature = bs58_encode(&tx_info.signature);

        // Extract log messages from the transaction metadata.
        let logs: Vec<String> = tx_info
            .meta
            .as_ref()
            .map(|m| m.log_messages.iter().map(|s| s.to_string()).collect())
            .unwrap_or_default();

        if logs.is_empty() {
            return;
        }

        // Parse Noviscia-specific events from the log stream.
        let parsed_events = parse_logs_for_events(&logs, slot, &signature);

        for event in parsed_events {
            // Update the in-memory state snapshot.
            self.state.apply_event(&event);

            // Broadcast to any active gRPC stream subscribers.
            if self.event_tx.send(event).is_err() {
                debug!("no active event stream subscribers");
            }
        }
    }
}

/// Convert raw bytes to a base58 transaction signature string.
fn bs58_encode(bytes: &[u8]) -> String {
    const ALPHABET: &[u8] = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    if bytes.is_empty() {
        return String::new();
    }

    let mut leading_zeros = 0;
    for byte in bytes {
        if *byte == 0 {
            leading_zeros += 1;
        } else {
            break;
        }
    }

    let encoded_len = (bytes.len() * 138) / 100 + 1;
    let mut output = vec![0u8; encoded_len];
    let mut output_len = 0;

    for &byte in bytes {
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

    let mut result = String::with_capacity(leading_zeros + encoded_len);
    for _ in 0..leading_zeros {
        result.push('1');
    }
    while i > 0 {
        i -= 1;
        result.push(ALPHABET[output[i] as usize] as char);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bs58_encode_empty() {
        assert_eq!(bs58_encode(&[]), "");
    }

    #[test]
    fn bs58_encode_zeros() {
        assert_eq!(bs58_encode(&[0, 0, 0]), "111");
    }
}
