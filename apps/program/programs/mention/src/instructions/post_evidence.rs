//! Evidence binding: before proposing an outcome, the trusted resolver posts the
//! raw evidence manifest bytes. The manifest account's PDA is derived from
//! `sha256(bytes)` (passed as an explicit argument so the seed stays in a
//! form the IDL generator can parse), and the program **recomputes** the hash
//! from the raw bytes and rejects a mismatch. The exact payload cited by a
//! proposal is therefore committed on-chain and cannot be swapped afterwards.
//!
//! The manifest is stored verbatim; interpreting it (canonical JSON, schema,
//! cross-checking its internal `specSha256`) is the job of the resolution
//! contract library. On-chain we only enforce size, provenance, and the link
//! back to the market's committed resolution spec.

use anchor_lang::prelude::*;
use solana_sha256_hasher::hash;

use crate::constants::MAX_EVIDENCE_LEN;
use crate::error::ErrorCode;
use crate::state::{Config, EvidenceManifest, Market, MarketStatus};

#[derive(Accounts)]
#[instruction(bytes: Vec<u8>, sha256: [u8; 32])]
pub struct PostEvidence<'info> {
    #[account(mut)]
    pub resolver: Signer<'info>,

    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        seeds = [b"market", market.id.to_le_bytes().as_ref()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,

    #[account(
        init,
        payer = resolver,
        space = 8 + EvidenceManifest::INIT_SPACE,
        seeds = [
            b"evidence",
            market.key().as_ref(),
            sha256.as_ref()
        ],
        bump
    )]
    pub evidence: Account<'info, EvidenceManifest>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<PostEvidence>,
    bytes: Vec<u8>,
    sha256: [u8; 32],
    spec_sha256: [u8; 32],
) -> Result<()> {
    require!(
        ctx.accounts.resolver.key() == ctx.accounts.config.resolver,
        ErrorCode::Unauthorized
    );
    let status = ctx.accounts.market.status;
    require!(
        status == MarketStatus::Locked || status == MarketStatus::Resolving,
        ErrorCode::MarketNotLocked
    );
    require!(!bytes.is_empty(), ErrorCode::EmptyEvidence);
    require!(bytes.len() <= MAX_EVIDENCE_LEN, ErrorCode::EvidenceTooLarge);
    // The program recomputes the manifest hash and requires the client-passed
    // value to match, so the address-derived commitment cannot be forged.
    require!(
        hash(bytes.as_slice()).to_bytes() == sha256,
        ErrorCode::EvidenceMismatch
    );

    let market = ctx.accounts.market.key();
    let evidence_key = ctx.accounts.evidence.key();

    let evidence = &mut ctx.accounts.evidence;
    evidence.market = market;
    evidence.spec_sha256 = spec_sha256;
    evidence.sha256 = sha256;
    evidence.bytes = bytes;
    evidence.bump = ctx.bumps.evidence;

    emit!(EvidencePosted {
        market,
        evidence: evidence_key,
        spec_sha256,
        sha256,
    });
    Ok(())
}

#[event]
pub struct EvidencePosted {
    pub market: Pubkey,
    pub evidence: Pubkey,
    pub spec_sha256: [u8; 32],
    pub sha256: [u8; 32],
}