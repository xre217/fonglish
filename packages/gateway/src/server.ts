import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { WebSocketServer, type WebSocket } from "ws";
import {
  isLangCode,
  type ClientMessage,
  type GatewayServices,
  type LangCode,
  type ServiceState,
} from "@fonglish/shared";
import {
  broadcast,
  getOrCreateRoom,
  getRoom,
  peerInfo,
  removePeer,
  send,
  type RoomPeer,
} from "./rooms.js";
import { SpeakerPipeline } from "./pipeline.js";
import { checkOllama } from "./mt-ollama.js";
import { getSttLoadState, preloadAsr } from "./stt-local.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load monorepo root .env
loadEnv({ path: path.resolve(__dirname, "../../../.env") });
loadEnv({ path: path.resolve(__dirname, "../../../.env.local") });

const PORT = Number(process.env.GATEWAY_PORT ?? 8787);
const HOST = process.env.GATEWAY_HOST ?? "0.0.0.0";

type SocketState = {
  peerId: string | null;
  roomId: string | null;
  pipeline: SpeakerPipeline | null;
};

type OllamaSnapshot = {
  ok: boolean;
  base: string;
  model: string;
  error?: string;
};

let ollamaSnap: OllamaSnapshot = {
  ok: false,
  base: process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
  model: process.env.OLLAMA_MT_MODEL ?? "llama3.2:3b",
  error: "not checked yet",
};

function sttServiceState(): ServiceState {
  const s = getSttLoadState().status;
  if (s === "ready") return "ready";
  if (s === "loading" || s === "idle") return "loading";
  if (s === "error") return "error";
  return "unavailable";
}

function currentServices(): GatewayServices {
  const stt = getSttLoadState();
  return {
    ollama: ollamaSnap.ok,
    ollamaModel: ollamaSnap.model,
    ollamaError: ollamaSnap.error,
    stt: sttServiceState(),
    sttModel: stt.model,
    sttError: stt.error,
  };
}

function broadcastServices(wss: WebSocketServer): void {
  const msg = { type: "services" as const, services: currentServices() };
  const raw = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === 1 /* OPEN */) {
      try {
        client.send(raw);
      } catch {
        /* ignore */
      }
    }
  }
}

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    void (async () => {
      // Refresh Ollama on health probes so UI can re-check without restart
      ollamaSnap = await checkOllama();
      const stt = getSttLoadState();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          ollama: ollamaSnap.ok,
          ollamaBase: ollamaSnap.base,
          ollamaModel: ollamaSnap.model,
          ollamaError: ollamaSnap.error,
          stt: sttServiceState(),
          sttModel: stt.model,
          sttError: stt.error,
          services: currentServices(),
        }),
      );
    })();
    return;
  }
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("fonglish gateway\n");
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  const state: SocketState = {
    peerId: null,
    roomId: null,
    pipeline: null,
  };

  // Push current readiness immediately so UI can show pills before join
  send(ws, { type: "services", services: currentServices() });

  ws.on("message", (raw, isBinary) => {
    if (isBinary) {
      handleBinary(ws, state, raw as Buffer);
      return;
    }
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString()) as ClientMessage;
    } catch {
      send(ws, { type: "error", code: "bad_json", message: "Invalid JSON" });
      return;
    }
    void handleJson(ws, state, msg);
  });

  ws.on("close", () => {
    void cleanup(state);
  });

  ws.on("error", (err) => {
    console.warn("[ws] error", err.message);
  });
});

function handleBinary(_ws: WebSocket, state: SocketState, buf: Buffer): void {
  if (!state.pipeline) return;
  state.pipeline.pushPcm(buf);
}

