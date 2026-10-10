//! Optimistic resolution (UMA-lite): the designated resolver proposes an
//! outcome with a bond, anyone may challenge inside the window (resetting the
//! proposal), and an undisputed proposal finalizes once the window elapses.
//!
//! Bonds escrow into the vault. Unknown to the AMM, bonds simply add depth:
//! the proposer's bond is refunded at finalize; challenger bonds are forfeited.

use anchor_lang::prelude::*;
use anchor_lang::Bumps;

use crate::constants::{bond_units, CHALLENGE_WINDOW_SECS, MAX_OUTCOME_LEN};
use crate::error::ErrorCode;
use crate::state::{Config, Market, MarketStatus, MarketType, Vault};

#[derive(Accounts)]
pub struct ProposeResolution<'info> {
    #[account(mut)]
    pub resolver: Signer<'info>,

    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,

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

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ChallengeResolution<'info> {
    #[account(mut)]
    pub challenger: Signer<'info>,

    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,

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

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FinalizeResolution<'info> {
    /// Permissionless; pays nothing beyond tx fees.
    #[account(mut)]
    pub finalizer: Signer<'info>,

    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,

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

    /// CHECK: Proposer's system account (bond refund destination).
    #[account(mut)]
    pub proposer_account: Option<UncheckedAccount<'info>>,

    pub system_program: Program<'info, System>,
}

/// Propose `outcome` (with `confidence` and client-side `evidence_hash`); only
/// the trusted resolver may do so, only while the market is locked and has no
/// live proposal.
pub fn propose(
    ctx: Context<ProposeResolution>,
    outcome: String,
    confidence: u8,
    evidence_hash: [u8; 32],
) -> Result<()> {
    require!(
        ctx.accounts.resolver.key() == ctx.accounts.config.resolver,
        ErrorCode::Unauthorized
    );
    require!(
        ctx.accounts.market.status == MarketStatus::Locked,
        ErrorCode::MarketNotLocked
    );
    require!(
        ctx.accounts.market.challenge_deadline == 0,
        ErrorCode::AlreadyResolving
    );
    validate_outcome(&ctx.accounts.market, &outcome)?;
    require!(!outcome.is_empty(), ErrorCode::InvalidResolution);
    require!(outcome.len() <= MAX_OUTCOME_LEN, ErrorCode::OutcomeTooLong);
    require!(confidence <= 100, ErrorCode::InvalidResolution);

    let bond = bond_units();
    pay_bond(&ctx, bond)?;

    let now = Clock::get()?.unix_timestamp;
    let market = &mut ctx.accounts.market;
    market.status = MarketStatus::Resolving;
    market.winning_outcome = outcome;
    market.confidence = confidence;
    market.evidence_hash = evidence_hash;
    market.bond = bond;
    market.proposed_at = now;
    market.challenge_deadline = now + CHALLENGE_WINDOW_SECS;
    market.resolved_at = 0;
    market.proposer = ctx.accounts.resolver.key();

    emit!(ProposalProposed {
        market: market.key(),
        proposer: ctx.accounts.resolver.key(),
        outcome: market.winning_outcome.clone(),
        deadline: market.challenge_deadline,
    });
    Ok(())
}

/// Challenge a live proposal inside its window: escrow a bond, reset the market
/// to `Locked` so the resolver must re-propose.
pub fn challenge(ctx: Context<ChallengeResolution>) -> Result<()> {
    require!(
        ctx.accounts.market.status == MarketStatus::Resolving,
        ErrorCode::NoPendingProposal
    );
    let now = Clock::get()?.unix_timestamp;
    require!(
        ctx.accounts.market.challenge_deadline != 0,
        ErrorCode::WindowNotOpen
    );
    require!(
        now <= ctx.accounts.market.challenge_deadline,
        ErrorCode::WindowNotOpen
    );

    let bond = bond_units();
    pay_bond(&ctx, bond)?;

    let market = &mut ctx.accounts.market;
    market.challenge_deadline = 0;
    market.status = MarketStatus::Locked;

    emit!(ProposalChallenged {
        market: market.key(),
        challenger: ctx.accounts.challenger.key(),
    });
    Ok(())
}

