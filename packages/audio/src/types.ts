/**
 * Source-agnostic audio input (cross-platform).
 * v1: BrowserMicSource (works in Chromium/Edge/Chrome on Windows, macOS, Linux)
 * later: DesktopSystemAudioSource
 *   - Windows: WASAPI loopback / Stereo Mix / VB-Cable
 *   - macOS: BlackHole / ScreenCaptureKit
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
