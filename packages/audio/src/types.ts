/**
 * Source-agnostic audio input.
 * v1: BrowserMicSource
 * later: DesktopSystemAudioSource (Zoom/Meet companion)
 */
export type AudioChunk = {
  /** PCM16 little-endian mono */
  pcm: ArrayBuffer;
  sampleRate: number;
  channels: 1;
  ts: number;
};

export interface AudioSource {
  readonly kind: string;
  start(): AsyncIterable<AudioChunk>;
  stop(): Promise<void>;
}
