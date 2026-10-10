//! Shared value plumbing: SOL lamport moves into/out of the market vault.
//! Markets store lamports directly on the vault PDA.

use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer as sol_transfer, Transfer as SolTransfer};

use crate::error::ErrorCode;

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
    vault: &AccountInfo<'info>,
    trader: &AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    require!(vault.lamports() >= amount, ErrorCode::InsufficientAmount);
    **vault.try_borrow_mut_lamports()? -= amount;
    **trader.try_borrow_mut_lamports()? += amount;
    Ok(())
}
