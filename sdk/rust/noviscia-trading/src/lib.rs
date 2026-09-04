//! # Noviscia Trading
//!
//! Instruction builders and position math for the Noviscia position tracker.
//! Mirrors the TypeScript `position-tracker/client.ts` compute functions.

use solana_program::instruction::{AccountMeta, Instruction};
use solana_program::pubkey::Pubkey;

use noviscia_types::{
    BPS, COLLATERAL_VAULT_SEED, POSITION_SEED, PT_CONFIG_SEED,
};

// ── Position Math ──────────────────────────────────────────────────────────

/// Compute the required margin (collateral) in USDC base-6 for a given
/// position size and max leverage.
///
/// Mirrors TypeScript `computeRequiredMarginUsdc`:
/// ```text
/// margin = size_usdc * BPS / max_leverage_bps
/// ```
pub fn compute_required_margin_usdc(size_usdc: u64, max_leverage_bps: u64) -> u64 {
    (size_usdc as u128)
        .checked_mul(BPS as u128)
        .unwrap()
        .checked_div(max_leverage_bps as u128)
        .unwrap() as u64
}

/// Compute the maintenance margin requirement in USDC base-6.
///
/// Mirrors TypeScript `computeMaintenanceRequiredUsdc`:
/// ```text
/// maintenance_margin = size_usdc * maintenance_margin_bps / BPS
/// ```
pub fn compute_maintenance_required_usdc(
    size_usdc: u64,
    maintenance_margin_bps: u64,
) -> u64 {
    (size_usdc as u128)
        .checked_mul(maintenance_margin_bps as u128)
        .unwrap()
        .checked_div(BPS as u128)
        .unwrap() as u64
}

/// Compute the PnL for a position in USDC base-6.
///
/// Mirrors TypeScript `computePnlUsdc`:
/// ```text
/// price_delta = is_long ? live_price - entry_price : entry_price - live_price
/// pnl = price_delta * size_usdc / entry_price
/// ```
pub fn compute_pnl_usdc(size_usdc: u64, entry_price: u64, live_price: u64, is_long: bool) -> i64 {
    if entry_price == 0 {
        return 0;
    }
    let price_delta: i128 = if is_long {
        live_price as i128 - entry_price as i128
    } else {
        entry_price as i128 - live_price as i128
    };
    (price_delta
        .checked_mul(size_usdc as i128)
        .unwrap()
        .checked_div(entry_price as i128)
        .unwrap()) as i64
}

/// Compute equity: live margin + PnL.
pub fn compute_equity_usdc(live_margin_usdc: i64, pnl_usdc: i64) -> i64 {
    live_margin_usdc.saturating_add(pnl_usdc)
}

// ── PDA Derivation ─────────────────────────────────────────────────────────

/// Derive the pt-config PDA.
pub fn pt_config_pda(program_id: Pubkey) -> Pubkey {
    let (pda, _bump) = Pubkey::find_program_address(&[PT_CONFIG_SEED], &program_id);
    pda
}

/// Derive a position PDA for (trader, market, sub_id).
pub fn position_pda(
    program_id: Pubkey,
    trader: &Pubkey,
    market: &Pubkey,
    sub_id: u8,
) -> Pubkey {
    let (pda, _bump) = Pubkey::find_program_address(
        &[POSITION_SEED, trader.as_ref(), market.as_ref(), &[sub_id]],
        &program_id,
    );
    pda
}

/// Derive the collateral vault PDA for a position.
pub fn collateral_vault_pda(program_id: Pubkey, position: &Pubkey) -> Pubkey {
    let (pda, _bump) = Pubkey::find_program_address(
        &[COLLATERAL_VAULT_SEED, position.as_ref()],
        &program_id,
    );
    pda
}

/// Derive the settlement vault PDA.
pub fn settlement_vault_pda(program_id: Pubkey) -> Pubkey {
    let (pda, _bump) =
        Pubkey::find_program_address(&[b"settlement-vault"], &program_id);
    pda
}

/// Derive the insurance vault PDA.
pub fn insurance_vault_pda(program_id: Pubkey) -> Pubkey {
    let (pda, _bump) =
        Pubkey::find_program_address(&[b"insurance-vault"], &program_id);
    pda
}

// ── Anchor Discriminator ───────────────────────────────────────────────────

/// Compute the Anchor instruction discriminator: first 8 bytes of
/// `sha256("global:<instruction_name>")` using Solana's built-in SHA-256.
fn anchor_discriminator(name: &str) -> [u8; 8] {
    let preimage = format!("global:{name}");
    let hash = solana_program::hash::hash(preimage.as_bytes());
    let mut disc = [0u8; 8];
    disc.copy_from_slice(&hash.to_bytes()[..8]);
    disc
}

// ── Instruction Builders ───────────────────────────────────────────────────

