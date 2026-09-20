use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::instruction::Instruction,
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    anchor_spl::{
        associated_token::ID as ASSOCIATED_TOKEN_PROGRAM_ID,
        token::ID as TOKEN_PROGRAM_ID,
    },
    litesvm::LiteSVM,
    solana_clock::Clock,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
    std::str::FromStr,
};

const LAMPORTS: u64 = 1_000_000_000;

fn setup() -> (LiteSVM, Keypair, Pubkey) {
    let program_id = mention::id();
    let payer = Keypair::new();
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!("../../../target/deploy/mention.so");
    svm.add_program(program_id, bytes).unwrap();
    svm.airdrop(&payer.pubkey(), 100 * LAMPORTS).unwrap();
    (svm, payer, program_id)
}

fn send(svm: &mut LiteSVM, ixs: &[Instruction], payer: &Keypair) -> Result<(), String> {
    // BuyBinary/BackWord need more than the default 200k CU in dev builds.
    let mut data = vec![2u8]; // ComputeBudgetInstruction::SetComputeUnitLimit
    data.extend_from_slice(&1_400_000u32.to_le_bytes());
    let set_limit = Instruction {
        program_id: Pubkey::from_str("ComputeBudget111111111111111111111111111111").unwrap(),
        accounts: vec![],
        data,
    };
    let blockhash = svm.latest_blockhash();
    let mut all: Vec<Instruction> = Vec::with_capacity(ixs.len() + 1);
    all.push(set_limit);
    all.extend_from_slice(ixs);
    let msg = Message::new_with_blockhash(&all, Some(&payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[payer]).unwrap();
    svm.send_transaction(tx)
        .map(|_| ())
        .map_err(|e| format!("{e:?}"))
}

fn unix_now(svm: &LiteSVM) -> i64 {
    svm.get_sysvar::<Clock>().unix_timestamp
}

fn config_pda(program_id: Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"config"], &program_id).0
}

