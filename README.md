# Fonglish

Real-time **digital interpreter** for 1:1 video calls — hear the other person **spoken in your language**.

Optional **subtitles** (off by default). Long-term direction: companion alongside Zoom/Meet; today’s ship is a **browser WebRTC harness** + local Mac gateway (no cloud AI tokens).

- Browser **WebRTC** call (camera + mic)
- Each speaker streams **their own mic** to a Node **interpreter gateway**
- **Local Whisper STT** → **Ollama translation** → **macOS `say` TTS** → listener hears interpretation
- Original remote voice is **ducked** while translation plays
- **Subtitles** optional in-call toggle (default off)
- Host Mac runs STT/MT/TTS; Windows guests need only a browser + shared link

## Prerequisites

| Tool | Notes |
|------|--------|
| **Node.js 20+** | [nodejs.org](https://nodejs.org) — Windows: LTS installer is fine |
| **npm** | Bundled with Node |
| **Ollama** | [ollama.com](https://ollama.com) — Windows desktop app or install script |
| **Browser** | Chrome, Edge, or Chromium (best WebRTC + mic support) |

Pull a chat model (balanced preset uses `llama3`):

```bash
ollama pull llama3          # recommended for translation quality
# optional smaller/faster: ollama pull llama3.2:3b
```

## Windows one-click (no guest setup)

**Windows guest:** open one HTTPS link — no Node, no Chrome flags.  
**Mac host:** must stay online (runs Whisper + Ollama + free Cloudflare tunnel).

```bash
# Terminal 1 — interpreter brain (Whisper + Ollama + macOS say TTS)
npm run gateway

# Terminal 2 — public WSS tunnel (free Cloudflare quick tunnel)
npm run host:public
```

When the tunnel prints `wss://….trycloudflare.com`:

1. On the Mac open http://127.0.0.1:3000 (or the Vercel lobby).
2. Paste that **wss://** URL into **Interpreter gateway** (not the placeholder with `…`).
3. Set **I speak** / **I listen in** (e.g. host: speak English, listen Spanish; guest opposite).
4. Start a session → **Share access link**.
5. Send that link to Windows. It looks like:

```text
https://fonglish.vercel.app/room/<id>?gw=wss://xxxx.trycloudflare.com
```

Guest clicks → camera works (HTTPS) → joins your Mac gateway through the tunnel.

| Role | Needs |
|------|--------|
| Mac host | `gateway` + `host:public` running |
| Windows guest | Browser only + the shared link |

Quick tunnels change URL each restart; re-copy the link after restarting `host:public`.

## Caption quality (local, $0)

Accuracy is **STT × MT**. Defaults use the **balanced** preset (better than the old tiny/3B demo stack).

| `FONGLISH_QUALITY` | Whisper STT | Ollama MT | Use when |
|--------------------|-------------|-----------|----------|
| `fast` | `whisper-tiny` | `llama3.2:3b` | Lowest latency demos |
| **`balanced`** (default) | `whisper-base` | `llama3` (8B) | Daily use |
| `accurate` | `whisper-small` | `llama3` | Best local WER (heavier) |

```env
FONGLISH_QUALITY=balanced
# optional overrides:
# OLLAMA_MT_MODEL=llama3:latest
# WHISPER_MODEL=Xenova/whisper-small
# MT_ON_PARTIAL=0          # keep 0 — translate finals only (less flicker)
# MT_GLOSSARY=Fonglish,WebRTC,Ollama
```

**Tips for better translations**

1. Prefer **final** captions (default): partials show interim source; MT runs on speech end.  
2. Larger Whisper helps more than a larger chat model when the transcript is wrong.  
3. Use a glossary for product names that must not be translated.  
4. Pull a stronger multilingual model if needed (`qwen2.5:7b`, etc.) and set `OLLAMA_MT_MODEL`.

## Quick start (local)

Works the same on **Windows (PowerShell/cmd)**, macOS, and Linux:

```bash
cd fonglish
npm run env:init
# optional: edit .env — defaults use 127.0.0.1 (Windows-friendly)

npm install

# terminal 1 — interpreter brain (Whisper + Ollama + say TTS)
npm run gateway

# terminal 2 — UI (or use the Vercel deploy and skip this)
npm run web
```

Open **http://127.0.0.1:3000** (or your Vercel URL) in two browser profiles.

**Language pairing:** Peer A speak=en / listen=es, Peer B speak=es / listen=en. Each hears the other **spoken** in their listen language. Turn on **Subtitles** in the room toolbar if you want text.

## Deploy UI on Vercel

The **web app** deploys to Vercel. The **gateway does not** (long-lived WebSocket + local Whisper/Ollama).

```bash
# from repo root (requires vercel CLI login)
npx vercel link --yes
npx vercel --prod
```

| Piece | Where it runs |
|-------|----------------|
| Lobby + call UI | **Vercel** (Next.js) |
| WebSocket signaling + STT + MT + TTS | **Your Mac** (`npm run gateway`) |

On the lobby page, set **Interpreter gateway** to `ws://127.0.0.1:8787` (default). Start the gateway before joining a room. Spoken interpretation uses macOS `say` (host only).

```bash
npm run gateway   # keep running on the machine that does STT/MT
```

Optional Vercel env:

| Name | Example | Notes |
|------|---------|--------|
| `NEXT_PUBLIC_GATEWAY_URL` | `ws://127.0.0.1:8787` | Default WS URL baked into the build |

Monorepo build uses `npm run vercel-build` (shared + audio + web only — not the gateway).

1. Create a room → **Copy invite**
2. Open the link on the other side (name + languages on the lobby)
3. Allow camera/mic
4. Speak a full sentence and pause — the other person **hears** the translation (host TTS). Enable **Subtitles** if you want text.

> Whisper ONNX downloads on first gateway start (~75MB). Ollama loads the model on first translation. TTS uses built-in macOS voices (`say`).

### Windows notes

- Prefer **`127.0.0.1`** over `localhost` in `.env` (avoids IPv6 `::1` when Node listens on IPv4).
- Allow **Node.js** through **Windows Defender Firewall** for ports **8787** (gateway) and **3000** (web) if you connect from another PC.
- Use **PowerShell** or **cmd**; no Bash required. Health check:

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health
# or: curl.exe http://127.0.0.1:8787/health
```

- Install Ollama from [ollama.com/download](https://ollama.com/download) (Windows). Keep it running in the tray.
- Edge and Chrome both work; grant mic/camera when prompted.

### Two machines on a LAN

1. On the gateway host, note its LAN IP (e.g. `192.168.1.20`).
2. Set on **both** sides (or at least the client):

```env
NEXT_PUBLIC_GATEWAY_URL=ws://192.168.1.20:8787
```

3. Open `http://192.168.1.20:3000` (web is bound to `0.0.0.0`).
4. Ensure firewall allows inbound TCP **3000** and **8787** on the host.

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

### Companion-ready seam (future desktop)

```ts
interface AudioSource {
  start(): AsyncIterable<AudioChunk>; // PCM16 mono @ 16 kHz
  stop(): Promise<void>;
}
// v1: BrowserMicSource
// later: DesktopSystemAudioSource
//   Windows: WASAPI loopback / Stereo Mix / VB-Cable
//   macOS: BlackHole / ScreenCaptureKit
```

Gateway protocol stays the same: binary PCM frames in → `caption` events out. Video app is irrelevant to STT/MT.

## Platform support

| Layer | Windows | macOS | Linux |
|-------|---------|-------|-------|
| Gateway (Node) | ✅ | ✅ | ✅ |
| Web UI + WebRTC harness | ✅ | ✅ | ✅ |
| Ollama MT | ✅ | ✅ | ✅ |
| Local Whisper STT | ✅ | ✅ | ✅ |
| System-audio companion | 🔜 planned | 🔜 planned | 🔜 planned |

## Environment

| Variable | Default | Notes |
|----------|---------|--------|
| `FONGLISH_QUALITY` | `balanced` | `fast` / `balanced` / `accurate` |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama HTTP API |
| `OLLAMA_MT_MODEL` | from preset | e.g. `llama3:latest` |
| `WHISPER_MODEL` | from preset | e.g. `Xenova/whisper-base` |
| `MT_ON_PARTIAL` | `0` | Set `1` to translate interim STT |
| `MT_GLOSSARY` | — | Comma-separated terms / `src=tgt` |
| `TTS_ENABLED` | `1` | Set `0` to disable spoken interpretation |
| `TTS_ENGINE` | `say` | macOS host TTS (`none` to disable) |
| `TTS_RATE` | `200` | `say -r` speaking rate |
| `TTS_VOICE_EN` / `_ES` / … | system map | Override `say -v` voice per language |
| `GATEWAY_PORT` | `8787` | Interpreter gateway |
| `GATEWAY_HOST` | `0.0.0.0` | Bind all interfaces (LAN-friendly) |
| `NEXT_PUBLIC_GATEWAY_URL` | `ws://127.0.0.1:8787` | Browser WS URL |
| `NEXT_PUBLIC_GATEWAY_PORT` | `8787` | Used if URL not set |

## Protocol (summary)

Client → gateway JSON: `join`, `leave`, `update_langs`, `signal`, `mute`  
Client → gateway binary: raw PCM16 LE mono @ 16 kHz (~100 ms chunks)  
Gateway → client: `welcome`, `peer_joined`, `peer_left`, `signal`, `caption`, `interpret`, `error`, `stats`, `services`

## Privacy note

This MVP runs **STT, translation, and TTS on the host Mac** (Whisper ONNX + Ollama + `say`). Mic PCM is sent only to the local interpreter gateway. A consent note is shown in-call. No server-side transcript store is implemented.

## Out of scope (v1)

- Group calls (3+)
- Spoken dubbing / voice replacement
- Zoom/Meet in-app overlay (companion planned; not built)
- Accounts / auth

## Troubleshooting

| Symptom | Check |
|---------|--------|
| “WebSocket error” | Gateway running? `http://127.0.0.1:8787/health` |
| WS works on Mac, fails on Windows | Use `127.0.0.1` not `localhost` in `NEXT_PUBLIC_GATEWAY_URL` |
| Firewall blocked | Windows: allow Node for ports 8787 & 3000 |
| No spoken translation | Ollama + TTS ready? **Speech**/**Translate**/**Voice** pills green? Complementary **I speak** / **I listen in**? Pause after a full sentence. |
| No subtitles | Turn on **Subtitles** in the room toolbar (off by default). |
| TTS / Voice pill bad | Host must be macOS with `say` + `afconvert`. Check `TTS_VOICE_*` names (`say -v '?'`). |
| MT errors | `OLLAMA_MT_MODEL` matches a pulled model? `ollama run llama3.2:3b` |
| STT pill yellow | Whisper loading — wait for gateway log `STT: ready` |
| onnx / native errors after clone | Delete `node_modules`, run `npm install` **on that machine** (native binaries are OS-specific) |
| No remote video | Allow camera; same Wi‑Fi; browser console ICE errors |
| Room full | v1 is 1:1 — only two peers per room |

## License

Private / experimental.
