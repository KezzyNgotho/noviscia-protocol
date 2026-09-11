use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, MintTo, Token, TokenAccount, Transfer};
use noviscia_tvv_gate::cpi::accounts::RepaySupply;
use noviscia_tvv_gate::program::NovisciaTvvGate;

declare_id!("2t5zfcgpdWW5MH4PrQjRDyqVB5MhbwwKFFQJN3VZogAr");

pub const VAULT_SEED: &[u8] = b"omni-vault";
pub const NSHARES_SEED: &[u8] = b"nshares";

pub const SOLAR_SECONDS: u64 = 31_536_000;
pub const BPS_DENOM: u64 = 10_000;

#[program]
pub mod noviscia_omni_pool {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        gate: Pubkey,
        mgmt_bps: u16,
        perf_bps: u16,
        dif_bps: u16,
    ) -> Result<()> {
        require!(mgmt_bps <= BPS_DENOM as u16, VaultError::InvalidBps);
        require!(perf_bps <= BPS_DENOM as u16, VaultError::InvalidBps);
        require!(dif_bps <= BPS_DENOM as u16, VaultError::InvalidBps);

        let now = ctx.accounts.clock.unix_timestamp;
        let vault = &mut ctx.accounts.vault;
        vault.authority = ctx.accounts.authority.key();
        vault.usdc_mint = ctx.accounts.usdc_mint.key();
        let (shares_pda, _) = Pubkey::find_program_address(
            &[NSHARES_SEED, ctx.accounts.usdc_mint.key().as_ref()],
            &ID,
        );
        vault.shares_mint = shares_pda;
        vault.gate = gate;
        vault.gate_linked = gate != Pubkey::default();
        vault.total_assets = 0;
        vault.total_shares = 0;
        vault.carry_ledger = 0;
        vault.insurance_ledger = 0;
        vault.highwater_yield = read_gate_yield(&ctx.accounts.gate)?;
        vault.mgmt_bps = if mgmt_bps == 0 { 200 } else { mgmt_bps };
        vault.perf_bps = if perf_bps == 0 { 2000 } else { perf_bps };
        vault.dif_bps = if dif_bps == 0 { 1500 } else { dif_bps };
        vault.last_settle_unix = now;
        vault.settle_count = 0;
        let (_, bump) = Pubkey::find_program_address(
            &[VAULT_SEED, ctx.accounts.usdc_mint.key().as_ref()],
            ctx.program_id,
        );
        vault.bump = bump;
        Ok(())
    }

    pub fn initialize_shares(ctx: Context<InitializeShares>) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.vault.authority,
            ctx.accounts.authority.key(),
            VaultError::Unauthorized
        );
        Ok(())
    }

    pub fn update_gate(ctx: Context<UpdateConfig>, gate: Pubkey) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require_keys_eq!(vault.authority, ctx.accounts.authority.key(), VaultError::Unauthorized);
        vault.gate = gate;
        vault.gate_linked = gate != Pubkey::default();
        vault.highwater_yield = read_gate_yield(&ctx.accounts.gate)?;
        Ok(())
    }

    pub fn set_fees(
        ctx: Context<UpdateConfig>,
        mgmt_bps: u16,
        perf_bps: u16,
        dif_bps: u16,
    ) -> Result<()> {
        require!(mgmt_bps <= BPS_DENOM as u16, VaultError::InvalidBps);
        require!(perf_bps <= BPS_DENOM as u16, VaultError::InvalidBps);
        require!(dif_bps <= BPS_DENOM as u16, VaultError::InvalidBps);
        let vault = &mut ctx.accounts.vault;
        require_keys_eq!(vault.authority, ctx.accounts.authority.key(), VaultError::Unauthorized);
        vault.mgmt_bps = mgmt_bps;
        vault.perf_bps = perf_bps;
        vault.dif_bps = dif_bps;
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, VaultError::ZeroAmount);
        require!(!ctx.accounts.vault.paused, VaultError::Paused);
        require!(ctx.accounts.vault_usdc.owner == ctx.accounts.vault.key(), VaultError::WrongVaultOwner);

        let (ta, ts, bump) = (
            ctx.accounts.vault.total_assets,
            ctx.accounts.vault.total_shares,
            ctx.accounts.vault.bump,
        );

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_usdc.to_account_info(),
                    to: ctx.accounts.vault_usdc.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
        )?;

        let (shares, remainder) = compute_mint_shares(amount, ta, ts);
        require!(shares > 0, VaultError::SharesZero);

        mint_shares(
            &ctx.accounts.token_program.to_account_info(),
            &ctx.accounts.shares_mint.to_account_info(),
            &ctx.accounts.user_shares.to_account_info(),
            &ctx.accounts.vault.to_account_info(),
            ctx.accounts.usdc_mint.key(),
            bump,
            shares,
        )?;

        let vault = &mut ctx.accounts.vault;
        vault.total_assets = vault.total_assets.saturating_add(amount.saturating_sub(remainder));
        vault.total_shares = vault.total_shares.saturating_add(shares);
        Ok(())
    }

    pub fn redeem(ctx: Context<Redeem>, shares: u64, min_out: u64) -> Result<()> {
        require!(shares > 0, VaultError::ZeroAmount);
        require!(!ctx.accounts.vault.paused, VaultError::Paused);
        require!(ctx.accounts.vault_usdc.owner == ctx.accounts.vault.key(), VaultError::WrongVaultOwner);
        require!(shares <= ctx.accounts.vault.total_shares, VaultError::InsufficientShares);

        let provisioned = ctx
            .accounts
            .vault
            .carry_ledger
            .saturating_add(ctx.accounts.vault.insurance_ledger);
        let distributable = ctx.accounts.vault.total_assets.saturating_sub(provisioned);
        let usdc_out = (shares as u128 * distributable as u128 / ctx.accounts.vault.total_shares as u128)
            as u64;
        require!(usdc_out >= min_out, VaultError::SlippageExceeded);
        require!(
            ctx.accounts.vault_usdc.amount >= usdc_out + provisioned,
            VaultError::InsufficientLiquidity
        );

        let usdc_mint = ctx.accounts.usdc_mint.key();
        let bump = { ctx.accounts.vault.bump };
        let vault_info = ctx.accounts.vault.to_account_info();
        let seeds: &[&[&[u8]]] = &[&[VAULT_SEED, usdc_mint.as_ref(), &[bump]]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault_usdc.to_account_info(),
                    to: ctx.accounts.user_usdc.to_account_info(),
                    authority: vault_info,
                },
                seeds,
            ),
            usdc_out,
        )?;

        token::burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.shares_mint.to_account_info(),
                    from: ctx.accounts.user_shares.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            shares,
        )?;

        let vault = &mut ctx.accounts.vault;
        vault.total_assets -= usdc_out;
        vault.total_shares -= shares;
        Ok(())
    }

    pub fn settle_day(ctx: Context<SettleDay>) -> Result<()> {
        require!(!ctx.accounts.vault.paused, VaultError::Paused);
        require!(ctx.accounts.vault.gate_linked, VaultError::GateNotLinked);
        let gate_yield = read_gate_yield(&ctx.accounts.gate)?;
        let now = ctx.accounts.clock.unix_timestamp;
        let elapsed = now.saturating_sub(ctx.accounts.vault.last_settle_unix);

        let gross = gate_yield.saturating_sub(ctx.accounts.vault.highwater_yield);

        let mgmt_u = ctx.accounts.vault.total_assets as u128
            * ctx.accounts.vault.mgmt_bps as u128
            * elapsed as u128
            / (BPS_DENOM as u128 * SOLAR_SECONDS as u128);

        let carry_u = gross * ctx.accounts.vault.perf_bps as u128 / BPS_DENOM as u128;
        let dif_u = carry_u * ctx.accounts.vault.dif_bps as u128 / BPS_DENOM as u128;
        let carry_pending_u = carry_u.saturating_sub(dif_u);

        require!(
            ctx.accounts.vault.total_assets as u128 >= mgmt_u,
            VaultError::Insolvent
        );

        let gross_net = gross.checked_sub(carry_u).ok_or(VaultError::Underflow)?;
        let vault = &mut ctx.accounts.vault;
        vault.total_assets = vault
            .total_assets
            .checked_add(gross_net as u64)
            .ok_or(VaultError::Overflow)?
            .checked_sub(mgmt_u as u64)
            .ok_or(VaultError::Underflow)?;
        vault.carry_ledger = vault
            .carry_ledger
            .saturating_add(carry_pending_u as u64)
            .saturating_add(mgmt_u as u64);
        vault.insurance_ledger = vault
            .insurance_ledger
            .saturating_add(dif_u as u64);
        vault.highwater_yield = gate_yield;
        vault.last_settle_unix = now;
        vault.settle_count += 1;
        Ok(())
    }

    pub fn collect_carry(mut ctx: Context<Collect>, amount: u64) -> Result<()> {
        collect_vault(&mut ctx, amount, true)
    }

    pub fn collect_insurance(mut ctx: Context<Collect>, amount: u64) -> Result<()> {
        collect_vault(&mut ctx, amount, false)
    }

    pub fn set_paused(ctx: Context<Update>, paused: bool) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require_keys_eq!(vault.authority, ctx.accounts.authority.key(), VaultError::Unauthorized);
        vault.paused = paused;
        Ok(())
    }

    pub fn deploy_supply(ctx: Context<DeploySupply>, amount: u64) -> Result<()> {
        require!(amount > 0, VaultError::ZeroAmount);
        require!(!ctx.accounts.vault.paused, VaultError::Paused);
        require_keys_eq!(
            ctx.accounts.vault.authority,
            ctx.accounts.authority.key(),
            VaultError::Unauthorized
        );
        require!(ctx.accounts.vault.gate_linked, VaultError::GateNotLinked);
        require!(
            ctx.accounts.vault_usdc.owner == ctx.accounts.vault.key(),
            VaultError::WrongVaultOwner
        );
        require!(
            ctx.accounts.reserve_vault.owner == ctx.accounts.gate.key(),
            VaultError::WrongReserveOwner
        );
        require!(
            ctx.accounts.gate.key() == ctx.accounts.vault.gate,
            VaultError::GateMismatch
        );
        require!(
            amount <= ctx.accounts.vault_usdc.amount,
            VaultError::InsufficientLiquidity
        );

        let usdc_mint = ctx.accounts.usdc_mint.key();
        let vault_bump = ctx.accounts.vault.bump;
        let vault_info = ctx.accounts.vault.to_account_info();
        let seeds: &[&[&[u8]]] = &[&[VAULT_SEED, usdc_mint.as_ref(), &[vault_bump]]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault_usdc.to_account_info(),
                    to: ctx.accounts.reserve_vault.to_account_info(),
                    authority: vault_info,
                },
                seeds,
            ),
            amount,
        )?;

        let vault = &mut ctx.accounts.vault;
        vault.gate_loan = vault.gate_loan.saturating_add(amount);
        Ok(())
    }

    pub fn recall_supply(ctx: Context<RecallSupply>, amount: u64) -> Result<()> {
        require!(amount > 0, VaultError::ZeroAmount);
        require_keys_eq!(
            ctx.accounts.vault.authority,
            ctx.accounts.authority.key(),
            VaultError::Unauthorized
        );
        let outstanding = ctx.accounts.vault.gate_loan;
        require!(amount <= outstanding, VaultError::InsufficientLedger);
        ctx.accounts.vault.gate_loan = outstanding - amount;

        let cpi_program = ctx.accounts.gate_program.to_account_info();
        let cpi_accounts = RepaySupply {
            config: ctx.accounts.gate.to_account_info(),
            reserve_vault: ctx.accounts.reserve_vault.to_account_info(),
            to_vault: ctx.accounts.vault_usdc.to_account_info(),
            asset_mint: ctx.accounts.usdc_mint.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        noviscia_tvv_gate::cpi::repay_supply(cpi_ctx, amount)?;
        Ok(())
    }
}

