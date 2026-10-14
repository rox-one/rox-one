# Team calls end-to-end check (real LiveKit)

Two headless participants (Марк, Анна) join one LiveKit room with tokens minted by
`packages/shared/src/team-chat/livekit-token.ts`, publish speech, and a third
`rox-transcriber` participant records each track. `asr.py` transcribes per speaker
with faster-whisper (MIT) and `summary.py` asks the Rox API (R1 Max → DeepSeek V4.1 Flash).

```bash
cd scripts/team-calls-e2e
npm i @livekit/rtc-node && bun build ../../packages/shared/src/team-chat/livekit-token.ts --target=node --format=esm --outfile=lktoken.mjs
python3 -m venv venv && ./venv/bin/pip install faster-whisper edge-tts
./venv/bin/edge-tts --voice ru-RU-DmitryNeural --text "…" --write-media a.mp3 && ffmpeg -i a.mp3 -ar 48000 -ac 1 -f s16le a.pcm   # same for b
ROX_CALLS_ENV_FILE=/path/to/livekit.env node call.mjs
./venv/bin/python asr.py small
ROX_API_KEY=… ./venv/bin/python summary.py
```
Credentials are read from the env file / environment only and are never printed.
