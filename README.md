# Fonglish

Real-time **bilingual subtitles** for 1:1 video calls.

- Browser **WebRTC** call (camera + mic)
- Each speaker streams **their own mic** to a Node **caption gateway**
- **Local Whisper STT** (energy VAD + Transformers.js) → **Ollama translation** → live captions
- Designed so a later **Zoom/Meet companion** can reuse the same gateway by swapping only the audio source

## Prerequisites

1. [Ollama](https://ollama.com) running locally
2. A chat model pulled, e.g.:

```bash
ollama pull llama3.2:3b
```

## Quick start

```bash
cd /Users/trefong/fonglish
cp .env.example .env
# defaults point at local Ollama — no API key needed

npm install

# terminal 1
npm run gateway

# terminal 2
npm run web
```

Open http://localhost:3000 in two browser profiles (or two machines).

1. Create a room on one side → **Copy invite link**
2. Open the link on the other side (set name + languages on the lobby, or join via room ID)
3. Allow camera/mic
4. Speak — captions appear under the video, translated into each person’s **Captions in** language

> First STT utterance downloads the Whisper ONNX model (~75MB) into the transformers cache. First MT call loads the Ollama model into memory.

## Architecture

```
Browser A ──WebRTC A/V── Browser B
   │ mic PCM                    │ mic PCM
   └──────────► Gateway ◄───────┘
                  │
     local Whisper STT + Ollama MT
                  │
            CaptionEvent (WS)
```

### Packages

| Path | Role |
|------|------|
| `apps/web` | Next.js lobby + call UI |
| `packages/gateway` | WebSocket signaling + STT/MT pipeline |
| `packages/shared` | Protocol types, languages |
| `packages/audio` | `AudioSource` interface + `BrowserMicSource` |

### Companion-ready seam

```ts
interface AudioSource {
  start(): AsyncIterable<AudioChunk>; // PCM16 mono @ 16 kHz
  stop(): Promise<void>;
}
// v1: BrowserMicSource
// later: DesktopSystemAudioSource (system/call audio)
```

Gateway protocol stays the same: binary PCM frames in → `caption` events out.

## Environment

| Variable | Default | Notes |
|----------|---------|--------|
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama HTTP API |
| `OLLAMA_MT_MODEL` | `llama3.2:3b` | Translation model (`ollama pull …`) |
| `WHISPER_MODEL` | `Xenova/whisper-tiny` | Local ASR via Transformers.js |
| `GATEWAY_PORT` | `8787` | Caption gateway |
| `NEXT_PUBLIC_GATEWAY_URL` | `ws://localhost:8787` | Browser WS URL |

## Protocol (summary)

Client → gateway JSON: `join`, `leave`, `update_langs`, `signal`, `mute`  
Client → gateway binary: raw PCM16 LE mono @ 16 kHz (~100 ms chunks)  
Gateway → client: `welcome`, `peer_joined`, `peer_left`, `signal`, `caption`, `error`, `stats`

## Privacy note

This MVP runs **STT and translation on your machine** (Whisper ONNX + Ollama). Mic PCM is sent only to the local caption gateway. A consent banner is shown in-call. No server-side transcript store is implemented.

## Out of scope (v1)

- Group calls (3+)
- Spoken dubbing / voice replacement
- Zoom/Meet overlay (designed, not built)
- Accounts / auth

## Troubleshooting

| Symptom | Check |
|---------|--------|
| “WebSocket error” | Gateway running? `curl http://localhost:8787/health` |
| No captions | Ollama running? `curl http://localhost:11434/api/tags` — model pulled? Gateway logs `STT: ready`? In-call **STT**/**MT** pills green? Mic unmuted? |
| MT errors | `OLLAMA_MT_MODEL` matches a pulled model? Try `ollama run llama3.2:3b` |
| STT pill yellow | Whisper still loading/downloading — wait for gateway log `STT: ready` |
| Slow first caption | Should be rare after preload; if cold start, wait for STT ready pill |
| No remote video | Allow camera; try same Wi‑Fi; check browser console for ICE errors |
| Room full | v1 is 1:1 — only two peers per room |

## License

Private / experimental.