/// Finalize an undisputed proposal once its window has elapsed; refund the
/// proposer's bond and mark the market `Resolved`.
pub fn finalize(ctx: Context<FinalizeResolution>) -> Result<()> {
    require!(
        ctx.accounts.market.status == MarketStatus::Resolving,
        ErrorCode::NoPendingProposal
    );
    require!(
        ctx.accounts.market.challenge_deadline != 0,
        ErrorCode::WindowNotOpen
    );
    let now = Clock::get()?.unix_timestamp;
    require!(
        now > ctx.accounts.market.challenge_deadline,
        ErrorCode::WindowNotOpen
    );
    require!(
        !ctx.accounts.market.winning_outcome.is_empty(),
        ErrorCode::InvalidResolution
    );

    let bond = ctx.accounts.market.bond;
    if bond > 0 {
        refund_bond(&ctx, bond)?;
    }

    let market = &mut ctx.accounts.market;
    market.resolved_at = now;
    market.bond = 0;
    market.status = MarketStatus::Resolved;

    emit!(MarketResolved {
        market: market.key(),
        outcome: market.winning_outcome.clone(),
        confidence: market.confidence,
    });
    Ok(())
}

fn validate_outcome(market: &Market, outcome: &str) -> Result<()> {
    let ok = match market.market_type {
        MarketType::Binary => outcome == "yes" || outcome == "no",
        MarketType::Majority => market.words.iter().any(|w| w.word == outcome),
    };
    require!(ok, ErrorCode::UnknownWord);
    Ok(())
}

trait BondAccounts<'info> {
    fn bond_payer(&self) -> AccountInfo<'info>;
    fn vault(&self) -> AccountInfo<'info>;
    fn v_system_program(&self) -> AccountInfo<'info>;
}

impl<'info> BondAccounts<'info> for ProposeResolution<'info> {
    fn bond_payer(&self) -> AccountInfo<'info> {
        self.resolver.to_account_info()
    }
    fn vault(&self) -> AccountInfo<'info> {
        self.vault.to_account_info()
    }
    fn v_system_program(&self) -> AccountInfo<'info> {
        self.system_program.to_account_info()
    }
}

impl<'info> BondAccounts<'info> for ChallengeResolution<'info> {
    fn bond_payer(&self) -> AccountInfo<'info> {
        self.challenger.to_account_info()
    }
    fn vault(&self) -> AccountInfo<'info> {
        self.vault.to_account_info()
    }
    fn v_system_program(&self) -> AccountInfo<'info> {
        self.system_program.to_account_info()
    }
}

/// Escrow the bond from the proposer/challenger into the vault.
fn pay_bond<'info, A: BondAccounts<'info> + Bumps>(
    ctx: &Context<'_, A>,
    bond: u64,
) -> Result<()> {
    require!(bond > 0, ErrorCode::InsufficientAmount);
    let vault = ctx.accounts.vault();
    crate::instructions::token_util::deposit_sol(
        &ctx.accounts.v_system_program(),
        &ctx.accounts.bond_payer(),
        &vault,
        bond,
    )
}

/// Refund `bond` from the vault to the proposing resolver.
///
/// `finalize` is permissionless, so the refund destination may not be chosen
/// by the caller: the bond goes back to whoever posted it (`market.proposer`).
fn refund_bond(ctx: &Context<FinalizeResolution>, bond: u64) -> Result<()> {
    let vault = ctx.accounts.vault.to_account_info();
    let proposer_account = ctx
        .accounts
        .proposer_account
        .as_ref()
        .ok_or(ErrorCode::InsufficientAmount)?;
    require_keys_eq!(
        proposer_account.key(),
        ctx.accounts.market.proposer,
        ErrorCode::Unauthorized
    );
    crate::instructions::token_util::withdraw_sol(&vault, proposer_account, bond)
}

#[event]
pub struct ProposalProposed {
    pub market: Pubkey,
    pub proposer: Pubkey,
    pub outcome: String,
    pub deadline: i64,
}

#[event]
pub struct ProposalChallenged {
    pub market: Pubkey,
    pub challenger: Pubkey,
}

#[event]
pub struct MarketResolved {
    pub market: Pubkey,
    pub outcome: String,
    pub confidence: u8,
}