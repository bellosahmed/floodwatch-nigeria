"use client";

import { useEffect, useState } from "react";
import Turnstile, { TURNSTILE_SITE_KEY } from "@/components/Turnstile";
import { LOCATIONS } from "@/lib/locations";

const SEVERITY_OPTIONS = [
  { value: 1, title: "Minor", hint: "Water on the road or compound, about ankle deep" },
  { value: 2, title: "Dangerous", hint: "Knee to waist deep, hard to walk or drive through" },
  { value: 3, title: "Severe", hint: "Above the waist, homes flooded, or people trapped" },
] as const;

// Anonymous per-browser id so one person cannot count as many. Only a hash is stored server-side.
function getDeviceId(): string {
  try {
    let id = localStorage.getItem("fw-device");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("fw-device", id);
    }
    return id;
  } catch {
    return crypto.randomUUID(); // storage blocked: still lets the person report, just not deduplicated
  }
}

type Notice = { ok: boolean; text: string };
type LgaOption = { slug: string; name: string };

export default function ReportForm() {
  const [state, setState] = useState("");
  const [lga, setLga] = useState("");
  const [lgaOptions, setLgaOptions] = useState<LgaOption[]>([]);
  const [area, setArea] = useState("");
  const [severity, setSeverity] = useState<number>(2);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [token, setToken] = useState("");
  const [resetSignal, setResetSignal] = useState(0);

  // Load the chosen state's local governments. (The dropdown handler clears the old list, so this only fetches.)
  // The cancelled flag stops a slow earlier answer overwriting a newer one.
  useEffect(() => {
    if (!state) return;
    let cancelled = false;
    fetch(`/api/lgas?state=${encodeURIComponent(state)}`)
      .then((r) => (r.ok ? r.json() : { lgas: [] }))
      .then((data: { lgas: LgaOption[] }) => {
        if (!cancelled) setLgaOptions(data.lgas);
      })
      .catch(() => undefined); // the LGA is optional, so a failed lookup is not an error
    return () => {
      cancelled = true;
    };
  }, [state]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state, lga: lga || undefined, area, severity, note, deviceId: getDeviceId(), turnstileToken: token || undefined }),
      });
      const data: { error?: string } = await res.json().catch(() => ({}));
      if (res.ok) {
        setNotice({ ok: true, text: "Thank you. Your report is now counted. Share this page so neighbours can add theirs." });
        setArea("");
        setNote("");
      } else {
        setNotice({ ok: false, text: data.error ?? "Something went wrong. Please try again." });
      }
    } catch {
      setNotice({ ok: false, text: "No connection. Please try again." });
    } finally {
      setBusy(false);
      setResetSignal((n) => n + 1); // tokens are single-use: ask for a fresh check
    }
  }

  return (
    <form onSubmit={submit}>
      <label htmlFor="state">State</label>
      <select id="state" className="field" required value={state} onChange={(e) => {
          setState(e.target.value);
          setLga("");
          setLgaOptions([]);
        }}
      >
        <option value="">Choose your state</option>
        {LOCATIONS.map((l) => (
          <option key={l.slug} value={l.slug}>
            {l.name}
          </option>
        ))}
      </select>

      <label htmlFor="lga">Local government (optional)</label>
      <select id="lga" className="field" value={lga} onChange={(e) => setLga(e.target.value)} disabled={!lgaOptions.length}>
        <option value="">{state ? "Not sure / skip" : "Choose a state first"}</option>
        {lgaOptions.map((l) => (
          <option key={l.slug} value={l.slug}>
            {l.name}
          </option>
        ))}
      </select>

      <label htmlFor="area">Where exactly? (community, street or landmark)</label>
      <input
        id="area"
        className="field"
        required
        minLength={2}
        maxLength={80}
        value={area}
        onChange={(e) => setArea(e.target.value)}
      />

      <fieldset>
        <legend>How bad is it?</legend>
        {SEVERITY_OPTIONS.map((s) => (
          <label className="choice" key={s.value}>
            <input type="radio" name="severity" checked={severity === s.value} onChange={() => setSeverity(s.value)} />
            <span>
              <b>{s.title}</b>
              <br />
              <small>{s.hint}</small>
            </span>
          </label>
        ))}
      </fieldset>

      <label htmlFor="note">Anything else? (optional)</label>
      <textarea
        id="note"
        className="field"
        rows={3}
        maxLength={200}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />

      <Turnstile onToken={setToken} resetSignal={resetSignal} />

      <button className="btn" type="submit" disabled={busy || !state || (Boolean(TURNSTILE_SITE_KEY) && !token)}>
        {busy ? "Sending…" : "Send report"}
      </button>

      <div aria-live="polite">{notice && <p className={notice.ok ? "ok" : "notice"}>{notice.text}</p>}</div>
    </form>
  );
}
