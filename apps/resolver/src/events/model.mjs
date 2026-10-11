/**
 * Off-chain event model.
 *
 * The on-chain resolution spec is source- and outcome-oriented; it does not
 * know *how* an event is discovered or transcribed. This model adds exactly
 * that: an event `kind` drives discovery + ingestion, while the spec stays
 * schema-v1 and frozen.
 *
 *   fixed_time  scheduled moment (earnings call, FOMC, debate) — official
 *               webcast/VOD is the canonical source; batch transcription.
 *   podcast     a feed drops an episode on schedule — the RSS enclosure is the
 *               canonical source; batch transcription.
 *   livestream  live audio while the event runs — the live feed is canonical;
 *               streaming transcription, guarded against gaps.
 */

export const EVENT_KINDS = Object.freeze(["fixed_time", "podcast", "livestream"]);
export const INGEST_MODES = Object.freeze(["manual", "batch", "live"]);

/** Ingestion adapter we intend to use once the corresponding phase ships. */
const RECOMMENDED_ADAPTER = Object.freeze({
  fixed_time: "deepgram-batch",
  podcast: "deepgram-batch",
  livestream: "deepgram-live",
});

/** Vertical → default event kind (used when the provider does not decide it). */
const KIND_BY_VERTICAL = Object.freeze({
  streams: "livestream",
  podcasts: "podcast",
  earnings: "fixed_time",
  sports: "fixed_time",
  politics: "fixed_time",
});

const PROVIDER_KIND_HINTS = [
  [/rss|feed|podcast/i, "podcast"],
  [/live|twitch|youtube-live|hls/i, "livestream"],
  [/webcast|ir-|earnings|fomc|official/i, "fixed_time"],
];

/**
 * Decide an event's kind from its vertical and source provider. The provider
 * wins when it is decisive; otherwise the vertical's default applies.
 *
 * @param {{vertical?: string, provider?: string}} input
 * @returns {"fixed_time"|"podcast"|"livestream"}
 */
export function classifyEvent({ vertical, provider } = {}) {
  if (typeof provider === "string") {
    for (const [pattern, kind] of PROVIDER_KIND_HINTS) {
      if (pattern.test(provider)) return kind;
    }
  }
  return KIND_BY_VERTICAL[vertical] ?? "fixed_time";
}

/**
 * Normalize and validate an event. Fills defaults and guarantees the shape the
 * pipeline and evidence builder rely on.
 *
 * @param {object} input
 * @param {string} input.marketAddress
 * @param {string} [input.kind]              Inferred from vertical/provider.
 * @param {string} [input.vertical]
 * @param {{startsAtMs:number, endsAtMs:number}} input.window
 * @param {{provider:string, sourceId:string, url:string}} input.canonicalSource
 * @param {{provider:string, sourceId:string, url:string}} [input.probe]
 * @param {string|null} [input.speaker]
 * @param {string[]} [input.keywords]
 * @param {{adapter?:string, mode?:string}} [input.ingest]
 */
export function createEvent(input) {
  const { marketAddress, vertical, window, canonicalSource, probe, speaker, keywords, ingest } = input;
  text(marketAddress, "marketAddress", 44);

  const kind = input.kind ?? classifyEvent({ vertical, provider: canonicalSource?.provider });
  oneOf(kind, EVENT_KINDS, "kind");

  object(window, "window");
  integer(window.startsAtMs, "window.startsAtMs");
  integer(window.endsAtMs, "window.endsAtMs");
  if (window.endsAtMs <= window.startsAtMs) {
    throw new TypeError("window.endsAtMs must be after window.startsAtMs");
  }

  source(canonicalSource, "canonicalSource");
  if (probe !== undefined) source(probe, "probe");

  const mode = ingest?.mode ?? "manual";
  oneOf(mode, INGEST_MODES, "ingest.mode");
  const adapter = ingest?.adapter ?? "operator-upload";

  return {
    marketAddress,
    kind,
    vertical: vertical ?? null,
    window: { startsAtMs: window.startsAtMs, endsAtMs: window.endsAtMs },
    canonicalSource,
    probe: probe ?? null,
    speaker: speaker ?? null,
    keywords: Array.isArray(keywords) ? [...keywords] : [],
    ingest: { adapter, mode },
  };
}

/** The adapter a kind should graduate to once its phase ships. */
export function recommendedAdapter(kind) {
  oneOf(kind, EVENT_KINDS, "kind");
  return RECOMMENDED_ADAPTER[kind];
}

function source(value, label) {
  object(value, label);
  text(value.provider, `${label}.provider`, 64);
  text(value.sourceId, `${label}.sourceId`, 256);
  absoluteUrl(value.url, `${label}.url`);
}

function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function text(value, label, maxLength) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    throw new TypeError(`${label} must be a non-empty string of at most ${maxLength} characters`);
  }
}

function integer(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
}

function oneOf(value, choices, label) {
  if (!choices.includes(value)) throw new TypeError(`${label} must be one of: ${choices.join(", ")}`);
}

function absoluteUrl(value, label) {
  text(value, label, 2048);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError(`${label} must be an absolute URL`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new TypeError(`${label} must use HTTP or HTTPS`);
  }
}
