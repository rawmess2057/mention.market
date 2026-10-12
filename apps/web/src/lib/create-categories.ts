/**
 * Create-market category taxonomy.
 *
 * `Vertical` is the program's on-chain enum (streams/sports/earnings/politics/
 * podcasts) — the thing that lands on devnet. This module adds the *wizard*
 * categories the user sees and picks from: a picker category ("Crypto", "Events",
 * "Other") that maps onto a program vertical, plus the verticals themselves.
 *
 * The page renders this list in its category step; the program receives the
 * resolved `vertical` value. Keeping the mapping here makes the wizard
 * user-facing and the program-facing values drift apart.
 */

/** Program-facing vertical as chosen on-chain by `create_market`. */
export type Vertical = "streams" | "sports" | "earnings" | "politics" | "podcasts";

/** User-facing picker labels that collapse into program verticals. */
export type PickerCategory =
  | "crypto"
  | "events"
  | "other"
  | Vertical;

export interface CategoryOption {
  /** User-facing label shown in the wizard grid. */
  label: string;
  /** Program vertical this option resolves to. */
  vertical: Vertical;
  /** Icon/emoji shown next to the label. */
  emoji: string;
  /** Short hint shown under the grid. */
  hint: string;
}

/**
 * Picker categories. "Crypto" and "Events" are the requested groupings; "Other"
 * catches everything else. Each collapses to exactly one program vertical.
 */
export const PICKER_CATEGORIES: CategoryOption[] = [
  {
    label: "Crypto",
    vertical: "streams",
    emoji: "₿",
    hint: "Meme coins, tokens, and on-chain activity.",
  },
  {
    label: "Events",
    vertical: "sports",
    emoji: "📅",
    hint: "Live sports, tournaments, and scheduled events.",
  },
  {
    label: "Other",
    vertical: "politics",
    emoji: "📌",
    hint: "Everything that does not fit the categories above.",
  },
  {
    label: "Streams",
    vertical: "streams",
    emoji: "🎮",
    hint: "Streaming, chat, and personality markets.",
  },
  {
    label: "Sports",
    vertical: "sports",
    emoji: "⚽",
    hint: "Sports and esports outcomes.",
  },
  {
    label: "Earnings",
    vertical: "earnings",
    emoji: "📈",
    hint: "Earnings, results, and financial outcomes.",
  },
  {
    label: "Politics",
    vertical: "politics",
    emoji: "🏛️",
    hint: "Elections, policy, and political outcomes.",
  },
  {
    label: "Podcasts",
    vertical: "podcasts",
    emoji: "🎙️",
    hint: "Episode, guest, and topic markets.",
  },
];

/** Label/emoji for a resolved program vertical (used in previews and footers). */
export const VERTICAL_META: Record<
  Vertical,
  { label: string; emoji: string }
> = {
  streams: { label: "Streams", emoji: "🎮" },
  sports: { label: "Sports", emoji: "⚽" },
  earnings: { label: "Earnings", emoji: "📈" },
  politics: { label: "Politics", emoji: "🏛️" },
  podcasts: { label: "Podcasts", emoji: "🎙️" },
};

/** Inverse map: picker category -> program vertical (defensive). */
export function categoryVertical(category: PickerCategory): Vertical {
  return PICKER_CATEGORIES.find((c) => c.label === category)?.vertical ?? "streams";
}

/**
 * Render a picker category exactly like the program would resolve it. Used to
 * derive the title/vertical the store stores while typing.
 */
export function resolveCategory(category: PickerCategory): Vertical {
  return categoryVertical(category);
}
