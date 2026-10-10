import { programFor, deployKeypair, ensureResolverKeypair, fetchOrNull, CONFIG_PDA, SYSTEM_PROGRAM } from "./lib.mjs";

const kp = deployKeypair();
const program = programFor(kp);
const resolver = ensureResolverKeypair();

const existing = await fetchOrNull(program.account.config.fetch(CONFIG_PDA));
if (existing) {
  console.log("Config already initialized:");
  console.log("  authority =", existing.authority.toBase58());
  console.log("  resolver  =", existing.resolver.toBase58());
  console.log("  fee_bps   =", existing.feeBps);
  console.log("  paused    =", existing.paused);
  process.exit(0);
}

const feeBps = Number(process.env.FEE_BPS || 100);

const tx = await program.methods
  .initializeConfig(feeBps)
  .accounts({
    authority: kp.publicKey,
    config: CONFIG_PDA,
    resolver: resolver.publicKey,
    systemProgram: SYSTEM_PROGRAM,
  })
  .rpc();

console.log("Config initialized:", tx);
const c = await program.account.config.fetch(CONFIG_PDA);
console.log("  resolver  =", c.resolver.toBase58());
console.log("  fee_bps   =", c.feeBps);