import type { SignalPayload } from "@fonglish/shared";

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

export type PeerConnectionHandlers = {
  onRemoteStream: (stream: MediaStream) => void;
  onSignal: (payload: SignalPayload) => void;
  onConnectionState?: (state: RTCPeerConnectionState) => void;
};

/**
 * Thin 1:1 WebRTC helper. Caller decides who is the polite peer (answerer).
 */
export class CallPeer {
  private pc: RTCPeerConnection;
  private makingOffer = false;
  private ignoreOffer = false;
  private isPolite: boolean;

  constructor(
    private readonly localStream: MediaStream,
    private readonly handlers: PeerConnectionHandlers,
    opts: { polite: boolean },
  ) {
    this.isPolite = opts.polite;
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    for (const track of localStream.getTracks()) {
      this.pc.addTrack(track, localStream);
    }

    this.pc.ontrack = (ev) => {
      const [stream] = ev.streams;
      if (stream) this.handlers.onRemoteStream(stream);
    };

    this.pc.onicecandidate = (ev) => {
      this.handlers.onSignal({
        kind: "ice",
        candidate: ev.candidate
          ? {
              candidate: ev.candidate.candidate,
              sdpMid: ev.candidate.sdpMid,
              sdpMLineIndex: ev.candidate.sdpMLineIndex,
              usernameFragment: ev.candidate.usernameFragment,
            }
          : null,
      });
    };

    this.pc.onconnectionstatechange = () => {
      this.handlers.onConnectionState?.(this.pc.connectionState);
    };
  }

  async createOffer(): Promise<void> {
    try {
      this.makingOffer = true;
      const offer = await this.pc.createOffer();
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
      await this.pc.setRemoteDescription({
        type: "answer",
        sdp: payload.sdp,
      });
      return;
    }

    if (payload.kind === "ice") {
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

export async function getMediaStream(opts?: {
  video?: boolean;
  audio?: boolean;
}): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
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
}
