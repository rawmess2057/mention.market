import { describe, expect, it } from "vitest";
import { splitQuote, watchWordsFor } from "../watch-words";

describe("splitQuote", () => {
  it("splits a title around its quoted phrase", () => {
    expect(splitQuote('Will he say "W in the chat"?')).toEqual({
      before: "Will he say ",
      phrase: "W in the chat",
      after: "?",
    });
  });

  it("accepts curly and single quotes", () => {
    expect(splitQuote("Will they say “AI”?").phrase).toBe("AI");
    expect(splitQuote("Will IShowSpeed shout 'SUIII' during his next livestream?")).toEqual({
      before: "Will IShowSpeed shout ",
      phrase: "SUIII",
      after: " during his next livestream?",
    });
  });

  it("returns the whole title as `before` when nothing is quoted", () => {
    expect(splitQuote("Will IShowSpeed bark on stream ?")).toEqual({
      before: "Will IShowSpeed bark on stream ?",
      phrase: null,
      after: "",
    });
  });

  it("agrees with watchWordsFor on the phrase", () => {
    const title = 'Will the speaker say "all female team"?';
    expect(watchWordsFor({ type: "binary", title })).toEqual([splitQuote(title).phrase]);
  });
});
