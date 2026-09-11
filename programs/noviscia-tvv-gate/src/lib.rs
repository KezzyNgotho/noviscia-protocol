use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("A1cYVV1PjhHgJfiKZzPsjo6Bf7E8NNkMdiv4xNkTaU9g");

pub const GATE_SEED: &[u8] = b"tvv-gate";
pub const SEARCHER_SEED: &[u8] = b"tvv-searcher";
pub const RUN_SEED: &[u8] = b"tvv-run";
pub const RISK_SEED: &[u8] = b"tvv-risk";
pub const DIF_SEED: &[u8] = b"tvv-dif";
pub const MARGIN_SEED: &[u8] = b"tvv-margin";

pub const MAX_ASSETS: usize = 8;
pub const NAV_BPS_DENOM: u64 = 10_000;
pub const DIF_BPS: u16 = 2_000;
pub const JLF_HALT_BPS: u16 = 5_000;

pub const RUN_OPEN: u8 = 0;
pub const RUN_SETTLED: u8 = 1;
pub const RUN_TIMEOUT: u8 = 2;

pub fn jlf_breached(losses: &u64, capital: &u64) -> bool {
    (*losses as u128 * NAV_BPS_DENOM as u128) >= (*capital as u128 * JLF_HALT_BPS as u128)
}

