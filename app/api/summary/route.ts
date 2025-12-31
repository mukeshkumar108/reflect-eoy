import { NextRequest, NextResponse } from "next/server";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_MESSAGES = 70;
const MAX_CONTENT_LENGTH = 4000;

export const runtime = "nodejs";

type Message = { role: "user" | "assistant" | "system"; content: string };

const summaryPrompt = `You are an expert facilitator creating a crisp one-page Year Review action sheet.
Given a conversation transcript between a user and a coach, produce JSON only with this shape:
{
  year_sentence: string,
  wins: string[],
  drains: string[],
  theme: string,
  top_lessons: string[],
  commitments: [{title: string, why: string, first_step: string, cadence: string}],
  stop_doing: string[],
  if_then_rules: string[],
  people_to_invest_in: string[],
  closing_note: string
}
Rules: keep it concise; avoid duplication; commitments must be action-ready with cadence; do not include nulls; return valid JSON with all keys present and arrays (can be empty). No extra commentary or markdown.`;

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL;

  if (!apiKey || !model) {
    return NextResponse.json(
      { ok: false, error: "Summary is not configured. Missing OPENROUTER_API_KEY or OPENROUTER_MODEL." },
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

  const transcript = messages
    .map((m) => `${m.role.toUpperCase()}: ${(m.content || "").slice(0, MAX_CONTENT_LENGTH)}`)
    .join("\n");

  const payload = {
    model,
    messages: [
      { role: "system", content: summaryPrompt },
      { role: "user", content: `Transcript:\n${transcript}` }
    ],
    temperature: 0.5
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
      return NextResponse.json({ ok: false, error: `Summary failed: ${detail}` }, { status: 502 });
    }

    const data = await completion.json();
    const content: string | undefined = data?.choices?.[0]?.message?.content;
    if (!content) {
      return NextResponse.json({ ok: false, error: "No summary content returned." }, { status: 502 });
    }

    const parsed = parseJSONContent(content);
    if (!parsed) {
      return NextResponse.json({ ok: false, error: "Could not parse summary JSON." }, { status: 502 });
    }

    return NextResponse.json(parsed);
  } catch (err) {
    console.error("Summary error", err);
    return NextResponse.json({ ok: false, error: "Unexpected error while summarising." }, { status: 500 });
  }
}

function parseJSONContent(content: string) {
  const cleaned = content.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

async function safeText(res: Response) {
  try {
    return await res.text();
  } catch {
    return res.statusText || "no details";
  }
}