async function handleJson(
  ws: WebSocket,
  state: SocketState,
  msg: ClientMessage,
): Promise<void> {
  switch (msg.type) {
    case "join": {
      if (!msg.roomId || !msg.peerId) {
        send(ws, {
          type: "error",
          code: "bad_join",
          message: "roomId and peerId required",
        });
        return;
      }
      if (!isLangCode(msg.speakLang) || !isLangCode(msg.captionLang)) {
        send(ws, {
          type: "error",
          code: "bad_lang",
          message: "Invalid language code",
        });
        return;
      }

      await cleanup(state);

      const room = getOrCreateRoom(msg.roomId);
      if (room.peers.size >= 2 && !room.peers.has(msg.peerId)) {
        send(ws, {
          type: "error",
          code: "room_full",
          message: "This room already has 2 participants (v1 is 1:1)",
        });
        return;
      }

      const peer: RoomPeer = {
        peerId: msg.peerId,
        displayName: msg.displayName?.trim() || "Guest",
        speakLang: msg.speakLang as LangCode,
        captionLang: msg.captionLang as LangCode,
        muted: false,
        ws,
      };
      room.peers.set(peer.peerId, peer);
      state.peerId = peer.peerId;
      state.roomId = room.roomId;
      state.pipeline = new SpeakerPipeline(room, peer);

      const others = [...room.peers.values()]
        .filter((p) => p.peerId !== peer.peerId)
        .map(peerInfo);

      send(ws, {
        type: "welcome",
        peerId: peer.peerId,
        roomId: room.roomId,
        peers: others,
        services: currentServices(),
      });

      broadcast(
        room,
        { type: "peer_joined", peer: peerInfo(peer) },
        peer.peerId,
      );

      console.log(
        `[room ${room.roomId}] ${peer.displayName} joined (${room.peers.size} peers)`,
      );
      return;
    }

    case "leave": {
      await cleanup(state);
      return;
    }

    case "update_langs": {
      if (!state.roomId || !state.peerId) return;
      const room = getOrCreateRoom(state.roomId);
      const peer = room.peers.get(state.peerId);
      if (!peer) return;
      if (!isLangCode(msg.speakLang) || !isLangCode(msg.captionLang)) return;

      peer.captionLang = msg.captionLang;
      state.pipeline?.updateLangs(msg.speakLang, msg.captionLang);
      peer.speakLang = msg.speakLang;

      broadcast(room, { type: "peer_updated", peer: peerInfo(peer) });
      return;
    }

    case "signal": {
      if (!state.roomId || !state.peerId) return;
      const room = getOrCreateRoom(state.roomId);
      const target = room.peers.get(msg.targetId);
      if (!target) return;
      send(target.ws, {
        type: "signal",
        fromId: state.peerId,
        payload: msg.payload,
      });
      return;
    }

    case "mute": {
      if (!state.roomId || !state.peerId) return;
      const room = getOrCreateRoom(state.roomId);
      const peer = room.peers.get(state.peerId);
      if (!peer) return;
      peer.muted = msg.muted;
      broadcast(room, { type: "peer_updated", peer: peerInfo(peer) });
      return;
    }

    case "audio.meta":
    case "audio.end":
      return;

    default:
      send(ws, {
        type: "error",
        code: "unknown",
        message: `Unknown message type`,
      });
  }
}

async function cleanup(state: SocketState): Promise<void> {
  if (state.pipeline) {
    await state.pipeline.close();
    state.pipeline = null;
  }
  if (state.roomId && state.peerId) {
    const roomId = state.roomId;
    const peerId = state.peerId;
    const left = removePeer(roomId, peerId);
    if (left) {
      const room = getRoom(roomId);
      if (room && room.peers.size > 0) {
        broadcast(room, { type: "peer_left", peerId });
      }
      console.log(`[room ${roomId}] ${peerId} left`);
    }
  }
  state.peerId = null;
  state.roomId = null;
}

server.listen(PORT, HOST, () => {
  console.log(`fonglish gateway on ws://${HOST}:${PORT}`);

  void (async () => {
    ollamaSnap = await checkOllama();
    if (ollamaSnap.ok) {
      console.log(`Ollama: ok (${ollamaSnap.base}, model ${ollamaSnap.model})`);
    } else {
      console.warn(
        `Ollama: NOT READY (${ollamaSnap.base}, model ${ollamaSnap.model}) — ${ollamaSnap.error ?? "unknown"}`,
      );
      console.warn(
        "Start Ollama and pull the model, e.g. `ollama pull llama3.2:3b`",
      );
    }
    broadcastServices(wss);

    // Refresh Ollama periodically so clients see recovery without restart
    setInterval(() => {
      void checkOllama().then((o) => {
        const changed =
          o.ok !== ollamaSnap.ok ||
          o.model !== ollamaSnap.model ||
          o.error !== ollamaSnap.error;
        ollamaSnap = o;
        if (changed) broadcastServices(wss);
      });
    }, 15_000).unref?.();
  })();

  console.log("STT: preloading Whisper (Transformers.js)…");
  void preloadAsr().then((state) => {
    if (state.status === "ready") {
      console.log(`STT: ready (${state.model})`);
    } else {
      console.warn(
        `STT: ${state.status}${state.error ? ` — ${state.error}` : ""}`,
      );
    }
    broadcastServices(wss);
  });
});
