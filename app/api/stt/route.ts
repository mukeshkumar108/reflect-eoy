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
    const language = (formData.get("language") as string) || "en";

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ ok: false, error: "No audio file provided." }, { status: 400 });
    }

    if (file.size > MAX_AUDIO_SIZE) {
      return NextResponse.json({ ok: false, error: "Audio is too large (max 6MB)." }, { status: 413 });
    }

    const upstreamForm = new FormData();
    upstreamForm.append("file", file, "audio.webm");
    upstreamForm.append("language", language === "es" ? "es" : "en");
    upstreamForm.append("task", "transcribe");

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

    if (isLikelyArabic(data.text)) {
      // Optional retry could go here; keeping single attempt for simplicity.
      return NextResponse.json(
        { ok: false, error: "I couldn’t transcribe that clearly — please try again." },
        { status: 400 }
      );
    }

    if (data.text.trim().length < 3) {
      return NextResponse.json(
        { ok: false, error: "I couldn’t hear enough. Please try again." },
        { status: 400 }
      );
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

function isLikelyArabic(text: string) {
  const arabicChars = text.match(/[\u0600-\u06FF]/g) || [];
  const totalChars = text.replace(/\s/g, "").length || 1;
  const ratio = arabicChars.length / totalChars;
  return ratio > 0.5;
}
