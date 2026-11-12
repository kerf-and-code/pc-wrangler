"use client";

// components/analytics-choice-button.tsx (2026-11-12, push 43, audit round 2 T20)
// On the Privacy page: clears this browser's analytics answer and asks again (components/analytics.tsx
// listens for the event). Analytics only runs in production, so elsewhere the bar does not appear.
export default function AnalyticsChoiceButton() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event("sx-analytics-ask"))}
      style={{ background: "none", border: "none", padding: 0, color: "inherit", textDecoration: "underline", cursor: "pointer", font: "inherit" }}
    >
      change your analytics choice
    </button>
  );
}
