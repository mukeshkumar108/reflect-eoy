# Year Review Coach

Voice-first annual review coach built on Next.js 14 (App Router). Record, transcribe, chat, hear the assistant, and end with a concise one-page action sheet. No database; everything stays in the browser until you download it.

## Quickstart

```bash
npm install
cp .env.example .env.local   # fill the values below
npm run dev                  # http://localhost:3000
```

Required environment variables (`.env.local`):
- `LEMONFOX_API_KEY` / `LEMONFOX_STT_URL` for Whisper STT
- `OPENROUTER_API_KEY` / `OPENROUTER_MODEL` for chat + summary
- `ELEVENLABS_API_KEY` / `ELEVENLABS_VOICE_ID` for TTS

## Usage

- `/` has a simple start link.
- `/session` is mobile-first with a large record toggle. Speech is transcribed via `/api/stt`, sent to `/api/chat`, and the assistant reply is played via `/api/tts`.
- Tap **Finish session** to call `/api/summary` and render the action sheet. Tap **Download session** to save `{messages, summary, createdAt}` as JSON.
- Manual input is available if you prefer typing.

## Notes on reliability

- Client-only state; nothing is persisted server-side.
- Audio upload capped at ~6MB; TTS input capped for safety.
- Designed to work in iPhone Safari/Chrome using `MediaRecorder` with best-available mime type fallback.
- API errors return `{ok:false,error}` to keep the UI calm rather than crashing.