#[program]
pub mod noviscia_tvv_gate {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        mev_tip_pct_bps: u16,
        open_ttl_slots: u64,
        max_run_cap: u64,
        max_open_per_searcher: u8,
        jlf_capital: u64,
        max_exposure: u64,
        max_asset_share_bps: u16,
        allowed_assets: Vec<Pubkey>,
    ) -> Result<()> {
        require!(
            allowed_assets.len() <= MAX_ASSETS && !allowed_assets.is_empty(),
            TvvError::MaxAssets
        );
        require!(max_asset_share_bps <= NAV_BPS_DENOM as u16, TvvError::InvalidBps);
        let cfg = &mut ctx.accounts.config;
        cfg.authority = ctx.accounts.authority.key();
        cfg.paused = false;
        cfg.mev_tip_pct_bps = mev_tip_pct_bps;
        cfg.open_ttl_slots = open_ttl_slots;
        cfg.max_run_cap = max_run_cap;
        cfg.max_open_per_searcher = max_open_per_searcher;
        cfg.run_seq = 0;
        cfg.run_count = 0;
        cfg.realized_yield = 0;
        cfg.timeout_count = 0;
        cfg.reserve_count = 0;
        for (i, asset) in allowed_assets.iter().enumerate() {
            cfg.assets[i] = *asset;
            cfg.reserve_count = (i + 1) as u8;
        }
        cfg.sweeper = Pubkey::default();
        cfg.swept_yield = 0;
        cfg.dif_ledger = 0;
        let (_, bump) = Pubkey::find_program_address(&[GATE_SEED], ctx.program_id);
        cfg.bump = bump;

        let risk = &mut ctx.accounts.risk;
        risk.gate = ctx.accounts.config.key();
        risk.gateway = *ctx.program_id;
        risk.emergency_halt = false;
        risk.jlf_capital = jlf_capital;
        risk.jlf_losses = 0;
        risk.halted = false;
        risk.max_exposure = max_exposure;
        risk.max_asset_share_bps = max_asset_share_bps;
        risk.committed_total = 0;
        risk.committed_by_asset = [0u64; MAX_ASSETS];
        let (_, risk_bump) = Pubkey::find_program_address(&[RISK_SEED, ctx.accounts.config.key().as_ref()], ctx.program_id);
        risk.bump = risk_bump;
        Ok(())
    }

    pub fn set_config(
        ctx: Context<ManageConfig>,
        mev_tip_pct_bps: Option<u16>,
        open_ttl_slots: Option<u64>,
        max_run_cap: Option<u64>,
        max_open_per_searcher: Option<u8>,
    ) -> Result<()> {
        let cfg = &mut ctx.accounts.config;
        require_keys_eq!(cfg.authority, ctx.accounts.authority.key(), TvvError::Unauthorized);
        if let Some(v) = mev_tip_pct_bps {
            cfg.mev_tip_pct_bps = v;
        }
        if let Some(v) = open_ttl_slots {
            cfg.open_ttl_slots = v;
        }
        if let Some(v) = max_run_cap {
            cfg.max_run_cap = v;
        }
        if let Some(v) = max_open_per_searcher {
            cfg.max_open_per_searcher = v;
        }
        Ok(())
    }

    pub fn set_authority<'info>(ctx: Context<'_, '_, '_, 'info, ManageAuthority<'info>>) -> Result<()> {
        let cfg = &mut ctx.accounts.config;
        require_keys_eq!(cfg.authority, ctx.accounts.authority.key(), TvvError::Unauthorized);
        cfg.authority = ctx.accounts.new_authority.key();
        Ok(())
    }

    pub fn pause(ctx: Context<ManageConfig>, paused: bool) -> Result<()> {
        let cfg = &mut ctx.accounts.config;
        require_keys_eq!(cfg.authority, ctx.accounts.authority.key(), TvvError::Unauthorized);
        cfg.paused = paused;
        Ok(())
    }

    pub fn init_searcher(
        ctx: Context<InitSearcher>,
        cap_bps: u16,
        maintenance_bps: u16,
        enabled: bool,
    ) -> Result<()> {
        require!(cap_bps <= NAV_BPS_DENOM as u16, TvvError::InvalidBps);
        require!(maintenance_bps <= NAV_BPS_DENOM as u16, TvvError::InvalidBps);
        let cfg = &ctx.accounts.config;
        require_keys_eq!(cfg.authority, ctx.accounts.authority.key(), TvvError::Unauthorized);
        let st = &mut ctx.accounts.searcher_state;
        st.owner = ctx.accounts.searcher.key();
        st.enabled = enabled;
        st.cap_bps = cap_bps;
        st.open_runs = 0;
        let (_pk, bump) = Pubkey::find_program_address(
            &[SEARCHER_SEED, ctx.accounts.searcher.key().as_ref()],
            ctx.program_id,
        );
        st.bump = bump;

        let margin = &mut ctx.accounts.margin;
        margin.searcher = ctx.accounts.searcher.key();
        margin.gate = cfg.key();
        margin.collateral = 0;
        margin.gross_exposure = 0;
        margin.hedged_exposure = 0;
        margin.maintenance_bps = maintenance_bps;
        margin.flag = false;
        let (_pk, margin_bump) = Pubkey::find_program_address(
            &[MARGIN_SEED, ctx.accounts.searcher.key().as_ref()],
            ctx.program_id,
        );
        margin.bump = margin_bump;
        Ok(())
    }

    pub fn update_searcher(
        ctx: Context<UpdateSearcher>,
        cap_bps: u16,
        enabled: bool,
    ) -> Result<()> {
        require!(cap_bps <= NAV_BPS_DENOM as u16, TvvError::InvalidBps);
        let cfg = &ctx.accounts.config;
        require_keys_eq!(cfg.authority, ctx.accounts.authority.key(), TvvError::Unauthorized);
        let st = &mut ctx.accounts.searcher_state;
        st.enabled = enabled;
        st.cap_bps = cap_bps;
        Ok(())
    }

    pub fn post_margin(ctx: Context<PostMargin>, amount: u64) -> Result<()> {
        require!(amount > 0, TvvError::ZeroAmount);
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.searcher_margin_vault.to_account_info(),
                    to: ctx.accounts.margin_escrow.to_account_info(),
                    authority: ctx.accounts.searcher.to_account_info(),
                },
            ),
            amount,
        )?;
        let margin = &mut ctx.accounts.margin;
        margin.collateral = margin.collateral.saturating_add(amount);
        margin.flag = margin.margin_breached();
        Ok(())
    }

    pub fn withdraw_margin(ctx: Context<WithdrawMargin>, amount: u64) -> Result<()> {
        require!(amount > 0, TvvError::ZeroAmount);
        let margin = &mut ctx.accounts.margin;
        require!(!margin.flag, TvvError::MarginBreach);
        require!(amount <= margin.collateral, TvvError::InsufficientCollateral);
        let remaining = margin.collateral - amount;
        require!(margin.covers_margin(remaining), TvvError::MarginBreach);
        margin.collateral = remaining;
        margin.flag = margin.margin_breached();

        let searcher_key = ctx.accounts.searcher.key();
        let seeds: &[&[&[u8]]] = &[&[
            MARGIN_SEED,
            searcher_key.as_ref(),
            &[margin.bump],
        ]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.margin_escrow.to_account_info(),
                    to: ctx.accounts.searcher_margin_vault.to_account_info(),
                    authority: ctx.accounts.margin.to_account_info(),
                },
                seeds,
            ),
            amount,
        )?;
        Ok(())
    }

    pub fn set_hedge(ctx: Context<SetHedge>, hedged_exposure: u64) -> Result<()> {
        let margin = &mut ctx.accounts.margin;
        require!(
            hedged_exposure <= margin.gross_exposure,
            TvvError::HedgeExceedsExposure
        );
        margin.hedged_exposure = hedged_exposure;
        margin.flag = margin.margin_breached();
        Ok(())
    }

    pub fn provision_reserve(ctx: Context<DepositReserve>, amount: u64) -> Result<()> {
        require!(amount > 0, TvvError::ZeroAmount);
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.from.to_account_info(),
                    to: ctx.accounts.reserve_vault.to_account_info(),
                    authority: ctx.accounts.from_authority.to_account_info(),
                },
            ),
            amount,
        )?;
        Ok(())
    }

    pub fn withdraw_reserve(ctx: Context<WithdrawReserve>, amount: u64) -> Result<()> {
        require!(amount > 0, TvvError::ZeroAmount);
        let cfg = &ctx.accounts.config;
        require_keys_eq!(cfg.authority, ctx.accounts.authority.key(), TvvError::Unauthorized);
        let seeds: &[&[&[u8]]] = &[&[GATE_SEED, &[cfg.bump]]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.reserve_vault.to_account_info(),
                    to: ctx.accounts.to_vault.to_account_info(),
                    authority: ctx.accounts.config.to_account_info(),
                },
                seeds,
            ),
            amount,
        )?;
        Ok(())
    }

    pub fn register_lender(ctx: Context<ManageLender>, pool_vault: Pubkey) -> Result<()> {
        let cfg = &mut ctx.accounts.config;
        require_keys_eq!(cfg.authority, ctx.accounts.authority.key(), TvvError::Unauthorized);
        cfg.lender_pool = pool_vault;
        Ok(())
    }

    pub fn repay_supply(ctx: Context<RepaySupply>, amount: u64) -> Result<()> {
        require!(amount > 0, TvvError::ZeroAmount);
        let cfg = &ctx.accounts.config;
        require!(
            ctx.accounts.to_vault.owner == cfg.lender_pool,
            TvvError::UnknownLender
        );
        require!(
            ctx.accounts.to_vault.key() != ctx.accounts.reserve_vault.key(),
            TvvError::UnknownLender
        );
        let seeds: &[&[&[u8]]] = &[&[GATE_SEED, &[cfg.bump]]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.reserve_vault.to_account_info(),
                    to: ctx.accounts.to_vault.to_account_info(),
                    authority: ctx.accounts.config.to_account_info(),
                },
                seeds,
            ),
            amount,
        )?;
        Ok(())
    }

    pub fn pull_cap(ctx: Context<PullCap>, amount: u64) -> Result<()> {
        let cfg = &ctx.accounts.config;
        require!(!cfg.paused, TvvError::Paused);
        require!(cfg.is_asset(&ctx.accounts.asset_mint.key()), TvvError::AssetNotWhitelisted);
        require!(amount > 0, TvvError::ZeroAmount);

        let risk = &ctx.accounts.risk;
        require!(risk.gateway == *ctx.program_id, TvvError::WrongGateway);
        require!(!risk.emergency_halt, TvvError::EmergencyHalt);
        require!(!risk.halted, TvvError::RiskBreach);
        require!(
            risk.committed_total as u128 + amount as u128 <= risk.max_exposure as u128,
            TvvError::ExposureExceeded
        );
        let asset_idx = cfg
            .asset_index(&ctx.accounts.asset_mint.key())
            .ok_or(TvvError::AssetNotWhitelisted)?;
        let total_basis = ctx.accounts.reserve_vault.amount as u128 + risk.committed_total as u128;
        let new_share = (risk.committed_by_asset[asset_idx] as u128 + amount as u128)
            * NAV_BPS_DENOM as u128
            / total_basis;
        require!(
            new_share <= risk.max_asset_share_bps as u128,
            TvvError::AssetShareExceeded
        );

        require_keys_eq!(
            ctx.accounts.searcher_state.owner,
            ctx.accounts.searcher.key(),
            TvvError::WrongSearcherState
        );
        require!(ctx.accounts.searcher_state.enabled, TvvError::SearcherDisabled);
        require!(
            ctx.accounts.searcher_state.open_runs < cfg.max_open_per_searcher,
            TvvError::TooManyOpenRuns
        );

        let cap_units = (ctx.accounts.searcher_state.cap_bps as u128
            * ctx.accounts.reserve_vault.amount as u128
            / NAV_BPS_DENOM as u128) as u64;
        let allowed = cap_units.min(cfg.max_run_cap);
        require!(amount <= allowed, TvvError::CapExceeded);
        require!(amount <= ctx.accounts.reserve_vault.amount, TvvError::InsufficientReserve);

        let margin = &mut ctx.accounts.margin;
        require!(!margin.projected_margin_breached(amount), TvvError::MarginBreach);
        margin.flag = false;

        let initial_balance = ctx.accounts.reserve_vault.amount;
        let slot = ctx.accounts.clock.slot;

        let seeds: &[&[&[u8]]] = &[&[GATE_SEED, &[cfg.bump]]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.reserve_vault.to_account_info(),
                    to: ctx.accounts.searcher_vault.to_account_info(),
                    authority: ctx.accounts.config.to_account_info(),
                },
                seeds,
            ),
            amount,
        )?;

        let run = &mut ctx.accounts.run;
        run.searcher = ctx.accounts.searcher.key();
        run.asset_mint = ctx.accounts.asset_mint.key();
        run.reserve_vault = ctx.accounts.reserve_vault.key();
        run.searcher_vault = ctx.accounts.searcher_vault.key();
        run.initial_pool_balance = initial_balance;
        run.principal = amount;
        run.opened_slot = slot;
        run.ttl_slots = cfg.open_ttl_slots;
        run.seq = cfg.run_seq;
        run.status = RUN_OPEN;
        run.credited_yield = 0;
        run.settled_slot = 0;
        let (_pk, run_bump) = Pubkey::find_program_address(
            &[
                RUN_SEED,
                run.searcher.as_ref(),
                run.asset_mint.as_ref(),
                &run.seq.to_le_bytes(),
            ],
            ctx.program_id,
        );
        run.bump = run_bump;

        let seq = ctx.accounts.config.run_seq;
        ctx.accounts.searcher_state.open_runs += 1;
        ctx.accounts.config.run_seq = seq + 1;

        let risk = &mut ctx.accounts.risk;
        risk.committed_total = risk.committed_total.saturating_add(amount);
        risk.committed_by_asset[asset_idx] = risk.committed_by_asset[asset_idx].saturating_add(amount);

        let margin = &mut ctx.accounts.margin;
        margin.gross_exposure = margin.gross_exposure.saturating_add(amount);
        margin.flag = margin.margin_breached();
        Ok(())
    }

    pub fn settle_run(ctx: Context<SettleRun>) -> Result<()> {
        let cfg = &mut ctx.accounts.config;
        require!(!cfg.paused, TvvError::Paused);
        let run = &mut ctx.accounts.run;
        require!(run.status == RUN_OPEN, TvvError::RunNotOpen);
        require_keys_eq!(run.searcher, ctx.accounts.searcher.key(), TvvError::Unauthorized);

        let slot = ctx.accounts.clock.slot;
        require!(
            slot.saturating_sub(run.opened_slot) <= run.ttl_slots,
            TvvError::TtlExpired
        );

        let return_amount = ctx.accounts.searcher_vault.amount;
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.searcher_vault.to_account_info(),
                    to: ctx.accounts.reserve_vault.to_account_info(),
                    authority: ctx.accounts.searcher.to_account_info(),
                },
            ),
            return_amount,
        )?;

        let reserve_info = ctx.accounts.reserve_vault.to_account_info();
        let final_balance = {
            let data = reserve_info.try_borrow_data()?;
            u64::from_le_bytes(data[64..72].try_into().unwrap())
        };
        require!(
            final_balance >= run.initial_pool_balance,
            TvvError::InvariantViolated
        );

        let realized = final_balance - run.initial_pool_balance;
        let dif_amount = realized as u128 * DIF_BPS as u128 / NAV_BPS_DENOM as u128;
        let realized_net = (realized as u128).saturating_sub(dif_amount);
        run.status = RUN_SETTLED;
        run.credited_yield = realized_net as u64;
        run.settled_slot = slot;

        ctx.accounts.searcher_state.open_runs -= 1;
        let asset_idx = cfg
            .asset_index(&run.asset_mint)
            .ok_or(TvvError::AssetNotWhitelisted)?;
        let risk = &mut ctx.accounts.risk;
        require!(risk.gateway == *ctx.program_id, TvvError::WrongGateway);
        risk.committed_total = risk.committed_total.saturating_sub(run.principal);
        risk.committed_by_asset[asset_idx] = risk.committed_by_asset[asset_idx].saturating_sub(run.principal);

        let margin = &mut ctx.accounts.margin;
        margin.gross_exposure = margin.gross_exposure.saturating_sub(run.principal);
        margin.flag = margin.margin_breached();

        cfg.realized_yield = cfg.realized_yield.saturating_add(realized_net);
        cfg.dif_ledger = cfg.dif_ledger.saturating_add(dif_amount);
        cfg.run_count += 1;
        Ok(())
    }

    pub fn sweep_profits(ctx: Context<Sweep>, amount: u64) -> Result<()> {
        require!(amount > 0, TvvError::ZeroAmount);
        {
            let cfg = &ctx.accounts.config;
            require!(!cfg.paused, TvvError::Paused);
            require!(
                ctx.accounts.signer.key() == cfg.authority
                    || ctx.accounts.signer.key() == cfg.sweeper,
                TvvError::Unauthorized
            );
            require!(
                cfg.realized_yield.saturating_sub(cfg.swept_yield) >= amount as u128,
                TvvError::InsufficientYield
            );
            require!(ctx.accounts.reserve_vault.owner == cfg.key(), TvvError::WrongReserveOwner);
        }

        let config_bump = ctx.accounts.config.bump;
        let config_info = ctx.accounts.config.to_account_info();
        let seeds: &[&[&[u8]]] = &[&[GATE_SEED, &[config_bump]]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.reserve_vault.to_account_info(),
                    to: ctx.accounts.to_vault.to_account_info(),
                    authority: config_info,
                },
                seeds,
            ),
            amount,
        )?;

        let cfg = &mut ctx.accounts.config;
        cfg.swept_yield = cfg.swept_yield.saturating_add(amount as u128);
        Ok(())
    }

    pub fn set_sweeper<'info>(ctx: Context<'_, '_, '_, 'info, ManageConfig<'info>>, new_sweeper: Pubkey) -> Result<()> {
        let cfg = &mut ctx.accounts.config;
        require_keys_eq!(cfg.authority, ctx.accounts.authority.key(), TvvError::Unauthorized);
        cfg.sweeper = new_sweeper;
        Ok(())
    }

    pub fn set_risk_config(
        ctx: Context<ManageRisk>,
        emergency_halt: Option<bool>,
        max_exposure: Option<u64>,
        max_asset_share_bps: Option<u16>,
        jlf_top_up: Option<u64>,
    ) -> Result<()> {
        let cfg = &ctx.accounts.config;
        require_keys_eq!(cfg.authority, ctx.accounts.authority.key(), TvvError::Unauthorized);
        if let Some(v) = max_asset_share_bps {
            require!(v <= NAV_BPS_DENOM as u16, TvvError::InvalidBps);
        }
        let risk = &mut ctx.accounts.risk;
        if let Some(v) = emergency_halt {
            risk.emergency_halt = v;
        }
        if let Some(v) = max_exposure {
            risk.max_exposure = v;
        }
        if let Some(v) = max_asset_share_bps {
            risk.max_asset_share_bps = v;
        }
        if let Some(v) = jlf_top_up {
            risk.jlf_capital = risk.jlf_capital.saturating_add(v);
        }
        risk.halted = jlf_breached(&risk.jlf_losses, &risk.jlf_capital);
        Ok(())
    }

    pub fn collect_dif(ctx: Context<CollectDif>, amount: u64) -> Result<()> {
        require!(amount > 0, TvvError::ZeroAmount);
        let cfg = &ctx.accounts.config;
        require_keys_eq!(cfg.authority, ctx.accounts.authority.key(), TvvError::Unauthorized);
        require!(amount as u128 <= cfg.dif_ledger, TvvError::InsufficientDif);

        let seeds: &[&[&[u8]]] = &[&[GATE_SEED, &[cfg.bump]]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.reserve_vault.to_account_info(),
                    to: ctx.accounts.dif_vault.to_account_info(),
                    authority: ctx.accounts.config.to_account_info(),
                },
                seeds,
            ),
            amount,
        )?;

        let cfg = &mut ctx.accounts.config;
        cfg.dif_ledger -= amount as u128;
        Ok(())
    }

    pub fn force_close(ctx: Context<ForceClose>) -> Result<()> {
        let cfg = &ctx.accounts.config;
        require_keys_eq!(cfg.authority, ctx.accounts.authority.key(), TvvError::Unauthorized);
        let run = &mut ctx.accounts.run;
        require!(run.status == RUN_OPEN, TvvError::RunNotOpen);
        run.status = RUN_TIMEOUT;
        run.settled_slot = ctx.accounts.clock.slot;
        ctx.accounts.searcher_state.open_runs -= 1;
        ctx.accounts.config.timeout_count += 1;

        let asset_idx = ctx
            .accounts
            .config
            .asset_index(&run.asset_mint)
            .ok_or(TvvError::AssetNotWhitelisted)?;
        let risk = &mut ctx.accounts.risk;
        require!(risk.gateway == *ctx.program_id, TvvError::WrongGateway);
        risk.jlf_losses = risk.jlf_losses.saturating_add(run.principal);
        risk.committed_total = risk.committed_total.saturating_sub(run.principal);
        risk.committed_by_asset[asset_idx] = risk.committed_by_asset[asset_idx].saturating_sub(run.principal);
        risk.halted = jlf_breached(&risk.jlf_losses, &risk.jlf_capital);

        let margin = &mut ctx.accounts.margin;
        margin.gross_exposure = margin.gross_exposure.saturating_sub(run.principal);
        margin.flag = margin.margin_breached();
        Ok(())
    }
}

