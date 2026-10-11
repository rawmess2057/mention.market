import { validateResolutionSpec } from "./schema.mjs";

/**
 * Default source provider for markets whose evidence is supplied by the
 * operator (manual transcript upload). The value is free-form — the resolver
 * picks an ingestion adapter by it — and must not violate the 64-char cap on
 * `source.provider`.
 */
export const DEFAULT_PROVIDER = "operator-upload";

/**
 * Build a schema-v1 resolution spec exactly as the web create flow commits it.
 *
 * This is the single source of truth for spec construction: the browser, the
 * seed script, and the resolver all call this so the bytes — and therefore the
 * `specSha256` committed on-chain — are byte-identical everywhere.
 *
 * @param {object} input
 * @param {string} input.marketAddress   Base58 market PDA.
 * @param {"binary"|"majority"} input.marketType
 * @param {string[]} [input.words]       Board phrases (majority). Each phrase is
 *   both an outcome option and its own trigger term.
 * @param {string} [input.binaryPhrase]  The single YES trigger phrase (binary).
 * @param {string} input.sourceUrl       Absolute http(s) URL of the source.
 * @param {string} [input.provider]      Defaults to {@link DEFAULT_PROVIDER}.
 * @param {{startsAtMs:number, endsAtMs:number}} input.window
 * @param {object} [input.matching]      Overrides for the default matcher.
 * @param {boolean} [input.validate]     Validate before returning (default true).
 */
export function buildResolutionSpec(input) {
  const {
    marketAddress,
    marketType,
    words,
    binaryPhrase,
    sourceUrl,
    provider = DEFAULT_PROVIDER,
    window,
    matching,
    validate = true,
  } = input;

  const outcomes = marketType === "binary" ? ["yes", "no"] : [...words];
  const terms =
    marketType === "binary"
      ? [{ phrase: binaryPhrase, outcome: "yes" }]
      : [...words].map((phrase) => ({ phrase, outcome: phrase }));

  const spec = {
    schemaVersion: 1,
    marketAddress,
    marketType,
    outcomeOptions: outcomes,
    terms,
    source: {
      provider,
      sourceId: sourceUrl,
      url: sourceUrl,
    },
    window: {
      startsAtMs: window.startsAtMs,
      endsAtMs: window.endsAtMs,
    },
    matching: matching ?? {
      mode: "exact_phrase",
      caseSensitive: false,
      punctuationSensitive: false,
      speaker: null,
    },
  };

  if (validate) validateResolutionSpec(spec);
  return spec;
}