/// Build an `open_position_jit` instruction.
///
/// Account order mirrors the on-chain `OpenPositionJit` context:
/// 0. trader (signer, mut)
/// 1. pt_config (mut)
/// 2. market (mut)
/// 3. position (mut)
/// 4. collateral_vault (mut)
/// 5. token_program
/// 6. system_program
pub fn build_open_position_jit_ix(
    program_id: Pubkey,
    trader: Pubkey,
    market: Pubkey,
    is_long: bool,
    size_usdc: u64,
    collateral_shares: u64,
    sub_id: u8,
    margin_mode: u8,
    tp_price: Option<u64>,
    sl_price: Option<u64>,
) -> Instruction {
    let position = position_pda(program_id, &trader, &market, sub_id);
    let collateral_vault = collateral_vault_pda(program_id, &position);
    let config = pt_config_pda(program_id);

    let accounts = vec![
        AccountMeta::new(trader, true),                    // trader (signer)
        AccountMeta::new(config, false),                   // pt_config
        AccountMeta::new(market, false),                   // market
        AccountMeta::new(position, false),                 // position
        AccountMeta::new(collateral_vault, false),         // collateral_vault
        AccountMeta::new_readonly(spl_token::ID, false),  // token_program
        AccountMeta::new_readonly(solana_program::system_program::ID, false), // system_program
    ];

    // Build instruction data using Borsh layout matching the on-chain struct.
    let mut data = anchor_discriminator("open_position_jit").to_vec();
    data.push(sub_id);
    data.push(if is_long { 1 } else { 0 });
    data.extend_from_slice(&size_usdc.to_le_bytes());
    data.extend_from_slice(&collateral_shares.to_le_bytes());
    data.push(margin_mode);
    // Borsh Option<u64>: 0x00 for None, 0x01 + 8 bytes for Some.
    match tp_price {
        Some(price) => {
            data.push(1);
            data.extend_from_slice(&price.to_le_bytes());
        }
        None => data.push(0),
    }
    match sl_price {
        Some(price) => {
            data.push(1);
            data.extend_from_slice(&price.to_le_bytes());
        }
        None => data.push(0),
    }

    Instruction {
        program_id,
        accounts,
        data,
    }
}

/// Build a `close_position` instruction.
///
/// Account order mirrors the on-chain `ClosePosition` context:
/// 0. trader (signer, mut)
/// 1. pt_config (mut)
/// 2. market (mut)
/// 3. position (mut)
/// 4. collateral_vault (mut)
/// 5. token_program
pub fn build_close_position_ix(
    program_id: Pubkey,
    trader: Pubkey,
    market: Pubkey,
    sub_id: u8,
) -> Instruction {
    let position = position_pda(program_id, &trader, &market, sub_id);
    let collateral_vault = collateral_vault_pda(program_id, &position);
    let config = pt_config_pda(program_id);

    let accounts = vec![
        AccountMeta::new(trader, true),                    // trader (signer)
        AccountMeta::new(config, false),                   // pt_config
        AccountMeta::new(market, false),                   // market
        AccountMeta::new(position, false),                 // position
        AccountMeta::new(collateral_vault, false),         // collateral_vault
        AccountMeta::new_readonly(spl_token::ID, false),  // token_program
    ];

    let mut data = anchor_discriminator("close_position").to_vec();
    data.push(sub_id);

    Instruction {
        program_id,
        accounts,
        data,
    }
}