fn init_config_ix(
    program_id: Pubkey,
    authority: Pubkey,
    usdc_mint: Pubkey,
    resolver: Pubkey,
) -> Instruction {
    Instruction::new_with_bytes(
        program_id,
        &mention::instruction::InitializeConfig { fee_bps: 100 }.data(),
        mention::accounts::InitializeConfig {
            authority,
            config: config_pda(program_id),
            usdc_mint,
            resolver,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
    )
}

fn create_market_ix(
    program_id: Pubkey,
    creator: Pubkey,
    id: u64,
    market_type: mention::MarketType,
    asset: mention::AssetKind,
    words: Vec<String>,
    end_time: i64,
) -> (Instruction, Pubkey) {
    let id_bytes = id.to_le_bytes();
    let market =
        Pubkey::find_program_address(&[b"market", &id_bytes], &program_id).0;
    let vault = Pubkey::find_program_address(&[b"vault", market.as_ref()], &program_id).0;
    let ix = Instruction::new_with_bytes(
        program_id,
        &mention::instruction::CreateMarket {
            id,
            title: "Will AI be said on stream?".to_string(),
            event: "devnet test event".to_string(),
            vertical: mention::Vertical::Streams,
            market_type,
            asset,
            b: 100_000,
            words,
            end_time,
            creator_fee_bps: 100,
        }
        .data(),
        mention::accounts::CreateMarket {
            creator,
            config: config_pda(program_id),
            market,
            vault,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
    );
    (ix, market)
}

fn lock_market_ix(program_id: Pubkey, signer: Pubkey, market: Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        program_id,
        &mention::instruction::LockMarket {}.data(),
        mention::accounts::LockMarket { signer, market }.to_account_metas(None),
    )
}

fn read_market(svm: &LiteSVM, market: Pubkey) -> mention::Market {
    let acct = svm.get_account(&market).expect("market account");
    let mut data = acct.data.as_slice();
    mention::Market::try_deserialize(&mut data).expect("deserialize market")
}

fn bootstrap(svm: &mut LiteSVM, payer: &Keypair, program_id: Pubkey) -> (Pubkey, Keypair) {
    let usdc_mint = Keypair::new().pubkey();
    let resolver = Keypair::new();
    svm.airdrop(&resolver.pubkey(), 100 * LAMPORTS).unwrap();
    send(
        svm,
        &[init_config_ix(program_id, payer.pubkey(), usdc_mint, resolver.pubkey())],
        payer,
    )
    .unwrap();
    (usdc_mint, resolver)
}

#[test]
fn test_initialize_config() {
    let (mut svm, payer, program_id) = setup();
    let usdc_mint = Keypair::new().pubkey();
    let resolver = Keypair::new().pubkey();
    send(
        &mut svm,
        &[init_config_ix(program_id, payer.pubkey(), usdc_mint, resolver)],
        &payer,
    )
    .unwrap();

    let acct = svm.get_account(&config_pda(program_id)).unwrap();
    let mut data = acct.data.as_slice();
    let config = mention::Config::try_deserialize(&mut data).unwrap();
    assert_eq!(config.authority, payer.pubkey());
    assert_eq!(config.resolver, resolver);
    assert_eq!(config.usdc_mint, usdc_mint);
    assert_eq!(config.fee_bps, 100);
    assert!(!config.paused);
}

#[test]
fn test_create_market_binary() {
    let (mut svm, payer, program_id) = setup();
    bootstrap(&mut svm, &payer, program_id);

    let end_time = unix_now(&svm) + 3_600;
    let (ix, market_pda) = create_market_ix(
        program_id,
        payer.pubkey(),
        1,
        mention::MarketType::Binary,
        mention::AssetKind::Sol,
        vec![],
        end_time,
    );
    send(&mut svm, &[ix], &payer).unwrap();

    let market = read_market(&svm, market_pda);
    assert_eq!(market.id, 1);
    assert_eq!(market.creator, payer.pubkey());
    assert_eq!(market.status, mention::MarketStatus::Open);
    assert_eq!(market.market_type, mention::MarketType::Binary);
    assert_eq!(market.asset, mention::AssetKind::Sol);
    assert_eq!(market.b, 100_000);
    assert_eq!(market.end_time, end_time);
    assert_eq!(market.creator_fee_bps, 100);
    assert_eq!(market.yes_shares, 0);
    assert_eq!(market.no_shares, 0);
    assert!(market.winning_outcome.is_empty());
    assert!(market.words.is_empty());
}

#[test]
fn test_create_market_majority_words() {
    let (mut svm, payer, program_id) = setup();
    bootstrap(&mut svm, &payer, program_id);

    let (ix, market_pda) = create_market_ix(
        program_id,
        payer.pubkey(),
        2,
        mention::MarketType::Majority,
        mention::AssetKind::Sol,
        vec!["AI".into(), "agents".into(), "Solana".into()],
        unix_now(&svm) + 3_600,
    );
    send(&mut svm, &[ix], &payer).unwrap();

    let market = read_market(&svm, market_pda);
    assert_eq!(market.market_type, mention::MarketType::Majority);
    assert_eq!(market.words.len(), 3);
    assert_eq!(market.words[0].word, "AI");
    assert_eq!(market.words[0].pool, 0);
    assert_eq!(market.words[2].word, "Solana");
}

#[test]
fn test_create_market_rejects_past_end_time() {
    let (mut svm, payer, program_id) = setup();
    bootstrap(&mut svm, &payer, program_id);

    let (ix, _) = create_market_ix(
        program_id,
        payer.pubkey(),
        3,
        mention::MarketType::Binary,
        mention::AssetKind::Sol,
        vec![],
        unix_now(&svm) - 10,
    );
    let err = send(&mut svm, &[ix], &payer).unwrap_err();
    assert!(
        err.contains("Custom") || err.contains("InvalidEndTime"),
        "unexpected error: {err}"
    );
}

#[test]
fn test_duplicate_market_id_fails() {
    let (mut svm, payer, program_id) = setup();
    bootstrap(&mut svm, &payer, program_id);

    let end = unix_now(&svm) + 3_600;
    let (ix, _) = create_market_ix(
        program_id,
        payer.pubkey(),
        4,
        mention::MarketType::Binary,
        mention::AssetKind::Sol,
        vec![],
        end,
    );
    send(&mut svm, &[ix.clone()], &payer).unwrap();
    assert!(send(&mut svm, &[ix], &payer).is_err());
}

#[test]
fn test_lock_market_only_after_end() {
    let (mut svm, payer, program_id) = setup();
    bootstrap(&mut svm, &payer, program_id);

    let end_time = unix_now(&svm) + 5;
    let (ix, market_pda) = create_market_ix(
        program_id,
        payer.pubkey(),
        5,
        mention::MarketType::Binary,
        mention::AssetKind::Sol,
        vec![],
        end_time,
    );
    send(&mut svm, &[ix], &payer).unwrap();

    let lock_ix = lock_market_ix(program_id, payer.pubkey(), market_pda);
    // Too early: rejected.
    assert!(send(&mut svm, &[lock_ix.clone()], &payer).is_err());
    assert_eq!(read_market(&svm, market_pda).status, mention::MarketStatus::Open);

    // Advance the clock past end_time, then lock succeeds.
    let mut clock = svm.get_sysvar::<Clock>();
    clock.unix_timestamp = end_time + 1;
    svm.set_sysvar(&clock);
    svm.expire_blockhash();

    send(&mut svm, &[lock_ix], &payer).unwrap();
    assert_eq!(
        read_market(&svm, market_pda).status,
        mention::MarketStatus::Locked
    );
}

// ---------------------------------------------------------------------------
// Trading / betting / resolution helpers (SOL markets)
// ---------------------------------------------------------------------------

fn vault_pda(program_id: Pubkey, market: Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"vault", market.as_ref()], &program_id).0
}

fn position_pda(program_id: Pubkey, market: Pubkey, owner: Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[b"position", market.as_ref(), owner.as_ref()],
        &program_id,
    )
    .0
}

fn read_position(svm: &LiteSVM, pda: Pubkey) -> mention::Position {
    let acct = svm.get_account(&pda).expect("position account");
    let mut data = acct.data.as_slice();
    mention::Position::try_deserialize(&mut data).expect("deserialize position")
}