impl GateConfig {
    pub fn is_asset(&self, mint: &Pubkey) -> bool {
        self.asset_index(mint).is_some()
    }

    pub fn asset_index(&self, mint: &Pubkey) -> Option<usize> {
        for i in 0..self.reserve_count as usize {
            if &self.assets[i] == mint {
                return Some(i);
            }
        }
        None
    }
}

#[account]
pub struct GateConfig {
    pub authority: Pubkey,
    pub paused: bool,
    pub mev_tip_pct_bps: u16,
    pub open_ttl_slots: u64,
    pub max_run_cap: u64,
    pub max_open_per_searcher: u8,
    pub run_seq: u64,
    pub run_count: u64,
    pub realized_yield: u128,
    pub timeout_count: u64,
    pub reserve_count: u8,
    pub assets: [Pubkey; MAX_ASSETS],
    pub bump: u8,
    pub sweeper: Pubkey,
    pub swept_yield: u128,
    pub dif_ledger: u128,
    pub lender_pool: Pubkey,
}

impl GateConfig {
    pub const SPACE: usize =
        8 + 32 + 1 + 2 + 8 + 8 + 1 + 8 + 8 + 16 + 8 + 1 + 32 * MAX_ASSETS + 1 + 32 + 16 + 16
        + 32;
}

