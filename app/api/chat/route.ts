import { NextRequest, NextResponse } from "next/server";

import { coachSystemPrompt } from "../../../lib/prompts";
import { OPENROUTER_CHAT_PARAMS } from "../../../lib/runtimeSettings";

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
  let language = "en";
  let stepContext = "";
  let stepIndex: number | undefined;

  try {
    const body = await req.json();
    messages = body?.messages || [];
    language = body?.language === "es" ? "es" : "en";
    stepContext = typeof body?.stepContext === "string" ? body.stepContext : "";
    stepIndex = typeof body?.stepIndex === "number" ? body.stepIndex : undefined;
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

  const depthCapNote =
    stepContext && sanitizedMessages.length > 4
      ? "Depth cap triggered: wrap this category and transition to the next one."
      : "";

  const assistantTurns = sanitizedMessages.filter((m) => m.role === "assistant").length;
  const turnCapNote =
    assistantTurns >= 1
      ? "Per-step turn cap reached: do NOT ask a follow-up here. Ask the NEXT step question now."
      : "";

  const bannedPatterns =
    "BANNED QUESTION PATTERNS: 'where were you', 'what happened first', 'pick one', 'stung', 'how did that make you feel', 'what did that give you', 'tell me about a specific moment', 'one intense argument'. Do not ask for income/work details unless this step explicitly requires it.";

  const shapeByStep =
    stepIndex === 0
      ? "ALLOWED SHAPE: headline + one surprise, broad. DISALLOWED: scene mining."
      : stepIndex === 1
        ? "ALLOWED SHAPE: 1–2 wins max, broad classification. DISALLOWED: scene mining or deep follow-ups."
        : stepIndex === 2
          ? "ALLOWED SHAPE: 1–2 drains using classification buckets. DISALLOWED: story-level probing."
          : stepIndex === 3 || stepIndex === 4
            ? "ALLOWED SHAPE: one cause or one lesson only. DISALLOWED: stories or multiple probes."
            : stepIndex === 5 || stepIndex === 6 || stepIndex === 7 || stepIndex === 8 || stepIndex === 9 || stepIndex === 10 || stepIndex === 11
              ? "ALLOWED SHAPE: broad, actionable question for this category (systems, time, people, unfinished, alignment, memories, plan/finale). DISALLOWED: scene mining or multiple examples."
              : "Keep it broad and move forward.";

  const payload = {
    model,
    messages: [
      {
        role: "system",
        content: `${coachSystemPrompt}\nRespond in language: ${language}.\nCurrent step intent: ${
          stepContext || "continue naturally"
        }\nState marker: you are on step ${stepIndex ?? "unknown"} of 12. Primary goal is completion: ask the next single question and move to the next category once answered.\n${depthCapNote}\n${turnCapNote}\n${bannedPatterns}\n${shapeByStep}`
      },
      ...sanitizedMessages
    ],
    temperature: OPENROUTER_CHAT_PARAMS.temperature,
    top_p: OPENROUTER_CHAT_PARAMS.top_p,
    max_tokens: OPENROUTER_CHAT_PARAMS.max_tokens,
    presence_penalty: OPENROUTER_CHAT_PARAMS.presence_penalty,
    frequency_penalty: OPENROUTER_CHAT_PARAMS.frequency_penalty
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