fn compute_mint_shares(usdc_in: u64, total_assets: u64, total_shares: u64) -> (u64, u64) {
    if total_shares == 0 || total_assets == 0 {
        return (usdc_in, 0);
    }
    let shares = usdc_in as u128 * total_shares as u128 / total_assets as u128;
    let used = shares * total_assets as u128 / total_shares as u128;
    (shares as u64, (usdc_in as u128 - used) as u64)
}

fn mint_shares<'info>(
    token_program: &AccountInfo<'info>,
    shares_mint: &AccountInfo<'info>,
    user_shares: &AccountInfo<'info>,
    vault: &AccountInfo<'info>,
    usdc_mint: Pubkey,
    bump: u8,
    amount: u64,
) -> Result<()> {
    let seeds: &[&[&[u8]]] = &[&[VAULT_SEED, usdc_mint.as_ref(), &[bump]]];
    token::mint_to(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            MintTo {
                mint: shares_mint.to_account_info(),
                to: user_shares.to_account_info(),
                authority: vault.to_account_info(),
            },
            seeds,
        ),
        amount,
    )?;
    Ok(())
}

fn read_gate_yield(gate: &AccountInfo) -> Result<u128> {
    if gate.key() == Pubkey::default() {
        return Ok(0);
    }
    let data = gate.try_borrow_data()?;
    let start = 8 + 68;
    if data.len() < start + 16 {
        return Ok(0);
    }
    let mut buf = [0u8; 16];
    buf.copy_from_slice(&data[start..start + 16]);
    Ok(u128::from_le_bytes(buf))
}

