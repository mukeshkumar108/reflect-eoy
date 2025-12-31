import { NextRequest, NextResponse } from "next/server";

import { coachSystemPrompt } from "../../../lib/prompts";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_MESSAGES = 50;
const MAX_CONTENT_LENGTH = 3000;

export const runtime = "nodejs";

type Message = { role: "user" | "assistant" | "system"; content: string };

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL;

  if (!apiKey || !model) {
    return NextResponse.json(
      { ok: false, error: "Chat is not configured. Missing OPENROUTER_API_KEY or OPENROUTER_MODEL." },
      { status: 500 }
    );
  }

  let messages: Message[] = [];

  try {
    const body = await req.json();
    messages = body?.messages || [];
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ ok: false, error: "Messages are required." }, { status: 400 });
  }

  if (messages.length > MAX_MESSAGES) {
    return NextResponse.json({ ok: false, error: "Message history too long." }, { status: 413 });
  }

  const sanitizedMessages = messages.map((m) => ({
    role: m.role,
    content: (m.content || "").slice(0, MAX_CONTENT_LENGTH)
  })) as Message[];

  const payload = {
    model,
    messages: [{ role: "system", content: coachSystemPrompt }, ...sanitizedMessages],
    temperature: 0.6
  };

  try {
    const completion = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    if (!completion.ok) {
      const detail = await safeText(completion);
      return NextResponse.json({ ok: false, error: `Chat failed: ${detail}` }, { status: 502 });
    }

    const data = (await completion.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const assistantText = data?.choices?.[0]?.message?.content;

    if (!assistantText) {
      return NextResponse.json({ ok: false, error: "Assistant did not return text." }, { status: 502 });
    }

    return NextResponse.json({ assistantText });
  } catch (err) {
    console.error("Chat error", err);
    return NextResponse.json({ ok: false, error: "Unexpected error while chatting." }, { status: 500 });
  }
}

async function safeText(res: Response) {
  try {
    return await res.text();
  } catch {
    return res.statusText || "no details";
  }
}
