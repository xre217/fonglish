/**
 * Quality presets for local STT + MT.
 * Explicit env vars always win over the preset.
 *
 *   FONGLISH_QUALITY=fast|balanced|accurate
 */

export type QualityPreset = "fast" | "balanced" | "accurate";

export type QualityResolved = {
  preset: QualityPreset;
  mtModel: string;
  whisperModel: string;
  /** Run Ollama on partial (interim) STT. Default false — finals only. */
  mtOnPartial: boolean;
  /** Optional "term=translation" pairs for MT. */
  glossary: string;
};

const PRESETS: Record<
  QualityPreset,
  { mtModel: string; whisperModel: string; mtOnPartial: boolean }
> = {
  // Lowest latency / demo
  fast: {
    mtModel: "llama3.2:3b",
    whisperModel: "Xenova/whisper-tiny",
    mtOnPartial: false,
  },
  // Daily use — better WER + better MT (8B if available)
  balanced: {
    mtModel: "llama3:latest",
    whisperModel: "Xenova/whisper-base",
    mtOnPartial: false,
  },
  // Best local quality (heavier download + RAM)
  accurate: {
    mtModel: "llama3:latest",
    whisperModel: "Xenova/whisper-small",
    mtOnPartial: false,
  },
};

function parsePreset(raw: string | undefined): QualityPreset {
  const v = (raw ?? "balanced").trim().toLowerCase();
  if (v === "fast" || v === "balanced" || v === "accurate") return v;
  return "balanced";
}

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw == null || raw === "") return fallback;
  const v = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return fallback;
}

let cached: QualityResolved | null = null;

/** Resolve once (after dotenv load). */
export function resolveQuality(): QualityResolved {
  if (cached) return cached;
  const preset = parsePreset(
    process.env.FONGLISH_QUALITY ?? process.env.QUALITY,
  );
  const base = PRESETS[preset];
  cached = {
    preset,
    mtModel: process.env.OLLAMA_MT_MODEL?.trim() || base.mtModel,
    whisperModel: process.env.WHISPER_MODEL?.trim() || base.whisperModel,
    mtOnPartial: parseBool(process.env.MT_ON_PARTIAL, base.mtOnPartial),
    glossary: process.env.MT_GLOSSARY?.trim() ?? "",
  };
  return cached;
}

export function getMtModel(): string {
  return resolveQuality().mtModel;
}

export function getWhisperModel(): string {
  return resolveQuality().whisperModel;
}

export function getMtOnPartial(): boolean {
  return resolveQuality().mtOnPartial;
}

export function getGlossary(): string {
  return resolveQuality().glossary;
}

export function qualitySummary(): string {
  const q = resolveQuality();
  return `quality=${q.preset} mt=${q.mtModel} stt=${q.whisperModel} mtOnPartial=${q.mtOnPartial}`;
}
