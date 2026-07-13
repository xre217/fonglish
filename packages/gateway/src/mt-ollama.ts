import type { LangCode } from "@fonglish/shared";
import { LANG_LABEL } from "@fonglish/shared";

const OLLAMA_BASE =
  (process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").replace(/\/$/, "");
const MODEL = process.env.OLLAMA_MT_MODEL ?? "llama3.2:3b";

export type TranslateResult = {
  text: string;
  ms: number;
};

/**
 * Translate source text into target language via Ollama chat API.
 * Returns only the translation. Same-language → no API call.
 */
export async function translateText(
  sourceText: string,
  sourceLang: LangCode,
  targetLang: LangCode,
): Promise<TranslateResult> {
  const trimmed = sourceText.trim();
  if (!trimmed) return { text: "", ms: 0 };
  if (sourceLang === targetLang) return { text: trimmed, ms: 0 };

  const started = Date.now();
  const system = `You are a real-time meeting interpreter.
Translate the user message into ${LANG_LABEL[targetLang]} (${targetLang}).
Return ONLY the translation. Preserve proper nouns, numbers, and acronyms.
If input is incomplete, translate what is clear; do not invent content.
Do not add quotes, labels, or explanations.`;

  const resp = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      options: {
        temperature: 0.1,
        num_predict: 256,
      },
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: `Source language: ${LANG_LABEL[sourceLang]} (${sourceLang})\n\n${trimmed}`,
        },
      ],
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(
      `Ollama MT failed (${resp.status}): ${body.slice(0, 200) || resp.statusText}`,
    );
  }

  const data = (await resp.json()) as {
    message?: { content?: string };
  };
  const text = data.message?.content?.trim() ?? trimmed;
  return { text, ms: Date.now() - started };
}

/** Probe Ollama and confirm the configured model is available. */
export async function checkOllama(): Promise<{
  ok: boolean;
  base: string;
  model: string;
  error?: string;
}> {
  try {
    const resp = await fetch(`${OLLAMA_BASE}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!resp.ok) {
      return {
        ok: false,
        base: OLLAMA_BASE,
        model: MODEL,
        error: `HTTP ${resp.status}`,
      };
    }
    const data = (await resp.json()) as {
      models?: { name?: string }[];
    };
    const names = (data.models ?? []).map((m) => m.name ?? "");
    const hasModel =
      names.includes(MODEL) ||
      names.some((n) => n === MODEL || n.startsWith(`${MODEL}:`));
    if (!hasModel && names.length > 0) {
      return {
        ok: false,
        base: OLLAMA_BASE,
        model: MODEL,
        error: `model "${MODEL}" not found (have: ${names.slice(0, 5).join(", ")})`,
      };
    }
    return { ok: true, base: OLLAMA_BASE, model: MODEL };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, base: OLLAMA_BASE, model: MODEL, error: message };
  }
}