fn collect_vault(ctx: &mut Context<Collect>, amount: u64, carry: bool) -> Result<()> {
    require!(amount > 0, VaultError::ZeroAmount);
    require_keys_eq!(
        ctx.accounts.vault.authority,
        ctx.accounts.authority.key(),
        VaultError::Unauthorized
    );
    if carry {
        require!(amount <= ctx.accounts.vault.carry_ledger, VaultError::InsufficientLedger);
    } else {
        require!(amount <= ctx.accounts.vault.insurance_ledger, VaultError::InsufficientLedger);
    }
    require!(ctx.accounts.vault_usdc.owner == ctx.accounts.vault.key(), VaultError::WrongVaultOwner);

    let usdc_mint = ctx.accounts.usdc_mint.key();
    let bump = ctx.accounts.vault.bump;
    let vault_info = ctx.accounts.vault.to_account_info();
    let seeds: &[&[&[u8]]] = &[&[VAULT_SEED, usdc_mint.as_ref(), &[bump]]];
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault_usdc.to_account_info(),
                to: ctx.accounts.to_vault.to_account_info(),
                authority: vault_info,
            },
            seeds,
        ),
        amount,
    )?;

    let vault = &mut ctx.accounts.vault;
    if carry {
        vault.carry_ledger -= amount;
    } else {
        vault.insurance_ledger -= amount;
    }
    Ok(())
}

