import type {
  CaptionEvent,
  ClientMessage,
  GatewayServices,
  InterpretEvent,
  LangCode,
  PeerInfo,
  ServerMessage,
  SignalPayload,
} from "@fonglish/shared";
import {
  resolveGatewayUrl,
  formatWsError,
  isValidWsUrl,
  normalizeWsUrl,
} from "./gateway-url";

export type CaptionClientHandlers = {
  onWelcome?: (
    peers: PeerInfo[],
    peerId: string,
    roomId: string,
    services?: GatewayServices,
  ) => void;
  onPeerJoined?: (peer: PeerInfo) => void;
  onPeerLeft?: (peerId: string) => void;
  onPeerUpdated?: (peer: PeerInfo) => void;
  onSignal?: (fromId: string, payload: SignalPayload) => void;
  onCaption?: (caption: CaptionEvent) => void;
  onInterpret?: (interpret: InterpretEvent) => void;
  onError?: (code: string, message: string) => void;
  onStats?: (stats: { sttMs?: number; mtMs?: number; ttsMs?: number }) => void;
  onServices?: (services: GatewayServices) => void;
  onOpen?: () => void;
  onClose?: () => void;
};

export class CaptionClient {
  private ws: WebSocket | null = null;
  private handlers: CaptionClientHandlers = {};

  connect(handlers: CaptionClientHandlers): void {
    this.handlers = handlers;
    const url = normalizeWsUrl(resolveGatewayUrl());

    if (!isValidWsUrl(url)) {
      this.handlers.onError?.("ws_error", formatWsError(url));
      return;
    }
    // HTTPS page + plain ws:// → browsers throw (Safari: "pattern", Chrome: construct failed)
    if (
      typeof window !== "undefined" &&
      window.location.protocol === "https:" &&
      url.startsWith("ws://")
    ) {
      this.handlers.onError?.("ws_error", formatWsError(url));
      return;
    }

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.handlers.onError?.("ws_error", formatWsError(url, detail));
      return;
    }
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    ws.onopen = () => this.handlers.onOpen?.();
    ws.onclose = () => this.handlers.onClose?.();
    ws.onerror = () => {
      this.handlers.onError?.("ws_error", formatWsError(url));
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== "string") return;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(ev.data) as ServerMessage;
      } catch {
        return;
      }
      switch (msg.type) {
        case "welcome":
          this.handlers.onWelcome?.(
            msg.peers,
            msg.peerId,
            msg.roomId,
            msg.services,
          );
          if (msg.services) this.handlers.onServices?.(msg.services);
          break;
        case "peer_joined":
          this.handlers.onPeerJoined?.(msg.peer);
          break;
        case "peer_left":
          this.handlers.onPeerLeft?.(msg.peerId);
          break;
        case "peer_updated":
          this.handlers.onPeerUpdated?.(msg.peer);
          break;
        case "signal":
          this.handlers.onSignal?.(msg.fromId, msg.payload);
          break;
        case "caption":
          this.handlers.onCaption?.(msg.caption);
          break;
        case "interpret":
          this.handlers.onInterpret?.(msg.interpret);
          break;
        case "error":
          this.handlers.onError?.(msg.code, msg.message);
          break;
        case "stats":
          this.handlers.onStats?.({
            sttMs: msg.sttMs,
            mtMs: msg.mtMs,
            ttsMs: msg.ttsMs,
          });
          break;
        case "services":
          this.handlers.onServices?.(msg.services);
          break;
      }
    };
  }

  join(opts: {
    roomId: string;
    peerId: string;
    displayName: string;
    speakLang: LangCode;
    captionLang: LangCode;
  }): void {
    this.send({
      type: "join",
      roomId: opts.roomId,
      peerId: opts.peerId,
      displayName: opts.displayName,
      speakLang: opts.speakLang,
      captionLang: opts.captionLang,
    });
  }

  updateLangs(speakLang: LangCode, captionLang: LangCode): void {
    this.send({ type: "update_langs", speakLang, captionLang });
  }

  signal(targetId: string, payload: SignalPayload): void {
    this.send({ type: "signal", targetId, payload });
  }

  setMuted(muted: boolean): void {
    this.send({ type: "mute", muted });
  }

  /**
   * Send PCM16 mono to the gateway for Whisper STT.
   * Uses base64 JSON by default — more reliable through Cloudflare/quick tunnels
   * than raw binary frames from some browsers. Binary still accepted by gateway.
   */
  sendPcm(pcm: ArrayBuffer, opts?: { binary?: boolean }): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    if (opts?.binary) {
      this.ws.send(pcm);
      return;
    }
    this.send({
      type: "audio.pcm",
      data: arrayBufferToBase64(pcm),
      sampleRate: 16000,
      ts: Date.now(),
    });
  }

  /** Send browser-transcribed text (Web Speech API) for MT + captions. */
  sendSttText(text: string, isFinal: boolean, source = "browser"): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    const cleaned = text.replace(/\s+/g, " ").trim();
    if (!cleaned) return;
    this.send({
      type: "stt.text",
      text: cleaned,
      isFinal,
      source,
    });
  }

  leave(): void {
    this.send({ type: "leave" });
    this.close();
  }

  close(): void {
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
  }

  get ready(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
