"use client";

import { useEffect } from "react";

/** Last-resort boundary for errors in the root layout itself (replaces the whole document). */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100svh", margin: 0 }}>
        <main role="alert" style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 18, marginBottom: 8 }}>SplitLens hit a snag</h1>
          <p style={{ color: "#666", fontSize: 14 }}>
            Something went wrong loading the app. Your data is safe.
            {error.digest && <span style={{ display: "block", fontFamily: "monospace", fontSize: 12, marginTop: 8 }}>Ref: {error.digest}</span>}
          </p>
          <button
            type="button"
            onClick={reset}
            style={{ marginTop: 16, padding: "8px 16px", borderRadius: 8, border: "1px solid #ccc", background: "#111", color: "#fff", cursor: "pointer" }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
