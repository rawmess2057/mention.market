import { describe, expect, it } from "vitest";

import { migrateLegacyBooks } from "../store";
import { watchWordsFor } from "../watch-words";

describe("migrateLegacyBooks", () => {
  it("keeps a wallet's on-chain positions and trades, drops simulated ones", () => {
    const legacy = {
      CD69wallet: {
        user: { handle: "CD69…XFj", points: 12, rank: 0, balance: 0.68 },
        positions: {
          c104: { id: "p-c104", marketId: "c104", yesShares: 0.4135, avgYesPrice: 0.5513 },
          m1700000: { id: "p-m1700000", marketId: "m1700000", yesShares: 10 },
          "sol-ai": { id: "p-sol-ai", marketId: "sol-ai", noShares: 3 },
        },
        trades: [
          { id: "t1", marketId: "c104", kind: "buy", amount: 0.228 },
          { id: "t2", marketId: "sol-ai", kind: "buy", amount: 5 },
        ],
      },
    };
    const books = migrateLegacyBooks(legacy);
    expect(Object.keys(books.CD69wallet.positions)).toEqual(["c104"]);
    expect(books.CD69wallet.trades.map((t) => t.id)).toEqual(["t1"]);
    expect(books.CD69wallet.user).toMatchObject({ points: 12, wallet: "CD69wallet" });
  });

  it("tolerates garbage", () => {
    expect(migrateLegacyBooks(null)).toEqual({});
    expect(migrateLegacyBooks({ w: null, v: { positions: {} } })).toEqual({});
  });
});

describe("watchWordsFor", () => {
  it("reads a binary market's quoted phrase", () => {
    expect(watchWordsFor({ type: "binary", title: 'Will the speaker say "all female team"?' })).toEqual(["all female team"]);
    expect(watchWordsFor({ type: "binary", title: "Will he say “W in the chat”?" })).toEqual(["W in the chat"]);
    expect(watchWordsFor({ type: "binary", title: "Will it rain" })).toEqual([]);
  });

  it("lists a word race's options", () => {
    const words = [
      { word: "spacewalk", pool: 1, bettors: 1, lastBetAt: 0 },
      { word: "women", pool: 0, bettors: 0, lastBetAt: 0 },
    ];
    expect(watchWordsFor({ type: "majority", title: "Word race: x", words })).toEqual(["spacewalk", "women"]);
  });
});
