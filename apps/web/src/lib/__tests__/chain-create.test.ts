import { describe, expect, it } from "vitest";
import {
  MAX_TITLE_BYTES,
  byteLength,
  chainCreateProblems,
  chainCreateTitle,
  chainErrorText,
  freeChainId,
  nextChainId,
  type ChainCreateParams,
} from "../chain";

function params(overrides: Partial<ChainCreateParams> = {}): ChainCreateParams {
  return {
    title: "Will they say AI?",
    event: "Speed live stream",
    vertical: "streams",
    type: "binary",
    words: [],
    minutes: 60,
    sourceUrl: "https://example.com/live",
    binaryPhrase: "AI",
    ...overrides,
  };
}

describe("chainCreateTitle", () => {
  it("sends the question verbatim for binary markets", () => {
    expect(chainCreateTitle({ type: "binary", title: "Will they say AI?", event: "Stream" })).toBe(
      "Will they say AI?"
    );
  });

  it("derives the word-race title from the event name", () => {
    expect(chainCreateTitle({ type: "majority", title: "ignored", event: "Speed live stream" })).toBe(
      "Word race: Speed live stream"
    );
  });
});

describe("chainCreateProblems", () => {
  it("accepts a binary market the program will take", () => {
    expect(chainCreateProblems(params())).toEqual([]);
  });

  // The exact parameters of the devnet create that failed with
  // custom program error 0x1779 (TitleTooLong, limit 64 bytes).
  it("flags the over-long question devnet rejected with TitleTooLong", () => {
    const title = "Will IShowSpeed bark on stream in response to a Messi fan or Ronaldo hater?";
    expect(byteLength(title)).toBe(75);
    const problems = chainCreateProblems(params({ title }));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("75 bytes");
    expect(problems[0]).toContain(String(MAX_TITLE_BYTES));
  });

  it("measures the derived word-race title, so a 60-byte event name is caught", () => {
    const event = "x".repeat(60);
    const problems = chainCreateProblems(
      params({ type: "majority", words: ["alpha", "beta"], event })
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`"Word race: ${event}"`);
    expect(problems[0]).toContain(`${byteLength(`Word race: ${event}`)} bytes`);
  });

  it("keeps a word-race event name that only fits because it is prefixed", () => {
    const event = "x".repeat(53);
    expect(byteLength(`Word race: ${event}`)).toBeLessThanOrEqual(MAX_TITLE_BYTES);
    expect(
      chainCreateProblems(params({ type: "majority", words: ["alpha", "beta"], event }))
    ).toEqual([]);
  });

  it("rejects the reserved word \"void\" in any casing", () => {
    const problems = chainCreateProblems(params({ type: "majority", words: ["alpha", " Void "] }));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("reserved");
  });

  it("checks the event name separately for binary markets", () => {
    const problems = chainCreateProblems(params({ event: "y".repeat(70) }));
    expect(problems.some((p) => p.includes("event name"))).toBe(true);
  });

  it("rejects word labels over 32 bytes and races with too few or too many words", () => {
    expect(
      chainCreateProblems(params({ type: "majority", words: ["only one"] })).some((p) =>
        p.includes("at least two words")
      )
    ).toBe(true);
    expect(
      chainCreateProblems(
        params({ type: "majority", words: Array.from({ length: 17 }, (_, i) => `w${i}`) })
      ).some((p) => p.includes("at most 16 words"))
    ).toBe(true);
    expect(
      chainCreateProblems(params({ type: "majority", words: ["alpha", "z".repeat(40)] })).some((p) =>
        p.includes("a word allows 32")
      )
    ).toBe(true);
  });

  it("rejects a duration below the program minimum", () => {
    expect(chainCreateProblems(params({ minutes: 3 }))).toEqual([
      "The market must run at least 5 minutes.",
    ]);
  });
});

describe("chainErrorText", () => {
  it("decodes an anchor error code wrapped inside a wallet error", () => {
    // WalletSignTransactionError keeps the provider error in `.error`, so the
    // user-visible message is the useless "Unexpected error".
    const walletError = Object.assign(new Error("Unexpected error"), {
      error: { message: "custom program error: 0x1779" },
    });
    expect(chainErrorText(walletError)).toBe("Title or event name is too long");
  });

  // Phantom returns `{ code: -32603, message: "Unexpected error", data: { logs } }`
  // for a rejected simulation; only the logs carry the program's reason.
  it("decodes an anchor code from Phantom-style data.logs", () => {
    const walletError = Object.assign(new Error("Unexpected error"), {
      error: {
        code: -32003,
        message: "Transaction simulation failed",
        data: {
          logs: [
            "Program log: AnchorError thrown in programs/mention/src/instructions/create_market.rs:64.",
            "Program log: Error Code: TitleTooLong. Error Number: 6009. Error Message: Title or event name is too long.",
          ],
        },
      },
    });
    expect(chainErrorText(walletError)).toBe("Title or event name is too long");
  });

  it("decodes an anchor code from attached program logs", () => {
    const err = Object.assign(new Error("Transaction failed"), {
      logs: [
        "Program log: AnchorError thrown in programs/mention/src/instructions/back_word.rs:49.",
        "Program log: Error Code: MarketNotOpen. Error Number: 6005. Error Message: Market is not open.",
      ],
    });
    expect(chainErrorText(err)).toBe("Market is not open");
  });

  it("explains the system-program id collision behind custom program error 0x0", () => {
    expect(
      chainErrorText(new Error("custom program error: 0x0"))
    ).toContain("Market id already in use on devnet");
    expect(
      chainErrorText(new Error("Allocate: account Address abc already in use"))
    ).toContain("Market id already in use on devnet");
  });

  it("explains an underfunded wallet", () => {
    expect(chainErrorText(new Error("Transfer: insufficient lamports 1, need 690000000"))).toContain(
      "Not enough devnet SOL"
    );
  });

  it("keeps the curated rate-limit and rejection messages", () => {
    expect(chainErrorText(new Error("Too many requests for a specific RPC call"))).toBe(
      "Network busy (rate limited) — retry in a moment."
    );
    expect(chainErrorText(new Error("User rejected the request."))).toBe(
      "You rejected the request in your wallet."
    );
  });

  it("falls back to the wrapper message when the wallet gives nothing usable", () => {
    expect(chainErrorText(new Error("Unexpected error"))).toBe("Unexpected error");
  });
});

describe("freeChainId", () => {
  it("skips ids that already have an account on devnet", async () => {
    const start = nextChainId();
    const occupied = new Set([start, start + 1]);
    await expect(freeChainId(async (id) => occupied.has(id))).resolves.toBe(start + 2);
  });

  it("gives up instead of probing forever", async () => {
    await expect(freeChainId(async () => true, 3)).rejects.toThrow(/No free market id/);
  });
});
