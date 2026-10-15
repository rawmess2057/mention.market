/**
 * Deepgram adapters for transcription.
 *
 * Phase 2: batch transcription for pre-recorded audio/files + RSS/URLs. Live
 * streaming adapter will be added in Phase 3. All calls are network-bound — a
 * `DEEPGRAM_API_KEY` is required at runtime; tests use stubs.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_MODEL = "nova-3";
const DEFAULT_LANGUAGE = "en";
const PRERECORDED_ENDPOINT = "https://api.deepgram.com/v1/listen";

export class DeepgramError extends Error {
  constructor(message, cause, status) {
    super(message);
    this.name = "DeepgramError";
    this.status = status;
    this.cause = cause;
  }
}

/**
 * Simple HTTP client wrapper (no axios dependency) — can be injected for tests.
 */
export function createHttpClient(opts = {}) {
  const fetch = opts.fetch ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? 120_000;

  return {
    async postJson(url, body, headers) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
            ...(headers ?? {}),
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        const text = await res.text();
        let json = null;
        if (text) {
          try {
            json = JSON.parse(text);
          } catch {
            /* fall through: not json */
          }
        }
        if (!res.ok) {
          const msg = json?.error ?? json?.message ?? text ?? res.statusText;
          throw new DeepgramError(`deepgram request failed (${res.status}): ${msg}`, null, res.status);
        }
        return json;
      } catch (err) {
        if (err instanceof DeepgramError) throw err;
        if (err.name === "AbortError") throw new DeepgramError("deepgram request timed out", err);
        throw new DeepgramError(String(err.message ?? err), err);
      } finally {
        clearTimeout(timer);
      }
    },

    async postBinary(url, bytes, contentType, headers) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": contentType,
            accept: "application/json",
            ...(headers ?? {}),
          },
          body: bytes,
          signal: controller.signal,
        });
        const text = await res.text();
        let json = null;
        if (text) {
          try {
            json = JSON.parse(text);
          } catch {
            /* not json */
          }
        }
        if (!res.ok) {
          const msg = json?.error ?? json?.message ?? text ?? res.statusText;
          throw new DeepgramError(`deepgram request failed (${res.status}): ${msg}`, null, res.status);
        }
        return json;
      } catch (err) {
        if (err instanceof DeepgramError) throw err;
        if (err.name === "AbortError") throw new DeepgramError("deepgram request timed out", err);
        throw new DeepgramError(String(err.message ?? err), err);
      } finally {
        clearTimeout(timer);
      }
    },

    async get(url, headers) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, {
          method: "GET",
          headers: { accept: "application/json", ...(headers ?? {}) },
          signal: controller.signal,
        });
        const text = await res.text();
        let json = null;
        if (text) {
          try {
            json = JSON.parse(text);
          } catch {
            /* not json */
          }
        }
        if (!res.ok) {
          const msg = json?.error ?? json?.message ?? text ?? res.statusText;
          throw new DeepgramError(`deepgram request failed (${res.status}): ${msg}`, null, res.status);
        }
        return json;
      } catch (err) {
        if (err instanceof DeepgramError) throw err;
        if (err.name === "AbortError") throw new DeepgramError("deepgram request timed out", err);
        throw new DeepgramError(String(err.message ?? err), err);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export class DeepgramBatchAdapter {
  constructor(opts = {}) {
    const key = opts.apiKey ?? process.env.DEEPGRAM_API_KEY;
    if (!key) throw new TypeError("DEEPGRAM_API_KEY is required for DeepgramBatchAdapter");
    this.apiKey = key;
    this.http = opts.http ?? createHttpClient(opts.httpOpts);
    this.model = opts.model ?? DEFAULT_MODEL;
    this.language = opts.language ?? DEFAULT_LANGUAGE;
    this.version = opts.version ?? "resolver/0.1.0";
    // Punctuation gives sentence-sized segments and readable excerpts;
    // diarization separates speakers.
    this.query = { smart_format: true, diarize: true, ...(opts.query ?? {}) };
  }

  /**
   * Transcribe an audio file on disk (WAV/MP3/MP4, FLAC supported). Returns
   * normalized segments and coverage compatible with `evaluateTranscript`.
   */
  async transcribeFile(filePath) {
    const full = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
    const bytes = await fs.readFile(full);
    const contentType = inferContentType(full, bytes);
    const url = buildPrerecordedUrl({ model: this.model, language: this.language, ...this.query });
    const json = await this.http.postBinary(url, bytes, contentType, {
      authorization: `Token ${this.apiKey}`,
    });
    return normalizeDeepgramResponse(json);
  }

  /**
   * Transcribe from a public URL. Requires Deepgram to fetch the audio.
   */
  async transcribeUrl(audioUrl, opts = {}) {
    return normalizeDeepgramResponse(await this.transcribeUrlRaw(audioUrl, opts));
  }

  /** The raw Deepgram response for a public URL (for storage; see `compactDeepgramResponse`). */
  async transcribeUrlRaw(audioUrl, opts = {}) {
    const url = buildPrerecordedUrl({
      model: this.model,
      language: this.language,
      ...this.query,
      ...(opts.query ?? {}),
    });
    return this.http.postJson(url, { url: audioUrl }, { authorization: `Token ${this.apiKey}` });
  }
}

function buildPrerecordedUrl(query = {}) {
  const qs = new URLSearchParams();
  if (query.model) qs.set("model", query.model);
  if (query.language) qs.set("language", query.language);
  if (query.punctuate !== undefined) qs.set("punctuate", String(query.punctuate));
  if (query.diarize !== undefined) qs.set("diarize", String(query.diarize));
  if (query.tier) qs.set("tier", query.tier);
  if (query.smart_format !== undefined) qs.set("smart_format", String(query.smart_format));
  if (query.keyword_boost) qs.set("keyword_boost", query.keyword_boost);
  if (query.keywords) qs.set("keywords", query.keywords);
  if (query.timestamps !== undefined) qs.set("timestamps", String(query.timestamps));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return `${PRERECORDED_ENDPOINT}${suffix}`;
}

function inferContentType(filePath, bytes) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".wav":
    case ".wave":
      return "audio/wav";
    case ".mp3":
      return "audio/mpeg";
    case ".mp4":
    case ".m4a":
      return "audio/mp4";
    case ".flac":
      return "audio/flac";
    case ".ogg":
    case ".opus":
      return "audio/ogg";
    case ".webm":
      return "audio/webm";
    default:
      // Best guess: if it starts with 'fLaC', treat as flac; otherwise mp3.
      const start = bytes.slice(0, 4);
      if (start[0] === 0x66 && start[1] === 0x4c && start[2] === 0x61 && start[3] === 0x43) {
        return "audio/flac";
      }
      return "audio/mpeg";
  }
}

