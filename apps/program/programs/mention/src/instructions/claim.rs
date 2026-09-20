//! Settlement: redeem a Position in a resolved market.
//!
//! Binary markets redeem winning shares 1:1 in base units (no fee, matching
//! the sim). Majority markets split the net pot pro-rata to the winning pool:
//! `payout = backed / win_pool * net_pot` where
//! `net_pot = total_pool * (1 - creator_fee_bps / 10000)`. The rake stays in
//! the vault. Claims are one-shot (`position.claimed`).

use anchor_lang::prelude::*;
use anchor_spl::{associated_token::AssociatedToken, token::Token};

use crate::error::ErrorCode;
use crate::state::{AssetKind, Market, MarketStatus, MarketType, Position, Vault};

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub claimant: Signer<'info>,

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
        seeds = [b"position", market.key().as_ref(), claimant.key().as_ref()],
        bump
    )]
    pub position: Account<'info, Position>,

    /// CHECK: Claimant's USDC ATA (payout destination); presence checked per
    /// asset type and validated by the transfer CPI.
    #[account(mut)]
    pub claimant_ata: Option<UncheckedAccount<'info>>,
    /// CHECK: Vault USDC ATA; created idempotently and validated by the transfer
    /// CPI when the market is USDC-denominated.
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

/// Claim the payout of `position` in a resolved `market`.
pub fn handler(ctx: Context<Claim>) -> Result<()> {
    let market_key = ctx.accounts.market.key();
    let vault_bump = ctx.accounts.vault.bump;
    let market = &mut ctx.accounts.market;
    require!(market.status == MarketStatus::Resolved, ErrorCode::NotResolved);
    require!(ctx.accounts.position.claimed == false, ErrorCode::Claimed);
    let outcome = market.winning_outcome.clone();
    require!(!outcome.is_empty(), ErrorCode::InvalidResolution);

    let payout = payout_for(market, &ctx.accounts.position, &outcome)?;
    require!(payout > 0, ErrorCode::NoWinningShares);

    match market.asset {
        AssetKind::Usdc => {
            let claimant_ata = ctx
                .accounts
                .claimant_ata
                .as_ref()
                .ok_or(ErrorCode::InsufficientAmount)?;
            let vault_ata = ctx
                .accounts
                .vault_ata
                .as_ref()
                .ok_or(ErrorCode::InsufficientAmount)?;
            crate::instructions::token_util::ensure_vault_ata(
                &ctx.accounts.claimant.to_account_info(),
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
                claimant_ata,
                &ctx.accounts.vault.to_account_info(),
                &market_key,
                vault_bump,
                payout,
            )?;
        }
        AssetKind::Sol => {
            crate::instructions::token_util::withdraw_sol(
                &ctx.accounts.system_program.to_account_info(),
                &ctx.accounts.vault.to_account_info(),
                &ctx.accounts.claimant.to_account_info(),
                &market_key,
                vault_bump,
                payout,
            )?;
        }
    }

    // Clear the position's cost basis and lock it from double-claiming.
    let pos = &mut ctx.accounts.position;
    pos.claimed = true;
    pos.yes_shares = 0;
    pos.no_shares = 0;
    pos.word_backs = Vec::new();

    emit!(PayoutClaimed {
        market: market_key,
        claimant: ctx.accounts.claimant.key(),
        payout,
        outcome,
    });
    Ok(())
}

/// Gross payout owed (base units) for this position; 0 when it holds nothing
/// on the winning side.
pub fn payout_for(market: &Market, position: &Position, outcome: &str) -> Result<u64> {
    match market.market_type {
        MarketType::Binary => {
            let shares = if outcome == "yes" {
                position.yes_shares
            } else {
                position.no_shares
            };
            Ok(shares)
        }
        MarketType::Majority => {
            let backed = position
                .word_backs
                .iter()
                .find(|b| b.word == outcome)
                .map(|b| b.amount)
                .unwrap_or(0);
            if backed == 0 {
                return Ok(0);
            }
            let win_pool = market
                .words
                .iter()
                .find(|w| w.word == outcome)
                .map(|w| w.pool)
                .unwrap_or(0);
            if win_pool == 0 {
                return Ok(0);
            }
            let fee_num = (10_000u64 - market.creator_fee_bps as u64) as f64;
            let net_pot = (market.total_pool as f64) * fee_num / 10_000.0;
            let payout = (backed as f64 / win_pool as f64) * net_pot;
            Ok(payout.floor() as u64)
        }
    }
}

