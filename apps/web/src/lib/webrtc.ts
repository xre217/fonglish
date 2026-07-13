import type { SignalPayload } from "@fonglish/shared";

/**
 * STUN + free public TURN (Metered openrelay) so Mac↔Windows media works
 * across NATs — STUN alone often fails for remote video.
 */
const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  {
    urls: "turn:openrelay.metered.ca:80",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  {
    urls: "turn:openrelay.metered.ca:443",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  {
    urls: "turn:openrelay.metered.ca:443?transport=tcp",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
];

export type PeerConnectionHandlers = {
  onRemoteStream: (stream: MediaStream) => void;
  onSignal: (payload: SignalPayload) => void;
  onConnectionState?: (state: RTCPeerConnectionState) => void;
  onIceConnectionState?: (state: RTCIceConnectionState) => void;
};

/**
 * Thin 1:1 WebRTC helper. Caller decides who is the polite peer (answerer).
 */
export class CallPeer {
  private pc: RTCPeerConnection;
  private makingOffer = false;
  private ignoreOffer = false;
  private isPolite: boolean;
  private remoteStream: MediaStream | null = null;

  constructor(
    private readonly localStream: MediaStream,
    private readonly handlers: PeerConnectionHandlers,
    opts: { polite: boolean },
  ) {
    this.isPolite = opts.polite;
    this.pc = new RTCPeerConnection({
      iceServers: ICE_SERVERS,
      iceCandidatePoolSize: 4,
    });

    for (const track of localStream.getTracks()) {
      this.pc.addTrack(track, localStream);
    }

    this.pc.ontrack = (ev) => {
      // Some browsers omit ev.streams — build stream from track
      let stream = ev.streams[0] ?? null;
      if (!stream) {
        if (!this.remoteStream) this.remoteStream = new MediaStream();
        stream = this.remoteStream;
        if (!stream.getTracks().some((t) => t.id === ev.track.id)) {
          stream.addTrack(ev.track);
        }
      } else {
        this.remoteStream = stream;
      }
      this.handlers.onRemoteStream(stream);
    };

    this.pc.onicecandidate = (ev) => {
      if (!ev.candidate) return; // end-of-candidates — skip null payload
      this.handlers.onSignal({
        kind: "ice",
        candidate: {
          candidate: ev.candidate.candidate,
          sdpMid: ev.candidate.sdpMid,
          sdpMLineIndex: ev.candidate.sdpMLineIndex,
          usernameFragment: ev.candidate.usernameFragment,
        },
      });
    };

    this.pc.onconnectionstatechange = () => {
      this.handlers.onConnectionState?.(this.pc.connectionState);
    };

    this.pc.oniceconnectionstatechange = () => {
      this.handlers.onIceConnectionState?.(this.pc.iceConnectionState);
    };
  }

  async createOffer(): Promise<void> {
    try {
      this.makingOffer = true;
      const offer = await this.pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });
      await this.pc.setLocalDescription(offer);
      this.handlers.onSignal({
        kind: "offer",
        sdp: this.pc.localDescription!.sdp,
      });
    } finally {
      this.makingOffer = false;
    }
  }

  async handleSignal(payload: SignalPayload): Promise<void> {
    if (payload.kind === "offer") {
      const offerCollision =
        this.makingOffer || this.pc.signalingState !== "stable";
      this.ignoreOffer = !this.isPolite && offerCollision;
      if (this.ignoreOffer) return;

      await this.pc.setRemoteDescription({
        type: "offer",
        sdp: payload.sdp,
      });
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      this.handlers.onSignal({
        kind: "answer",
        sdp: this.pc.localDescription!.sdp,
      });
      return;
    }

    if (payload.kind === "answer") {
      if (this.pc.signalingState === "stable") return;
      await this.pc.setRemoteDescription({
        type: "answer",
        sdp: payload.sdp,
      });
      return;
    }

    if (payload.kind === "ice") {
      if (!payload.candidate?.candidate) return;
      try {
        await this.pc.addIceCandidate(payload.candidate);
      } catch (err) {
        if (!this.ignoreOffer) throw err;
      }
    }
  }

  setMicEnabled(enabled: boolean): void {
    for (const t of this.localStream.getAudioTracks()) {
      t.enabled = enabled;
    }
  }

  setCamEnabled(enabled: boolean): void {
    for (const t of this.localStream.getVideoTracks()) {
      t.enabled = enabled;
    }
  }

  close(): void {
    try {
      this.pc.close();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Cam/mic access. Requires a secure context:
 * https://, http://localhost, or http://127.0.0.1
 * Plain http://192.168.x.x is NOT secure → mediaDevices is undefined.
 */
export async function getMediaStream(opts?: {
  video?: boolean;
  audio?: boolean;
}): Promise<MediaStream> {
  if (typeof window === "undefined") {
    throw new Error("Camera/mic only available in the browser.");
  }

  const host = window.location.hostname;
  const secure = window.isSecureContext;
  const devices = navigator.mediaDevices;

  if (!devices || typeof devices.getUserMedia !== "function") {
    const isLanHttp =
      window.location.protocol === "http:" &&
      host !== "localhost" &&
      host !== "127.0.0.1" &&
      host !== "[::1]";

    if (isLanHttp || !secure) {
      throw new Error(
        `Camera/mic blocked: browsers only allow getUserMedia on HTTPS or localhost — not on http://${host}. ` +
          `Fix (pick one): (1) On both PCs use Chrome flag “Insecure origins treated as secure” and add ` +
          `http://${host}:3000  then relaunch Chrome. ` +
          `(2) Or open http://127.0.0.1:3000 only for same-machine tests. ` +
          `(3) Or use a tunnel with real HTTPS (e.g. Cloudflare Tunnel).`,
      );
    }
    throw new Error(
      "Camera/mic API unavailable. Use Chrome/Edge and allow media permissions.",
    );
  }

  try {
    return await devices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video:
        opts?.video === false
          ? false
          : {
              width: { ideal: 1280 },
              height: { ideal: 720 },
              facingMode: "user",
            },
    });
  } catch (err) {
    const name = err instanceof DOMException ? err.name : "";
    const msg = err instanceof Error ? err.message : String(err);
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      throw new Error(
        "Camera/mic permission denied. Click the lock icon in the address bar and allow access, then reload.",
      );
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      throw new Error("No camera or microphone found on this device.");
    }
    throw new Error(msg || "Could not access camera/microphone.");
  }
}
