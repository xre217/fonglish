import type { LangCode, ServiceState } from "@fonglish/shared";
import {
  probeMacSay,
  synthesizeMacSay,
  type TtsResult,
} from "./tts-mac.js";

export type { TtsResult };

export type TtsEngineName = "say" | "none";

let probeCache: { at: number; state: ServiceState; error?: string; engine: string } | null =
  null;

export function ttsEnabled(): boolean {
  const v = (process.env.TTS_ENABLED ?? "1").trim().toLowerCase();
  return v !== "0" && v !== "false" && v !== "off" && v !== "none";
}

export function ttsEngineName(): TtsEngineName {
  if (!ttsEnabled()) return "none";
  const e = (process.env.TTS_ENGINE ?? "say").trim().toLowerCase();
  if (e === "none" || e === "off") return "none";
  return "say";
}

export async function refreshTtsHealth(): Promise<{
  tts: ServiceState;
  ttsEngine: string;
  ttsError?: string;
}> {
  const engine = ttsEngineName();
  if (engine === "none") {
    probeCache = {
      at: Date.now(),
      state: "unavailable",
      error: "TTS disabled",
      engine: "none",
    };
    return { tts: "unavailable", ttsEngine: "none", ttsError: "TTS disabled" };
  }

  if (process.platform !== "darwin") {
    probeCache = {
      at: Date.now(),
      state: "unavailable",
      error: "Host TTS (say) requires macOS",
      engine,
    };
    return {
      tts: "unavailable",
      ttsEngine: engine,
      ttsError: "Host TTS (say) requires macOS",
    };
  }

  const probe = await probeMacSay();
  probeCache = {
    at: Date.now(),
    state: probe.ok ? "ready" : "error",
    error: probe.error,
    engine,
  };
  return {
    tts: probeCache.state,
    ttsEngine: engine,
    ttsError: probe.error,
  };
}

export function getTtsHealth(): {
  tts: ServiceState;
  ttsEngine: string;
  ttsError?: string;
} {
  if (!probeCache) {
    return {
      tts: "loading",
      ttsEngine: ttsEngineName(),
      ttsError: "not probed yet",
    };
  }
  return {
    tts: probeCache.state,
    ttsEngine: probeCache.engine,
    ttsError: probeCache.error,
  };
}

/**
 * Synthesize speech for a target language. Throws on failure / disabled.
 */
export async function synthesizeSpeech(
  text: string,
  lang: LangCode,
): Promise<TtsResult> {
  const engine = ttsEngineName();
  if (engine === "none") {
    throw new Error("TTS disabled (TTS_ENABLED=0 or TTS_ENGINE=none)");
  }
  if (engine === "say") {
    return synthesizeMacSay(text, lang);
  }
  throw new Error(`Unknown TTS engine: ${engine}`);
}
