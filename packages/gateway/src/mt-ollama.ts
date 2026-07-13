import type { LangCode } from "@fonglish/shared";
import { LANG_LABEL } from "@fonglish/shared";
import { getGlossary, getMtModel } from "./quality.js";

const OLLAMA_BASE =
  (process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").replace(/\/$/, "");

export type TranslateResult = {
  text: string;
  ms: number;
};

/** Optional prior utterance for pronoun / topic continuity. */
export type TranslateContext = {
  previousSource?: string;
  previousTranslation?: string;
};

function buildSystemPrompt(targetLang: LangCode): string {
  const label = LANG_LABEL[targetLang];
  const glossary = getGlossary();
  const glossaryBlock = glossary
    ? `\nGlossary (keep these terms exact):\n${glossary
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => `- ${p}`)
        .join("\n")}\n`
    : "";

  return `You are a professional real-time meeting interpreter.
Translate into ${label} (${targetLang}) only.

Rules:
- Output ONLY the translation — no quotes, labels, prefaces, or notes.
- Natural ${label} for spoken meeting language (not word-for-word calques).
- Preserve proper nouns, product names, numbers, acronyms, and code identifiers.
- Do not invent content. If the source is incomplete or garbled, translate what is clear.
- Do not add "Translation:", "Here is", or the language name.
- Keep roughly the same length and tone as the source.
${glossaryBlock}`;
}

/** Strip common LLM wrapper chatter from translations. */
export function sanitizeTranslation(raw: string, fallback: string): string {
  let t = raw.trim();
  if (!t) return fallback;

  // Strip surrounding quotes
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'")) ||
    (t.startsWith("“") && t.endsWith("”"))
  ) {
    t = t.slice(1, -1).trim();
  }

  // Drop common prefaces (first line)
  t = t
    .replace(
      /^(here(?:'s| is) (?:the )?(?:translation|translated text)\s*[:：-]?\s*)/i,
      "",
    )
    .replace(/^(translation\s*[:：-]\s*)/i, "")
    .replace(/^(translated text\s*[:：-]\s*)/i, "")
    .replace(/^(\*\*translation\*\*\s*[:：-]?\s*)/i, "")
    .trim();

  // If multi-paragraph with explanation, keep first non-empty paragraph
  const paras = t.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (paras.length > 1 && /^(note|explanation|alternatively)\b/i.test(paras[1]!)) {
    t = paras[0]!;
  }

  // Collapse internal newlines for captions
  t = t.replace(/\s*\n+\s*/g, " ").trim();

  return t || fallback;
}

/**
 * Translate source text into target language via Ollama chat API.
 * Returns only the translation. Same-language → no API call.
 */
export async function translateText(
  sourceText: string,
  sourceLang: LangCode,
  targetLang: LangCode,
  context?: TranslateContext,
): Promise<TranslateResult> {
  const trimmed = sourceText.trim();
  if (!trimmed) return { text: "", ms: 0 };
  if (sourceLang === targetLang) return { text: trimmed, ms: 0 };

  const model = getMtModel();
  const started = Date.now();
  const system = buildSystemPrompt(targetLang);

  let user = `Source language: ${LANG_LABEL[sourceLang]} (${sourceLang})\n\n${trimmed}`;
  if (context?.previousSource?.trim()) {
    user = `Previous utterance (context only — do not re-translate it):\n${context.previousSource.trim()}${
      context.previousTranslation
        ? `\nPrevious translation: ${context.previousTranslation.trim()}`
        : ""
    }\n\nTranslate this new utterance:\n${trimmed}`;
  }

  const resp = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      options: {
        temperature: 0.05,
        num_predict: 320,
        // Prefer determinism for captions
        top_p: 0.9,
      },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
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
  const raw = data.message?.content ?? "";
  const text = sanitizeTranslation(raw, trimmed);
  return { text, ms: Date.now() - started };
}

/** Probe Ollama and confirm the configured model is available. */
export async function checkOllama(): Promise<{
  ok: boolean;
  base: string;
  model: string;
  error?: string;
}> {
  const model = getMtModel();
  try {
    const resp = await fetch(`${OLLAMA_BASE}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!resp.ok) {
      return {
        ok: false,
        base: OLLAMA_BASE,
        model,
        error: `HTTP ${resp.status}`,
      };
    }
    const data = (await resp.json()) as {
      models?: { name?: string }[];
    };
    const names = (data.models ?? []).map((m) => m.name ?? "");
    const hasModel =
      names.includes(model) ||
      names.some((n) => n === model || n.startsWith(`${model.split(":")[0]}:`));
    // Also accept exact tag match variants
    const loose =
      hasModel ||
      names.some(
        (n) =>
          n === model ||
          n.startsWith(model) ||
          model.startsWith(n.replace(/:latest$/, "")),
      );
    if (!loose && names.length > 0) {
      return {
        ok: false,
        base: OLLAMA_BASE,
        model,
        error: `model "${model}" not found (have: ${names.slice(0, 6).join(", ")})`,
      };
    }
    return { ok: true, base: OLLAMA_BASE, model };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, base: OLLAMA_BASE, model, error: message };
  }
}
