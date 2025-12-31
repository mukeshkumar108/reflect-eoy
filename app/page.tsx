"use client";

import Link from "next/link";

export default function HomePage() {
  return (
    <main className="stack" style={{ gap: 24 }}>
      <div className="pill">Year Review Coach</div>
      <div className="card stack" style={{ gap: 10 }}>
        <h1 style={{ fontSize: 28, lineHeight: 1.2 }}>
          Finish your year reflection in one guided voice session.
        </h1>
        <p style={{ color: "var(--muted)", maxWidth: 560 }}>
          Tap record, talk it out, and receive concise follow-ups plus a clear action sheet.
          No accounts, no databases — your session stays on this device until you download it.
        </p>
        <div className="cta-row">
          <Link href="/session">
            <button className="record-btn" style={{ width: 220, height: 64, fontSize: 18 }}>
              Start a session
            </button>
          </Link>
          <span className="footnote">Mobile-first · Works in Safari/Chrome</span>
        </div>
      </div>
    </main>
  );
}
