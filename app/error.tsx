"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <>
      <h1>Something went wrong</h1>
      <p className="notice">
        We could not load flood information just now. For official alerts check NiHSA or NEMA, or call 112 in an
        emergency.
      </p>
      <button className="btn" onClick={reset}>
        Try again
      </button>
    </>
  );
}
