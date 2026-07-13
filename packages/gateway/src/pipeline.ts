import { randomUUID } from "node:crypto";
import type { LangCode } from "@fonglish/shared";
import type { CaptionEvent } from "@fonglish/shared";
import { translateText } from "./mt-ollama.js";
import { getMtOnPartial } from "./quality.js";
import { LocalSttSession } from "./stt-local.js";
import type { Room, RoomPeer } from "./rooms.js";
import { broadcastCaption, send } from "./rooms.js";

/**
 * Per-speaker STT → MT pipeline.
 * Each client streams their own mic; captions are broadcast to the room
 * translated into each viewer's captionLang.
 *
 * By default, Ollama runs only on final STT segments (higher accuracy,
 * less flicker). Partials show source text or the last good translation.
 */
export class SpeakerPipeline {
  private stt: LocalSttSession | null = null;
  private utteranceId = randomUUID();
  private lastPartialText = "";
  private partialMtTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPartialMtAt = 0;
  private closed = false;
  private connecting: Promise<void> | null = null;
  private captionGeneration = 0;
  /** Last good translation per target lang (for partial display). */
  private lastGoodByTarget = new Map<LangCode, string>();
  private previousFinalSource = "";
  private previousFinalByTarget = new Map<LangCode, string>();
  /** Hold PCM until STT session is ready so the first utterance is not dropped. */
  private pendingPcm: Buffer[] = [];
  private static readonly MAX_PENDING = 80; // ~8s at 100ms chunks

  constructor(
    private room: Room,
    private peer: RoomPeer,
  ) {
    // Start STT immediately on join so the first speech isn't lost to connect race.
    void this.ensureStarted();
  }

