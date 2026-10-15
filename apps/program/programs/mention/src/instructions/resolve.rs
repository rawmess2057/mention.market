//! Optimistic resolution (UMA-lite): the designated resolver proposes an
//! outcome with a bond, anyone may challenge inside the window (resetting the
//! proposal), and an undisputed proposal finalizes once the window elapses.
//!
//! Bonds escrow into the vault. An undisputed proposer's bond is refunded at
//! finalize. A challenge records both bonds in a `Challenge` PDA, and the
//! resolver's next proposal settles it:
//! - different outcome → challenge upheld: the challenger gets both bonds;
//! - same outcome → challenge rejected: the proposer's bond is refunded and the
//!   challenger's bond goes to the treasury (`config.authority`) — never to the
//!   resolver, who is also the one ruling on the challenge.

use anchor_lang::prelude::*;
use anchor_lang::Bumps;

use crate::constants::{bond_units, CHALLENGE_WINDOW_SECS, MAX_OUTCOME_LEN, VOID_OUTCOME};
use crate::error::ErrorCode;
use crate::state::{
    Challenge, Config, EvidenceManifest, Market, MarketStatus, MarketType,
    ResolutionSpecCommitment, Vault,
};

#[derive(Accounts)]
#[instruction(outcome: String, confidence: u8, evidence_sha256: [u8; 32])]
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

    /// Committed resolution rules for this market; a zero hash marks a
    /// legacy/demo market that must not be resolved by the trusted resolver.
    #[account(
        seeds = [b"resolution-spec", market.key().as_ref()],
        bump = resolution_spec.bump
    )]
    pub resolution_spec: Box<Account<'info, ResolutionSpecCommitment>>,

    /// Evidence manifest posted via `post_evidence`; its address commits to the
    /// exact raw bytes the proposal is based on.
    #[account(
        seeds = [b"evidence", market.key().as_ref(), evidence_sha256.as_ref()],
        bump = evidence.bump
    )]
    pub evidence: Box<Account<'info, EvidenceManifest>>,

    /// CHECK: The market's `Challenge` PDA. Always required (the address is
    /// fixed by seeds) so the resolver can't skip settling an open dispute;
    /// empty when there is none. Deserialized and closed in `settle_challenge`.
    #[account(mut, seeds = [b"challenge", market.key().as_ref()], bump)]
    pub challenge: UncheckedAccount<'info>,

    /// CHECK: Challenger's system account; required only when settling a
    /// challenge, and must equal `challenge.challenger`.
    #[account(mut)]
    pub challenger_account: Option<UncheckedAccount<'info>>,

    /// CHECK: Disputed proposal's proposer; required only when settling a
    /// rejected challenge, and must equal `challenge.proposer`.
    #[account(mut)]
    pub prior_proposer_account: Option<UncheckedAccount<'info>>,

    /// CHECK: Treasury (`config.authority`); required only when settling a
    /// rejected challenge.
    #[account(mut)]
    pub treasury: Option<UncheckedAccount<'info>>,

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

    /// One open dispute per market: `init` fails while one is unsettled.
    #[account(
        init,
        payer = challenger,
        space = 8 + Challenge::INIT_SPACE,
        seeds = [b"challenge", market.key().as_ref()],
        bump
    )]
    pub challenge: Box<Account<'info, Challenge>>,

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

