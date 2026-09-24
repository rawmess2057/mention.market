import {
  bn,
  programFor,
  deployKeypair,
  marketPda,
  vaultPda,
  positionPda,
  CONFIG_PDA,
  USDC_MINT,
  SYSTEM_PROGRAM,
  TOKEN_PROGRAM,
  ATA_PROGRAM,
  sharesForCost,
  enumKey,
  budget,
  lmsrSellValue,
} from "./lib.mjs";

const ID = Number(process.env.SMOKE_ID || 9999);
const ENDS_IN_SEC = Number(process.env.SMOKE_END_IN_SEC || 600);

const kp = deployKeypair();
const program = programFor(kp);

const market = marketPda(ID);
const existing = await program.account.market.fetch(market).catch(() => null);
if (existing) {
  console.log("Market", ID, "already exists:", existing.title, "/", enumKey(existing.status));
} else {
  const now = Math.floor(Date.now() / 1000);
  const tx = await program.methods
    .createMarket(
      bn(ID),
      "Smoke test market",
      "devnet e2e",
      { streams: {} },
      { binary: {} },
      { sol: {} },
      bn(5_000_000_000),
      [],
      bn(now + ENDS_IN_SEC),
      100
    )
    .accounts({
      creator: kp.publicKey,
      config: CONFIG_PDA,
      market,
      vault: vaultPda(market),
      systemProgram: SYSTEM_PROGRAM,
    })
    .rpc();
  console.log("Created market", ID, ":", tx);
}

const m = await program.account.market.fetch(market);
console.log("Decoded market:", JSON.stringify({
  id: m.id.toString(),
  title: m.title,
  vertical: enumKey(m.vertical),
  type: enumKey(m.marketType),
  asset: enumKey(m.asset),
  status: enumKey(m.status),
  b: m.b.toString(),
  yesShares: m.yesShares.toString(),
  noShares: m.noShares.toString(),
}, null, 2));

const cost = 5_000_000; // 0.005 SOL
const shares = Math.floor(
  sharesForCost(Number(m.yesShares), Number(m.noShares), Number(m.b), 0, Number(cost))
);
const minShares = Math.floor(shares * 0.98);

if (shares > 0) {
  const tx = await program.methods
    .buyBinary(0, bn(cost), bn(minShares))
    .accounts({
      trader: kp.publicKey,
      config: CONFIG_PDA,
      market,
      vault: vaultPda(market),
      position: positionPda(market, kp.publicKey),
      traderAta: null,
      vaultAta: null,
      mint: USDC_MINT,
      tokenProgram: TOKEN_PROGRAM,
      associatedTokenProgram: ATA_PROGRAM,
      systemProgram: SYSTEM_PROGRAM,
    })
    .preInstructions(budget())
    .rpc();
  console.log("Bought", shares, "YES for", cost.toString(), "lamports:", tx);

  const m2 = await program.account.market.fetch(market);
  const pos = await program.account.position.fetch(positionPda(market, kp.publicKey));
  console.log("Position after buy:", { yesShares: pos.yesShares.toString(), noShares: pos.noShares.toString(), claimed: pos.claimed });

  const sellShares = Math.floor(shares / 2);
  const proceeds = Math.floor(
    lmsrSellValue(Number(m2.yesShares), Number(m2.noShares), Number(m2.b), 0, Number(sellShares))
  );
  const minProceeds = Math.floor(proceeds * 0.98);
  if (proceeds > 0) {
    const txs = await program.methods
      .sellBinary(0, bn(sellShares), bn(minProceeds))
      .accounts({
        trader: kp.publicKey,
        config: CONFIG_PDA,
        market,
        vault: vaultPda(market),
        position: positionPda(market, kp.publicKey),
        traderAta: null,
        vaultAta: null,
        mint: USDC_MINT,
        tokenProgram: TOKEN_PROGRAM,
        associatedTokenProgram: ATA_PROGRAM,
        systemProgram: SYSTEM_PROGRAM,
      })
      .preInstructions(budget())
      .rpc();
    console.log("Sold", sellShares.toString(), "YES for", proceeds, "lamports:", txs);
  }
} else {
  console.log("Skipped buy: LMSR produced no shares for that cost.");
}

const finalM = await program.account.market.fetch(market);
console.log("Final:", JSON.stringify({
  yesShares: finalM.yesShares.toString(),
  noShares: finalM.noShares.toString(),
  volume: finalM.volume.toString(),
  traders: finalM.traders,
}));