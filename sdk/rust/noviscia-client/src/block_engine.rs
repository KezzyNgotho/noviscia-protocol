//! # Block Engine Registry
//!
//! Multi-relay MEV delivery registry for institutional-grade transaction
//! submission. Loads Jito block engine endpoints from `JITO_BLOCK_ENGINE_URLS`,
//! tracks per-relay health, and exposes failover iteration so a bundle can be
//! re-submitted to the next healthy relay when the primary is saturated or
//! degrading.

use std::sync::Mutex;

/// A single Jito block engine relay.
#[derive(Debug, Clone)]
pub struct BlockEngineRelay {
    /// Base bundle submission URL, e.g.
    /// `https://ny.mainnet.block-engine.jito.wtf/api/v1/bundles`.
    pub url: String,
    /// Deployment region for observability (`NY`, `AM`, `FRA`, `SLG`, ...).
    pub region: String,
    /// Whether the relay is currently considered healthy.
    pub healthy: bool,
}

impl BlockEngineRelay {
    pub fn new(url: impl Into<String>, region: impl Into<String>) -> Self {
        Self {
            url: url.into(),
            region: region.into(),
            healthy: true,
        }
    }
}

/// Environment key for Jito block engine URLs (comma-separated).
pub const JITO_BLOCK_ENGINE_URLS_ENV: &str = "JITO_BLOCK_ENGINE_URLS";

/// Maintains the relay set and health state across submissions.
#[derive(Debug)]
pub struct BlockEngineRegistry {
    relays: Vec<BlockEngineRelay>,
}

impl Default for BlockEngineRegistry {
    fn default() -> Self {
        Self::from_env().unwrap_or_else(|_| Self {
            relays: vec![BlockEngineRelay::new(
                "https://mainnet.block-engine.jito.wtf/api/v1/bundles",
                "MAINNET",
            )],
        })
    }
}

impl BlockEngineRegistry {
    /// Create a registry from `JITO_BLOCK_ENGINE_URLS` (comma-separated).
    /// Empty/unset produces an error so callers can fall back to defaults.
    pub fn from_env() -> Result<Self, String> {
        let raw = std::env::var(JITO_BLOCK_ENGINE_URLS_ENV)
            .map_err(|_| format!("{JITO_BLOCK_ENGINE_URLS_ENV} not set"))?;
        let relays: Vec<BlockEngineRelay> = raw
            .split(',')
            .map(|url| url.trim())
            .filter(|url| !url.is_empty())
            .map(|url| BlockEngineRelay::new(url, "ENV"))
            .collect();
        if relays.is_empty() {
            Err("no relays in JITO_BLOCK_ENGINE_URLS".to_string())
        } else {
            Ok(Self { relays })
        }
    }

    /// Build a registry with an explicit ordered list of `(url, region)`.
    pub fn new_with_relays(relays: Vec<BlockEngineRelay>) -> Self {
        Self { relays }
    }

    /// Build the canonical multi-region fallback set in submission order.
    pub fn multi_region_relays() -> Self {
        Self::new_with_relays(vec![
            BlockEngineRelay::new(
                "https://mainnet.block-engine.jito.wtf/api/v1/bundles",
                "MAINNET-PRIMARY",
            ),
            BlockEngineRelay::new(
                "https://ny.mainnet.block-engine.jito.wtf/api/v1/bundles",
                "NY",
            ),
            BlockEngineRelay::new(
                "https://am.mainnet.block-engine.jito.wtf/api/v1/bundles",
                "AM",
            ),
            BlockEngineRelay::new(
                "https://fra.mainnet.block-engine.jito.wtf/api/v1/bundles",
                "FRA",
            ),
        ])
    }

    /// Snapshot of healthy relay URLs in order.
    pub fn healthy_urls(&self) -> Vec<String> {
        self.relays
            .iter()
            .filter(|r| r.healthy)
            .map(|r| r.url.clone())
            .collect()
    }

    /// All relays currently in the registry (for observability).
    pub fn all_relays(&self) -> &[BlockEngineRelay] {
        &self.relays
    }

    /// Mark a specific relay observed as unhealthy.
    pub fn mark_unhealthy(&mut self, url: &str) {
        for relay in self.relays.iter_mut() {
            if relay.url == url {
                relay.healthy = false;
            }
        }
    }

    /// Mark a specific relay observed as healthy again.
    pub fn mark_healthy(&mut self, url: &str) {
        for relay in self.relays.iter_mut() {
            if relay.url == url {
                relay.healthy = true;
            }
        }
    }

    /// Round-robin rotate so the head relay changes between submissions,
    /// spreading load and avoiding a single hot primary.
    pub fn rotate(&mut self) {
        if self.relays.len() > 1 {
            self.relays.rotate_left(1);
        }
    }
}

/// A thread-safe handle to a block engine registry inside the client.
#[derive(Debug, Default)]
pub struct SharedBlockEngineRegistry(pub Mutex<BlockEngineRegistry>);

impl SharedBlockEngineRegistry {
    pub fn new(registry: BlockEngineRegistry) -> Self {
        Self(Mutex::new(registry))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn env_registry_falls_back_to_default() {
        std::env::remove_var(JITO_BLOCK_ENGINE_URLS_ENV);
        let registry = BlockEngineRegistry::default();
        assert!(!registry.healthy_urls().is_empty());
    }

    #[test]
    fn health_failover_filters_relays() {
        let mut registry = BlockEngineRegistry::from_env().unwrap_or_else(|_| {
            BlockEngineRegistry::new_with_relays(vec![
                BlockEngineRelay::new("http://relay-a:8899", "A"),
                BlockEngineRelay::new("http://relay-b:8899", "B"),
            ])
        });
        if registry.all_relays().len() > 1 {
            let primary = registry.all_relays()[0].url.clone();
            registry.mark_unhealthy(&primary);
            assert!(!registry.healthy_urls().contains(&primary));
        }
        registry.mark_healthy("http://relay-a:8899");
        registry.rotate();
    }

    #[test]
    fn multi_region_relays_all_healthy() {
        let registry = BlockEngineRegistry::multi_region_relays();
        assert_eq!(registry.healthy_urls().len(), 4);
    }
}