/** Segmenting policy: break on speaker change, a long pause, or at a sentence end once a segment is long. */
const PAUSE_BREAK_MS = 1500;
const SOFT_MAX_WORDS = 40;
const HARD_MAX_WORDS = 120;
const SENTENCE_END = /[.?!]["')\]]*$/;

/**
 * Normalize a Deepgram pre-recorded (`/v1/listen`) response into
 * `{segments, coverage, artifactSha256}` for `evaluateTranscript`.
 *
 * Deepgram reports seconds from the start of the audio. Pass
 * `startedAtMs` (when the recording began, epoch ms) to get times on the
 * market's clock, and `splitAtMs` (e.g. the spec window's edges, same clock)
 * to force segment breaks there: the evaluator only counts segments wholly
 * inside the window, so a sentence straddling an edge would otherwise be
 * dropped — and could turn a spoken phrase into a false NO.
 *
 * - Words are grouped into sentence-sized segments (the evaluator caps a
 *   segment at 4000 chars, and evidence excerpts must stay small).
 * - A missing speaker becomes `"unknown"` (the evaluator rejects empty ones);
 *   diarized speakers are `"0"`, `"1"`, ….
 * - Coverage is the whole audio file (`metadata.duration`): Deepgram heard
 *   every second of it, so silence is still covered.
 */
export function normalizeDeepgramResponse(json, { startedAtMs = 0, splitAtMs = [] } = {}) {
  if (!Number.isSafeInteger(startedAtMs) || startedAtMs < 0) {
    throw new TypeError("startedAtMs must be a non-negative safe integer");
  }
  if (!json || typeof json !== "object") throw new TypeError("deepgram response is empty");
  const alt = json?.results?.channels?.[0]?.alternatives?.[0];
  if (!alt) throw new TypeError("deepgram response has no transcript alternative");

  const durationMs = ms(json?.metadata?.duration ?? json?.duration);
  const segments = [];
  const words = Array.isArray(alt.words) ? alt.words.filter((w) => wordText(w).length > 0) : [];

  if (words.length > 0) {
    let current = null;
    for (const w of words) {
      const speaker = speakerOf(w);
      const startMs = startedAtMs + ms(w.start);
      const endMs = Math.max(startedAtMs + ms(w.end), startMs + 1);
      const breakHere =
        current &&
        (current.speaker !== speaker ||
          // Isolate segments on each side of an edge (a word crossing it starts its own).
          splitAtMs.some((edge) => (current.endMs <= edge && endMs > edge) || (current.startMs < edge && startMs >= edge)) ||
          startMs - current.endMs >= PAUSE_BREAK_MS ||
          current.words.length >= HARD_MAX_WORDS ||
          (current.words.length >= SOFT_MAX_WORDS && SENTENCE_END.test(current.words.at(-1))));
      if (!current || breakHere) {
        if (current) segments.push(finish(current));
        current = { startMs, endMs, speaker, words: [] };
      }
      current.words.push(wordText(w));
      current.endMs = Math.max(current.endMs, endMs);
    }
    segments.push(finish(current));
  } else if (typeof alt.transcript === "string" && alt.transcript.trim().length > 0 && durationMs > 0) {
    // No word timings: one segment spanning the audio.
    segments.push({ startMs: startedAtMs, endMs: startedAtMs + durationMs, speaker: "unknown", text: alt.transcript.trim() });
  }

  const coverage =
    durationMs > 0
      ? {
          status: "available",
          coveredFromMs: startedAtMs,
          coveredThroughMs: Math.max(startedAtMs + durationMs, ...segments.map((s) => s.endMs)),
        }
      : { status: "unavailable", coveredFromMs: 0, coveredThroughMs: 0 };

  return {
    segments: segments.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs),
    coverage,
    artifactSha256: json?.metadata?.request_id ? sha256Hex(json.metadata.request_id) : undefined,
  };
}

