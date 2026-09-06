//! Live smoke client for the spec headless surface.
//!
//! Boot the hub with default ports, then:
//! ```text
//! cargo run --example spec_smoke --release
//! ```
//!
//! 1. Subscribes to `MarketVelocityStream.SubscribePoolState` (spec §1) and
//!    prints 3 pool updates.
//! 2. Reads the current slot from the stream, then calls the legacy
//!    `get_desk_status` for the USDC desk to prove the control-plane sentinel
//!    drill (spec §3) tipped the desk out of `NoWindow`/`Healthy`.
use std::time::Duration;

use tokio_stream::StreamExt;

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

use noviscia::pipeline::{noviscia_stream_client::NovisciaStreamClient, DeskStatusRequest};
use sandbox::v1::{
    market_velocity_stream_client::MarketVelocityStreamClient, PoolSubscriptionRequest,
};

const HUB: &str = "http://127.0.0.1:10000";

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let mut stream = MarketVelocityStreamClient::connect(HUB).await?;
    let mut updates = stream
        .subscribe_pool_state(PoolSubscriptionRequest {
            app_token: "sandbox-bearer".into(),
            asset_mints: vec!["SandboxUsdcMint".into(), "SandboxNvscMint".into()],
        })
        .await?
        .into_inner();

    let mut last_slot = 0u64;
    for i in 0..3 {
        if let Some(Ok(u)) = updates.next().await {
            last_slot = u.slot;
            println!(
                "[pool-update {}] slot={} mint={} idle_base_units={} active_base_units={} premium_rate_bps={}",
                i, u.slot, u.asset_mint, u.total_idle_capital, u.active_credit_utilization, u.current_premium_rate_bps
            );
        }
    }

    let mut desk = NovisciaStreamClient::connect(HUB).await?;
    // Poll until the control-plane sentinel (if armed) tips the desk out of
    // NoWindow/Healthy. Accept Overdue or Breached as "sentinel fired".
    let mut fired: Option<i32> = None;
    for _ in 0..12 {
        let state = desk
            .get_desk_status(DeskStatusRequest {
                institution: "sandbox-institution".into(),
                mint: "SandboxUsdcMint".into(),
                current_slot: last_slot as i64,
            })
            .await?
            .into_inner();
        println!(
            "[desk-status] mint={} posture={} active_principal={} window_start={}",
            state.mint, state.posture, state.active_principal, state.window_start_slot
        );
        if state.posture == 2 || state.posture == 3 {
            fired = Some(state.posture);
            break;
        }
        tokio::time::sleep(Duration::from_millis(600)).await;
    }

    match fired {
        Some(2) => println!("SMOKE OK — sentinel flipped desk to OVERDUE (posture=2)"),
        Some(3) => println!("SMOKE OK — sentinel fired, desk now BREACHED (posture=3)"),
        _ => println!(
            "SMOKE WARN — no sentinel observed; control-plane clearing failure may be unarmed"
        ),
    }
    Ok(())
}
