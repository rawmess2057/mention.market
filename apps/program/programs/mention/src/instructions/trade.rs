//! Binary (LMSR) trading: buy/sell YES/NO shares against the AMM.
//!
//! Buy moves `cost` base units into the vault and mints `shares` via the LMSR
//! pricing function; sell burns `shares` and pays `sell_return` out of the
//! vault. Both paths support USDC markets (vault ATA) and SOL markets (vault
//! lamports). Slippage is bounded by `min_shares` / `min_proceeds`.

use anchor_lang::prelude::*;
use anchor_spl::{associated_token::AssociatedToken, token::Token};

use crate::error::ErrorCode;
use crate::math::lmsr::{cost_units, sell_return, shares_for_cost};
use crate::state::{AssetKind, Market, MarketStatus, MarketType, Position, Vault};

const SIDE_YES: u8 = 0;

#[derive(Accounts)]
pub struct BuyBinary<'info> {
    #[account(mut)]
    pub trader: Signer<'info>,

    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, crate::state::Config>>,

    #[account(
        mut,
        seeds = [b"market", market.id.to_le_bytes().as_ref()],
        bump = market.bump
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        mut,
        seeds = [b"vault", market.key().as_ref()],
        bump = vault.bump
    )]
    pub vault: Box<Account<'info, Vault>>,

    #[account(
        init_if_needed,
        payer = trader,
        space = 8 + Position::INIT_SPACE,
        seeds = [b"position", market.key().as_ref(), trader.key().as_ref()],
        bump
    )]
    pub position: Box<Account<'info, Position>>,

    /// CHECK: Trader's USDC ATA (source of buy funds); presence checked per
    /// asset type and validated by the transfer CPI.
    #[account(mut)]
    pub trader_ata: Option<UncheckedAccount<'info>>,
    /// CHECK: Vault USDC ATA; created idempotently and validated by the
    /// transfer CPI when the market is USDC-denominated.
    #[account(mut)]
    pub vault_ata: Option<UncheckedAccount<'info>>,
    /// CHECK: USDC mint, constrained to `config.usdc_mint`; used only for vault
    /// ATA creation on USDC markets.
    #[account(constraint = mint.key() == config.usdc_mint)]
    pub mint: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SellBinary<'info> {
    #[account(mut)]
    pub trader: Signer<'info>,

    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, crate::state::Config>>,

    #[account(
        mut,
        seeds = [b"market", market.id.to_le_bytes().as_ref()],
        bump = market.bump
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        mut,
        seeds = [b"vault", market.key().as_ref()],
        bump = vault.bump
    )]
    pub vault: Box<Account<'info, Vault>>,

    #[account(
        mut,
        seeds = [b"position", market.key().as_ref(), trader.key().as_ref()],
        bump
    )]
    pub position: Box<Account<'info, Position>>,

    /// CHECK: Trader's USDC ATA (destination of sell proceeds); presence checked
    /// per asset type and validated by the transfer CPI.
    #[account(mut)]
    pub trader_ata: Option<UncheckedAccount<'info>>,
    /// Vault USDC ATA. USDC markets only.
    #[account(mut)]
    pub vault_ata: Option<UncheckedAccount<'info>>,
    /// CHECK: USDC mint, constrained to `config.usdc_mint`; used only for vault
    /// ATA creation on USDC markets.
    #[account(constraint = mint.key() == config.usdc_mint)]
    pub mint: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Buy `cost` base units of `side` (0 = YES, 1 = NO), guaranteed at least
/// `min_shares` shares (slippage floor).
#[allow(clippy::too_many_arguments)]
pub fn buy(
    ctx: Context<BuyBinary>,
    side: u8,
    cost: u64,
    min_shares: u64,
) -> Result<()> {
    require!(!ctx.accounts.config.paused, ErrorCode::Paused);
    let market_key = ctx.accounts.market.key();
    let market = &mut ctx.accounts.market;
    require!(market.status == MarketStatus::Open, ErrorCode::MarketNotOpen);
    require!(market.market_type == MarketType::Binary, ErrorCode::NotBinary);
    require!(cost > 0, ErrorCode::InvalidMarket);

    // Move funds in before any state change.
    match market.asset {
        AssetKind::Usdc => {
            let trader_ata = ctx.accounts.trader_ata.as_ref().ok_or(ErrorCode::InsufficientAmount)?;
            let vault_ata = ctx
                .accounts
                .vault_ata
                .as_ref()
                .ok_or(ErrorCode::InsufficientAmount)?;
            crate::instructions::token_util::ensure_vault_ata(
                &ctx.accounts.trader.to_account_info(),
                &ctx.accounts.vault.to_account_info(),
                &ctx.accounts.mint.to_account_info(),
                vault_ata,
                &ctx.accounts.associated_token_program.to_account_info(),
                &ctx.accounts.token_program.to_account_info(),
                &ctx.accounts.system_program.to_account_info(),
            )?;
            crate::instructions::token_util::deposit_usdc(
                &ctx.accounts.token_program.to_account_info(),
                trader_ata,
                vault_ata,
                &ctx.accounts.trader.to_account_info(),
                cost,
            )?;
        }
        AssetKind::Sol => {
            crate::instructions::token_util::deposit_sol(
                &ctx.accounts.system_program.to_account_info(),
                &ctx.accounts.trader.to_account_info(),
                &ctx.accounts.vault.to_account_info(),
                cost,
            )?;
        }
    }

    let q_y = market.yes_shares as f64;
    let q_n = market.no_shares as f64;
    let b = market.b as f64;

    let shares = shares_for_cost(q_y, q_n, b, side, cost as f64).floor() as u64;
    require!(shares > 0 && shares >= min_shares, ErrorCode::SlippageTooHigh);

    if side == SIDE_YES {
        market.yes_shares += shares;
        market.yes_cost += cost;
    } else {
        market.no_shares += shares;
        market.no_cost += cost;
    }
    market.volume += cost;
    market.traders += 1;

    let position = &mut ctx.accounts.position;
    position.market = market_key;
    position.owner = ctx.accounts.trader.key();
    if side == SIDE_YES {
        position.yes_shares += shares;
        position.yes_cost += cost;
    } else {
        position.no_shares += shares;
        position.no_cost += cost;
    }

    Ok(())
}

