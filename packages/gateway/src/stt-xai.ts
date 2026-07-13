import WebSocket from "ws";
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

/**
 * Streaming STT session against xAI WebSocket API.
 * Sends raw PCM16 binary frames; receives transcript.partial events.
 */
export class XaiSttSession {
  private ws: WebSocket | null = null;
  private ready = false;
  private closed = false;
  private queue: Buffer[] = [];

  constructor(
    private readonly language: LangCode,
    private readonly handlers: SttHandlers,
  ) {}

  async connect(): Promise<void> {
    const key = process.env.XAI_API_KEY;
    if (!key) throw new Error("XAI_API_KEY is not set");

    const params = new URLSearchParams({
      sample_rate: String(AUDIO.sampleRate),
      encoding: AUDIO.encoding,
      interim_results: "true",
      language: this.language,
      endpointing: "400",
      smart_turn: "0.6",
      smart_turn_timeout: "2500",
    });

    const url = `wss://api.x.ai/v1/stt?${params.toString()}`;

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url, {
        headers: { Authorization: `Bearer ${key}` },
      });
      this.ws = ws;

      const onFail = (err: Error) => {
        cleanup();
        reject(err);
      };

      const cleanup = () => {
        ws.off("error", onFail);
      };

      ws.once("error", onFail);

      ws.on("open", () => {
        // wait for transcript.created
      });

      ws.on("message", (data) => {
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(data.toString()) as Record<string, unknown>;
        } catch {
          return;
        }

        const type = event.type as string;
        if (type === "transcript.created") {
          this.ready = true;
          this.flushQueue();
          this.handlers.onReady?.();
          cleanup();
          resolve();
          return;
        }

        if (type === "transcript.partial") {
          const text = String(event.text ?? "");
          if (!text.trim()) return;
          this.handlers.onPartial({
            text,
            isFinal: Boolean(event.is_final),
            speechFinal: Boolean(event.speech_final),
          });
          return;
        }

        if (type === "error") {
          this.handlers.onError(String(event.message ?? "STT error"));
          return;
        }

        if (type === "transcript.done") {
          this.closed = true;
        }
      });

      ws.on("close", () => {
        this.closed = true;
        this.ready = false;
      });

      ws.on("error", (err) => {
        this.handlers.onError(err.message);
      });

      // Connection timeout
      setTimeout(() => {
        if (!this.ready && !this.closed) {
          onFail(new Error("STT connection timeout"));
        }
      }, 15_000);
    });
  }

  sendPcm(pcm: Buffer | ArrayBuffer): void {
    if (this.closed) return;
    const buf = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm);
    if (!this.ready || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.queue.push(buf);
      // bound queue (~2s)
      if (this.queue.length > 20) this.queue.shift();
      return;
    }
    this.ws.send(buf);
  }

  private flushQueue() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    for (const buf of this.queue) this.ws.send(buf);
    this.queue = [];
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "audio.done" }));
      }
    } catch {
      /* ignore */
    }
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        try {
          ws.terminate();
        } catch {
          /* ignore */
        }
        resolve();
      }, 500);
      ws.once("close", () => {
        clearTimeout(t);
        resolve();
      });
      try {
        ws.close();
      } catch {
        clearTimeout(t);
        resolve();
      }
    });
  }
}
