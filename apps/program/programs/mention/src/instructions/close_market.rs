//! Devnet cleanup: reap a market and everything escrowed for it.
//!
//! Nothing else in the program ever removes a `Market` account, so repeated
//! demo runs accumulate open/resolved markets that the app still discovers via
//! a single GPA over the Market discriminator. `close_market` lets the config
//! authority retire a market on demand: it drains the vault (escrow + rent),
//! closes the market + vault + resolution-spec accounts, and sweeps any
//! `Position` / `EvidenceManifest` accounts passed as `remaining_accounts`
//! (the caller discovers them off-chain by GPA), refunding every lamport to a
//! `recipient` the authority picks.
//!
//! Authority-only by design: a market creator must never be able to close a
//! market other wallets have funds in. This is a devnet/admin reaping path, not
//! a user-facing action — it force-closes even a resolved market whose winners
//! have not claimed, handing their payout to `recipient`.

use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::state::{Config, EvidenceManifest, Market, Position, ResolutionSpecCommitment, Vault};

#[derive(Accounts)]
pub struct CloseMarket<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [b"config"],
        bump = config.bump,
        has_one = authority @ ErrorCode::Unauthorized
    )]
    pub config: Box<Account<'info, Config>>,

    #[account(
        mut,
        close = recipient,
        seeds = [b"market", market.id.to_le_bytes().as_ref()],
        bump = market.bump
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        mut,
        close = recipient,
        seeds = [b"vault", market.key().as_ref()],
        bump = vault.bump
    )]
    pub vault: Box<Account<'info, Vault>>,

    #[account(
        mut,
        close = recipient,
        seeds = [b"resolution-spec", market.key().as_ref()],
        bump = resolution_spec.bump
    )]
    pub resolution_spec: Box<Account<'info, ResolutionSpecCommitment>>,

    /// CHECK: Rent + escrow destination, chosen by the config authority. Not
    /// constrained — it only ever receives lamports.
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,
}

/// Close `market`, returning the vault's full balance (traders' escrow, the
/// reserve ante, the creator's rent) plus the rent locked in the market, vault
/// and resolution-spec accounts to `recipient`. Any `Position` or
/// `EvidenceManifest` account for this market passed in `remaining_accounts` is
/// closed the same way. Foreign accounts are rejected so a stray meta can never
/// sweep unrelated state.
pub fn handler<'info>(ctx: Context<'info, CloseMarket<'info>>) -> Result<()> {
    let market_key = ctx.accounts.market.key();
    let id = ctx.accounts.market.id;
    let recipient = ctx.accounts.recipient.to_account_info();

    for info in ctx.remaining_accounts.iter() {
        require_keys_eq!(*info.owner, *ctx.program_id, ErrorCode::Unauthorized);
        if let Ok(position) = Account::<Position>::try_from(info) {
            require_keys_eq!(position.market, market_key, ErrorCode::InvalidMarket);
            position.close(recipient.clone())?;
        } else if let Ok(evidence) = Account::<EvidenceManifest>::try_from(info) {
            require_keys_eq!(evidence.market, market_key, ErrorCode::InvalidMarket);
            evidence.close(recipient.clone())?;
        } else {
            return Err(ErrorCode::InvalidMarket.into());
        }
    }

    emit!(MarketClosed {
        market: market_key,
        id,
        recipient: recipient.key(),
    });
    Ok(())
}

#[event]
pub struct MarketClosed {
    pub market: Pubkey,
    pub id: u64,
    pub recipient: Pubkey,
}