/// Sell `shares` of `side` back to the AMM, collecting at least `min_proceeds`
/// base units (slippage floor).
pub fn sell(
    ctx: Context<SellBinary>,
    side: u8,
    shares: u64,
    min_proceeds: u64,
) -> Result<()> {
    require!(!ctx.accounts.config.paused, ErrorCode::Paused);
    let market_key = ctx.accounts.market.key();
    let vault_bump = ctx.accounts.vault.bump;
    let market = &mut ctx.accounts.market;
    require!(market.status == MarketStatus::Open, ErrorCode::MarketNotOpen);
    require!(market.market_type == MarketType::Binary, ErrorCode::NotBinary);
    require!(shares > 0, ErrorCode::InvalidMarket);

    // Verify the trader actually holds these shares.
    let held = if side == SIDE_YES {
        ctx.accounts.position.yes_shares
    } else {
        ctx.accounts.position.no_shares
    };
    require!(held >= shares, ErrorCode::InsufficientAmount);

    let q_y = market.yes_shares as f64;
    let q_n = market.no_shares as f64;
    let b = market.b as f64;
    let proceeds = sell_return(q_y, q_n, b, side, shares as f64).floor() as u64;
    require!(proceeds >= min_proceeds, ErrorCode::SlippageTooHigh);
    require!(proceeds > 0, ErrorCode::InsufficientAmount);

    // Move funds out first so the vault stays the only shortfall risk.
    match market.asset {
        AssetKind::Usdc => {
            let trader_ata = ctx.accounts.trader_ata.as_ref().ok_or(ErrorCode::InsufficientAmount)?;
            let vault_ata = ctx
                .accounts
                .vault_ata
                .as_ref()
                .ok_or(ErrorCode::InsufficientAmount)?;
            crate::instructions::token_util::ensure_vault_ata(
                &ctx.accounts.trader.to_account_info(),
                &ctx.accounts.vault.to_account_info(),
                &ctx.accounts.mint.to_account_info(),
                vault_ata,
                &ctx.accounts.associated_token_program.to_account_info(),
                &ctx.accounts.token_program.to_account_info(),
                &ctx.accounts.system_program.to_account_info(),
            )?;
            crate::instructions::token_util::withdraw_usdc(
                &ctx.accounts.token_program.to_account_info(),
                vault_ata,
                trader_ata,
                &ctx.accounts.vault.to_account_info(),
                &market_key,
                vault_bump,
                proceeds,
            )?;
        }
        AssetKind::Sol => {
            crate::instructions::token_util::withdraw_sol(
                &ctx.accounts.system_program.to_account_info(),
                &ctx.accounts.vault.to_account_info(),
                &ctx.accounts.trader.to_account_info(),
                &market_key,
                vault_bump,
                proceeds,
            )?;
        }
    }

    if side == SIDE_YES {
        market.yes_shares -= shares;
        market.yes_cost -= market.yes_cost.min(proceeds);
    } else {
        market.no_shares -= shares;
        market.no_cost -= market.no_cost.min(proceeds);
    }
    market.volume += proceeds;

    let position = &mut ctx.accounts.position;
    if side == SIDE_YES {
        position.yes_shares -= shares;
        position.yes_cost -= position.yes_cost.min(proceeds);
    } else {
        position.no_shares -= shares;
        position.no_cost -= position.no_cost.min(proceeds);
    }

    Ok(())
}

/// Public exposure of the LMSR solvency check (used by tests): the vault must
/// back its worst-case payout once an ante is enforced.
#[doc(hidden)]
pub fn solvency_ok(vault_balance: u64, q_y: u64, q_n: u64, b: u64) -> bool {
    let c = cost_units(q_y as f64, q_n as f64, b as f64);
    vault_balance as f64 >= c
}