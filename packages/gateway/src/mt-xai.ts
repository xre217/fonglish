import OpenAI from "openai";
import type { LangCode } from "@fonglish/shared";
import { LANG_LABEL } from "@fonglish/shared";

const MODEL = process.env.XAI_MT_MODEL ?? "grok-4.5";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    const key = process.env.XAI_API_KEY;
    if (!key) throw new Error("XAI_API_KEY is not set");
    client = new OpenAI({
      apiKey: key,
      baseURL: "https://api.x.ai/v1",
    });
  }
  return client;
}

export type TranslateResult = {
  text: string;
  ms: number;
};

/**
 * Translate source text into target language. Returns only the translation.
 * If source and target match, returns the original text (no API call).
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

  const openai = getClient();
  const resp = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0.1,
    max_tokens: 256,
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: `Source language: ${LANG_LABEL[sourceLang]} (${sourceLang})\n\n${trimmed}`,
      },
    ],
  });

  const text = resp.choices[0]?.message?.content?.trim() ?? trimmed;
  return { text, ms: Date.now() - started };
}
