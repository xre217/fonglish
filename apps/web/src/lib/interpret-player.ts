/**
 * Plays host-synthesized interpretation audio (PCM16 LE mono) and supports
 * barge-in + duck callbacks for remote WebRTC volume.
 */

export type InterpretPlayHandlers = {
  onPlayStart?: () => void;
  onPlayEnd?: () => void;
};

export class InterpretPlayer {
  private ctx: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private playing = false;
  private handlers: InterpretPlayHandlers = {};

  setHandlers(h: InterpretPlayHandlers): void {
    this.handlers = h;
  }

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.ctx = new AC();
    }
    return this.ctx;
  }

  /** Interrupt current playback (new utterance / leave room). */
  stop(): void {
    if (this.source) {
      try {
        this.source.onended = null;
        this.source.stop();
      } catch {
        /* already stopped */
      }
      this.source = null;
    }
    if (this.playing) {
      this.playing = false;
      this.handlers.onPlayEnd?.();
    }
  }

  /**
   * Decode base64 PCM16 LE mono and play. Interrupts any in-flight clip.
   */
  async playPcm16Base64(
    dataB64: string,
    sampleRate: number,
  ): Promise<void> {
    this.stop();

    let bytes: Uint8Array;
    try {
      const bin = atob(dataB64);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } catch {
      return;
    }
    if (bytes.byteLength < 2) return;

    // Ensure even length for Int16; copy to a tight ArrayBuffer for DataView
    const even = bytes.byteLength - (bytes.byteLength % 2);
    const ab = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + even,
    ) as ArrayBuffer;
    const view = new DataView(ab);
    const samples = even / 2;
    const floats = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      floats[i] = view.getInt16(i * 2, true) / 32768;
    }

    const ctx = this.ensureCtx();
    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {
        /* autoplay policy — user gesture may be required */
      }
    }

    const buffer = ctx.createBuffer(1, floats.length, sampleRate || 22050);
    buffer.copyToChannel(floats, 0);

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    this.source = src;
    this.playing = true;
    this.handlers.onPlayStart?.();

    src.onended = () => {
      if (this.source === src) {
        this.source = null;
        if (this.playing) {
          this.playing = false;
          this.handlers.onPlayEnd?.();
        }
      }
    };

    try {
      src.start(0);
    } catch {
      this.playing = false;
      this.source = null;
      this.handlers.onPlayEnd?.();
    }
  }

  dispose(): void {
    this.stop();
    if (this.ctx) {
      void this.ctx.close().catch(() => undefined);
      this.ctx = null;
    }
  }
}