#[account]
pub struct RiskState {
    pub gate: Pubkey,
    pub gateway: Pubkey,
    pub emergency_halt: bool,
    pub jlf_capital: u64,
    pub jlf_losses: u64,
    pub halted: bool,
    pub max_exposure: u64,
    pub max_asset_share_bps: u16,
    pub committed_total: u64,
    pub committed_by_asset: [u64; MAX_ASSETS],
    pub bump: u8,
}

impl RiskState {
    pub const SPACE: usize = 8 + 32 + 32 + 1 + 8 + 8 + 1 + 8 + 2 + 8 + 8 * MAX_ASSETS + 1;
}

#[account]
pub struct SearcherState {
    pub owner: Pubkey,
    pub enabled: bool,
    pub cap_bps: u16,
    pub open_runs: u8,
    pub bump: u8,
}

impl SearcherState {
    pub const SPACE: usize = 8 + 32 + 1 + 2 + 1 + 1;
}

#[account]
pub struct MarginState {
    pub searcher: Pubkey,
    pub gate: Pubkey,
    pub collateral: u64,
    pub gross_exposure: u64,
    pub hedged_exposure: u64,
    pub maintenance_bps: u16,
    pub flag: bool,
    pub bump: u8,
}

impl MarginState {
    pub const SPACE: usize = 8 + 32 + 32 + 8 + 8 + 8 + 2 + 1 + 1;

