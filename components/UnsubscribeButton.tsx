"use client";

import { useState } from "react";

/** One tap to stop. It is a button (a POST), not an automatic action, so link scanners cannot unsubscribe anyone. */
export default function UnsubscribeButton({ code }: { code: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");

  async function stop() {
    setState("busy");
    try {
      const res = await fetch("/api/alerts/unsubscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
      setState(res.ok ? "done" : "error");
    } catch {
      setState("error");
    }
  }

  if (state === "done") {
    return <p className="ok">Done. You will not get any more alerts, and your number has been deleted.</p>;
  }
  return (
    <>
      <button className="btn" onClick={stop} disabled={state === "busy"}>
        {state === "busy" ? "Stopping…" : "Stop all FloodWatch alerts"}
      </button>
      {state === "error" && <p className="notice">That did not work. Please try again, or the link may be old.</p>}
    </>
  );
}
