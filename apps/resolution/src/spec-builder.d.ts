export const DEFAULT_PROVIDER: string;

export interface ResolutionSource {
  provider: string;
  sourceId: string;
  url: string;
}

export interface ResolutionMatching {
  mode: "exact_phrase" | "token";
  caseSensitive: boolean;
  punctuationSensitive: boolean;
  speaker: string | null;
}

export interface ResolutionTerm {
  phrase: string;
  outcome: string;
}

export interface ResolutionWindow {
  startsAtMs: number;
  endsAtMs: number;
}

export interface ResolutionSpec {
  schemaVersion: 1;
  marketAddress: string;
  marketType: "binary" | "majority";
  outcomeOptions: string[];
  terms: ResolutionTerm[];
  source: ResolutionSource;
  window: ResolutionWindow;
  matching: ResolutionMatching;
}

export interface BuildResolutionSpecInput {
  marketAddress: string;
  marketType: "binary" | "majority";
  words?: string[];
  binaryPhrase?: string;
  sourceUrl: string;
  provider?: string;
  window: ResolutionWindow;
  matching?: ResolutionMatching;
  validate?: boolean;
}

export function buildResolutionSpec(input: BuildResolutionSpecInput): ResolutionSpec;
