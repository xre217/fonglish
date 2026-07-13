import type { SignalPayload } from "@fonglish/shared";

/**
 * STUN + multiple free TURN relays so Mac↔Windows media works across NATs.
 * Host/srflx alone often fails (mDNS privacy, symmetric NAT, guest Wi‑Fi).
 */
const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
  { urls: "stun:global.stun.twilio.com:3478" },
  // Metered free open relay (public demo credentials — still widely used)
  {
    urls: [
      "turn:openrelay.metered.ca:80",
      "turn:openrelay.metered.ca:80?transport=tcp",
      "turn:openrelay.metered.ca:443",
      "turns:openrelay.metered.ca:443?transport=tcp",
      "turn:openrelay.metered.ca:443?transport=tcp",
    ],
    username: "openrelayproject",
    credential: "openrelayproject",
  },
];

export type PeerConnectionHandlers = {
  onRemoteStream: (stream: MediaStream) => void;
  onSignal: (payload: SignalPayload) => void;
  onConnectionState?: (state: RTCPeerConnectionState) => void;
  onIceConnectionState?: (state: RTCIceConnectionState) => void;
  onIceGatheringState?: (state: RTCIceGatheringState) => void;
  onDiagnostic?: (line: string) => void;
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
  /** ICE that arrived before remote description — must not drop these. */
  private pendingIce: RTCIceCandidateInit[] = [];
  private closed = false;
  private iceRestartTimer: ReturnType<typeof setTimeout> | null = null;
  private remoteDescSet = false;

  constructor(
    private readonly localStream: MediaStream,
    private readonly handlers: PeerConnectionHandlers,
    opts: { polite: boolean },
  ) {
    this.isPolite = opts.polite;
    this.pc = new RTCPeerConnection({
      iceServers: ICE_SERVERS,
      iceCandidatePoolSize: 8,
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require",
    });

    for (const track of localStream.getTracks()) {
      this.pc.addTrack(track, localStream);
      this.diag(`local ${track.kind} track ${track.label || track.id} readyState=${track.readyState}`);
    }

    this.pc.ontrack = (ev) => {
      this.diag(`ontrack ${ev.track.kind} streams=${ev.streams.length}`);
      // Always merge into one remote MediaStream so late audio/video both appear
      if (!this.remoteStream) this.remoteStream = new MediaStream();
      const stream = this.remoteStream;
      if (!stream.getTracks().some((t) => t.id === ev.track.id)) {
        stream.addTrack(ev.track);
      }
      // Also attach any tracks from browser-provided streams
      for (const s of ev.streams) {
        for (const t of s.getTracks()) {
          if (!stream.getTracks().some((x) => x.id === t.id)) {
            stream.addTrack(t);
          }
        }
      }
      this.handlers.onRemoteStream(stream);
    };

    this.pc.onicecandidate = (ev) => {
      if (!ev.candidate) {
        this.diag("ICE gathering complete");
        return;
      }
      const c = ev.candidate.candidate;
      const typ = / typ (\w+)/.exec(c)?.[1] ?? "?";
      this.diag(`ICE local candidate typ=${typ}`);
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
      const s = this.pc.connectionState;
      this.diag(`connectionState=${s}`);
      this.handlers.onConnectionState?.(s);
      if (s === "failed") {
        this.scheduleIceRestart();
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      const s = this.pc.iceConnectionState;
      this.diag(`iceConnectionState=${s}`);
      this.handlers.onIceConnectionState?.(s);
      if (s === "failed") {
        this.scheduleIceRestart();
      }
    };

    this.pc.onicegatheringstatechange = () => {
      this.handlers.onIceGatheringState?.(this.pc.iceGatheringState);
    };

    // Helpful when tracks are added later
    this.pc.onnegotiationneeded = () => {
      if (this.closed || this.isPolite) return;
      if (this.pc.signalingState !== "stable") return;
      void this.createOffer().catch((e) =>
        this.diag(`negotiationneeded failed: ${String(e)}`),
      );
    };
  }

  private diag(line: string): void {
    console.info(`[webrtc] ${line}`);
    this.handlers.onDiagnostic?.(line);
  }

  private scheduleIceRestart(): void {
    if (this.closed || this.iceRestartTimer) return;
    this.diag("scheduling ICE restart in 1.5s");
    this.iceRestartTimer = setTimeout(() => {
      this.iceRestartTimer = null;
      void this.restartIce();
    }, 1500);
  }

  /** Public retry for UI button. */
  async restartIce(): Promise<void> {
    if (this.closed) return;
    try {
      this.diag("ICE restart…");
      try {
        this.pc.restartIce?.();
      } catch {
        /* older browsers */
      }
      // Either side can send an iceRestart offer when stable
      if (this.pc.signalingState === "stable") {
        await this.createOffer({ iceRestart: true });
      } else {
        this.diag(`skip offer restart (signaling=${this.pc.signalingState})`);
      }
    } catch (err) {
      this.diag(
        `ICE restart error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async createOffer(opts?: { iceRestart?: boolean }): Promise<void> {
    if (this.closed) return;
    try {
      this.makingOffer = true;
      const offer = await this.pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
        iceRestart: opts?.iceRestart === true,
      });
      // Guard against glare
      if (this.pc.signalingState !== "stable" && !opts?.iceRestart) {
        // still allow if we own the offer slot
      }
      await this.pc.setLocalDescription(offer);
      this.diag(`sent offer iceRestart=${Boolean(opts?.iceRestart)}`);
      this.handlers.onSignal({
        kind: "offer",
        sdp: this.pc.localDescription!.sdp,
      });
    } finally {
      this.makingOffer = false;
    }
  }

  async handleSignal(payload: SignalPayload): Promise<void> {
    if (this.closed) return;

    if (payload.kind === "offer") {
      const offerCollision =
        this.makingOffer || this.pc.signalingState !== "stable";
      this.ignoreOffer = !this.isPolite && offerCollision;
      if (this.ignoreOffer) {
        this.diag("ignoring offer (glare, impolite)");
        return;
      }

      this.diag("got offer → answer");
      await this.pc.setRemoteDescription({
        type: "offer",
        sdp: payload.sdp,
      });
      await this.flushIce();
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      this.handlers.onSignal({
        kind: "answer",
        sdp: this.pc.localDescription!.sdp,
      });
      return;
    }

    if (payload.kind === "answer") {
      if (this.pc.signalingState === "stable") {
        this.diag("skip answer (already stable)");
        return;
      }
      this.diag("got answer");
      await this.pc.setRemoteDescription({
        type: "answer",
        sdp: payload.sdp,
      });
      await this.flushIce();
      return;
    }

    if (payload.kind === "ice") {
      if (!payload.candidate?.candidate) return;
      const init: RTCIceCandidateInit = {
        candidate: payload.candidate.candidate,
        sdpMid: payload.candidate.sdpMid ?? undefined,
        sdpMLineIndex: payload.candidate.sdpMLineIndex ?? undefined,
        usernameFragment: payload.candidate.usernameFragment ?? undefined,
      };
      if (!this.remoteDescSet && !this.pc.remoteDescription) {
        this.pendingIce.push(init);
        this.diag(`queued remote ICE (${this.pendingIce.length})`);
        return;
      }
      try {
        await this.pc.addIceCandidate(init);
      } catch (err) {
        if (!this.ignoreOffer) {
          this.diag(
            `addIceCandidate failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
  }

  private async flushIce(): Promise<void> {
    this.remoteDescSet = true;
    const batch = this.pendingIce.splice(0, this.pendingIce.length);
    for (const c of batch) {
      try {
        await this.pc.addIceCandidate(c);
      } catch (err) {
        this.diag(
          `flush ICE failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    if (batch.length) this.diag(`flushed ${batch.length} queued ICE candidates`);
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

  getStatsSummary(): Promise<string> {
    return this.pc.getStats().then((stats) => {
      let pairs = 0;
      let selected = "";
      stats.forEach((r) => {
        if (r.type === "candidate-pair" && "state" in r) {
          pairs++;
          const row = r as RTCIceCandidatePairStats;
          if (row.state === "succeeded" || row.nominated) {
            selected = `${row.state} nominated=${row.nominated}`;
          }
        }
      });
      return `pairs=${pairs} ${selected || "no-nominated"} ice=${this.pc.iceConnectionState} conn=${this.pc.connectionState}`;
    });
  }

  close(): void {
    this.closed = true;
    if (this.iceRestartTimer) {
      clearTimeout(this.iceRestartTimer);
      this.iceRestartTimer = null;
    }
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

  const wantVideo = opts?.video !== false;
  const wantAudio = opts?.audio !== false;

  // Progressive constraints — Windows desktops often fail with facingMode: "user"
  const attempts: MediaStreamConstraints[] = [];
  if (wantVideo && wantAudio) {
    attempts.push({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });
    attempts.push({ audio: true, video: true });
    attempts.push({
      audio: true,
      video: { width: { ideal: 640 }, height: { ideal: 480 } },
    });
    // Ultra-simple last video attempt
    attempts.push({ audio: true, video: { facingMode: undefined as unknown as undefined } });
  } else if (wantVideo) {
    attempts.push({ video: true });
  } else {
    attempts.push({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    attempts.push({ audio: true });
  }

  // Clean attempts — remove invalid constraint object
  const cleanAttempts = attempts.filter((a) => {
    if (a.video && typeof a.video === "object") {
      const v = a.video as Record<string, unknown>;
      if ("facingMode" in v && v.facingMode === undefined) {
        return false;
      }
    }
    return true;
  });
  // Always end with simplest
  if (wantVideo && wantAudio) {
    cleanAttempts.push({ audio: true, video: true });
  }

  let lastErr: unknown;
  for (const constraints of cleanAttempts) {
    try {
      return await devices.getUserMedia(constraints);
    } catch (err) {
      lastErr = err;
    }
  }

  // Last resort: audio only so the call can still connect
  if (wantVideo && wantAudio) {
    try {
      const audioOnly = await devices.getUserMedia({ audio: true });
      console.warn(
        "[media] Camera failed; continuing with microphone only.",
        lastErr,
      );
      return audioOnly;
    } catch {
      /* fall through */
    }
  }

  const name = lastErr instanceof DOMException ? lastErr.name : "";
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    throw new Error(
      "Camera/mic permission denied. Click the lock icon in the address bar → Site settings → Allow camera & microphone, then reload.",
    );
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    throw new Error("No camera or microphone found on this device.");
  }
  if (
    name === "NotReadableError" ||
    name === "TrackStartError" ||
    /could not start video source|could not start audio source/i.test(msg)
  ) {
    throw new Error(
      "Could not start camera/mic — another app may be using it (Teams, Zoom, Skype). Close those, unplug/replug the camera, then reload. On Windows also check Settings → Privacy → Camera/Microphone.",
    );
  }
  if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") {
    throw new Error(
      "Camera does not support the requested settings. Try another camera in system settings, then reload.",
    );
  }
  throw new Error(msg || "Could not access camera/microphone.");
}
