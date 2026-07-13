import { AUDIO } from "@fonglish/shared";
import type { AudioChunk, AudioSource } from "./types.js";

/**
 * Captures mic audio, downsamples to 16 kHz PCM16 mono, yields ~100ms chunks.
 * Uses ScriptProcessor as a widely-supported fallback (AudioWorklet optional later).
 */
export class BrowserMicSource implements AudioSource {
  readonly kind = "browser-mic";

  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private stopped = false;
  private queue: AudioChunk[] = [];
  private waiters: Array<(c: AudioChunk | null) => void> = [];
  private leftover = new Float32Array(0);

  constructor(
    private readonly getStream: () => Promise<MediaStream>,
    private readonly targetRate = AUDIO.sampleRate,
  ) {}

  async *start(): AsyncGenerator<AudioChunk> {
    this.stopped = false;
    this.stream = await this.getStream();
    const track = this.stream.getAudioTracks()[0];
    if (!track) throw new Error("No audio track on mic stream");

    this.ctx = new AudioContext();
    // Prefer running state for capture
    if (this.ctx.state === "suspended") {
      await this.ctx.resume();
    }

    this.sourceNode = this.ctx.createMediaStreamSource(this.stream);
    // 4096 frames ≈ buffer; we re-chunk after resample
    this.processor = this.ctx.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = (ev) => {
      if (this.stopped) return;
      const input = ev.inputBuffer.getChannelData(0);
      const resampled = this.resample(input, this.ctx!.sampleRate, this.targetRate);
      this.enqueuePcm(resampled);
    };

    this.sourceNode.connect(this.processor);
    // Keep processor alive without audible feedback
    const silent = this.ctx.createGain();
    silent.gain.value = 0;
    this.processor.connect(silent);
    silent.connect(this.ctx.destination);

    try {
      while (!this.stopped) {
        const chunk = await this.nextChunk();
        if (chunk === null) break;
        yield chunk;
      }
    } finally {
      await this.stop();
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const w of this.waiters) w(null);
    this.waiters = [];
    this.queue = [];

    try {
      this.processor?.disconnect();
      this.sourceNode?.disconnect();
    } catch {
      /* ignore */
    }
    this.processor = null;
    this.sourceNode = null;

    if (this.ctx) {
      await this.ctx.close().catch(() => undefined);
      this.ctx = null;
    }
    // Do not stop the MediaStream tracks — caller owns the call stream.
    this.stream = null;
  }

  private nextChunk(): Promise<AudioChunk | null> {
    if (this.queue.length > 0) {
      return Promise.resolve(this.queue.shift()!);
    }
    if (this.stopped) return Promise.resolve(null);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private push(chunk: AudioChunk) {
    const waiter = this.waiters.shift();
    if (waiter) waiter(chunk);
    else this.queue.push(chunk);
  }

  private enqueuePcm(samples: Float32Array) {
    // Concat leftover
    const merged = new Float32Array(this.leftover.length + samples.length);
    merged.set(this.leftover);
    merged.set(samples, this.leftover.length);

    const samplesPerChunk = AUDIO.chunkBytes / 2; // PCM16
    let offset = 0;
    while (offset + samplesPerChunk <= merged.length) {
      const slice = merged.subarray(offset, offset + samplesPerChunk);
      const pcm = floatTo16BitPCM(slice);
      this.push({
        pcm,
        sampleRate: this.targetRate,
        channels: 1,
        ts: Date.now(),
      });
      offset += samplesPerChunk;
    }
    this.leftover = merged.subarray(offset);
  }

  private resample(
    input: Float32Array,
    fromRate: number,
    toRate: number,
  ): Float32Array {
    if (fromRate === toRate) return input;
    const ratio = fromRate / toRate;
    const outLen = Math.floor(input.length / ratio);
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const src = i * ratio;
      const i0 = Math.floor(src);
      const i1 = Math.min(i0 + 1, input.length - 1);
      const t = src - i0;
      out[i] = input[i0]! * (1 - t) + input[i1]! * t;
    }
    return out;
  }
}

function floatTo16BitPCM(input: Float32Array): ArrayBuffer {
  const buf = new ArrayBuffer(input.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]!));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}