    pub fn net_exposure(&self) -> u64 {
        self.gross_exposure.saturating_sub(self.hedged_exposure)
    }

    pub fn margin_breached(&self) -> bool {
        (self.net_exposure() as u128 * self.maintenance_bps as u128)
            > (self.collateral as u128 * NAV_BPS_DENOM as u128)
    }

    pub fn projected_net_exposure(&self, amount: u64) -> u64 {
        self.gross_exposure
            .saturating_add(amount)
            .saturating_sub(self.hedged_exposure)
    }

    pub fn projected_margin_breached(&self, amount: u64) -> bool {
        (self.projected_net_exposure(amount) as u128 * self.maintenance_bps as u128)
            > (self.collateral as u128 * NAV_BPS_DENOM as u128)
    }

    pub fn covers_margin(&self, after_withdraw: u64) -> bool {
        (after_withdraw as u128 * NAV_BPS_DENOM as u128)
            >= (self.net_exposure() as u128 * self.maintenance_bps as u128)
    }
}

#[account]
pub struct Run {
    pub searcher: Pubkey,
    pub asset_mint: Pubkey,
    pub reserve_vault: Pubkey,
    pub searcher_vault: Pubkey,
    pub initial_pool_balance: u64,
    pub principal: u64,
    pub opened_slot: u64,
    pub ttl_slots: u64,
    pub seq: u64,
    pub status: u8,
    pub credited_yield: u64,
    pub settled_slot: u64,
    pub bump: u8,
}

impl Run {
    pub const SPACE: usize = 8 + 32 * 4 + 8 * 5 + 1 + 8 + 8 + 1;
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = GateConfig::SPACE,
        seeds = [GATE_SEED],
        bump
    )]
    pub config: Account<'info, GateConfig>,
    #[account(
        init,
        payer = authority,
        space = RiskState::SPACE,
        seeds = [RISK_SEED, config.key().as_ref()],
        bump
    )]
    pub risk: Account<'info, RiskState>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ManageConfig<'info> {
    #[account(mut, seeds = [GATE_SEED], bump = config.bump)]
    pub config: Account<'info, GateConfig>,
    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ManageRisk<'info> {
    #[account(seeds = [GATE_SEED], bump = config.bump)]
    pub config: Account<'info, GateConfig>,
    #[account(
        mut,
        seeds = [RISK_SEED, config.key().as_ref()],
        bump = risk.bump,
        constraint = risk.gate == config.key() @ TvvError::WrongReserveOwner
    )]
    pub risk: Account<'info, RiskState>,
    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct CollectDif<'info> {
    #[account(
        mut,
        seeds = [GATE_SEED],
        bump = config.bump,
        constraint = reserve_vault.owner == config.key() @ TvvError::WrongReserveOwner
    )]
    pub config: Account<'info, GateConfig>,
    #[account(mut, token::mint = asset_mint)]
    pub reserve_vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = asset_mint,
        constraint = dif_vault.owner == dif_treasury.key()
    )]
    pub dif_vault: Account<'info, TokenAccount>,
    /// CHECK: DIF treasury PDA; validated as the owner of dif_vault via constraint.
    #[account(seeds = [DIF_SEED, config.key().as_ref()], bump)]
    pub dif_treasury: UncheckedAccount<'info>,
    pub asset_mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ManageAuthority<'info> {
    #[account(mut, seeds = [GATE_SEED], bump = config.bump)]
    pub config: Account<'info, GateConfig>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub new_authority: SystemAccount<'info>,
}