function finish({ startMs, endMs, speaker, words }) {
  return { startMs, endMs, speaker, text: words.join(" ") };
}

function wordText(w) {
  return String(w.punctuated_word ?? w.word ?? w.text ?? "").trim();
}

function speakerOf(w) {
  const raw = w.speaker ?? w.speaker_id ?? w.speakerLabel;
  const speaker = raw == null ? "" : String(raw).trim();
  return speaker || "unknown";
}

/** Deepgram reports times in seconds. */
function ms(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) : 0;
}

function sha256Hex(str) {
  try {
    const h = createHash("sha256");
    h.update(String(str));
    return h.digest("hex");
  } catch {
    return undefined;
  }
}

/**
 * Compact a Deepgram response for storage: word timings and text only (about
 * a quarter of the raw size). {@link expandDeepgramTranscript} restores a
 * response `normalizeDeepgramResponse` accepts, so a stored transcript can be
 * re-normalized (e.g. with a corrected recording start) without re-transcribing.
 *
 * @returns {{ v: 1, requestId: string|null, duration: number, transcript: string, words: Array<[number, number, string|number|null, string]> }}
 */
export function compactDeepgramResponse(json) {
  const alt = json?.results?.channels?.[0]?.alternatives?.[0];
  if (!alt) throw new TypeError("deepgram response has no transcript alternative");
  return {
    v: 1,
    requestId: json?.metadata?.request_id ?? null,
    duration: Number(json?.metadata?.duration ?? json?.duration ?? 0),
    transcript: typeof alt.transcript === "string" ? alt.transcript : "",
    words: (alt.words ?? []).map((w) => [
      Number(w.start),
      Number(w.end),
      w.speaker ?? w.speaker_id ?? null,
      String(w.punctuated_word ?? w.word ?? ""),
    ]),
  };
}

/** Inverse of {@link compactDeepgramResponse}. */
export function expandDeepgramTranscript(compact) {
  if (compact?.v !== 1) throw new TypeError("unknown stored transcript format");
  return {
    metadata: { request_id: compact.requestId, duration: compact.duration },
    results: {
      channels: [
        {
          alternatives: [
            {
              transcript: compact.transcript,
              words: compact.words.map(([start, end, speaker, text]) => ({
                start,
                end,
                speaker,
                punctuated_word: text,
              })),
            },
          ],
        },
      ],
    },
  };
}