/// Propose `outcome` (with `confidence`) against a previously posted evidence
/// manifest; only the trusted resolver may do so, only while the market is
/// locked and has no live proposal. The proposal binds the market to the
/// manifest's program-computed hash and to the committed resolution spec.
pub fn propose(
    ctx: Context<ProposeResolution>,
    outcome: String,
    confidence: u8,
    evidence_sha256: [u8; 32],
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

    let market_key = ctx.accounts.market.key();
    require_keys_eq!(
        ctx.accounts.resolution_spec.market,
        market_key,
        ErrorCode::InvalidResolution
    );
    require!(
        ctx.accounts.resolution_spec.spec_sha256 != [0u8; 32],
        ErrorCode::MissingResolutionSpec
    );
    require_keys_eq!(
        ctx.accounts.evidence.market,
        market_key,
        ErrorCode::EvidenceMismatch
    );
    require!(
        ctx.accounts.evidence.sha256 == evidence_sha256,
        ErrorCode::EvidenceMismatch
    );
    require!(
        ctx.accounts.evidence.spec_sha256 == ctx.accounts.resolution_spec.spec_sha256,
        ErrorCode::EvidenceMismatch
    );

    validate_outcome(&ctx.accounts.market, &outcome)?;
    require!(!outcome.is_empty(), ErrorCode::InvalidResolution);
    require!(outcome.len() <= MAX_OUTCOME_LEN, ErrorCode::OutcomeTooLong);
    require!(confidence <= 100, ErrorCode::InvalidResolution);

    let bond = bond_units();
    pay_bond(&ctx, bond)?;
    // Settle after the bond CPI: settlement moves lamports directly, and a CPI
    // after direct moves to accounts outside it fails as unbalanced.
    settle_challenge(&ctx, &outcome)?;

    let now = Clock::get()?.unix_timestamp;
    let evidence_hash = ctx.accounts.evidence.sha256;
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

/// Settle an open dispute, if any, against the resolver's new `outcome`, then
/// close the `Challenge` account (its rent returns to the challenger).
fn settle_challenge(ctx: &Context<ProposeResolution>, outcome: &str) -> Result<()> {
    let info = ctx.accounts.challenge.to_account_info();
    if info.data_is_empty() {
        return Ok(());
    }
    // `try_deserialize` checks only the discriminator, so check the owner too.
    require_keys_eq!(*info.owner, crate::ID, ErrorCode::InvalidMarket);
    let challenge = {
        let data = info.try_borrow_data()?;
        Challenge::try_deserialize(&mut &data[..])?
    };
    require_keys_eq!(challenge.market, ctx.accounts.market.key(), ErrorCode::InvalidMarket);

    let vault = ctx.accounts.vault.to_account_info();
    let challenger = ctx
        .accounts
        .challenger_account
        .as_ref()
        .ok_or(ErrorCode::SettlementAccountMismatch)?
        .to_account_info();
    require_keys_eq!(challenger.key(), challenge.challenger, ErrorCode::SettlementAccountMismatch);

    let upheld = outcome != challenge.challenged_outcome;
    if upheld {
        let payout = challenge
            .challenger_bond
            .checked_add(challenge.proposer_bond)
            .ok_or(ErrorCode::InsufficientAmount)?;
        crate::instructions::token_util::withdraw_sol(&vault, &challenger, payout)?;
    } else {
        let proposer = ctx
            .accounts
            .prior_proposer_account
            .as_ref()
            .ok_or(ErrorCode::SettlementAccountMismatch)?
            .to_account_info();
        require_keys_eq!(proposer.key(), challenge.proposer, ErrorCode::SettlementAccountMismatch);
        let treasury = ctx
            .accounts
            .treasury
            .as_ref()
            .ok_or(ErrorCode::SettlementAccountMismatch)?
            .to_account_info();
        require_keys_eq!(treasury.key(), ctx.accounts.config.authority, ErrorCode::SettlementAccountMismatch);
        crate::instructions::token_util::withdraw_sol(&vault, &proposer, challenge.proposer_bond)?;
        crate::instructions::token_util::withdraw_sol(&vault, &treasury, challenge.challenger_bond)?;
    }

    emit!(ChallengeSettled {
        market: challenge.market,
        challenger: challenge.challenger,
        challenged_outcome: challenge.challenged_outcome.clone(),
        upheld,
    });
    close_account(&info, &challenger)
}

/// Close a program-owned account: move its rent to `dest` and hand it back to
/// the System Program, so the PDA can be `init`ed again by a later challenge.
fn close_account<'info>(info: &AccountInfo<'info>, dest: &AccountInfo<'info>) -> Result<()> {
    let lamports = info.lamports();
    **info.try_borrow_mut_lamports()? = 0;
    **dest.try_borrow_mut_lamports()? += lamports;
    info.assign(&anchor_lang::system_program::ID);
    info.resize(0)?;
    Ok(())
}

/// Challenge a live proposal inside its window: escrow a bond, record both
/// bonds in the market's `Challenge` PDA, and reset the market to `Locked` so
/// the resolver must re-propose (which settles the challenge).
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

    let market_key = ctx.accounts.market.key();
    let challenge = &mut ctx.accounts.challenge;
    challenge.market = market_key;
    challenge.challenger = ctx.accounts.challenger.key();
    challenge.challenged_outcome = ctx.accounts.market.winning_outcome.clone();
    challenge.challenger_bond = bond;
    challenge.proposer = ctx.accounts.market.proposer;
    challenge.proposer_bond = ctx.accounts.market.bond;
    challenge.bump = ctx.bumps.challenge;

    // The proposer's bond is now tracked by the challenge, not the market.
    let market = &mut ctx.accounts.market;
    market.bond = 0;
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

/// `outcome` must be a market outcome, or `VOID_OUTCOME` (any market type).
fn validate_outcome(market: &Market, outcome: &str) -> Result<()> {
    if outcome == VOID_OUTCOME {
        return Ok(());
    }
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
pub struct ChallengeSettled {
    pub market: Pubkey,
    pub challenger: Pubkey,
    pub challenged_outcome: String,
    pub upheld: bool,
}

#[event]
pub struct MarketResolved {
    pub market: Pubkey,
    pub outcome: String,
    pub confidence: u8,
}