export type LangCode =
  | "en"
  | "es"
  | "fr"
  | "de"
  | "zh"
  | "ja"
  | "pt"
  | "ko";

export type LangOption = {
  code: LangCode;
  label: string;
  nativeLabel: string;
};

/** Languages we surface in the UI (Whisper / Ollama-friendly set). */
export const LANGUAGES: LangOption[] = [
  { code: "en", label: "English", nativeLabel: "English" },
  { code: "es", label: "Spanish", nativeLabel: "Español" },
  { code: "fr", label: "French", nativeLabel: "Français" },
  { code: "de", label: "German", nativeLabel: "Deutsch" },
  { code: "zh", label: "Chinese", nativeLabel: "中文" },
  { code: "ja", label: "Japanese", nativeLabel: "日本語" },
  { code: "pt", label: "Portuguese", nativeLabel: "Português" },
  { code: "ko", label: "Korean", nativeLabel: "한국어" },
];

export const LANG_LABEL: Record<LangCode, string> = Object.fromEntries(
  LANGUAGES.map((l) => [l.code, l.label]),
) as Record<LangCode, string>;

export function isLangCode(value: string): value is LangCode {
  return LANGUAGES.some((l) => l.code === value);
}