#[derive(Accounts)]
pub struct ManageLender<'info> {
    #[account(mut, seeds = [GATE_SEED], bump = config.bump)]
    pub config: Account<'info, GateConfig>,
    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct RepaySupply<'info> {
    #[account(mut, seeds = [GATE_SEED], bump = config.bump)]
    pub config: Account<'info, GateConfig>,
    #[account(mut, token::mint = asset_mint)]
    pub reserve_vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = asset_mint)]
    pub to_vault: Account<'info, TokenAccount>,
    pub asset_mint: Box<Account<'info, Mint>>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct WithdrawReserve<'info> {
    #[account(
        mut,
        seeds = [GATE_SEED],
        bump = config.bump,
        constraint = reserve_vault.owner == config.key() @ TvvError::WrongReserveOwner
    )]
    pub config: Account<'info, GateConfig>,
    #[account(mut, token::mint = asset_mint)]
    pub reserve_vault: Account<'info, TokenAccount>,
    pub asset_mint: Box<Account<'info, Mint>>,
    #[account(mut, token::mint = asset_mint, constraint = to_vault.owner == authority.key())]
    pub to_vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct InitSearcher<'info> {
    #[account(mut, seeds = [GATE_SEED], bump = config.bump)]
    pub config: Account<'info, GateConfig>,
    #[account(
        init,
        payer = authority,
        space = SearcherState::SPACE,
        seeds = [SEARCHER_SEED, searcher.key().as_ref()],
        bump
    )]
    pub searcher_state: Account<'info, SearcherState>,
    #[account(
        init,
        payer = authority,
        space = MarginState::SPACE,
        seeds = [MARGIN_SEED, searcher.key().as_ref()],
        bump
    )]
    pub margin: Account<'info, MarginState>,
    /// CHECK: whitelisted searcher operator; validated against searcher_state.owner at runtime.
    pub searcher: UncheckedAccount<'info>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateSearcher<'info> {
    #[account(mut, seeds = [GATE_SEED], bump = config.bump)]
    pub config: Account<'info, GateConfig>,
    #[account(
        mut,
        seeds = [SEARCHER_SEED, searcher.key().as_ref()],
        bump = searcher_state.bump
    )]
    pub searcher_state: Account<'info, SearcherState>,
    /// CHECK: must match the owner recorded in searcher_state.
    pub searcher: UncheckedAccount<'info>,
    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct PostMargin<'info> {
    #[account(seeds = [GATE_SEED], bump = config.bump)]
    pub config: Account<'info, GateConfig>,
    #[account(
        mut,
        seeds = [MARGIN_SEED, searcher.key().as_ref()],
        bump = margin.bump,
        constraint = margin.gate == config.key() @ TvvError::WrongReserveOwner
    )]
    pub margin: Account<'info, MarginState>,
    #[account(mut)]
    pub searcher: Signer<'info>,
    #[account(
        mut,
        token::mint = asset_mint,
        constraint = searcher_margin_vault.owner == searcher.key()
    )]
    pub searcher_margin_vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = asset_mint,
        constraint = margin_escrow.owner == margin.key()
    )]
    pub margin_escrow: Account<'info, TokenAccount>,
    pub asset_mint: Box<Account<'info, Mint>>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct WithdrawMargin<'info> {
    #[account(seeds = [GATE_SEED], bump = config.bump)]
    pub config: Account<'info, GateConfig>,
    #[account(
        mut,
        seeds = [MARGIN_SEED, searcher.key().as_ref()],
        bump = margin.bump,
        constraint = margin.gate == config.key() @ TvvError::WrongReserveOwner
    )]
    pub margin: Account<'info, MarginState>,
    #[account(mut)]
    pub searcher: Signer<'info>,
    #[account(
        mut,
        token::mint = asset_mint,
        constraint = margin_escrow.owner == margin.key()
    )]
    pub margin_escrow: Account<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = asset_mint,
        constraint = searcher_margin_vault.owner == searcher.key()
    )]
    pub searcher_margin_vault: Account<'info, TokenAccount>,
    pub asset_mint: Box<Account<'info, Mint>>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct SetHedge<'info> {
    #[account(seeds = [GATE_SEED], bump = config.bump)]
    pub config: Account<'info, GateConfig>,
    #[account(
        mut,
        seeds = [MARGIN_SEED, searcher.key().as_ref()],
        bump = margin.bump,
        constraint = margin.gate == config.key() @ TvvError::WrongReserveOwner
    )]
    pub margin: Account<'info, MarginState>,
    #[account(mut)]
    pub searcher: Signer<'info>,
}

