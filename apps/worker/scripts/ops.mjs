// Operator CLI for the resolution queue (until the /ops page lands).
//
//   pnpm --filter @mention/worker ops list [state…]
//   pnpm --filter @mention/worker ops show <id|address>
//   pnpm --filter @mention/worker ops approve <id|address> --rationale "…" [--outcome yes|no|<word>|void]
//   pnpm --filter @mention/worker ops retry <id|address> [--audio-start 2026-10-15T12:00:00Z]
//
// Needs DATABASE_URL. The reviewer recorded on-chain is OPS_REVIEWER (default:
// your OS user name) — the /ops page will use the operator's wallet instead.

import os from "node:os";

import { getDb } from "@mention/db";
import { createResolutionQueue, STATES } from "@mention/resolver/queue";
import { getSpec } from "@mention/resolver/store";

const db = getDb();
if (!db) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
const queue = createResolutionQueue({ db });
const [command, target, ...rest] = process.argv.slice(2);

function flag(name) {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
}

async function resolveRow(ref) {
  if (!ref) throw new Error("pass a market id or address");
  const rows = await queue.list();
  const row = rows.find((r) => r.marketAddress === ref || String(r.marketId) === ref.replace(/^[mc]/, ""));
  if (!row) throw new Error(`market ${ref} is not in the resolution queue`);
  return row;
}

const fmtTime = (ms) => (ms ? new Date(ms).toISOString().replace(".000", "") : "—");

function summary(r) {
  const c = r.candidate;
  const verdict = c ? `${c.status}${c.outcome ? ` → "${c.outcome}"` : ""}` : "—";
  return `m${r.marketId}  ${r.state.padEnd(12)} round ${r.round}  evaluator: ${verdict}${r.approvedOutcome ? `  approved: "${r.approvedOutcome}" by ${r.reviewer}` : ""}${r.statusReason ? `\n      ${r.statusReason}` : ""}${r.lastError ? `\n      last error: ${r.lastError}` : ""}`;
}

try {
  switch (command) {
    case "list": {
      const states = target ? [target, ...rest] : STATES;
      const rows = await queue.list({ states });
      if (rows.length === 0) console.log("queue is empty");
      for (const r of rows) console.log(summary(r));
      break;
    }
    case "show": {
      const row = await resolveRow(target);
      const full = await queue.get(row.marketAddress);
      console.log(summary(full));
      console.log(`  address        ${full.marketAddress}`);
      console.log(`  audio start    ${fmtTime(full.audioStartedAt)}   transcribed ${fmtTime(full.transcribedAt)}`);
      for (const e of full.candidate?.excerpts ?? []) {
        console.log(`  excerpt        [${fmtTime(e.startMs)}] ${e.speaker}: ${e.text}`);
      }
      for (const w of full.candidate?.warnings ?? []) console.log(`  warning        ${w}`);
      if (full.transcript) {
        const text = full.transcript.words.map((w) => w[3]).join(" ");
        console.log(`  transcript     ${text.slice(0, 600)}${text.length > 600 ? "…" : ""}`);
      }
      for (const sig of full.txSigs) console.log(`  tx             ${sig}`);
      break;
    }
    case "approve": {
      const row = await resolveRow(target);
      const record = await getSpec(row.marketAddress);
      const updated = await queue.approve(row.marketAddress, {
        reviewer: process.env.OPS_REVIEWER || os.userInfo().username,
        rationale: flag("rationale"),
        outcome: flag("outcome"),
        spec: record?.spec,
      });
      console.log(`approved "${updated.approvedOutcome}" — the worker proposes it on its next pass`);
      break;
    }
    case "retry": {
      const row = await resolveRow(target);
      const start = flag("audio-start");
      const audioStartedAt = start === undefined ? undefined : Date.parse(start);
      if (start !== undefined && !Number.isFinite(audioStartedAt)) throw new Error(`bad --audio-start: ${start}`);
      await queue.retry(row.marketAddress, { audioStartedAt });
      console.log("queued for re-evaluation");
      break;
    }
    default:
      console.log("usage: ops list [state…] | show <m> | approve <m> --rationale … [--outcome …] | retry <m> [--audio-start ISO]");
      process.exit(command ? 1 : 0);
  }
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
