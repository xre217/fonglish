import type {
  CaptionEvent,
  ClientMessage,
  LangCode,
  PeerInfo,
  ServerMessage,
  SignalPayload,
} from "@fonglish/shared";

export type CaptionClientHandlers = {
  onWelcome?: (peers: PeerInfo[], peerId: string, roomId: string) => void;
  onPeerJoined?: (peer: PeerInfo) => void;
  onPeerLeft?: (peerId: string) => void;
  onPeerUpdated?: (peer: PeerInfo) => void;
  onSignal?: (fromId: string, payload: SignalPayload) => void;
  onCaption?: (caption: CaptionEvent) => void;
  onError?: (code: string, message: string) => void;
  onStats?: (stats: { sttMs?: number; mtMs?: number }) => void;
  onOpen?: () => void;
  onClose?: () => void;
};

function gatewayUrl(): string {
  return (
    process.env.NEXT_PUBLIC_GATEWAY_URL ??
    (typeof window !== "undefined"
      ? `ws://${window.location.hostname}:8787`
      : "ws://localhost:8787")
  );
}

export class CaptionClient {
  private ws: WebSocket | null = null;
  private handlers: CaptionClientHandlers = {};

  connect(handlers: CaptionClientHandlers): void {
    this.handlers = handlers;
    const url = gatewayUrl();
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    ws.onopen = () => this.handlers.onOpen?.();
    ws.onclose = () => this.handlers.onClose?.();
    ws.onerror = () => {
      this.handlers.onError?.(
        "ws_error",
        "WebSocket error — is the gateway running on port 8787?",
      );
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
          this.handlers.onWelcome?.(msg.peers, msg.peerId, msg.roomId);
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
        case "error":
          this.handlers.onError?.(msg.code, msg.message);
          break;
        case "stats":
          this.handlers.onStats?.({ sttMs: msg.sttMs, mtMs: msg.mtMs });
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

  sendPcm(pcm: ArrayBuffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(pcm);
    }
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