#[derive(Accounts)]
pub struct DepositReserve<'info> {
    #[account(
        mut,
        seeds = [GATE_SEED],
        bump = config.bump,
        constraint = reserve_vault.owner == config.key() @ TvvError::WrongReserveOwner
    )]
    pub config: Account<'info, GateConfig>,
    #[account(mut, token::mint = asset_mint)]
    pub reserve_vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = asset_mint, constraint = from.owner == from_authority.key())]
    pub from: Account<'info, TokenAccount>,
    #[account(mut)]
    pub from_authority: Signer<'info>,
    pub asset_mint: Box<Account<'info, Mint>>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct PullCap<'info> {
    #[account(mut, seeds = [GATE_SEED], bump = config.bump)]
    pub config: Box<Account<'info, GateConfig>>,
    #[account(
        mut,
        seeds = [SEARCHER_SEED, searcher.key().as_ref()],
        bump = searcher_state.bump,
        constraint = searcher_state.owner == searcher.key() @ TvvError::WrongSearcherState
    )]
    pub searcher_state: Account<'info, SearcherState>,
    #[account(mut)]
    pub searcher: Signer<'info>,
    #[account(
        mut,
        seeds = [MARGIN_SEED, searcher.key().as_ref()],
        bump = margin.bump,
        constraint = margin.gate == config.key() @ TvvError::WrongReserveOwner
    )]
    pub margin: Account<'info, MarginState>,
    #[account(
        mut,
        token::mint = asset_mint,
        constraint = reserve_vault.owner == config.key() @ TvvError::WrongReserveOwner
    )]
    pub reserve_vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = asset_mint,
        constraint = searcher_vault.owner == searcher.key()
    )]
    pub searcher_vault: Account<'info, TokenAccount>,
    pub asset_mint: Box<Account<'info, Mint>>,
    #[account(
        init,
        payer = searcher,
        space = Run::SPACE,
        seeds = [RUN_SEED, searcher.key().as_ref(), asset_mint.key().as_ref(), &config.run_seq.to_le_bytes()],
        bump
    )]
    pub run: Box<Account<'info, Run>>,
    #[account(
        mut,
        seeds = [RISK_SEED, config.key().as_ref()],
        bump = risk.bump,
        constraint = risk.gate == config.key() @ TvvError::WrongReserveOwner
    )]
    pub risk: Account<'info, RiskState>,
    pub token_program: Program<'info, Token>,
    pub clock: Sysvar<'info, Clock>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SettleRun<'info> {
    #[account(mut, seeds = [GATE_SEED], bump = config.bump)]
    pub config: Box<Account<'info, GateConfig>>,
    #[account(
        mut,
        seeds = [RUN_SEED, run.searcher.as_ref(), run.asset_mint.as_ref(), &run.seq.to_le_bytes()],
        bump = run.bump
    )]
    pub run: Box<Account<'info, Run>>,
    #[account(mut)]
    pub searcher: Signer<'info>,
    #[account(
        mut,
        token::mint = asset_mint,
        constraint = reserve_vault.key() == run.reserve_vault
    )]
    pub reserve_vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = asset_mint,
        constraint = searcher_vault.key() == run.searcher_vault
    )]
    pub searcher_vault: Account<'info, TokenAccount>,
    pub asset_mint: Box<Account<'info, Mint>>,
    #[account(
        mut,
        seeds = [SEARCHER_SEED, run.searcher.as_ref()],
        bump = searcher_state.bump
    )]
    pub searcher_state: Account<'info, SearcherState>,
    #[account(
        mut,
        seeds = [MARGIN_SEED, run.searcher.as_ref()],
        bump = margin.bump,
        constraint = margin.gate == config.key() @ TvvError::WrongReserveOwner
    )]
    pub margin: Account<'info, MarginState>,
    #[account(
        mut,
        seeds = [RISK_SEED, config.key().as_ref()],
        bump = risk.bump,
        constraint = risk.gate == config.key() @ TvvError::WrongReserveOwner
    )]
    pub risk: Box<Account<'info, RiskState>>,
    pub token_program: Program<'info, Token>,
    pub clock: Sysvar<'info, Clock>,
}

#[derive(Accounts)]
pub struct Sweep<'info> {
    #[account(
        mut,
        seeds = [GATE_SEED],
        bump = config.bump,
        constraint = reserve_vault.owner == config.key() @ TvvError::WrongReserveOwner
    )]
    pub config: Account<'info, GateConfig>,
    #[account(mut, token::mint = asset_mint)]
    pub reserve_vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = asset_mint)]
    pub to_vault: Account<'info, TokenAccount>,
    pub asset_mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub signer: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ForceClose<'info> {
    #[account(mut, seeds = [GATE_SEED], bump = config.bump)]
    pub config: Account<'info, GateConfig>,
    #[account(
        mut,
        seeds = [RUN_SEED, run.searcher.as_ref(), run.asset_mint.as_ref(), &run.seq.to_le_bytes()],
        bump = run.bump
    )]
    pub run: Box<Account<'info, Run>>,
    #[account(
        mut,
        seeds = [SEARCHER_SEED, run.searcher.as_ref()],
        bump = searcher_state.bump
    )]
    pub searcher_state: Account<'info, SearcherState>,
    #[account(
        mut,
        seeds = [MARGIN_SEED, run.searcher.as_ref()],
        bump = margin.bump,
        constraint = margin.gate == config.key() @ TvvError::WrongReserveOwner
    )]
    pub margin: Account<'info, MarginState>,
    #[account(
        mut,
        seeds = [RISK_SEED, config.key().as_ref()],
        bump = risk.bump,
        constraint = risk.gate == config.key() @ TvvError::WrongReserveOwner
    )]
    pub risk: Account<'info, RiskState>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub clock: Sysvar<'info, Clock>,
}

