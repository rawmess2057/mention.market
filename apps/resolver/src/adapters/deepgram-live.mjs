/**
 * Deepgram Live (streaming) transcription adapter.
 *
 * Phase 3: connects to Deepgram's `/v1/listen` via WebSocket for real-time
 * transcription. Emits/accumulates normalized segments compatible with
 * `evaluateTranscript` (schema expects segments with startMs/endMs/speaker/text).
 */
import { createHash } from "node:crypto";
import WebSocket from "ws";

const DEFAULT_MODEL = "nova-3";
const DEFAULT_LANGUAGE = "en";
const LIVE_WSS = "wss://api.deepgram.com/v1/listen";

export class DeepgramLiveError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = "DeepgramLiveError";
    this.cause = cause;
  }
}

export class DeepgramLiveTranscriber {
  constructor(opts = {}) {
    const key = opts.apiKey ?? process.env.DEEPGRAM_API_KEY;
    if (!key) throw new TypeError("DEEPGRAM_API_KEY is required for DeepgramLiveTranscriber");
    this.apiKey = key;
    this.model = opts.model ?? DEFAULT_MODEL;
    this.language = opts.language ?? DEFAULT_LANGUAGE;
    this.diarize = opts.diarize ?? false;
    this.keywords = opts.keywords ?? [];
    this.keyterm = opts.keyterm ?? null;
    this.encoding = opts.encoding ?? "linear16";
    this.sampleRate = opts.sampleRate ?? 16_000;
    this.channels = opts.channels ?? 1;
    this.punctuate = opts.punctuate ?? true;
    this.interimResults = opts.interimResults ?? true;
    this.ws = null;
    this._queue = [];
    this._resultHandlers = new Set();
    this._closeHandlers = new Set();
    this._errorHandlers = new Set();
  }

  url() {
    const qs = new URLSearchParams();
    qs.set("model", this.model);
    qs.set("language", this.language);
    qs.set("punctuate", String(this.punctuate));
    qs.set("interim_results", String(this.interimResults));
    if (this.diarize) qs.set("diarize", "true");
    if (this.keyterm) qs.set("keyterm", this.keyterm);
    if (Array.isArray(this.keywords) && this.keywords.length > 0) {
      qs.set("keywords", this.keywords.join(","));
    }
    return `${LIVE_WSS}?${qs.toString()}`;
  }

  async connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return this.ws;
    const ws = new WebSocket(this.url(), {
      headers: { Authorization: `Token ${this.apiKey}` },
    });
    this.ws = ws;

    ws.on("open", () => {
      // configure
      const cfg = {
        type: "Configure",
        features: {
          encoding: this.encoding,
          sample_rate: this.sampleRate,
          channels: this.channels,
        },
      };
      ws.send(JSON.stringify(cfg));
    });

    ws.on("message", (data) => {
      try {
        const json = JSON.parse(data.toString());
        const evt = normalizeLiveResult(json);
        if (evt) {
          for (const h of this._resultHandlers) h(evt);
        }
      } catch (err) {
        // ignore malformed; surface as error event
        for (const h of this._errorHandlers) h(new DeepgramLiveError("invalid deepgram message", err));
      }
    });

    ws.on("close", (code, reason) => {
      for (const h of this._closeHandlers) h({ code, reason: reason?.toString() });
    });

    ws.on("error", (err) => {
      for (const h of this._errorHandlers) h(new DeepgramLiveError("websocket error", err));
    });

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new DeepgramLiveError("websocket connect timeout")), 30_000);
      ws.once("open", () => { clearTimeout(timer); resolve(); });
      ws.once("error", (e) => { clearTimeout(timer); reject(new DeepgramLiveError("websocket open error", e)); });
    });
    return ws;
  }

  onResult(fn) { this._resultHandlers.add(fn); return () => this._resultHandlers.delete(fn); }
  onClose(fn) { this._closeHandlers.add(fn); return () => this._closeHandlers.delete(fn); }
  onError(fn) { this._errorHandlers.add(fn); return () => this._errorHandlers.delete(fn); }

  sendAudio(chunk) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new DeepgramLiveError("websocket not open");
    this.ws.send(chunk);
  }

  finish() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "Finalize" }));
    }
  }

  close() {
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
  }
}

function normalizeLiveResult(json) {
  if (!json || json.type !== "Results" || !json.channel) return null;
  const alt = json.channel?.alternatives?.[0];
  if (!alt) return null;
  const words = alt.words ?? [];
  const segments = [];
  let i = 0;
  while (i < words.length) {
    const w = words[i];
    const start = ms(w.start);
    const end = ms(w.end);
    const speaker = String(w.speaker ?? w.speaker_id ?? w.speakerLabel ?? "");
    const key = speaker || "__none__";
    let j = i + 1;
    while (j < words.length) {
      const nw = words[j];
      const nwSpeaker = String(nw.speaker ?? nw.speaker_id ?? nw.speakerLabel ?? "");
      const nwKey = nwSpeaker || key;
      if (nwKey !== key) break;
      j += 1;
    }
    const text = words.slice(i,j).map(x=>String(x.word??x.punctuated_word??x.text??"")).join(" ").trim();
    if (text.length > 0) {
      // The evaluator rejects empty speakers.
      segments.push({ startMs: start, endMs: Math.max(end, ms(words[j-1]?.end ?? end)), speaker: speaker || "unknown", text });
    }
    i = j;
  }
  const durationMs = ms(json.duration);
  let coverage = { status: "partial", coveredFromMs: 0, coveredThroughMs: 0 };
  if (segments.length > 0) {
    const from = Math.min(...segments.map(s=>s.startMs));
    const through = Math.max(...segments.map(s=>s.endMs));
    if (durationMs > 0 && from <= 0 && through >= durationMs * 0.99) {
      coverage = { status: "available", coveredFromMs: 0, coveredThroughMs: Math.ceil(through) };
    } else {
      coverage = { status: "partial", coveredFromMs: from, coveredThroughMs: Math.ceil(through) };
    }
  } else {
    coverage = { status: "unavailable", coveredFromMs: 0, coveredThroughMs: 0 };
  }
  return { isFinal: Boolean(json.is_final), segments, coverage, requestId: json.request_id };
}

function ms(v){ if(v==null)return 0; const n=Number(v); if(!Number.isFinite(n))return 0; return n<100000?Math.round(n*1000):Math.round(n); }
