"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { Check, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/format";
import { useSim } from "@/lib/sim";
import { useChain } from "@/hooks/useChain";
import { VERTICAL_META, type Market, type Vertical } from "@/lib/types";

const WORD_LIMIT = 12;

export default function CreateMarketPage() {
  const router = useRouter();
  const { connected } = useWallet();
  const createMarket = useSim((s) => s.createMarket);
  const chain = useChain();
  const [submitting, setSubmitting] = useState(false);

  const [step, setStep] = useState(0);
  const [vertical, setVertical] = useState<Vertical>("streams");
  const [event, setEvent] = useState("");
  const [type, setType] = useState<Market["type"]>("binary");
  const [question, setQuestion] = useState("");
  const [words, setWords] = useState<string[]>([]);
  const [wordInput, setWordInput] = useState("");
  const [minutes, setMinutes] = useState("60");
  const [rules, setRules] = useState("");

  const canNext =
    (step === 0 && event.trim().length > 2) ||
    step === 1 ||
    (step === 2 && (type === "binary" ? question.trim().length > 5 : words.length >= 2)) ||
    step === 3;

  const submit = async () => {
    setSubmitting(true);
    const params = {
      title:
        type === "binary"
          ? question.trim()
          : `Word race: ${event.trim()}`,
      event: event.trim(),
      vertical,
      type,
      words:
        type === "binary" ? [question.trim()] : words,
      minutes: Math.max(5, parseInt(minutes) || 60),
      rules:
        rules.trim() ||
        (type === "binary"
          ? `Resolves YES if the exact phrase from the title is spoken during the event (case-insensitive). Transcript: Deepgram primary feed.`
          : `First phrase from the board spoken during the event wins. Case-insensitive. 1% rake.`),
    };
    try {
      if (connected) {
        const chainId = await chain.create(params);
        if (chainId != null) {
          const id = createMarket({ ...params, chainId });
          const created = useSim.getState().markets[id];
          router.push(`/market/${created.slug}`);
          return;
        }
      }
    } catch (err) {
      console.warn("on-chain market creation failed — creating locally instead:", err);
    }
    const id = createMarket(params);
    const created = useSim.getState().markets[id];
    router.push(`/market/${created.slug}`);
  };

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="font-serif text-xl font-bold tracking-tight text-navy">Create a market</h1>
        <p className="text-sm text-gray-mid">
          Pick an event, define the words, set the clock. Trading goes live instantly.
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
                ? "border-blue bg-blue-light text-blue"
                : i < step
                  ? "border-green/40 bg-green-light text-green"
                  : "border-gray-warm text-gray-mid"
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
            {(Object.keys(VERTICAL_META) as Vertical[]).map((v) => (
              <button
                key={v}
                onClick={() => setVertical(v)}
                className={cn(
                  "rounded-xl border p-3 text-sm font-medium transition-all",
                  vertical === v ? "border-blue bg-blue-light text-blue" : "border-gray-warm text-navy hover:border-blue/40"
                )}
              >
                <span className="mr-1.5">{VERTICAL_META[v].emoji}</span>
                {VERTICAL_META[v].label}
              </button>
            ))}
          </div>
          <Label>Event name</Label>
          <Input
            placeholder="e.g. Solana Speedrun #13 — live dev stream"
            value={event}
            onChange={(e) => setEvent(e.target.value)}
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
                type === t.key ? "border-blue bg-blue-light text-navy" : "border-gray-warm text-navy hover:border-blue/40"
              )}
            >
              <div className="font-semibold">{t.title}</div>
              <div className="mt-1 text-xs text-gray-mid">{t.desc}</div>
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
              <p className="text-xs text-gray-mid">
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
                    className="flex items-center gap-1 rounded-full border border-blue/20 bg-blue-light px-2.5 py-1 text-xs font-medium text-blue"
                  >
                    {w}
                    <button
                      onClick={() => setWords(words.filter((x) => x !== w))}
                      className="text-blue/60 hover:text-blue"
                    >
                      ×
                    </button>
                  </span>
                ))}
                {words.length === 0 && (
                  <span className="text-xs text-gray-mid">
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
            className="min-h-24 w-full rounded-lg border border-gray-warm bg-white p-3 text-sm text-navy placeholder:text-gray-mid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue"
            placeholder="Exact phrases, case sensitivity, which audio sources count…"
            value={rules}
            onChange={(e) => setRules(e.target.value)}
          />

          {/* Preview */}
          <div className="rounded-xl border border-blue/15 bg-blue-light/30 p-4 text-sm">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-blue">
              Preview
            </div>
            <div className="font-semibold text-navy">
              {type === "binary"
                ? question || "Your question here"
                : `Word race with ${words.length} words`}
            </div>
            <div className="text-xs text-gray-mid">
              {event || "Event"} · {VERTICAL_META[vertical].label} · {minutes || "?"} min
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
          <Button
            variant="yes"
            className="flex-[2]"
            size="lg"
            disabled={submitting}
            onClick={submit}
          >
            {submitting ? "Launching…" : "Launch market 🚀"}
          </Button>
        )}
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-semibold uppercase tracking-wider text-gray-mid">{children}</div>;
}
