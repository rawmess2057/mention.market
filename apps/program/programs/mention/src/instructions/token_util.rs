//! Shared token plumbing: idempotent ATA creation via CPI, balance reads, and
//! SOL lamport moves into/out of the market vault. SOL markets store lamports
//! directly on the vault PDA; USDC markets use the vault's ATA.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::{invoke, invoke_signed};
use anchor_lang::system_program::{transfer as sol_transfer, Transfer as SolTransfer};
use anchor_spl::{
    associated_token::{self, spl_associated_token_account},
    token::{spl_token, TokenAccount as AnchorTokenAccount},
};

use crate::error::ErrorCode;

/// Idempotently create `associated_token` (an ATA for `owner` & `mint`) if it
/// does not yet exist unless already initialised. `payer` funds rent.
pub fn create_ata_if_needed<'info>(
    payer: &AccountInfo<'info>,
    owner: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    associated_token: &AccountInfo<'info>,
    associated_token_program: &AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
) -> Result<()> {
    let owner_is_token_program = associated_token.owner == &spl_token::ID;
    if owner_is_token_program {
        return Ok(());
    }
    let cpi = CpiContext::new(
        associated_token_program.key(),
        associated_token::Create {
            payer: payer.clone(),
            associated_token: associated_token.clone(),
            authority: owner.clone(),
            mint: mint.clone(),
            system_program: system_program.clone(),
            token_program: token_program.clone(),
        },
    );
    associated_token::create_idempotent(cpi)
}

/// Manual ATA CPI via `spl_associated_token_account` (works even when no
/// signer_seeds are needed, e.g. creating the vault's own ATA).
pub fn create_ata_plain<'info>(
    payer: &AccountInfo<'info>,
    owner: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    associated_token: &AccountInfo<'info>,
    _associated_token_program: &AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
) -> Result<()> {
    let ix = spl_associated_token_account::instruction::create_associated_token_account_idempotent(
        payer.key,
        owner.key,
        mint.key,
        token_program.key,
    );
    invoke(
        &ix,
        &[
            payer.clone(),
            associated_token.clone(),
            owner.clone(),
            mint.clone(),
            system_program.clone(),
            token_program.clone(),
        ],
    )
    .map_err(Into::into)
}

/// Read the token balance of a legacy SPL token account from its raw bytes.
pub fn read_token_amount(data: &[u8]) -> Result<u64> {
    let mut data = data;
    let acct = AnchorTokenAccount::try_deserialize_unchecked(&mut data)
        .map_err(|_| ErrorCode::InvalidTokenAccount)?;
    Ok(acct.amount)
}

/// Move `amount` lamports from `trader` into the vault PDA via a System
/// Program `transfer` CPI (the vault is credited; the System Program owns
/// `trader` and may debit it).
pub fn deposit_sol<'info>(
    system_program: &AccountInfo<'info>,
    trader: &AccountInfo<'info>,
    vault: &AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    require!(trader.lamports() >= amount, ErrorCode::InsufficientAmount);
    sol_transfer(
        CpiContext::new(
            system_program.key(),
            SolTransfer {
                from: trader.clone(),
                to: vault.clone(),
            },
        ),
        amount,
    )
}

/// Move `amount` lamports from the vault PDA back to `trader`. The vault is a
/// program-owned account, so the program may debit it directly; crediting a
/// system-owned destination is permitted (cf. SPL Token `close_account`).
pub fn withdraw_sol<'info>(
    _system_program: &AccountInfo<'info>,
    vault: &AccountInfo<'info>,
    trader: &AccountInfo<'info>,
    _market: &Pubkey,
    _bump: u8,
    amount: u64,
) -> Result<()> {
    require!(vault.lamports() >= amount, ErrorCode::InsufficientAmount);
    **vault.try_borrow_mut_lamports()? -= amount;
    **trader.try_borrow_mut_lamports()? += amount;
    Ok(())
}

/// SPL `transfer` with optional signer seeds (empty `seeds` for a caller that
/// signed the parent instruction as the authority, `vault_seeds` when the vault
/// PDA is the authority).
pub fn transfer_token<'info>(
    _token_program: &AccountInfo<'info>,
    from: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    amount: u64,
    seeds: &[&[&[u8]]],
) -> Result<()> {
    let ix = spl_token::instruction::transfer(
        &spl_token::ID,
        from.key,
        to.key,
        authority.key,
        &[],
        amount,
    )
    .map_err(|_| ErrorCode::InvalidTokenAccount)?;
    if seeds.is_empty() {
        invoke(&ix, &[from.clone(), to.clone(), authority.clone()])
            .map_err(Into::into)
    } else {
        invoke_signed(&ix, &[from.clone(), to.clone(), authority.clone()], seeds)
            .map_err(Into::into)
    }
}

/// Create the vault's USDC ATA (rent paid by `payer`) if missing.
pub fn ensure_vault_ata<'info>(
    payer: &AccountInfo<'info>,
    vault: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    vault_ata: &AccountInfo<'info>,
    associated_token_program: &AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
) -> Result<()> {
    create_ata_if_needed(
        payer,
        vault,
        mint,
        vault_ata,
        associated_token_program,
        token_program,
        system_program,
    )
}

/// A direct SPL transfer into the vault: `trader_ata -> vault_ata`,
/// authority is `trader` (parent-instruction signer).
pub fn deposit_usdc<'info>(
    token_program: &AccountInfo<'info>,
    trader_ata: &AccountInfo<'info>,
    vault_ata: &AccountInfo<'info>,
    trader: &AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    transfer_token(
        token_program,
        trader_ata,
        vault_ata,
        trader,
        amount,
        &[],
    )
}

/// A direct SPL transfer out of the vault: `vault_ata -> trader_ata`,
/// authority is the vault PDA (signed via its market seed + bump).
pub fn withdraw_usdc<'info>(
    token_program: &AccountInfo<'info>,
    vault_ata: &AccountInfo<'info>,
    trader_ata: &AccountInfo<'info>,
    vault: &AccountInfo<'info>,
    market: &Pubkey,
    bump: u8,
    amount: u64,
) -> Result<()> {
    let bump_byte = bump;
    let seeds = [
        b"vault".as_slice(),
        market.as_ref(),
        std::slice::from_ref(&bump_byte),
    ];
    transfer_token(
        token_program,
        vault_ata,
        trader_ata,
        vault,
        amount,
        &[&seeds],
    )
}