fn advance(svm: &mut LiteSVM, secs: i64) {
    let mut clock = svm.get_sysvar::<Clock>();
    clock.unix_timestamp += secs;
    svm.set_sysvar(&clock);
    svm.expire_blockhash();
}

fn buy_binary_ix(
    program_id: Pubkey,
    trader: Pubkey,
    market: Pubkey,
    side: u8,
    cost: u64,
    min_shares: u64,
    usdc_mint: Pubkey,
) -> Instruction {
    Instruction::new_with_bytes(
        program_id,
        &mention::instruction::BuyBinary {
            side,
            cost,
            min_shares,
        }
        .data(),
        mention::accounts::BuyBinary {
            trader,
            config: config_pda(program_id),
            market,
            vault: vault_pda(program_id, market),
            position: position_pda(program_id, market, trader),
            trader_ata: None,
            vault_ata: None,
            mint: usdc_mint,
            token_program: TOKEN_PROGRAM_ID,
            associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
    )
}

fn sell_binary_ix(
    program_id: Pubkey,
    trader: Pubkey,
    market: Pubkey,
    side: u8,
    shares: u64,
    min_proceeds: u64,
    usdc_mint: Pubkey,
) -> Instruction {
    Instruction::new_with_bytes(
        program_id,
        &mention::instruction::SellBinary {
            side,
            shares,
            min_proceeds,
        }
        .data(),
        mention::accounts::SellBinary {
            trader,
            config: config_pda(program_id),
            market,
            vault: vault_pda(program_id, market),
            position: position_pda(program_id, market, trader),
            trader_ata: None,
            vault_ata: None,
            mint: usdc_mint,
            token_program: TOKEN_PROGRAM_ID,
            associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
    )
}

fn back_word_ix(
    program_id: Pubkey,
    backer: Pubkey,
    market: Pubkey,
    word: String,
    amount: u64,
    usdc_mint: Pubkey,
) -> Instruction {
    Instruction::new_with_bytes(
        program_id,
        &mention::instruction::BackWord { word, amount }.data(),
        mention::accounts::BackWord {
            backer,
            config: config_pda(program_id),
            market,
            vault: vault_pda(program_id, market),
            position: position_pda(program_id, market, backer),
            backer_ata: None,
            vault_ata: None,
            mint: usdc_mint,
            token_program: TOKEN_PROGRAM_ID,
            associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
    )
}

fn propose_ix(
    program_id: Pubkey,
    resolver: Pubkey,
    market: Pubkey,
    outcome: String,
    confidence: u8,
    evidence_hash: [u8; 32],
    usdc_mint: Pubkey,
) -> Instruction {
    Instruction::new_with_bytes(
        program_id,
        &mention::instruction::ProposeResolution {
            outcome,
            confidence,
            evidence_hash,
        }
        .data(),
        mention::accounts::ProposeResolution {
            resolver,
            config: config_pda(program_id),
            market,
            vault: vault_pda(program_id, market),
            resolver_ata: None,
            vault_ata: None,
            mint: usdc_mint,
            token_program: TOKEN_PROGRAM_ID,
            associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
    )
}

fn challenge_ix(
    program_id: Pubkey,
    challenger: Pubkey,
    market: Pubkey,
    usdc_mint: Pubkey,
) -> Instruction {
    Instruction::new_with_bytes(
        program_id,
        &mention::instruction::ChallengeResolution {}.data(),
        mention::accounts::ChallengeResolution {
            challenger,
            config: config_pda(program_id),
            market,
            vault: vault_pda(program_id, market),
            challenger_ata: None,
            vault_ata: None,
            mint: usdc_mint,
            token_program: TOKEN_PROGRAM_ID,
            associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
    )
}

fn finalize_ix(
    program_id: Pubkey,
    finalizer: Pubkey,
    market: Pubkey,
    proposer: Pubkey,
    usdc_mint: Pubkey,
) -> Instruction {
    Instruction::new_with_bytes(
        program_id,
        &mention::instruction::FinalizeResolution {}.data(),
        mention::accounts::FinalizeResolution {
            finalizer,
            config: config_pda(program_id),
            market,
            vault: vault_pda(program_id, market),
            proposer_ata: None,
            proposer_account: Some(proposer),
            vault_ata: None,
            mint: usdc_mint,
            token_program: TOKEN_PROGRAM_ID,
            associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
    )
}

fn claim_ix(
    program_id: Pubkey,
    claimant: Pubkey,
    market: Pubkey,
    usdc_mint: Pubkey,
) -> Instruction {
    Instruction::new_with_bytes(
        program_id,
        &mention::instruction::ClaimPayout {}.data(),
        mention::accounts::Claim {
            claimant,
            config: config_pda(program_id),
            market,
            vault: vault_pda(program_id, market),
            position: position_pda(program_id, market, claimant),
            claimant_ata: None,
            vault_ata: None,
            mint: usdc_mint,
            token_program: TOKEN_PROGRAM_ID,
            associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
    )
}

// ---------------------------------------------------------------------------
// Binary trading
// ---------------------------------------------------------------------------

#[test]
fn test_buy_binary_mints_shares() {
    let (mut svm, payer, program_id) = setup();
    let (usdc_mint, _resolver) = bootstrap(&mut svm, &payer, program_id);

    let end = unix_now(&svm) + 3_600;
    let (ix, market) = create_market_ix(
        program_id,
        payer.pubkey(),
        20,
        mention::MarketType::Binary,
        mention::AssetKind::Sol,
        vec![],
        end,
    );
    send(&mut svm, &[ix], &payer).unwrap();
    let vault_before = svm
        .get_account(&vault_pda(program_id, market))
        .unwrap()
        .lamports;

    let trader = Keypair::new();
    svm.airdrop(&trader.pubkey(), 10 * LAMPORTS).unwrap();
    send(
        &mut svm,
        &[buy_binary_ix(
            program_id,
            trader.pubkey(),
            market,
            0,
            1_000_000_000,
            0,
            usdc_mint,
        )],
        &trader,
    )
    .unwrap();

    let m = read_market(&svm, market);
    assert!(m.yes_shares > 0);
    assert_eq!(m.yes_cost, 1_000_000_000);
    assert_eq!(m.volume, 1_000_000_000);
    assert_eq!(m.traders, 1);

    let p = read_position(&svm, position_pda(program_id, market, trader.pubkey()));
    assert_eq!(p.yes_shares, m.yes_shares);
    assert_eq!(p.yes_cost, 1_000_000_000);

    let vault_after = svm
        .get_account(&vault_pda(program_id, market))
        .unwrap()
        .lamports;
    assert_eq!(vault_after, vault_before + 1_000_000_000);
}

#[test]
fn test_buy_sell_round_trip() {
    let (mut svm, payer, program_id) = setup();
    let (usdc_mint, _resolver) = bootstrap(&mut svm, &payer, program_id);

    let end = unix_now(&svm) + 3_600;
    let (ix, market) = create_market_ix(
        program_id,
        payer.pubkey(),
        21,
        mention::MarketType::Binary,
        mention::AssetKind::Sol,
        vec![],
        end,
    );
    send(&mut svm, &[ix], &payer).unwrap();
    let vault_before = svm
        .get_account(&vault_pda(program_id, market))
        .unwrap()
        .lamports;

    let trader = Keypair::new();
    svm.airdrop(&trader.pubkey(), 10 * LAMPORTS).unwrap();
    send(
        &mut svm,
        &[buy_binary_ix(
            program_id,
            trader.pubkey(),
            market,
            0,
            2_000_000_000,
            0,
            usdc_mint,
        )],
        &trader,
    )
    .unwrap();
    let held = read_market(&svm, market).yes_shares;
    assert!(held > 0);

    send(
        &mut svm,
        &[sell_binary_ix(
            program_id,
            trader.pubkey(),
            market,
            0,
            held,
            0,
            usdc_mint,
        )],
        &trader,
    )
    .unwrap();

    let m = read_market(&svm, market);
    assert_eq!(m.yes_shares, 0);
    assert_eq!(m.no_shares, 0);
    let p = read_position(&svm, position_pda(program_id, market, trader.pubkey()));
    assert_eq!(p.yes_shares, 0);
    assert_eq!(p.no_shares, 0);

    let vault_after = svm
        .get_account(&vault_pda(program_id, market))
        .unwrap()
        .lamports;
    let retained = vault_before.saturating_sub(vault_after);
    assert!(
        retained < 1_000_000,
        "vault should not drift by more than rounding, retained {retained}"
    );
}

#[test]
fn test_sell_without_holdings_rejected() {
    let (mut svm, payer, program_id) = setup();
    let (usdc_mint, _resolver) = bootstrap(&mut svm, &payer, program_id);

    let end = unix_now(&svm) + 3_600;
    let (ix, market) = create_market_ix(
        program_id,
        payer.pubkey(),
        22,
        mention::MarketType::Binary,
        mention::AssetKind::Sol,
        vec![],
        end,
    );
    send(&mut svm, &[ix], &payer).unwrap();

    let trader = Keypair::new();
    svm.airdrop(&trader.pubkey(), 10 * LAMPORTS).unwrap();
    // Position account does not exist yet.
    assert!(
        send(
            &mut svm,
            &[sell_binary_ix(
                program_id,
                trader.pubkey(),
                market,
                0,
                100,
                0,
                usdc_mint,
            )],
            &trader,
        )
        .is_err()
    );
}

#[test]
fn test_buy_slippage_detected() {
    let (mut svm, payer, program_id) = setup();
    let (usdc_mint, _resolver) = bootstrap(&mut svm, &payer, program_id);

    let end = unix_now(&svm) + 3_600;
    let (ix, market) = create_market_ix(
        program_id,
        payer.pubkey(),
        23,
        mention::MarketType::Binary,
        mention::AssetKind::Sol,
        vec![],
        end,
    );
    send(&mut svm, &[ix], &payer).unwrap();

    let trader = Keypair::new();
    svm.airdrop(&trader.pubkey(), 10 * LAMPORTS).unwrap();
    // Demand 10x more shares than a 1 SOL buy can ever produce.
    assert!(
        send(
            &mut svm,
            &[buy_binary_ix(
                program_id,
                trader.pubkey(),
                market,
                0,
                1_000_000_000,
                u64::MAX,
                usdc_mint,
            )],
            &trader,
        )
        .is_err()
    );
}

#[test]
fn test_buy_after_lock_rejected() {
    let (mut svm, payer, program_id) = setup();
    let (usdc_mint, _resolver) = bootstrap(&mut svm, &payer, program_id);

    let end = unix_now(&svm) + 5;
    let (ix, market) = create_market_ix(
        program_id,
        payer.pubkey(),
        24,
        mention::MarketType::Binary,
        mention::AssetKind::Sol,
        vec![],
        end,
    );
    send(&mut svm, &[ix], &payer).unwrap();
    advance(&mut svm, 6);
    send(&mut svm, &[lock_market_ix(program_id, payer.pubkey(), market)], &payer).unwrap();

    let trader = Keypair::new();
    svm.airdrop(&trader.pubkey(), 10 * LAMPORTS).unwrap();
    assert!(
        send(
            &mut svm,
            &[buy_binary_ix(
                program_id,
                trader.pubkey(),
                market,
                0,
                1_000_000_000,
                0,
                usdc_mint,
            )],
            &trader,
        )
        .is_err(),
        "buying into a locked market must fail"
    );
}

// ---------------------------------------------------------------------------
// Majority betting
// ---------------------------------------------------------------------------

#[test]
fn test_back_word_pools_grow() {
    let (mut svm, payer, program_id) = setup();
    let (usdc_mint, _resolver) = bootstrap(&mut svm, &payer, program_id);

    let end = unix_now(&svm) + 3_600;
    let (ix, market) = create_market_ix(
        program_id,
        payer.pubkey(),
        30,
        mention::MarketType::Majority,
        mention::AssetKind::Sol,
        vec!["AI".into(), "Solana".into()],
        end,
    );
    send(&mut svm, &[ix], &payer).unwrap();

    let a = Keypair::new();
    let b = Keypair::new();
    let c = Keypair::new();
    for kp in [&a, &b, &c] {
        svm.airdrop(&kp.pubkey(), 10 * LAMPORTS).unwrap();
    }
    send(
        &mut svm,
        &[back_word_ix(
            program_id,
            a.pubkey(),
            market,
            "AI".into(),
            3_000_000_000,
            usdc_mint,
        )],
        &a,
    )
    .unwrap();
    send(
        &mut svm,
        &[back_word_ix(
            program_id,
            b.pubkey(),
            market,
            "AI".into(),
            1_000_000_000,
            usdc_mint,
        )],
        &b,
    )
    .unwrap();
    send(
        &mut svm,
        &[back_word_ix(
            program_id,
            c.pubkey(),
            market,
            "Solana".into(),
            6_000_000_000,
            usdc_mint,
        )],
        &c,
    )
    .unwrap();

    let m = read_market(&svm, market);
    assert_eq!(m.words[0].word, "AI");
    assert_eq!(m.words[0].pool, 4_000_000_000);
    assert_eq!(m.words[0].bettors, 2);
    assert_eq!(m.words[1].pool, 6_000_000_000);
    assert_eq!(m.words[1].bettors, 1);
    assert_eq!(m.total_pool, 10_000_000_000);
    assert_eq!(m.volume, 10_000_000_000);
    assert_eq!(m.traders, 3);

    let pa = read_position(&svm, position_pda(program_id, market, a.pubkey()));
    assert_eq!(pa.word_backs.len(), 1);
    assert_eq!(pa.word_backs[0].word, "AI");
    assert_eq!(pa.word_backs[0].amount, 3_000_000_000);
}

#[test]
fn test_back_unknown_word_rejected() {
    let (mut svm, payer, program_id) = setup();
    let (usdc_mint, _resolver) = bootstrap(&mut svm, &payer, program_id);

    let end = unix_now(&svm) + 3_600;
    let (ix, market) = create_market_ix(
        program_id,
        payer.pubkey(),
        31,
        mention::MarketType::Majority,
        mention::AssetKind::Sol,
        vec!["AI".into(), "Solana".into()],
        end,
    );
    send(&mut svm, &[ix], &payer).unwrap();

    let backer = Keypair::new();
    svm.airdrop(&backer.pubkey(), 10 * LAMPORTS).unwrap();
    assert!(
        send(
            &mut svm,
            &[back_word_ix(
                program_id,
                backer.pubkey(),
                market,
                "nope".into(),
                1_000_000_000,
                usdc_mint,
            )],
            &backer,
        )
        .is_err()
    );
}

#[test]
fn test_wrong_market_type_rejected() {
    let (mut svm, payer, program_id) = setup();
    let (usdc_mint, _resolver) = bootstrap(&mut svm, &payer, program_id);

    let end = unix_now(&svm) + 3_600;
    let (ix_bin, market_bin) = create_market_ix(
        program_id,
        payer.pubkey(),
        32,
        mention::MarketType::Binary,
        mention::AssetKind::Sol,
        vec![],
        end,
    );
    let (ix_maj, market_maj) = create_market_ix(
        program_id,
        payer.pubkey(),
        33,
        mention::MarketType::Majority,
        mention::AssetKind::Sol,
        vec!["AI".into(), "Solana".into()],
        end,
    );
    send(&mut svm, &[ix_bin, ix_maj], &payer).unwrap();

    let trader = Keypair::new();
    svm.airdrop(&trader.pubkey(), 10 * LAMPORTS).unwrap();
    // BuyBinary on a majority market.
    assert!(
        send(
            &mut svm,
            &[buy_binary_ix(
                program_id,
                trader.pubkey(),
                market_maj,
                0,
                1_000_000_000,
                0,
                usdc_mint,
            )],
            &trader,
        )
        .is_err()
    );
    // BackWord on a binary market.
    assert!(
        send(
            &mut svm,
            &[back_word_ix(
                program_id,
                trader.pubkey(),
                market_bin,
                "AI".into(),
                1_000_000_000,
                usdc_mint,
            )],
            &trader,
        )
        .is_err()
    );
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

#[test]
fn test_resolution_state_machine() {
    let (mut svm, payer, program_id) = setup();
    let (usdc_mint, resolver) = bootstrap(&mut svm, &payer, program_id);
    // Two bonds (propose -> challenge -> re-propose) come out of this wallet.
    svm.airdrop(&resolver.pubkey(), 300 * LAMPORTS).unwrap();
    let challenger = Keypair::new();
    svm.airdrop(&challenger.pubkey(), 100 * LAMPORTS).unwrap();

    let end = unix_now(&svm) + 5;
    let (ix, market) = create_market_ix(
        program_id,
        payer.pubkey(),
        40,
        mention::MarketType::Binary,
        mention::AssetKind::Sol,
        vec![],
        end,
    );
    send(&mut svm, &[ix], &payer).unwrap();
    advance(&mut svm, 6);
    send(&mut svm, &[lock_market_ix(program_id, payer.pubkey(), market)], &payer).unwrap();

    // Propose while locked is fine; non-resolver is not.
    let attacker = Keypair::new();
    svm.airdrop(&attacker.pubkey(), 100 * LAMPORTS).unwrap();
    assert!(
        send(
            &mut svm,
            &[propose_ix(
                program_id,
                attacker.pubkey(),
                market,
                "yes".into(),
                100,
                [7u8; 32],
                usdc_mint,
            )],
            &attacker,
        )
        .is_err(),
        "non-resolver must not be able to propose"
    );

    let bond = 50_000_000_000u64;
    let resolver_before = svm.get_account(&resolver.pubkey()).unwrap().lamports;
    let now = unix_now(&svm);
    send(
        &mut svm,
        &[propose_ix(
            program_id,
            resolver.pubkey(),
            market,
            "yes".into(),
            100,
            [7u8; 32],
            usdc_mint,
        )],
        &resolver,
    )
    .unwrap();

    let m = read_market(&svm, market);
    assert_eq!(m.status, mention::MarketStatus::Resolving);
    assert_eq!(m.winning_outcome, "yes");
    assert_eq!(m.proposer, resolver.pubkey());
    assert_eq!(m.bond, bond);
    assert_eq!(m.proposed_at, now);
    assert_eq!(m.challenge_deadline, now + 120);
    let resolver_after_propose = svm.get_account(&resolver.pubkey()).unwrap().lamports;
    assert!(
        resolver_before - resolver_after_propose >= bond
            && resolver_before - resolver_after_propose <= bond + 10_000_000,
        "resolver should be debited the bond (and only tx fees)"
    );

    // Challenge resets to Locked.
    send(
        &mut svm,
        &[challenge_ix(program_id, challenger.pubkey(), market, usdc_mint)],
        &challenger,
    )
    .unwrap();
    let m = read_market(&svm, market);
    assert_eq!(m.status, mention::MarketStatus::Locked);
    assert_eq!(m.challenge_deadline, 0);

    // Re-propose, then finalize too early must fail.
    send(
        &mut svm,
        &[propose_ix(
            program_id,
            resolver.pubkey(),
            market,
            "no".into(),
            90,
            [8u8; 32],
            usdc_mint,
        )],
        &resolver,
    )
    .unwrap();
    let m = read_market(&svm, market);
    assert_eq!(m.status, mention::MarketStatus::Resolving);
    assert_eq!(m.winning_outcome, "no");
    assert!(
        send(
            &mut svm,
            &[finalize_ix(program_id, payer.pubkey(), market, resolver.pubkey(), usdc_mint)],
            &payer,
        )
        .is_err(),
        "finalize must fail inside the challenge window"
    );

    // After the window elapses, finalize succeeds and refunds the current bond.
    advance(&mut svm, 121);
    send(
        &mut svm,
        &[finalize_ix(program_id, payer.pubkey(), market, resolver.pubkey(), usdc_mint)],
        &payer,
    )
    .unwrap();

    let m = read_market(&svm, market);
    assert_eq!(m.status, mention::MarketStatus::Resolved);
    assert_eq!(m.bond, 0);
    assert!(m.resolved_at > 0);
    // The current (2nd) proposal's bond is refunded; the 1st proposer bond and
    // challenger bond stay in the vault. Resolver nets exactly one bond out.
    let resolver_after = svm.get_account(&resolver.pubkey()).unwrap().lamports;
    assert!(
        (resolver_before as i128 - resolver_after as i128 - bond as i128).abs() <= 10_000_000,
        "resolver should pay exactly one forfeited bond"
    );
    let challenger_after = svm.get_account(&challenger.pubkey()).unwrap().lamports;
    assert!(
        challenger_after <= 100 * LAMPORTS - bond,
        "challenger bond must be forfeited"
    );
}

// ---------------------------------------------------------------------------
// Claims / settlement
// ---------------------------------------------------------------------------

fn resolve_market(
    svm: &mut LiteSVM,
    program_id: Pubkey,
    market: Pubkey,
    resolver: &Keypair,
    outcome: &str,
    payer: &Keypair,
    usdc_mint: Pubkey,
) {
    let end = read_market(svm, market).end_time;
    advance(svm, end + 1 - unix_now(svm));
    send(svm, &[lock_market_ix(program_id, payer.pubkey(), market)], payer).unwrap();
    send(
        svm,
        &[propose_ix(
            program_id,
            resolver.pubkey(),
            market,
            outcome.into(),
            100,
            [9u8; 32],
            usdc_mint,
        )],
        resolver,
    )
    .unwrap();
    advance(svm, 121);
    send(
        svm,
        &[finalize_ix(
            program_id,
            payer.pubkey(),
            market,
            resolver.pubkey(),
            usdc_mint,
        )],
        payer,
    )
    .unwrap();
}

#[test]
fn test_binary_claim_payout() {
    let (mut svm, payer, program_id) = setup();
    let (usdc_mint, resolver) = bootstrap(&mut svm, &payer, program_id);

    let end = unix_now(&svm) + 5;
    let (ix, market) = create_market_ix(
        program_id,
        payer.pubkey(),
        50,
        mention::MarketType::Binary,
        mention::AssetKind::Sol,
        vec![],
        end,
    );
    send(&mut svm, &[ix], &payer).unwrap();

    let yes_trader = Keypair::new();
    let no_trader = Keypair::new();
    svm.airdrop(&yes_trader.pubkey(), 10 * LAMPORTS).unwrap();
    svm.airdrop(&no_trader.pubkey(), 10 * LAMPORTS).unwrap();
    send(
        &mut svm,
        &[buy_binary_ix(
            program_id,
            yes_trader.pubkey(),
            market,
            0,
            1_000_000_000,
            0,
            usdc_mint,
        )],
        &yes_trader,
    )
    .unwrap();
    send(
        &mut svm,
        &[buy_binary_ix(
            program_id,
            no_trader.pubkey(),
            market,
            1,
            900_000_000,
            0,
            usdc_mint,
        )],
        &no_trader,
    )
    .unwrap();
    let yes_shares = read_market(&svm, market).yes_shares;
    assert!(yes_shares > 0);

    resolve_market(&mut svm, program_id, market, &resolver, "yes", &payer, usdc_mint);

    // YES trader redeems winning shares 1:1.
    let yes_before = svm.get_account(&yes_trader.pubkey()).unwrap().lamports;
    send(
        &mut svm,
        &[claim_ix(program_id, yes_trader.pubkey(), market, usdc_mint)],
        &yes_trader,
    )
    .unwrap();
    let yes_after = svm.get_account(&yes_trader.pubkey()).unwrap().lamports;
    let claimed = yes_after - yes_before;
    assert!(
        (claimed as i128 - yes_shares as i128).abs() <= 10_000_000,
        "binary claim pays winning shares 1:1, got {claimed} for {yes_shares}"
    );
    let p = read_position(&svm, position_pda(program_id, market, yes_trader.pubkey()));
    assert!(p.claimed);
    assert_eq!(p.yes_shares, 0);

    // Double claim is rejected.
    assert!(
        send(
            &mut svm,
            &[claim_ix(program_id, yes_trader.pubkey(), market, usdc_mint)],
            &yes_trader,
        )
        .is_err(),
        "double claim must fail"
    );

    // NO trader holds no winning shares.
    assert!(
        send(
            &mut svm,
            &[claim_ix(program_id, no_trader.pubkey(), market, usdc_mint)],
            &no_trader,
        )
        .is_err(),
        "claiming a losing side must fail"
    );
}

#[test]
fn test_majority_claim_pro_rata() {
    let (mut svm, payer, program_id) = setup();
    let (usdc_mint, resolver) = bootstrap(&mut svm, &payer, program_id);

    let end = unix_now(&svm) + 5;
    let (ix, market) = create_market_ix(
        program_id,
        payer.pubkey(),
        51,
        mention::MarketType::Majority,
        mention::AssetKind::Sol,
        vec!["AI".into(), "Solana".into()],
        end,
    );
    send(&mut svm, &[ix], &payer).unwrap();

    let a = Keypair::new();
    let b = Keypair::new();
    let c = Keypair::new();
    for kp in [&a, &b, &c] {
        svm.airdrop(&kp.pubkey(), 10 * LAMPORTS).unwrap();
    }
    send(
        &mut svm,
        &[back_word_ix(
            program_id,
            a.pubkey(),
            market,
            "AI".into(),
            3_000_000_000,
            usdc_mint,
        )],
        &a,
    )
    .unwrap();
    send(
        &mut svm,
        &[back_word_ix(
            program_id,
            b.pubkey(),
            market,
            "AI".into(),
            1_000_000_000,
            usdc_mint,
        )],
        &b,
    )
    .unwrap();
    send(
        &mut svm,
        &[back_word_ix(
            program_id,
            c.pubkey(),
            market,
            "Solana".into(),
            6_000_000_000,
            usdc_mint,
        )],
        &c,
    )
    .unwrap();

    resolve_market(&mut svm, program_id, market, &resolver, "AI", &payer, usdc_mint);

    // total_pool = 10e9, win_pool(AI) = 4e9, fee = 100 bps.
    // net_pot = 10e9 * 0.99 = 9.9e9 (floored stays integral).
    // A: 3/4 * 9.9e9 = 7_425_000_000 ; B: 1/4 * 9.9e9 = 2_475_000_000.
    let a_before = svm.get_account(&a.pubkey()).unwrap().lamports;
    send(
        &mut svm,
        &[claim_ix(program_id, a.pubkey(), market, usdc_mint)],
        &a,
    )
    .unwrap();
    let a_after = svm.get_account(&a.pubkey()).unwrap().lamports;
    let a_delta = a_after as i128 - a_before as i128;
    assert!(
        (a_delta - 7_425_000_000i128).abs() <= 10_000_000,
        "A should claim 7.425 SOL, delta = {a_delta}"
    );

    let b_before = svm.get_account(&b.pubkey()).unwrap().lamports;
    send(
        &mut svm,
        &[claim_ix(program_id, b.pubkey(), market, usdc_mint)],
        &b,
    )
    .unwrap();
    let b_after = svm.get_account(&b.pubkey()).unwrap().lamports;
    let b_delta = b_after as i128 - b_before as i128;
    assert!(
        (b_delta - 2_475_000_000i128).abs() <= 10_000_000,
        "B should claim 2.475 SOL, delta = {b_delta}"
    );

    // Losing backer gets nothing.
    assert!(
        send(
            &mut svm,
            &[claim_ix(program_id, c.pubkey(), market, usdc_mint)],
            &c,
        )
        .is_err()
    );

    // The rake stays in the vault: 10e9 in, 9.9e9 out.
    let vault = svm
        .get_account(&vault_pda(program_id, market))
        .unwrap()
        .lamports;
    let rent_floor = 0; // lambda: vault also holds any forfeited capacity, here zero because bonds refunded
    let _ = rent_floor;
    assert!(
        vault >= 100_000_000 && vault < 1_000_000_000,
        "vault should retain the ~0.1 SOL rake, got {vault}"
    );
}

#[test]
fn test_claim_before_resolved_rejected() {
    let (mut svm, payer, program_id) = setup();
    let (usdc_mint, _resolver) = bootstrap(&mut svm, &payer, program_id);

    let end = unix_now(&svm) + 3_600;
    let (ix, market) = create_market_ix(
        program_id,
        payer.pubkey(),
        52,
        mention::MarketType::Binary,
        mention::AssetKind::Sol,
        vec![],
        end,
    );
    send(&mut svm, &[ix], &payer).unwrap();

    let trader = Keypair::new();
    svm.airdrop(&trader.pubkey(), 10 * LAMPORTS).unwrap();
    send(
        &mut svm,
        &[buy_binary_ix(
            program_id,
            trader.pubkey(),
            market,
            0,
            1_000_000_000,
            0,
            usdc_mint,
        )],
        &trader,
    )
    .unwrap();

    assert!(
        send(
            &mut svm,
            &[claim_ix(program_id, trader.pubkey(), market, usdc_mint)],
            &trader,
        )
        .is_err(),
        "claiming an unresolved market must fail"
    );
}

#[test]
fn test_usdc_buy_requires_ata() {
    let (mut svm, payer, program_id) = setup();
    let (usdc_mint, _resolver) = bootstrap(&mut svm, &payer, program_id);

    let end = unix_now(&svm) + 3_600;
    let (ix, market) = create_market_ix(
        program_id,
        payer.pubkey(),
        53,
        mention::MarketType::Binary,
        mention::AssetKind::Usdc,
        vec![],
        end,
    );
    send(&mut svm, &[ix], &payer).unwrap();

    let trader = Keypair::new();
    svm.airdrop(&trader.pubkey(), 10 * LAMPORTS).unwrap();
    // No ATAs passed: the USDC branch must reject before any transfer.
    assert!(
        send(
            &mut svm,
            &[buy_binary_ix(
                program_id,
                trader.pubkey(),
                market,
                0,
                1_000_000_000,
                0,
                usdc_mint,
            )],
            &trader,
        )
        .is_err()
    );
}
