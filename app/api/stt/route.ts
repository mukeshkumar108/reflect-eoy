import { NextRequest, NextResponse } from "next/server";

const MAX_AUDIO_SIZE = 6 * 1024 * 1024; // ~6MB

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const apiKey = process.env.LEMONFOX_API_KEY;
  const sttUrl = process.env.LEMONFOX_STT_URL;

  if (!apiKey || !sttUrl) {
    return NextResponse.json(
      { ok: false, error: "STT is not configured. Missing LEMONFOX_API_KEY or LEMONFOX_STT_URL." },
      { status: 500 }
    );
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ ok: false, error: "No audio file provided." }, { status: 400 });
    }

    if (file.size > MAX_AUDIO_SIZE) {
      return NextResponse.json({ ok: false, error: "Audio is too large (max 6MB)." }, { status: 413 });
    }

    const upstreamForm = new FormData();
    upstreamForm.append("file", file, "audio.webm");

    const sttRes = await fetch(sttUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      body: upstreamForm
    });

    if (!sttRes.ok) {
      const errorText = await safeText(sttRes);
      return NextResponse.json({ ok: false, error: `STT failed: ${errorText}` }, { status: 502 });
    }

    const data = (await sttRes.json()) as { text?: string; error?: string };
    if (!data.text) {
      return NextResponse.json({ ok: false, error: data.error || "Transcription unavailable." }, { status: 502 });
    }

    return NextResponse.json({ text: data.text });
  } catch (err) {
    console.error("STT error", err);
    return NextResponse.json({ ok: false, error: "Unexpected error during transcription." }, { status: 500 });
  }
}

async function safeText(res: Response) {
  try {
    return await res.text();
  } catch {
    return res.statusText || "no details";
  }
}