#[event]
pub struct PayoutClaimed {
    pub market: Pubkey,
    pub claimant: Pubkey,
    pub payout: u64,
    pub outcome: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{AssetKind, Market, MarketStatus, MarketType, Position, Vertical, WordBack, WordPool};

    fn market(market_type: MarketType) -> Market {
        Market {
            id: 1,
            creator: Pubkey::default(),
            title: "t".into(),
            event: "e".into(),
            vertical: Vertical::Streams,
            asset: AssetKind::Sol,
            market_type,
            status: MarketStatus::Resolved,
            b: 100_000,
            yes_shares: 0,
            no_shares: 0,
            yes_cost: 0,
            no_cost: 0,
            words: vec![],
            total_pool: 0,
            volume: 0,
            traders: 0,
            creator_fee_bps: 100,
            end_time: 0,
            winning_outcome: "yes".into(),
            confidence: 100,
            bond: 0,
            evidence_hash: [0; 32],
            proposed_at: 0,
            challenge_deadline: 0,
            resolved_at: 0,
            proposer: Pubkey::default(),
            bump: 0,
        }
    }

    fn position() -> Position {
        Position {
            market: Pubkey::default(),
            owner: Pubkey::default(),
            yes_shares: 0,
            no_shares: 0,
            yes_cost: 0,
            no_cost: 0,
            word_backs: vec![],
            claimed: false,
            bump: 0,
        }
    }

    #[test]
    fn binary_pays_winning_shares_one_to_one() {
        let m = market(MarketType::Binary);
        let mut p = position();
        p.yes_shares = 100;
        p.no_shares = 40;
        assert_eq!(payout_for(&m, &p, "yes").unwrap(), 100);
        assert_eq!(payout_for(&m, &p, "no").unwrap(), 40);
        assert_eq!(payout_for(&m, &p, "yes").unwrap(), 100);
    }

    #[test]
    fn majority_pays_pro_rata_of_net_pot() {
        let mut m = market(MarketType::Majority);
        m.words = vec![
            WordPool { word: "AI".into(), pool: 400, bettors: 2 },
            WordPool { word: "Solana".into(), pool: 600, bettors: 1 },
        ];
        m.total_pool = 1_000;
        m.creator_fee_bps = 100;
        m.winning_outcome = "AI".into();

        let mut p = position();
        p.word_backs = vec![WordBack { word: "AI".into(), amount: 300 }];
        // 300/400 * 1000 * 0.99 = 742.5 -> 742
        assert_eq!(payout_for(&m, &p, "AI").unwrap(), 742);

        // Backed the losing word -> nothing.
        let mut p2 = position();
        p2.word_backs = vec![WordBack { word: "Solana".into(), amount: 600 }];
        assert_eq!(payout_for(&m, &p2, "AI").unwrap(), 0);
    }

    #[test]
    fn majority_with_zero_win_pool_pays_nothing() {
        let mut m = market(MarketType::Majority);
        m.words = vec![WordPool { word: "AI".into(), pool: 0, bettors: 0 }];
        m.total_pool = 0;
        let mut p = position();
        p.word_backs = vec![WordBack { word: "AI".into(), amount: 100 }];
        assert_eq!(payout_for(&m, &p, "AI").unwrap(), 0);
    }

    #[test]
    fn majority_bond_refund_does_not_touch_pool() {
        // Guard: resolver bond flows are outside the settlement pool math.
        let mut m = market(MarketType::Majority);
        m.words = vec![WordPool { word: "AI".into(), pool: 1_000, bettors: 1 }];
        m.total_pool = 1_000;
        m.bond = 50_000_000_000;
        let mut p = position();
        p.word_backs = vec![WordBack { word: "AI".into(), amount: 1_000 }];
        assert_eq!(payout_for(&m, &p, "AI").unwrap(), 990);
    }
}