  async ensureStarted(): Promise<void> {
    if (this.closed) return;
    if (this.stt) return;
    if (this.connecting) return this.connecting;

    this.connecting = (async () => {
      const session = new LocalSttSession(this.peer.speakLang, {
        onPartial: (p) => {
          void this.handleStt(p.text, p.isFinal, p.speechFinal);
        },
        onError: (message) => {
          send(this.peer.ws, {
            type: "error",
            code: "stt_error",
            message,
          });
          console.warn(`[stt] ${this.peer.peerId}: ${message}`);
        },
        onReady: () => {
          console.log(
            `[stt] ready for ${this.peer.displayName} (${this.peer.speakLang})`,
          );
        },
      });
      try {
        await session.connect();
        this.stt = session;
        // Flush any PCM that arrived while Whisper was connecting.
        if (this.pendingPcm.length > 0) {
          console.log(
            `[stt] flushing ${this.pendingPcm.length} buffered PCM chunks for ${this.peer.displayName}`,
          );
          for (const chunk of this.pendingPcm) {
            session.sendPcm(chunk);
          }
          this.pendingPcm = [];
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        send(this.peer.ws, {
          type: "error",
          code: "stt_connect_failed",
          message,
        });
        console.error(`[stt] connect failed: ${message}`);
        this.stt = null;
      } finally {
        this.connecting = null;
      }
    })();

    return this.connecting;
  }

  pushPcm(pcm: Buffer): void {
    if (this.closed || this.peer.muted) return;
    if (this.stt) {
      this.stt.sendPcm(pcm);
      return;
    }
    // Buffer until session ready
    this.pendingPcm.push(pcm);
    if (this.pendingPcm.length > SpeakerPipeline.MAX_PENDING) {
      this.pendingPcm.shift();
    }
    void this.ensureStarted();
  }

  updateLangs(speakLang: LangCode, captionLang: LangCode): void {
    const speakChanged = speakLang !== this.peer.speakLang;
    const captionChanged = captionLang !== this.peer.captionLang;
    if (!speakChanged && !captionChanged) return;

    this.peer.speakLang = speakLang;
    this.peer.captionLang = captionLang;

    if (speakChanged && this.stt) {
      this.stt.setLanguage(speakLang);
      console.log(
        `[stt] language → ${speakLang} for ${this.peer.displayName}`,
      );
    }

    this.resetCaptionState();
  }

  private resetCaptionState(): void {
    if (this.partialMtTimer) clearTimeout(this.partialMtTimer);
    this.partialMtTimer = null;
    this.utteranceId = randomUUID();
    this.lastPartialText = "";
    this.lastPartialMtAt = 0;
    this.captionGeneration++;
    this.lastGoodByTarget.clear();
  }

  private async handleStt(
    text: string,
    isFinal: boolean,
    speechFinal: boolean,
  ): Promise<void> {
    if (this.closed || !text.trim()) return;

    const finalUtterance = speechFinal || isFinal;
    this.lastPartialText = text;

    if (!finalUtterance) {
      if (this.partialMtTimer) clearTimeout(this.partialMtTimer);
      // Show partials quickly; MT only if MT_ON_PARTIAL (off by default)
      this.partialMtTimer = setTimeout(() => {
        void this.emitCaptions(text, false);
      }, getMtOnPartial() ? 900 : 250);
      return;
    }

    if (this.partialMtTimer) {
      clearTimeout(this.partialMtTimer);
      this.partialMtTimer = null;
    }

    await this.emitCaptions(text, true);

    if (speechFinal) {
      this.previousFinalSource = text;
      this.utteranceId = randomUUID();
      this.lastPartialText = "";
    }
  }

  private async emitCaptions(
    sourceText: string,
    isFinal: boolean,
  ): Promise<void> {
    const generation = this.captionGeneration;
    const sourceLang = this.peer.speakLang;
    const speakerId = this.peer.peerId;
    const speakerName = this.peer.displayName;
    const utteranceId = this.utteranceId;
    const ts = Date.now();
    const runMt = isFinal || getMtOnPartial();

    const targets = new Set<LangCode>();
    for (const p of this.room.peers.values()) {
      targets.add(p.captionLang);
    }
    targets.add(sourceLang);

    const translations = new Map<LangCode, string>();
    translations.set(sourceLang, sourceText);

    const mtTimings: number[] = [];

    await Promise.all(
      [...targets].map(async (targetLang) => {
        if (targetLang === sourceLang) return;

        if (!runMt) {
          // Finals-first: reuse last good MT or show source until final
          const stale =
            this.lastGoodByTarget.get(targetLang) ??
            this.previousFinalByTarget.get(targetLang);
          translations.set(targetLang, stale ?? sourceText);
          return;
        }

        // Optional throttle only when partial MT is enabled
        if (!isFinal && Date.now() - this.lastPartialMtAt < 1500) {
          const stale = this.lastGoodByTarget.get(targetLang);
          if (stale) translations.set(targetLang, stale);
          return;
        }

        try {
          const { text, ms } = await translateText(
            sourceText,
            sourceLang,
            targetLang,
            {
              previousSource: this.previousFinalSource || undefined,
              previousTranslation:
                this.previousFinalByTarget.get(targetLang) || undefined,
            },
          );
          translations.set(targetLang, text);
          this.lastGoodByTarget.set(targetLang, text);
          if (isFinal) {
            this.previousFinalByTarget.set(targetLang, text);
          }
          mtTimings.push(ms);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[mt] ${message}`);
          translations.set(
            targetLang,
            this.lastGoodByTarget.get(targetLang) ?? sourceText,
          );
          send(this.peer.ws, {
            type: "error",
            code: "mt_error",
            message,
          });
        }
      }),
    );

    if (!isFinal && runMt) this.lastPartialMtAt = Date.now();

    if (generation !== this.captionGeneration) return;

    if (mtTimings.length > 0) {
      const avg = Math.round(
        mtTimings.reduce((a, b) => a + b, 0) / mtTimings.length,
      );
      send(this.peer.ws, { type: "stats", mtMs: avg });
      console.log(
        `[mt] ${avg}ms | ${isFinal ? "final" : "partial"} | ${sourceLang} → ${[...targets].join(",")}`,
      );
    }

    broadcastCaption(this.room, speakerId, (viewer) => {
      const targetLang = viewer.captionLang;
      const translatedText =
        translations.get(targetLang) ??
        translations.get(sourceLang) ??
        sourceText;

      const caption: CaptionEvent = {
        roomId: this.room.roomId,
        speakerId,
        speakerName,
        utteranceId,
        isFinal,
        sourceLang,
        targetLang,
        sourceText,
        translatedText,
        ts,
      };

      return { type: "caption", caption };
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.partialMtTimer) clearTimeout(this.partialMtTimer);
    await this.stt?.close();
    this.stt = null;
  }
}
