import { NextRequest, NextResponse } from "next/server";
import { ELEVENLABS_VOICE_SETTINGS } from "../../../lib/runtimeSettings";

const MAX_TTS_TEXT = 800;

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;

  if (!apiKey || !voiceId) {
    return NextResponse.json(
      { ok: false, error: "TTS is not configured. Missing ELEVENLABS_API_KEY or ELEVENLABS_VOICE_ID." },
      { status: 500 }
    );
  }

  let text = "";

  try {
    const body = await req.json();
    text = (body?.text || "").toString();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  if (!text.trim()) {
    return NextResponse.json({ ok: false, error: "Text is required." }, { status: 400 });
  }

  const cleaned = stripFormatting(text);
  const clippedText = cleaned.slice(0, MAX_TTS_TEXT);
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;

  try {
    const ttsRes = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg"
      },
      body: JSON.stringify({
        text: clippedText,
        model_id: "eleven_turbo_v2",
        voice_settings: ELEVENLABS_VOICE_SETTINGS
      })
    });

    if (!ttsRes.ok) {
      const detail = await safeText(ttsRes);
      return NextResponse.json({ ok: false, error: `TTS failed: ${detail}` }, { status: 502 });
    }

    const buffer = await ttsRes.arrayBuffer();
    return new NextResponse(Buffer.from(buffer), {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store"
      }
    });
  } catch (err) {
    console.error("TTS error", err);
    return NextResponse.json({ ok: false, error: "Unexpected error during TTS." }, { status: 500 });
  }
}

async function safeText(res: Response) {
  try {
    return await res.text();
  } catch {
    return res.statusText || "no details";
  }
}

function stripFormatting(input: string) {
  let output = input.replace(/[*_`>#]/g, "");
  output = output.replace(/-{2,}/g, "-");
  output = output.replace(/\.{3,}/g, ".");
  output = output.replace(/^\s*[-+]\s+/gm, "");
  output = output.replace(/^\s*\d+\.\s+/gm, "");
  return output.trim();
}