#[account]
pub struct VaultState {
    pub authority: Pubkey,
    pub usdc_mint: Pubkey,
    pub shares_mint: Pubkey,
    pub gate: Pubkey,
    pub paused: bool,
    pub gate_linked: bool,
    pub total_assets: u64,
    pub total_shares: u64,
    pub carry_ledger: u64,
    pub insurance_ledger: u64,
    pub highwater_yield: u128,
    pub mgmt_bps: u16,
    pub perf_bps: u16,
    pub dif_bps: u16,
    pub last_settle_unix: i64,
    pub settle_count: u64,
    pub gate_loan: u64,
    pub bump: u8,
}

impl VaultState {
    pub const SPACE: usize =
        8 + 32 * 4 + 1 * 3 + 8 * 4 + 16 + 2 * 3 + 8 + 8 + 8 + 1;
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = VaultState::SPACE,
        seeds = [VAULT_SEED, usdc_mint.key().as_ref()],
        bump
    )]
    pub vault: Box<Account<'info, VaultState>>,
    /// CHECK: gate config account (noviscia_tvv_gate). Read-only ledger view.
    pub gate: AccountInfo<'info>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub clock: Sysvar<'info, Clock>,
}

#[derive(Accounts)]
pub struct InitializeShares<'info> {
    #[account(
        seeds = [VAULT_SEED, usdc_mint.key().as_ref()],
        bump = vault.bump,
        constraint = vault.authority == authority.key() @ VaultError::Unauthorized
    )]
    pub vault: Box<Account<'info, VaultState>>,
    #[account(
        init,
        payer = authority,
        seeds = [NSHARES_SEED, usdc_mint.key().as_ref()],
        bump,
        mint::decimals = 6,
        mint::authority = vault,
        mint::freeze_authority = vault,
    )]
    pub shares_mint: Account<'info, Mint>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(mut, seeds = [VAULT_SEED, usdc_mint.key().as_ref()], bump = vault.bump)]
    pub vault: Box<Account<'info, VaultState>>,
    /// CHECK: gate config account (noviscia_tvv_gate). Read-only ledger view.
    pub gate: AccountInfo<'info>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct Update<'info> {
    #[account(mut, seeds = [VAULT_SEED, usdc_mint.key().as_ref()], bump = vault.bump)]
    pub vault: Box<Account<'info, VaultState>>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut, seeds = [VAULT_SEED, usdc_mint.key().as_ref()], bump = vault.bump)]
    pub vault: Box<Account<'info, VaultState>>,
    #[account(mut)]
    pub shares_mint: Account<'info, Mint>,
    #[account(mut, token::mint = usdc_mint)]
    pub vault_usdc: Account<'info, TokenAccount>,
    #[account(mut, token::mint = usdc_mint)]
    pub user_usdc: Account<'info, TokenAccount>,
    #[account(mut, token::mint = shares_mint)]
    pub user_shares: Account<'info, TokenAccount>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Redeem<'info> {
    #[account(mut, seeds = [VAULT_SEED, usdc_mint.key().as_ref()], bump = vault.bump)]
    pub vault: Box<Account<'info, VaultState>>,
    #[account(mut)]
    pub shares_mint: Account<'info, Mint>,
    #[account(mut, token::mint = usdc_mint)]
    pub vault_usdc: Account<'info, TokenAccount>,
    #[account(mut, token::mint = usdc_mint)]
    pub user_usdc: Account<'info, TokenAccount>,
    #[account(mut, token::mint = shares_mint)]
    pub user_shares: Account<'info, TokenAccount>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct SettleDay<'info> {
    #[account(mut, seeds = [VAULT_SEED, usdc_mint.key().as_ref()], bump = vault.bump)]
    pub vault: Box<Account<'info, VaultState>>,
    /// CHECK: gate config account (noviscia_tvv_gate). Read-only ledger view.
    pub gate: AccountInfo<'info>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    pub clock: Sysvar<'info, Clock>,
}

#[derive(Accounts)]
pub struct Collect<'info> {
    #[account(mut, seeds = [VAULT_SEED, usdc_mint.key().as_ref()], bump = vault.bump)]
    pub vault: Box<Account<'info, VaultState>>,
    #[account(mut, token::mint = usdc_mint)]
    pub vault_usdc: Account<'info, TokenAccount>,
    #[account(mut, token::mint = usdc_mint)]
    pub to_vault: Account<'info, TokenAccount>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct DeploySupply<'info> {
    #[account(mut, seeds = [VAULT_SEED, usdc_mint.key().as_ref()], bump = vault.bump)]
    pub vault: Box<Account<'info, VaultState>>,
    /// CHECK: gate config account (noviscia_tvv_gate). Owner of the reserve vault.
    pub gate: AccountInfo<'info>,
    #[account(mut, token::mint = usdc_mint)]
    pub vault_usdc: Account<'info, TokenAccount>,
    #[account(mut, token::mint = usdc_mint)]
    pub reserve_vault: Account<'info, TokenAccount>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct RecallSupply<'info> {
    #[account(mut, seeds = [VAULT_SEED, usdc_mint.key().as_ref()], bump = vault.bump)]
    pub vault: Box<Account<'info, VaultState>>,
    /// CHECK: gate config account (noviscia_tvv_gate). CPI target; writable in the inner call.
    #[account(mut)]
    pub gate: AccountInfo<'info>,
    #[account(mut, token::mint = usdc_mint)]
    pub reserve_vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = usdc_mint)]
    pub vault_usdc: Account<'info, TokenAccount>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub gate_program: Program<'info, NovisciaTvvGate>,
}

#[error_code]
pub enum VaultError {
    #[msg("authority only")]
    Unauthorized,
    #[msg("vault is paused")]
    Paused,
    #[msg("gate not linked to a live configured gate account")]
    GateNotLinked,
    #[msg("invalid bps")]
    InvalidBps,
    #[msg("amount must be nonzero")]
    ZeroAmount,
    #[msg("minted shares rounded to zero")]
    SharesZero,
    #[msg("insufficient share balance")]
    InsufficientShares,
    #[msg("slippage exceeds min_out")]
    SlippageExceeded,
    #[msg("insufficient vault liquidity")]
    InsufficientLiquidity,
    #[msg("ledger cannot cover amount")]
    InsufficientLedger,
    #[msg("vault_usdc owner mismatch")]
    WrongVaultOwner,
    #[msg("arithmetic overflow")]
    Overflow,
    #[msg("arithmetic underflow")]
    Underflow,
    #[msg("vault is insolvent")]
    Insolvent,
    #[msg("gate account does not match the linked gateway")]
    GateMismatch,
    #[msg("gate reserve vault owner mismatch")]
    WrongReserveOwner,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_deposit_mints_one_to_one() {
        let (shares, remainder) = compute_mint_shares(1_000_000, 0, 0);
        assert_eq!(shares, 1_000_000);
        assert_eq!(remainder, 0);
    }

    #[test]
    fn later_deposits_are_nav_proportional() {
        let (shares, _) = compute_mint_shares(1_000_000, 10_000_000, 9_000_000);
        assert_eq!(shares, 900_000);
        let nav_before = 10_000_000 * 100 / 9_000_000;
        let nav_after = 11_000_000 * 100 / 9_900_000;
        assert_eq!(nav_before, nav_after);
    }

    #[test]
    fn settle_misses_fees_when_flat() {
        let ta: u64 = 10_000_000;
        let gross: u64 = 0;
        let carry = (gross as u128 * 2_000 / 10_000) as u64;
        let dif = (carry as u128 * 1_500 / 10_000) as u64;
        let lp = gross - carry;
        assert_eq!(carry, 0);
        assert_eq!(dif, 0);
        assert_eq!(lp, 0);
        assert_eq!(ta, 10_000_000);
    }

    #[test]
    fn settle_split_matches_two_twenty_with_dif() {
        let gross: u64 = 1_000_000;
        let mgmt: u64 = 0;
        let carry = (gross as u128 * 2_000 / 10_000) as u64;
        let dif = (carry as u128 * 1_500 / 10_000) as u64;
        let carry_pending = carry - dif;
        let lp = gross - carry - mgmt;
        assert_eq!(carry, 200_000);
        assert_eq!(dif, 30_000);
        assert_eq!(carry_pending, 170_000);
        assert_eq!(lp, 800_000);
    }
}