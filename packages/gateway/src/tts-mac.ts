import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { LangCode } from "@fonglish/shared";

export type TtsResult = {
  pcm: Buffer;
  sampleRate: number;
  ms: number;
  format: "pcm16";
};

/** Default macOS `say` voices per language (override with TTS_VOICE_XX). */
const DEFAULT_VOICES: Record<LangCode, string> = {
  en: "Samantha",
  es: "Monica",
  fr: "Thomas",
  de: "Anna",
  zh: "Ting-Ting",
  ja: "Kyoko",
  pt: "Joana",
  ko: "Yuna",
};

export function voiceForLang(lang: LangCode): string {
  const key = `TTS_VOICE_${lang.toUpperCase()}`;
  const fromEnv = process.env[key]?.trim();
  if (fromEnv) return fromEnv;
  return DEFAULT_VOICES[lang] ?? "Samantha";
}

export function ttsRate(): number {
  const n = Number(process.env.TTS_RATE ?? 200);
  return Number.isFinite(n) && n > 50 && n < 500 ? n : 200;
}

function run(
  cmd: string,
  args: string[],
  timeoutMs = 30_000,
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${cmd} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
  });
}

/**
 * Parse a minimal WAV (PCM16 LE mono) into raw PCM + sample rate.
 */
export function parseWavPcm16(wav: Buffer): { pcm: Buffer; sampleRate: number } {
  if (wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF") {
    throw new Error("Invalid WAV from afconvert");
  }
  // Find "fmt " and "data" chunks (skip non-standard padding)
  let offset = 12;
  let sampleRate = 22050;
  let dataOffset = -1;
  let dataSize = 0;
  while (offset + 8 <= wav.length) {
    const id = wav.toString("ascii", offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    if (id === "fmt ") {
      sampleRate = wav.readUInt32LE(offset + 12);
    } else if (id === "data") {
      dataOffset = offset + 8;
      dataSize = size;
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (dataOffset < 0) throw new Error("WAV missing data chunk");
  const pcm = wav.subarray(dataOffset, dataOffset + dataSize);
  return { pcm: Buffer.from(pcm), sampleRate };
}

/**
 * Synthesize speech with macOS `say` → AIFF → WAV PCM16 mono via afconvert.
 */
export async function synthesizeMacSay(
  text: string,
  lang: LangCode,
): Promise<TtsResult> {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) throw new Error("Empty text for TTS");

  const voice = voiceForLang(lang);
  const rate = ttsRate();
  const dir = await mkdtemp(path.join(tmpdir(), "fonglish-tts-"));
  const aiffPath = path.join(dir, "out.aiff");
  const wavPath = path.join(dir, "out.wav");
  const started = Date.now();

  try {
    // Write text to file to avoid shell/arg length issues with quotes
    const textPath = path.join(dir, "in.txt");
    await writeFile(textPath, cleaned, "utf8");

    const sayRes = await run("say", [
      "-v",
      voice,
      "-r",
      String(rate),
      "-f",
      textPath,
      "-o",
      aiffPath,
    ]);
    if (sayRes.code !== 0) {
      throw new Error(
        `say failed (voice=${voice}): ${sayRes.stderr.trim() || `exit ${sayRes.code}`}`,
      );
    }

    const afRes = await run("afconvert", [
      aiffPath,
      wavPath,
      "-f",
      "WAVE",
      "-d",
      "LEI16",
      "-c",
      "1",
    ]);
    if (afRes.code !== 0) {
      throw new Error(
        `afconvert failed: ${afRes.stderr.trim() || `exit ${afRes.code}`}`,
      );
    }

    const wav = await readFile(wavPath);
    const { pcm, sampleRate } = parseWavPcm16(wav);
    if (pcm.length < 2) throw new Error("TTS produced empty audio");

    return {
      pcm,
      sampleRate,
      ms: Date.now() - started,
      format: "pcm16",
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function probeMacSay(): Promise<{
  ok: boolean;
  error?: string;
}> {
  if (process.platform !== "darwin") {
    return { ok: false, error: "macOS say TTS requires darwin" };
  }
  try {
    const whichSay = await run("which", ["say"], 5000);
    if (whichSay.code !== 0) {
      return { ok: false, error: "say not found on PATH" };
    }
    const whichAf = await run("which", ["afconvert"], 5000);
    if (whichAf.code !== 0) {
      return { ok: false, error: "afconvert not found on PATH" };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
