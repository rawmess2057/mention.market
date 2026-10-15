"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Check, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/format";
import { useSim } from "@/lib/sim";
import { useChain } from "@/hooks/useChain";
import {
  CHAIN_CREATE_B_UI,
  MAX_TITLE_BYTES,
  MIN_CREATE_MINUTES,
  byteLength,
  chainCreateProblems,
  chainCreateTitle,
  chainErrorText,
} from "@/lib/chain";
import { VERTICAL_META, type Market, type Vertical } from "@/lib/types";
import {
  PICKER_CATEGORIES,
  PickerCategory,
  resolveCategory,
  type Vertical as ProgramVertical,
} from "@/lib/create-categories";

const WORD_LIMIT = 12;

export default function CreateMarketPage() {
  const router = useRouter();
  const { connected } = useWallet();
  const { setVisible } = useWalletModal();
  const createMarket = useSim((s) => s.createMarket);
  const showToast = useSim((s) => s.showToast);
  const chain = useChain();
  const [submitting, setSubmitting] = useState(false);

  const [step, setStep] = useState(0);
  const [category, setCategory] = useState<PickerCategory>("Crypto" as PickerCategory);
  const [vertical, setVertical] = useState<ProgramVertical>("streams");
  const [event, setEvent] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [type, setType] = useState<Market["type"]>("binary");
  const [question, setQuestion] = useState("");
  const [binaryPhrase, setBinaryPhrase] = useState("");
  const [words, setWords] = useState<string[]>([]);
  const [wordInput, setWordInput] = useState("");
  const [minutes, setMinutes] = useState("60");
  const [rules, setRules] = useState("");

  const canNext =
    (step === 0 && event.trim().length > 2 && isHttpUrl(sourceUrl)) ||
    step === 1 ||
    (step === 2 && (type === "binary" ? question.trim().length > 5 && binaryPhrase.trim().length > 0 : words.length >= 2)) ||
    step === 3;

  /**
   * The exact parameters the program and the store receive. The title is
   * derived through `chainCreateTitle` so the limit check below measures the
   * same bytes the program will (word races send "Word race: <event>").
   */
  const buildParams = () => {
    const trimmedEvent = event.trim();
    return {
      title: chainCreateTitle({ type, event: trimmedEvent, title: question.trim() }),
      event: trimmedEvent,
      sourceUrl: sourceUrl.trim(),
      vertical,
      type,
      words,
      binaryPhrase: binaryPhrase.trim(),
      minutes: Math.max(MIN_CREATE_MINUTES, parseInt(minutes) || 60),
      rules:
        rules.trim() ||
        (type === "binary"
          ? `Resolves YES if the exact phrase from the title is spoken during the event (case-insensitive). Transcript: Deepgram primary feed.`
          : `First phrase from the board spoken during the event wins. Case-insensitive. 1% rake.`),
    };
  };

  // Everything the program would reject, computed before any wallet prompt.
  const problems = chainCreateProblems(buildParams());

  const submit = async (local = false) => {
    setSubmitting(true);
    const params = buildParams();
    if (!local && !connected) {
      setSubmitting(false);
      setVisible(true);
      return;
    }
    if (!local) {
      try {
        const launched = await chain.create(params);
        if (launched == null) throw new Error("Wallet is not ready to create an on-chain market.");
        const id = createMarket({ ...params, chainId: launched.id });
        if (!launched.specSaved) {
          showToast(
            "Market is live, but its resolution rules couldn't be saved, so it can't be resolved yet. Ask an operator to register it."
          );
        }
        const created = useSim.getState().markets[id];
        router.push(`/market/${created.slug}`);
        return;
      } catch (err) {
        // Never fake the on-chain moment: surface the failure and let the
        // presenter retry or explicitly pick the offline mode below.
        showToast(`On-chain create failed: ${chainErrorText(err)}`);
        setSubmitting(false);
        return;
      }
    }
    const id = createMarket(params);
    const created = useSim.getState().markets[id];
    router.push(`/market/${created.slug}`);
  };

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-fg">Create a market</h1>
        <p className="text-sm text-fg-muted">
          Pick an event, define the words, and launch a market on Solana.
        </p>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-1.5">
        {["Event", "Type", "Words", "Rules"].map((label, i) => (
          <button
            key={label}
            onClick={() => i <= step && setStep(i)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-full border py-1.5 text-[11px] font-medium transition-colors",
              i === step
                ? "border-accent bg-accent-soft text-accent"
                : i < step
                  ? "border-yes/40 bg-yes-soft text-yes"
                  : "border-line text-fg-muted"
            )}
          >
            {i < step ? <Check className="h-3 w-3" /> : <span>{i + 1}</span>}
            {label}
          </button>
        ))}
      </div>

      {/* Step 0: event */}
      {step === 0 && (
        <div className="space-y-3 animate-fade-in">
          <Label>Category</Label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {PICKER_CATEGORIES.map((c) => (
              <button
                key={c.label}
                onClick={() => setCategory(c.label as PickerCategory)}
                className={cn(
                  "rounded-xl border p-3 text-sm font-medium transition-all",
                  category === c.label
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-line text-fg hover:border-accent/40"
                )}
              >
                <span className="mr-1.5">{c.emoji}</span>
                {c.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-fg-muted">
            {PICKER_CATEGORIES.find((c) => c.label === category)?.hint ?? ""}
          </p>
          <Label>Event name</Label>
          <Input
            placeholder="e.g. Solana Speedrun #13 — live dev stream"
            value={event}
            onChange={(e) => setEvent(e.target.value)}
          />
          <ByteHint
            label="Event name"
            value={event}
            limit={MAX_TITLE_BYTES}
            prefix={type === "majority" ? "Word race: " : ""}
          />
          <Label>Primary source URL</Label>
          <Input
            type="url"
            placeholder="https://example.com/live-event"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
          />
        </div>
      )}

      {/* Step 1: type */}
      {step === 1 && (
        <div className="grid gap-3 animate-fade-in sm:grid-cols-2">
          {(
            [
              {
                key: "binary",
                title: "Binary",
                desc: "YES / NO on a phrase being said. LMSR pricing.",
              },
              {
                key: "majority",
                title: "Word race",
                desc: "Back words; winners split the pot pari-mutuel.",
              },
            ] as Array<{ key: Market["type"]; title: string; desc: string }>
          ).map((t) => (
            <button
              key={t.key}
              onClick={() => setType(t.key)}
              className={cn(
                "rounded-xl border p-4 text-left transition-all",
                type === t.key ? "border-accent bg-accent-soft text-fg" : "border-line text-fg hover:border-accent/40"
              )}
            >
              <div className="font-semibold">{t.title}</div>
              <div className="mt-1 text-xs text-fg-muted">{t.desc}</div>
            </button>
          ))}
        </div>
      )}

      {/* Step 2: words / question */}
      {step === 2 && (
        <div className="space-y-3 animate-fade-in">
          {type === "binary" ? (
            <>
              <Label>Market question</Label>
              <Input
                placeholder={"Will they say \u201cAI\u201d?"}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
              />
              <ByteHint label="Question" value={question} limit={MAX_TITLE_BYTES} />
              <Label>Exact phrase to detect</Label>
              <Input
                placeholder="AI"
                value={binaryPhrase}
                onChange={(e) => setBinaryPhrase(e.target.value)}
              />
              <p className="text-xs text-fg-muted">
                Keep it simple: &ldquo;Will they say &lsquo;X&rsquo;?&rdquo; works best.
              </p>
            </>
          ) : (
            <>
              <Label>Words / phrases ({words.length}/{WORD_LIMIT})</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="Add a word or phrase"
                  value={wordInput}
                  onChange={(e) => setWordInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && wordInput.trim() && words.length < WORD_LIMIT) {
                      e.preventDefault();
                      setWords([...words, wordInput.trim()]);
                      setWordInput("");
                    }
                  }}
                />
                <Button
                  variant="secondary"
                  onClick={() => {
                    if (wordInput.trim() && words.length < WORD_LIMIT) {
                      setWords([...words, wordInput.trim()]);
                      setWordInput("");
                    }
                  }}
                >
                  Add
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {words.map((w) => (
                  <span
                    key={w}
                    className="flex items-center gap-1 rounded-full border border-accent/20 bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent"
                  >
                    {w}
                    <button
                      onClick={() => setWords(words.filter((x) => x !== w))}
                      className="text-accent/60 hover:text-accent"
                    >
                      ×
                    </button>
                  </span>
                ))}
                {words.length === 0 && (
                  <span className="text-xs text-fg-muted">
                    e.g. &ldquo;AI&rdquo;, &ldquo;open source&rdquo;, &ldquo;agents&rdquo;
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Step 3: rules + duration */}
      {step === 3 && (
        <div className="space-y-3 animate-fade-in">
          <Label>Duration (minutes)</Label>
          <Input
            type="number"
            min={5}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
          />
          <Label>Resolution rules (shown to traders)</Label>
          <textarea
            className="min-h-24 w-full rounded-lg border border-line bg-surface p-3 text-sm text-fg placeholder:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            placeholder="Exact phrases, case sensitivity, which audio sources count…"
            value={rules}
            onChange={(e) => setRules(e.target.value)}
          />

          {connected && (
            <p className="rounded-lg bg-surface-2 p-2.5 text-[11px] leading-relaxed text-fg-muted">
              On-chain launch escrows the LMSR reserve ante (≈0.69 SOL at b = {CHAIN_CREATE_B_UI} SOL) plus
              rent for the market + vault accounts from your wallet.
            </p>
          )}

          {/* What the program would reject — shown before the wallet prompt
              instead of as a failed devnet transaction. */}
          {problems.length > 0 && (
            <div className="rounded-xl border border-no/30 bg-live/5 p-3 text-[11px] leading-relaxed">
              <div className="font-semibold text-no">
                The program will reject this market
              </div>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-fg">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
              <div className="mt-1 text-fg-muted">
                On-chain launch stays disabled until this is fixed; the demo launch below is unaffected.
              </div>
            </div>
          )}

          {/* Preview */}
          <div className="rounded-xl border border-accent/15 bg-accent-soft p-4 text-sm">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-accent">
              Preview
            </div>
            <div className="font-semibold text-fg">
              {type === "binary"
                ? question || "Your question here"
                : `Word race with ${words.length} words`}
            </div>
            <div className="text-xs text-fg-muted">
              {event || "Event"} · {VERTICAL_META[resolveCategory(category)].label} · {minutes || "?"} min
            </div>
          </div>
        </div>
      )}

      {/* Nav */}
      <div className="flex gap-2">
        {step > 0 && (
          <Button variant="outline" className="flex-1" onClick={() => setStep(step - 1)}>
            Back
          </Button>
        )}
        {step < 3 ? (
          <Button className="flex-[2]" disabled={!canNext} onClick={() => setStep(step + 1)}>
            Continue <ChevronRight className="h-4 w-4" />
          </Button>
        ) : (
          <div className="flex flex-[2] flex-col gap-2">
            <Button
              variant="yes"
              size="lg"
              className="w-full"
              disabled={submitting || problems.length > 0}
              onClick={() => connected ? submit(false) : setVisible(true)}
            >
              {submitting
                ? "Launching…"
                : connected
                  ? "Launch on-chain"
                  : "Connect wallet to launch"}
            </Button>
            {connected && (
              <button
                type="button"
                disabled={submitting}
                onClick={() => submit(true)}
                className="text-[11px] text-fg-muted underline-offset-2 hover:text-fg hover:underline"
              >
                Create a demo market instead
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-semibold uppercase tracking-wider text-fg-muted">{children}</div>;
}

/**
 * Live byte counter for inputs the program measures in UTF-8 bytes. The event
 * name feeds "Word race: <event>" on majority markets, hence `prefix`.
 */
function ByteHint({
  value,
  limit,
  label,
  prefix = "",
}: {
  value: string;
  limit: number;
  label: string;
  prefix?: string;
}) {
  if (!value.trim()) return null;
  const used = byteLength(prefix + value);
  const over = used > limit;
  return (
    <p className={cn("text-[11px]", over ? "font-medium text-no" : "text-fg-muted")}>
      {label}: {used}/{limit} bytes
      {over ? ` — the program rejects anything longer than ${limit}` : ""}
    </p>
  );
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