#[error_code]
pub enum TvvError {
    #[msg("authority only")]
    Unauthorized,
    #[msg("gate paused")]
    Paused,
    #[msg("searcher not whitelisted")]
    SearcherDisabled,
    #[msg("searcher state does not match signer")]
    WrongSearcherState,
    #[msg("too many open runs for searcher")]
    TooManyOpenRuns,
    #[msg("asset not in whitelist")]
    AssetNotWhitelisted,
    #[msg("amount exceeds per-run cap")]
    CapExceeded,
    #[msg("insufficient reserve balance")]
    InsufficientReserve,
    #[msg("post-swap invariant violated: final vault balance < initial")]
    InvariantViolated,
    #[msg("run is not open")]
    RunNotOpen,
    #[msg("run TTL expired, force_close required")]
    TtlExpired,
    #[msg("bps exceeds denominator")]
    InvalidBps,
    #[msg("too many whitelisted assets")]
    MaxAssets,
    #[msg("amount must be nonzero")]
    ZeroAmount,
    #[msg("reserve vault owner mismatch")]
    WrongReserveOwner,
    #[msg("sweep exceeds un-swept realized yield")]
    InsufficientYield,
    #[msg("emergency halt active")]
    EmergencyHalt,
    #[msg("risk breaker tripped: JLF drawdown exceeds half of JLF capital")]
    RiskBreach,
    #[msg("aggregate committed exposure exceeds max_exposure")]
    ExposureExceeded,
    #[msg("asset committed share exceeds max_asset_share_bps")]
    AssetShareExceeded,
    #[msg("dif ledger cannot cover requested amount")]
    InsufficientDif,
    #[msg("hedged exposure exceeds gross exposure")]
    HedgeExceedsExposure,
    #[msg("margin insufficient for projected net exposure")]
    MarginBreach,
    #[msg("withdrawal exceeds posted collateral")]
    InsufficientCollateral,
    #[msg("risk registry gateway does not match executing program")]
    WrongGateway,
    #[msg("supply recall target is not the registered lender pool")]
    UnknownLender,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg_with_assets(assets: Vec<Pubkey>) -> GateConfig {
        let mut cfg = GateConfig {
            authority: Pubkey::default(),
            paused: false,
            mev_tip_pct_bps: 6000,
            open_ttl_slots: 1000,
            max_run_cap: 1_000_000,
            max_open_per_searcher: 3,
            run_seq: 0,
            run_count: 0,
            realized_yield: 0,
            timeout_count: 0,
            reserve_count: 0,
            assets: [Pubkey::default(); MAX_ASSETS],
            bump: 255,
            sweeper: Pubkey::default(),
            swept_yield: 0,
            dif_ledger: 0,
            lender_pool: Pubkey::default(),
        };
        for (i, a) in assets.iter().enumerate() {
            cfg.assets[i] = *a;
            cfg.reserve_count = (i + 1) as u8;
        }
        cfg
    }

    #[test]
    fn is_asset_accepts_whitelisted_only() {
        let a = Pubkey::new_unique();
        let b = Pubkey::new_unique();
        let cfg = cfg_with_assets(vec![a]);
        assert!(cfg.is_asset(&a));
        assert!(!cfg.is_asset(&b));
    }

    #[test]
    fn cap_bounds_are_bps_of_reserve() {
        let cap_bps: u16 = 2000;
        let reserve: u64 = 1_500_000_000;
        let cap_units = cap_bps as u128 * reserve as u128 / NAV_BPS_DENOM as u128;
        assert_eq!(cap_units, 300_000_000);
    }

    #[test]
    fn invariant_arithmetic_credits_positive_spread() {
        let initial: u64 = 10_000_000;
        let final_balance: u64 = 10_150_000;
        assert!(final_balance >= initial);
        let realized = final_balance - initial;
        assert_eq!(realized, 150_000);
    }

    #[test]
    fn settle_splits_twenty_percent_to_dif() {
        let realized: u64 = 100_000_000;
        let dif_amount = realized as u128 * DIF_BPS as u128 / NAV_BPS_DENOM as u128;
        assert_eq!(dif_amount, 20_000_000);
        let realized_net = (realized as u128).saturating_sub(dif_amount);
        assert_eq!(realized_net, 80_000_000);
    }

    #[test]
    fn breaker_trips_at_fifty_percent_jlf_drawdown() {
        let jlf_capital: u64 = 800_000_000;
        let losses = 100_000_000u64;
        assert!(!jlf_breached(&losses, &jlf_capital));
        let losses = 500_000_000u64;
        assert!(jlf_breached(&losses, &jlf_capital));
    }

    fn margin_with(collateral: u64, gross: u64, hedge: u64, maintenance: u16) -> MarginState {
        MarginState {
            searcher: Pubkey::default(),
            gate: Pubkey::default(),
            collateral,
            gross_exposure: gross,
            hedged_exposure: hedge,
            maintenance_bps: maintenance,
            flag: false,
            bump: 255,
        }
    }

    #[test]
    fn netting_subtracts_hedged_from_gross() {
        let m = margin_with(1_000_000_000, 100_000_000, 60_000_000, 200);
        assert_eq!(m.net_exposure(), 40_000_000);
    }

    #[test]
    fn projected_breach_uses_net_after_pull() {
        let m = margin_with(2_000_000, 100_000_000, 0, 200);
        assert!(!m.projected_margin_breached(0));
        assert!(m.projected_margin_breached(50_000_000));
        let hedged = margin_with(3_000_000, 100_000_000, 100_000_000, 200);
        assert!(!hedged.projected_margin_breached(150_000_000));
    }

    #[test]
    fn maintenance_math_pins_exact_boundary() {
        let collateral: u64 = 2_000_000;
        let gross: u64 = 100_000_000;
        let maintenance: u16 = 200;
        let m = margin_with(collateral, gross, 0, maintenance);
        assert!(!m.margin_breached());
        assert!(m.covers_margin(collateral));
        assert!(!m.covers_margin(1_000_000));
    }
}