/// Build a `liquidate` instruction.
///
/// Account order mirrors the on-chain `Liquidate` context:
/// 0. liquidator (signer, mut)
/// 1. pt_config (mut)
/// 2. market (mut)
/// 3. owner
/// 4. position (mut)
/// 5. collateral_vault (mut)
/// 6. insurance_vault (mut)
/// 7. token_program
/// 8. system_program
pub fn build_liquidate_ix(
    program_id: Pubkey,
    liquidator: Pubkey,
    owner: Pubkey,
    market: Pubkey,
    sub_id: u8,
) -> Instruction {
    let position = position_pda(program_id, &owner, &market, sub_id);
    let collateral_vault = collateral_vault_pda(program_id, &position);
    let config = pt_config_pda(program_id);
    let insurance = insurance_vault_pda(program_id);

    let accounts = vec![
        AccountMeta::new(liquidator, true),                // liquidator (signer)
        AccountMeta::new(config, false),                   // pt_config
        AccountMeta::new(market, false),                   // market
        AccountMeta::new_readonly(owner, false),           // owner
        AccountMeta::new(position, false),                 // position
        AccountMeta::new(collateral_vault, false),         // collateral_vault
        AccountMeta::new(insurance, false),                // insurance_vault
        AccountMeta::new_readonly(spl_token::ID, false),  // token_program
        AccountMeta::new_readonly(solana_program::system_program::ID, false), // system_program
    ];

    let mut data = anchor_discriminator("liquidate").to_vec();
    data.push(sub_id);

    Instruction {
        program_id,
        accounts,
        data,
    }
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use noviscia_types::POSITION_TRACKER_PROGRAM_ID;

    #[test]
    fn required_margin_matches_typescript() {
        // $10k size, 10x leverage (100000 bps) → $1k margin
        let margin = compute_required_margin_usdc(10_000_000_000, 100_000);
        assert_eq!(margin, 1_000_000_000);
    }

    #[test]
    fn required_margin_at_1x() {
        let margin = compute_required_margin_usdc(5_000_000, 10_000);
        assert_eq!(margin, 5_000_000);
    }

    #[test]
    fn pnl_long_positive() {
        let pnl = compute_pnl_usdc(1_000_000_000, 100_000_000, 110_000_000, true);
        assert_eq!(pnl, 100_000_000);
    }

    #[test]
    fn pnl_long_negative() {
        let pnl = compute_pnl_usdc(1_000_000_000, 100_000_000, 90_000_000, true);
        assert_eq!(pnl, -100_000_000);
    }

    #[test]
    fn pnl_short_positive() {
        let pnl = compute_pnl_usdc(1_000_000_000, 100_000_000, 90_000_000, false);
        assert_eq!(pnl, 100_000_000);
    }

    #[test]
    fn pnl_short_negative() {
        let pnl = compute_pnl_usdc(1_000_000_000, 100_000_000, 110_000_000, false);
        assert_eq!(pnl, -100_000_000);
    }

    #[test]
    fn pnl_zero_entry_price() {
        let pnl = compute_pnl_usdc(1_000_000_000, 0, 100_000_000, true);
        assert_eq!(pnl, 0);
    }

    #[test]
    fn equity_calculation() {
        let eq = compute_equity_usdc(1_000_000_000, 200_000_000);
        assert_eq!(eq, 1_200_000_000);
    }

    #[test]
    fn maintenance_margin() {
        let mm = compute_maintenance_required_usdc(10_000_000_000, 500);
        assert_eq!(mm, 500_000_000);
    }

    #[test]
    fn position_pdas_are_deterministic() {
        let program_id = POSITION_TRACKER_PROGRAM_ID;
        let trader = Pubkey::new_unique();
        let market = Pubkey::new_unique();
        let p1 = position_pda(program_id, &trader, &market, 0);
        let p2 = position_pda(program_id, &trader, &market, 0);
        assert_eq!(p1, p2);
    }

    #[test]
    fn different_sub_ids_yield_different_pdas() {
        let program_id = POSITION_TRACKER_PROGRAM_ID;
        let trader = Pubkey::new_unique();
        let market = Pubkey::new_unique();
        let p0 = position_pda(program_id, &trader, &market, 0);
        let p1 = position_pda(program_id, &trader, &market, 1);
        assert_ne!(p0, p1);
    }

    #[test]
    fn open_position_ix_has_correct_accounts() {
        let ix = build_open_position_jit_ix(
            POSITION_TRACKER_PROGRAM_ID,
            Pubkey::new_unique(),
            Pubkey::new_unique(),
            true,
            1_000_000_000,
            500_000_000,
            0,
            0,
            None,
            None,
        );
        assert_eq!(ix.accounts.len(), 7);
        assert!(ix.accounts[0].is_signer);
    }

    #[test]
    fn close_position_ix_has_correct_accounts() {
        let ix = build_close_position_ix(
            POSITION_TRACKER_PROGRAM_ID,
            Pubkey::new_unique(),
            Pubkey::new_unique(),
            0,
        );
        assert_eq!(ix.accounts.len(), 6);
    }

    #[test]
    fn liquidate_ix_has_correct_accounts() {
        let ix = build_liquidate_ix(
            POSITION_TRACKER_PROGRAM_ID,
            Pubkey::new_unique(),
            Pubkey::new_unique(),
            Pubkey::new_unique(),
            0,
        );
        assert_eq!(ix.accounts.len(), 9);
    }

    #[test]
    fn open_position_ix_data_has_discriminator_and_args() {
        let ix = build_open_position_jit_ix(
            POSITION_TRACKER_PROGRAM_ID,
            Pubkey::new_unique(),
            Pubkey::new_unique(),
            true,
            12345,
            67890,
            0,
            0,
            None,
            None,
        );
        // 8 (disc) + 1 (sub_id) + 1 (is_long) + 8 (size) + 8 (collateral) + 1 (margin_mode) + 1 (tp None) + 1 (sl None) = 29
        assert_eq!(ix.data.len(), 29);
    }

    #[test]
    fn open_position_ix_with_tp_sl() {
        let ix = build_open_position_jit_ix(
            POSITION_TRACKER_PROGRAM_ID,
            Pubkey::new_unique(),
            Pubkey::new_unique(),
            true,
            12345,
            67890,
            0,
            0,
            Some(150_000_000),
            Some(90_000_000),
        );
        // 8 (disc) + 1 (sub_id) + 1 (is_long) + 8 (size) + 8 (collateral)
        //   + 1 (margin_mode) + 9 (tp Some) + 9 (sl Some) = 45
        assert_eq!(ix.data.len(), 45);
    }
}
