"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Message = {
  role: "user" | "assistant" | "system";
  content: string;
};

type Summary = {
  year_sentence: string;
  wins: string[];
  drains: string[];
  theme: string;
  top_lessons: string[];
  commitments: { title: string; why: string; first_step: string; cadence: string }[];
  stop_doing: string[];
  if_then_rules: string[];
  people_to_invest_in: string[];
  closing_note: string;
};

type Phase = "idle" | "active" | "paused" | "finished";

const MAX_TTS_CHARS = 600;
const MAX_MANUAL_INPUT = 320;
const ESCAPE_PHRASES = ["end session", "stop everything", "cancel", "just stop", "shut up"];
const FILLER_WORDS = ["uh", "um", "hey", "hmm", "huh", "yo", "hi", "hello"];

export default function SessionPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [questionStep, setQuestionStep] = useState(0);
  const [hasBegun, setHasBegun] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [isSummarising, setIsSummarising] = useState(false);
  const [manualInput, setManualInput] = useState("");
  const [createdAt, setCreatedAt] = useState(() => new Date().toISOString());

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const audioPlaybackRef = useRef<HTMLAudioElement | null>(null);
  const sttAbortRef = useRef<AbortController | null>(null);
  const chatAbortRef = useRef<AbortController | null>(null);
  const ttsAbortRef = useRef<AbortController | null>(null);
  const terminatedRef = useRef(false);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, summary]);

  useEffect(() => {
    return () => {
      hardEndSession();
    };
  }, []);

  const supportedMimeType = () => {
    if (typeof MediaRecorder === "undefined") return null;
    const candidates = ["audio/webm", "audio/mp4", "audio/ogg"];
    return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || null;
  };

  const startSessionOrResume = async () => {
    if (phase === "finished") return;
    setError(null);
    setSummary(null);
    terminatedRef.current = false;
    if (phase === "idle") {
      setCreatedAt(new Date().toISOString());
      setMessages([]);
      setQuestionStep(0);
      setPhase("active");
      const intro =
        "This is a short, guided end-of-year reflection.\nI’ll ask you a few thoughtful questions, one at a time.\nYou can answer briefly — there are no right answers.\nAt the end, you’ll get a simple one-page summary you can keep.\nWhen you’re ready, tap record and say: I’m ready.";
      await deliverAssistant(intro, { autoListen: false });
      return;
    }

    if (phase === "paused") {
      setPhase("active");
      return;
    }
  };

  const pauseSession = () => {
    if (phase !== "active") return;
    setPhase("paused");
    stopRecording();
  };

  const endAndSummarise = async () => {
    stopRecording();
    audioPlaybackRef.current?.pause();
    setPhase("finished");
    await handleFinishSession();
  };

  const hardEndSession = () => {
    terminatedRef.current = true;
    stopRecording();
    audioPlaybackRef.current?.pause();
    sttAbortRef.current?.abort();
    chatAbortRef.current?.abort();
    ttsAbortRef.current?.abort();
    sttAbortRef.current = null;
    chatAbortRef.current = null;
    ttsAbortRef.current = null;
    setIsProcessing(false);
    setIsSpeaking(false);
    setIsRecording(false);
    setMessages([]);
    setSummary(null);
    setError(null);
    setIsSummarising(false);
    setManualInput("");
    setQuestionStep(0);
    setPhase("idle");
  };

  const startRecording = async () => {
    if (terminatedRef.current) return;
    if (isRecording || isSpeaking || isProcessing || phase !== "active") return;
    if (typeof window === "undefined" || typeof navigator === "undefined") return;
    if (typeof MediaRecorder === "undefined") {
      setError("Recording is not supported in this browser. Please try mobile Safari/Chrome.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = supportedMimeType();
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: mimeType || "audio/webm" });
        stream.getTracks().forEach((t) => t.stop());
        setIsRecording(false);
        await processAudio(blob);
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    } catch (err) {
      console.error(err);
      setError("Microphone access was blocked. Enable it and try again.");
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
    setIsRecording(false);
  };

  const processAudio = async (audioBlob: Blob) => {
    if (terminatedRef.current || phase !== "active") return;
    setIsProcessing(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", audioBlob, "voice.webm");
      sttAbortRef.current?.abort();
      const controller = new AbortController();
      sttAbortRef.current = controller;
      const res = await fetch("/api/stt", {
        method: "POST",
        body: form,
        signal: controller.signal
      });
      const data = await res.json();
      if (!res.ok || !data?.text) {
        throw new Error(data?.error || "Could not transcribe audio.");
      }
      await handleUserTurn(data.text);
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      setError(err?.message || "Something went wrong while transcribing.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUserTurn = async (text: string) => {
    if (terminatedRef.current || phase !== "active") return;
    const trimmed = text.trim();
    if (!trimmed) {
      await deliverAssistant("I didn't catch much there. Share one quick moment from this year that stands out.", {
        autoListen: false
      });
      return;
    }
    if (containsEscapePhrase(trimmed)) {
      hardEndSession();
      return;
    }
    appendMessage({ role: "user", content: trimmed });
    if (!hasBegun) setHasBegun(true);
    setSummary(null);

    if (questionStep === 0) {
      setQuestionStep(1);
      await deliverAssistant(
        "Let’s ease in. Thinking back over the year, did it turn out roughly how you expected — or did it surprise you?",
        { autoListen: false }
      );
      return;
    }

    if (questionStep === 1) {
      setQuestionStep(2);
      await deliverAssistant("Looking back now, what’s one thing that genuinely went well this year?", { autoListen: false });
      return;
    }

    if (questionStep === 2) {
      setQuestionStep(3);
      await deliverAssistant(
        "And what’s one thing that didn’t go the way you hoped — or took more out of you than expected?",
        { autoListen: false }
      );
      return;
    }

    await sendChat([...messages, { role: "user", content: trimmed }]);
  };

  const sendChat = async (history: Message[]) => {
    if (terminatedRef.current) return;
    try {
      chatAbortRef.current?.abort();
      const controller = new AbortController();
      chatAbortRef.current = controller;
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
        signal: controller.signal
      });
      const data = await res.json();
      if (!res.ok || !data?.assistantText) {
        throw new Error(data?.error || "Assistant was not able to respond.");
      }

      const assistantText: string = data.assistantText;
      await deliverAssistant(assistantText, { autoListen: true });
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      setError(err?.message || "Assistant request failed.");
    }
  };

  const deliverAssistant = async (text: string, opts: { autoListen?: boolean } = {}) => {
    if (terminatedRef.current) return;
    appendMessage({ role: "assistant", content: text });
    await speak(text);
    // no auto-recording in turn-based mode
  };

  const speak = async (text: string) => {
    if (!text) return;
    const clipped = text.slice(0, MAX_TTS_CHARS);
    try {
      setIsSpeaking(true);
      ttsAbortRef.current?.abort();
      const controller = new AbortController();
      ttsAbortRef.current = controller;
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: clipped }),
        signal: controller.signal
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Text-to-speech failed.");
      }
      const arrayBuffer = await res.arrayBuffer();
      const audioBlob = new Blob([arrayBuffer], { type: "audio/mpeg" });
      const url = URL.createObjectURL(audioBlob);

      if (!audioPlaybackRef.current) {
        audioPlaybackRef.current = new Audio();
      }
      audioPlaybackRef.current.pause();
      audioPlaybackRef.current.src = url;
      await audioPlaybackRef.current.play();
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      console.error(err);
      setError(err?.message || "Could not play audio.");
    } finally {
      setIsSpeaking(false);
    }
  };

  const appendMessage = (msg: Message) => {
    setMessages((prev) => [...prev, msg]);
  };

  const handleManualSend = async () => {
    if (!manualInput.trim()) return;
    const text = manualInput.trim().slice(0, MAX_MANUAL_INPUT);
    setManualInput("");
    await handleUserTurn(text);
  };

  const handleFinishSession = async () => {
    if (messages.filter((m) => m.role !== "system").length < 2) return;
    setIsSummarising(true);
    setError(null);
    try {
      const res = await fetch("/api/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages })
      });
      const data = await res.json();
      if (!res.ok || !data) {
        throw new Error(data?.error || "Could not generate summary.");
      }
      setSummary(data as Summary);
    } catch (err: any) {
      setError(err?.message || "Summary generation failed.");
    } finally {
      setIsSummarising(false);
    }
  };

  const handleDownload = () => {
    const payload = {
      messages,
      summary,
      createdAt
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `year-review-${new Date().toISOString()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const displayMessages = messages.filter((m) => m.role !== "system");
  const statusLabel = isRecording
    ? "Recording... tap stop"
    : isSpeaking
      ? "Coach speaking..."
      : isProcessing
        ? "Thinking..."
        : phase === "paused"
          ? "Paused"
          : phase === "finished"
            ? "Session finished"
            : phase === "idle"
              ? "Start intro"
              : "Tap to speak";

  return (
    <main className="stack" style={{ gap: 18 }}>
      <div className="cta-row" style={{ justifyContent: "space-between" }}>
        <div className="pill">Year Review Coach</div>
        <Link href="/" className="footnote">
          Home
        </Link>
      </div>

      <div className="grid-two">
        <div className="stack" style={{ gap: 12 }}>
          <div className="cta-row" style={{ gap: 8, alignItems: "center" }}>
            <button
              className={`record-btn ${isRecording ? "recording" : ""}`}
              onClick={() => (isRecording ? stopRecording() : phase === "idle" ? startSessionOrResume() : startRecording())}
              disabled={isSpeaking || isProcessing || phase === "finished" || phase === "paused"}
              aria-live="polite"
            >
              {statusLabel}
            </button>
            {isRecording && (
              <button onClick={() => stopRecording()} disabled={isProcessing} style={{ minWidth: 120 }}>
                Stop
              </button>
            )}
          </div>
          {!hasBegun && phase === "active" && !isRecording && !isSpeaking && !isProcessing && (
            <div className="footnote" style={{ marginTop: -4 }}>
              To begin, say: “I’m ready”.
            </div>
          )}

          <div className="card stack">
            <div className="cta-row" style={{ justifyContent: "space-between" }}>
              <h3>Transcript</h3>
              <div className="tag">{displayMessages.length} exchanges</div>
            </div>
            <div className="transcript" style={{ maxHeight: 420, overflowY: "auto" }}>
              {displayMessages.map((msg, idx) => (
                <div key={idx} className={`bubble ${msg.role}`}>
                  <div className="message-meta">{msg.role === "user" ? "You" : "Coach"}</div>
                  <div>{msg.content}</div>
                </div>
              ))}
              <div ref={transcriptEndRef} />
            </div>
            <div className="input-inline">
              <input
                placeholder="Type if you prefer..."
                maxLength={MAX_MANUAL_INPUT}
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleManualSend();
                  }
                }}
              />
              <button onClick={handleManualSend} disabled={isProcessing || !manualInput.trim()}>
                Send
              </button>
            </div>
            {error && <div className="footnote" style={{ color: "var(--danger)" }}>{error}</div>}
          </div>
        </div>

        <div className="stack">
          <div className="card stack" style={{ gap: 10 }}>
            <h3>Session controls</h3>
            <div className="cta-row">
              <button onClick={pauseSession} disabled={phase === "paused" || phase === "finished" || phase === "idle"}>
                Pause
              </button>
              <button onClick={startSessionOrResume} disabled={phase === "finished"}>
                {phase === "paused" ? "Resume" : phase === "idle" ? "Start" : "Resume"}
              </button>
              <button onClick={endAndSummarise} disabled={isSummarising || phase === "idle"}>
                {isSummarising ? "Summarising..." : "End & summarise"}
              </button>
              <button onClick={hardEndSession}>End session</button>
              <button onClick={handleDownload}>Download session</button>
            </div>
            <p className="footnote">
              Audio is processed live; nothing is stored on our servers beyond the current request.
              Download the JSON if you want to keep a copy.
            </p>
          </div>

          <div className="card stack" style={{ gap: 10 }}>
            <h3>Action sheet</h3>
            {!summary && (
              <p className="footnote">
                Finish your session to generate a one-page plan with lessons, commitments, and a closing note.
              </p>
            )}
            {summary && (
              <div className="stack" style={{ gap: 12 }}>
                {summary.year_sentence && (
                  <div className="summary-block">
                    <h4>Year in one line</h4>
                    <div style={{ color: "var(--muted)" }}>{summary.year_sentence}</div>
                  </div>
                )}
                <div className="summary-grid">
                  <ListBlock title="Wins" items={summary.wins} />
                  <ListBlock title="Drains" items={summary.drains} />
                  <ListBlock title="Stop doing" items={summary.stop_doing} />
                  <ListBlock title="If/Then rules" items={summary.if_then_rules} />
                  <ListBlock title="People to invest in" items={summary.people_to_invest_in} />
                </div>
                {summary.theme && (
                  <div className="summary-block">
                    <h4>Theme</h4>
                    <div style={{ color: "var(--muted)" }}>{summary.theme}</div>
                  </div>
                )}
                <ListBlock title="Top lessons" items={summary.top_lessons} />
                <CommitmentList commitments={summary.commitments} />
                {summary.closing_note && (
                  <div className="summary-block">
                    <h4>Closing note</h4>
                    <div style={{ color: "var(--muted)" }}>{summary.closing_note}</div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function ListBlock({ title, items }: { title: string; items: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="summary-block">
      <h4>{title}</h4>
      <ul>
        {items.map((item, idx) => (
          <li key={idx}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function CommitmentList({ commitments }: { commitments: Summary["commitments"] }) {
  if (!commitments || commitments.length === 0) return null;
  return (
    <div className="stack" style={{ gap: 10 }}>
      {commitments.map((commit, idx) => (
        <div className="summary-block" key={idx}>
          <h4>{commit.title}</h4>
          <div className="footnote">Why: {commit.why}</div>
          <div className="footnote">First step: {commit.first_step}</div>
          <div className="footnote">Cadence: {commit.cadence}</div>
        </div>
      ))}
    </div>
  );
}

function containsEscapePhrase(text: string) {
  const lower = text.toLowerCase();
  return ESCAPE_PHRASES.some((phrase) => lower.includes(phrase));
}

function isLikelyFiller(text: string) {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  if (words.length <= 3 && words.every((w) => FILLER_WORDS.includes(w))) return true;
  return false;
}
