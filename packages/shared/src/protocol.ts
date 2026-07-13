import type { LangCode } from "./langs.js";

/** PCM16 mono chunk metadata (binary payload sent separately as WS binary). */
export type AudioChunkMeta = {
  type: "audio.chunk";
  sampleRate: number;
  channels: 1;
  /** Client send time ms */
  ts: number;
};

export type CaptionEvent = {
  roomId: string;
  speakerId: string;
  speakerName: string;
  utteranceId: string;
  isFinal: boolean;
  sourceLang: LangCode;
  targetLang: LangCode;
  sourceText: string;
  translatedText: string;
  ts: number;
};

/** Client → gateway JSON messages */
export type ClientMessage =
  | {
      type: "join";
      roomId: string;
      peerId: string;
      displayName: string;
      speakLang: LangCode;
      captionLang: LangCode;
    }
  | {
      type: "leave";
    }
  | {
      type: "update_langs";
      speakLang: LangCode;
      captionLang: LangCode;
    }
  | {
      type: "signal";
      targetId: string;
      payload: SignalPayload;
    }
  | {
      type: "audio.meta";
      sampleRate: number;
      channels: 1;
      ts: number;
    }
  | {
      type: "audio.end";
    }
  | {
      type: "mute";
      muted: boolean;
    };

export type IceCandidateInit = {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
};

export type SignalPayload =
  | { kind: "offer"; sdp: string }
  | { kind: "answer"; sdp: string }
  | { kind: "ice"; candidate: IceCandidateInit | null };

/** Gateway → client JSON messages */
export type ServerMessage =
  | {
      type: "welcome";
      peerId: string;
      roomId: string;
      peers: PeerInfo[];
    }
  | {
      type: "peer_joined";
      peer: PeerInfo;
    }
  | {
      type: "peer_left";
      peerId: string;
    }
  | {
      type: "peer_updated";
      peer: PeerInfo;
    }
  | {
      type: "signal";
      fromId: string;
      payload: SignalPayload;
    }
  | {
      type: "caption";
      caption: CaptionEvent;
    }
  | {
      type: "error";
      code: string;
      message: string;
    }
  | {
      type: "stats";
      sttMs?: number;
      mtMs?: number;
    };

export type PeerInfo = {
  peerId: string;
  displayName: string;
  speakLang: LangCode;
  captionLang: LangCode;
  muted: boolean;
};

/** Audio constants for PCM capture (16 kHz mono — Whisper-friendly). */
export const AUDIO = {
  sampleRate: 16000,
  channels: 1 as const,
  /** 100ms of PCM16 mono @ 16kHz */
  chunkBytes: 3200,
  encoding: "pcm" as const,
};
