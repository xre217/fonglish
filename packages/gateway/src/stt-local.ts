import type { LangCode } from "@fonglish/shared";
import { AUDIO } from "@fonglish/shared";

export type SttPartial = {
  text: string;
  isFinal: boolean;
  speechFinal: boolean;
};

export type SttHandlers = {
  onPartial: (p: SttPartial) => void;
  onError: (message: string) => void;
  onReady?: () => void;
};

/** Energy threshold for speech detection (PCM16 RMS). */
const SPEECH_RMS = Number(process.env.STT_SPEECH_RMS ?? 500);
/** Silence ms before finalizing an utterance. */
const SILENCE_MS = Number(process.env.STT_SILENCE_MS ?? 700);
/** Max buffered speech before forced finalize. */
const MAX_UTTERANCE_MS = Number(process.env.STT_MAX_UTTERANCE_MS ?? 12_000);
/** Min speech ms before we bother transcribing. */
const MIN_SPEECH_MS = Number(process.env.STT_MIN_SPEECH_MS ?? 350);
/** Interim re-transcribe interval while speaking. */
const PARTIAL_INTERVAL_MS = Number(process.env.STT_PARTIAL_MS ?? 1600);

const WHISPER_MODEL =
  process.env.WHISPER_MODEL ?? "Xenova/whisper-tiny";

export type SttLoadState = {
  status: "idle" | "loading" | "ready" | "error";
  model: string;
  error?: string;
};

type AsrPipeline = (
  audio: Float32Array,
  opts?: Record<string, unknown>,
) => Promise<{ text: string } | { text: string }[]>;

let asrPromise: Promise<AsrPipeline> | null = null;
let sttLoad: SttLoadState = { status: "idle", model: WHISPER_MODEL };

export function getSttLoadState(): SttLoadState {
  return sttLoad;
}

async function getAsr(): Promise<AsrPipeline> {
  if (!asrPromise) {
    sttLoad = { status: "loading", model: WHISPER_MODEL };
    asrPromise = (async () => {
      // @xenova/transformers loads ONNX whisper in-process (local, free).
      const { pipeline, env } = await import("@xenova/transformers");
      // Allow remote model download on first run; cache thereafter.
      env.allowLocalModels = false;
      const pipe = await pipeline(
        "automatic-speech-recognition",
        WHISPER_MODEL,
      );
      sttLoad = { status: "ready", model: WHISPER_MODEL };
      return pipe as unknown as AsrPipeline;
    })().catch((err) => {
      asrPromise = null;
      const message = err instanceof Error ? err.message : String(err);
      sttLoad = { status: "error", model: WHISPER_MODEL, error: message };
      throw err;
    });
  }
  return asrPromise;
}

/** Load Whisper at gateway boot so the first utterance is not a cold start. */
export async function preloadAsr(): Promise<SttLoadState> {
  try {
    await getAsr();
  } catch {
    /* state already set in getAsr */
  }
  return sttLoad;
}

function pcm16ToFloat32(buf: Buffer): Float32Array {
  const n = buf.length / 2;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = buf.readInt16LE(i * 2) / 32768;
  }
  return out;
}

function rmsPcm16(buf: Buffer): number {
  const n = buf.length / 2;
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const s = buf.readInt16LE(i * 2);
    sum += s * s;
  }
  return Math.sqrt(sum / n);
}

/**
 * Local streaming-ish STT: energy VAD over PCM16 @ 16 kHz → Whisper (Transformers.js).
 * Same surface as the old xAI WebSocket session so the pipeline stays unchanged.
 */
export class LocalSttSession {
  private ready = false;
  private closed = false;
  private speaking = false;
  private speechChunks: Buffer[] = [];
  private silenceMs = 0;
  private speechMs = 0;
  private lastPartialAt = 0;
  private transcribing = false;
  private pendingFinal = false;

  constructor(
    private language: LangCode,
    private readonly handlers: SttHandlers,
  ) {}

  /** Switch recognition language without tearing down the VAD buffer. */
  setLanguage(lang: LangCode): void {
    this.language = lang;
  }

  async connect(): Promise<void> {
    if (this.closed) return;
    try {
      await getAsr();
      this.ready = true;
      this.handlers.onReady?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Local STT init failed: ${message}`);
    }
  }

  sendPcm(pcm: Buffer | ArrayBuffer): void {
    if (this.closed || !this.ready) return;
    const buf = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm);
    if (buf.length < 2) return;

    const ms = (buf.length / 2 / AUDIO.sampleRate) * 1000;
    const energy = rmsPcm16(buf);
    const isSpeech = energy >= SPEECH_RMS;

    if (isSpeech) {
      if (!this.speaking) {
        this.speaking = true;
        this.speechChunks = [];
        this.speechMs = 0;
        this.silenceMs = 0;
        this.lastPartialAt = Date.now();
      }
      this.speechChunks.push(buf);
      this.speechMs += ms;
      this.silenceMs = 0;

      if (
        this.speechMs >= MIN_SPEECH_MS &&
        Date.now() - this.lastPartialAt >= PARTIAL_INTERVAL_MS
      ) {
        this.lastPartialAt = Date.now();
        void this.transcribe(false);
      }

      if (this.speechMs >= MAX_UTTERANCE_MS) {
        void this.transcribe(true);
        this.resetUtterance();
      }
      return;
    }

    // silence
    if (this.speaking) {
      this.silenceMs += ms;
      this.speechChunks.push(buf);
      if (this.silenceMs >= SILENCE_MS && this.speechMs >= MIN_SPEECH_MS) {
        void this.transcribe(true);
        this.resetUtterance();
      } else if (this.silenceMs >= SILENCE_MS) {
        this.resetUtterance();
      }
    }
  }

  private resetUtterance(): void {
    this.speaking = false;
    this.speechChunks = [];
    this.speechMs = 0;
    this.silenceMs = 0;
  }

  private async transcribe(final: boolean): Promise<void> {
    if (this.closed || this.speechChunks.length === 0) return;
    if (this.transcribing) {
      if (final) this.pendingFinal = true;
      return;
    }

    this.transcribing = true;
    const pcm = Buffer.concat(this.speechChunks);
    try {
      const audio = pcm16ToFloat32(pcm);
      const asr = await getAsr();
      const lang =
        this.language === "zh"
          ? "chinese"
          : this.language === "ja"
            ? "japanese"
            : this.language === "ko"
              ? "korean"
              : this.language;

      // Feature extractor assumes 16 kHz when given a raw Float32Array.
      const result = await asr(audio, {
        language: lang,
        task: "transcribe",
        return_timestamps: false,
        // sampling_rate is used by some pipeline versions; keep explicit
        sampling_rate: AUDIO.sampleRate,
      });

      const raw = Array.isArray(result)
        ? result.map((r) => r.text).join(" ").trim()
        : String(result.text ?? "").trim();
      const text = raw
        .replace(/\[BLANK_AUDIO\]/gi, "")
        .replace(/\s+/g, " ")
        .trim();

      if (text) {
        this.handlers.onPartial({
          text,
          isFinal: final,
          speechFinal: final,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.handlers.onError(message);
    } finally {
      this.transcribing = false;
      if (this.pendingFinal) {
        this.pendingFinal = false;
        // if still holding speech after a queued final, re-run once
        if (this.speechChunks.length > 0 && this.speechMs >= MIN_SPEECH_MS) {
          void this.transcribe(true);
          this.resetUtterance();
        }
      }
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.ready = false;
    if (this.speaking && this.speechMs >= MIN_SPEECH_MS) {
      await this.transcribe(true);
    }
    this.resetUtterance();
  }
}
