/**
 * Deepgram adapters for transcription.
 *
 * Phase 2: batch transcription for pre-recorded audio/files + RSS/URLs. Live
 * streaming adapter will be added in Phase 3. All calls are network-bound — a
 * `DEEPGRAM_API_KEY` is required at runtime; tests use stubs.
 */
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
  }

  /**
   * Transcribe an audio file on disk (WAV/MP3/MP4, FLAC supported). Returns
   * normalized segments and coverage compatible with `evaluateTranscript`.
   */
  async transcribeFile(filePath) {
    const full = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
    const bytes = await fs.readFile(full);
    const contentType = inferContentType(full, bytes);
    const url = buildPrerecordedUrl({ model: this.model, language: this.language });
    const json = await this.http.postBinary(url, bytes, contentType, {
      authorization: `Token ${this.apiKey}`,
    });
    return normalizeDeepgramResponse(json);
  }

  /**
   * Transcribe from a public URL. Requires Deepgram to fetch the audio.
   */
  async transcribeUrl(audioUrl, opts = {}) {
    const url = buildPrerecordedUrl({
      model: this.model,
      language: this.language,
      ...(opts.query ?? {}),
    });
    const json = await this.http.postJson(
      url,
      { url: audioUrl },
      { authorization: `Token ${this.apiKey}` }
    );
    return normalizeDeepgramResponse(json);
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

/**
 * Normalize Deepgram Nova-3 'listen' response into `{segments, coverage, artifactSha256}`.
 * Prefers word-level timestamps (`words`) to build stable excerpts; falls back to
 * utterances/paragraphs if missing.
 */
export function normalizeDeepgramResponse(json) {
  if (!json || typeof json !== "object") throw new TypeError("deepgram response is empty");
  const channel = json?.results?.channels?.[0];
  const alt = channel?.alternatives?.[0];
  if (!alt) throw new TypeError("deepgram response has no transcript alternative");

  const segments = [];
  const words = alt?.words;
  if (Array.isArray(words) && words.length > 0) {
    // Bucket by speaker when diarization enabled (speaker is string like '0', '1').
    // Build per-word but collapse consecutive same-speaker words into segments for clarity.
    let i = 0;
    while (i < words.length) {
      const w = words[i];
      const start = ms(w.start);
      const end = ms(w.end);
      const speaker = String(w.speaker ?? w.speaker_id ?? w.speakerLabel ?? "");
      const speakerKey = speaker || "__none__";
      let j = i + 1;
      while (j < words.length) {
        const nw = words[j];
        const nwSpeaker = String(nw.speaker ?? nw.speaker_id ?? nw.speakerLabel ?? "");
        const nwKey = nwSpeaker || speakerKey;
        if (nwKey !== speakerKey) break;
        j += 1;
      }
      const text = words
        .slice(i, j)
        .map((x) => String(x.word ?? x.punctuated_word ?? x.text ?? ""))
        .join(" ")
        .trim();
      if (text.length > 0) {
        segments.push({ startMs: start, endMs: Math.max(end, ms(words[j - 1]?.end ?? end)), speaker, text });
      }
      i = j;
    }
  } else if (Array.isArray(alt?.paragraphs?.transcript) && alt?.paragraphs?.transcript.length > 0) {
    // Minimal fallback; approximate timestamps from start/end if present.
    const paras = alt.paragraphs.paragraphs ?? alt.paragraphs ?? [];
    for (const p of Array.isArray(alt.paragraphs.paragraphs) ? alt.paragraphs.paragraphs : paras) {
      const text = String(p.transcript ?? p.text ?? "").trim();
      if (text.length === 0) continue;
      segments.push({
        startMs: ms(p.start),
        endMs: ms(p.end),
        speaker: String(p.speaker ?? p.speaker_id ?? ""),
        text,
      });
    }
  } else if (alt?.transcript) {
    // Final fallback: single segment spanning the whole audio if timestamps missing.
    const text = String(alt.transcript).trim();
    if (text.length > 0) {
      const duration = ms(json?.duration) ?? 0;
      segments.push({ startMs: 0, endMs: duration || 1, speaker: "", text });
    }
  }

  // Determine coverage: if we got any segments and there's a duration, mark available/partial.
  const durationMs = ms(json?.duration);
  let coverage;
  if (segments.length === 0 || !Number.isFinite(durationMs) || durationMs <= 0) {
    coverage = { status: "unavailable", coveredFromMs: 0, coveredThroughMs: 0 };
  } else {
    const from = Math.min(...segments.map((s) => s.startMs));
    const through = Math.max(...segments.map((s) => s.endMs));
    if (from <= 0 && through >= durationMs * 0.99) {
      coverage = { status: "available", coveredFromMs: 0, coveredThroughMs: Math.ceil(through) };
    } else {
      coverage = { status: "partial", coveredFromMs: from, coveredThroughMs: Math.ceil(through) };
    }
  }

  return {
    segments: segments.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs),
    coverage,
    artifactSha256: json?.metadata?.request_id ? sha256Hex(json.metadata.request_id) : undefined,
  };
}

function ms(v) {
  if (v == null) return 0;
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  // Deepgram can return seconds or ms depending on endpoint; seconds is typical.
  // Assume seconds if < 100_000 (a large audio is 10^6 seconds impossible, so seconds).
  return n < 100_000 ? Math.round(n * 1000) : Math.round(n);
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
import { createHash } from "node:crypto";
