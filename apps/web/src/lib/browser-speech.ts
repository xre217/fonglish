import type { LangCode } from "@fonglish/shared";

/** Minimal Web Speech types (not always present in TS DOM lib). */
type SpeechRecResultLike = {
  isFinal: boolean;
  0?: { transcript?: string };
  length: number;
};

type SpeechRecEventLike = {
  resultIndex: number;
  results: ArrayLike<SpeechRecResultLike> & { length: number };
};

type SpeechRecErrorLike = {
  error: string;
};

type SpeechRecLike = {
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  lang: string;
  onstart: ((ev: Event) => void) | null;
  onresult: ((ev: SpeechRecEventLike) => void) | null;
  onerror: ((ev: SpeechRecErrorLike) => void) | null;
  onend: ((ev: Event) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecConstructor = new () => SpeechRecLike;

function getSpeechRecognitionCtor(): SpeechRecConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    SpeechRecognition?: SpeechRecConstructor;
    webkitSpeechRecognition?: SpeechRecConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Map Fonglish lang codes to BCP-47 tags Web Speech understands. */
export function langToBcp47(lang: LangCode): string {
  const map: Record<LangCode, string> = {
    en: "en-US",
    es: "es-ES",
    fr: "fr-FR",
    de: "de-DE",
    zh: "zh-CN",
    ja: "ja-JP",
    pt: "pt-BR",
    ko: "ko-KR",
  };
  return map[lang] ?? "en-US";
}

export function browserSpeechSupported(): boolean {
  return getSpeechRecognitionCtor() != null;
}

export type BrowserSpeechHandlers = {
  onText: (text: string, isFinal: boolean) => void;
  onError?: (message: string) => void;
  onStart?: () => void;
};

/**
 * Continuous browser speech recognition (Chrome/Edge).
 * Restarts automatically after silence. Free, works without PCM/Whisper.
 */
export class BrowserSpeechSource {
  private rec: SpeechRecLike | null = null;
  private stopped = true;
  private lang: LangCode;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    lang: LangCode,
    private readonly handlers: BrowserSpeechHandlers,
  ) {
    this.lang = lang;
  }

  start(): boolean {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return false;

    this.stopped = false;
    try {
      const rec = new Ctor();
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      rec.lang = langToBcp47(this.lang);

      rec.onstart = () => this.handlers.onStart?.();

      rec.onresult = (ev) => {
        let interim = "";
        let finals = "";
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const result = ev.results[i];
          if (!result) continue;
          const piece = result[0]?.transcript ?? "";
          if (result.isFinal) finals += piece;
          else interim += piece;
        }
        const finalText = finals.replace(/\s+/g, " ").trim();
        const interimText = interim.replace(/\s+/g, " ").trim();
        if (finalText) this.handlers.onText(finalText, true);
        else if (interimText) this.handlers.onText(interimText, false);
      };

      rec.onerror = (ev) => {
        if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
          this.handlers.onError?.(
            "Browser speech permission blocked — allow microphone for captions.",
          );
        } else if (ev.error === "network") {
          this.handlers.onError?.(
            "Browser speech needs network (Chrome speech service).",
          );
        }
      };

      rec.onend = () => {
        if (this.stopped) return;
        this.restartTimer = setTimeout(() => {
          if (this.stopped || !this.rec) return;
          try {
            this.rec.start();
          } catch {
            /* already started */
          }
        }, 250);
      };

      this.rec = rec;
      rec.start();
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.handlers.onError?.(`Browser speech failed: ${message}`);
      return false;
    }
  }

  setLanguage(lang: LangCode): void {
    if (lang === this.lang) return;
    this.lang = lang;
    if (this.stopped || !this.rec) return;
    this.stop();
    this.start();
  }

  stop(): void {
    this.stopped = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    const rec = this.rec;
    this.rec = null;
    if (!rec) return;
    try {
      rec.onend = null;
      rec.onresult = null;
      rec.onerror = null;
      rec.stop();
    } catch {
      try {
        rec.abort();
      } catch {
        /* ignore */
      }
    }
  }
}
