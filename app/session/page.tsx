"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Message = {
  role: "user" | "assistant";
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

const MAX_TTS_CHARS = 600;
const MAX_MANUAL_INPUT = 320;

export default function SessionPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content:
        "Welcome back. When you are ready, press record and talk me through the moments that defined your year. I will ask one focused question at a time."
    }
  ]);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [isSummarising, setIsSummarising] = useState(false);
  const [manualInput, setManualInput] = useState("");
  const [createdAt] = useState(() => new Date().toISOString());

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const audioPlaybackRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, summary]);

  useEffect(() => {
    return () => {
      mediaRecorderRef.current?.stream.getTracks().forEach((t) => t.stop());
      mediaRecorderRef.current?.stop();
    };
  }, []);

  const supportedMimeType = () => {
    if (typeof MediaRecorder === "undefined") return null;
    const candidates = ["audio/webm", "audio/mp4", "audio/ogg"];
    return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || null;
  };

  const startRecording = async () => {
    setError(null);
    setSummary(null);
    if (isProcessing) return;
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
    } else {
      setIsRecording(false);
    }
  };

  const processAudio = async (audioBlob: Blob) => {
    setIsProcessing(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", audioBlob, "voice.webm");
      const res = await fetch("/api/stt", {
        method: "POST",
        body: form
      });
      const data = await res.json();
      if (!res.ok || !data?.text) {
        throw new Error(data?.error || "Could not transcribe audio.");
      }
      appendMessage({ role: "user", content: data.text });
      await sendChat([...messages, { role: "user", content: data.text }]);
    } catch (err: any) {
      setError(err?.message || "Something went wrong while transcribing.");
    } finally {
      setIsProcessing(false);
    }
  };

  const sendChat = async (history: Message[]) => {
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history })
      });
      const data = await res.json();
      if (!res.ok || !data?.assistantText) {
        throw new Error(data?.error || "Assistant was not able to respond.");
      }

      const assistantText: string = data.assistantText;
      appendMessage({ role: "assistant", content: assistantText });
      await speak(assistantText);
    } catch (err: any) {
      setError(err?.message || "Assistant request failed.");
    }
  };

  const speak = async (text: string) => {
    if (!text) return;
    const clipped = text.slice(0, MAX_TTS_CHARS);
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: clipped })
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
      audioPlaybackRef.current.src = url;
      await audioPlaybackRef.current.play();
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Could not play audio.");
    }
  };

  const appendMessage = (msg: Message) => {
    setMessages((prev) => [...prev, msg]);
  };

  const handleManualSend = async () => {
    if (!manualInput.trim()) return;
    const text = manualInput.trim().slice(0, MAX_MANUAL_INPUT);
    setManualInput("");
    setSummary(null);
    appendMessage({ role: "user", content: text });
    await sendChat([...messages, { role: "user", content: text }]);
  };

  const handleFinishSession = async () => {
    if (messages.length < 2) return;
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

  const statusLabel = isRecording
    ? "Recording... tap to stop"
    : isProcessing
      ? "Processing..."
      : "Tap to record";

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
          <button
            className={`record-btn ${isRecording ? "recording" : ""}`}
            onClick={isRecording ? stopRecording : startRecording}
            disabled={isProcessing}
            aria-live="polite"
          >
            {statusLabel}
          </button>

          <div className="card stack">
            <div className="cta-row" style={{ justifyContent: "space-between" }}>
              <h3>Transcript</h3>
              <div className="tag">{messages.length} exchanges</div>
            </div>
            <div className="transcript" style={{ maxHeight: 420, overflowY: "auto" }}>
              {messages.map((msg, idx) => (
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
              <button onClick={handleFinishSession} disabled={isSummarising || messages.length < 2}>
                {isSummarising ? "Summarising..." : "Finish session"}
              </button>
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
