"use client";

import { useEffect, useState } from "react";
import Turnstile, { TURNSTILE_SITE_KEY } from "@/components/Turnstile";
import { LOCATIONS } from "@/lib/locations";

type LgaOption = { slug: string; name: string };
type Notice = { ok: boolean; text: string } | null;

async function post(path: string, body: object): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data: { error?: string } = await res.json().catch(() => ({}));
    return res.ok ? { ok: true } : { ok: false, error: data.error ?? "Something went wrong. Please try again." };
  } catch {
    return { ok: false, error: "No connection. Please try again." };
  }
}

/** Two steps: ask for the number, then prove it belongs to you with the 6-digit code we send. */
export default function AlertsForm() {
  const [step, setStep] = useState<"details" | "code" | "done">("details");
  const [channel, setChannel] = useState<"sms" | "whatsapp">("sms");
  const [phone, setPhone] = useState("");
  const [state, setState] = useState("");
  const [lga, setLga] = useState("");
  const [lgaOptions, setLgaOptions] = useState<LgaOption[]>([]);
  const [hazard, setHazard] = useState<"flood" | "heat" | "both">("flood");
  const [minLevel, setMinLevel] = useState<2 | 3>(2);
  const [consent, setConsent] = useState(false);
  const [code, setCode] = useState("");
  const [token, setToken] = useState("");
  const [resetSignal, setResetSignal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  // Load the chosen state's local governments (the dropdown handler clears the old list).
  useEffect(() => {
    if (!state) return;
    let cancelled = false;
    fetch(`/api/lgas?state=${encodeURIComponent(state)}`)
      .then((r) => (r.ok ? r.json() : { lgas: [] }))
      .then((d: { lgas: LgaOption[] }) => !cancelled && setLgaOptions(d.lgas))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [state]);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    const r = await post("/api/alerts/subscribe", { phone, channel, state, lga: lga || undefined, hazard, minLevel, consent, turnstileToken: token || undefined });
    setBusy(false);
    setResetSignal((n) => n + 1);
    if (r.ok) {
      setStep("code");
      setCode("");
    } else setNotice({ ok: false, text: r.error! });
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    const r = await post("/api/alerts/confirm", { phone, channel, code });
    setBusy(false);
    if (r.ok) setStep("done");
    else setNotice({ ok: false, text: r.error! });
  }

  const message = notice && (
    <div aria-live="polite">
      <p className={notice.ok ? "ok" : "notice"}>{notice.text}</p>
    </div>
  );

  if (step === "done") {
    return (
      <div className="card">
        <h2 style={{ marginTop: 0 }}>You are signed up</h2>
        <p>
          You will get a message only when {hazard === "both" ? "flood or heat" : hazard} reaches{" "}
          <b>{minLevel === 3 ? "Severe" : "High"}</b> for your area. Every message has a link to stop.
        </p>
        <p className="legend">These are unofficial warnings and can be wrong. Always follow NEMA and your State Emergency Management Agency.</p>
      </div>
    );
  }

  if (step === "code") {
    return (
      <form onSubmit={confirm}>
        <p className="notice">
          We sent a 6-digit code by {channel === "sms" ? "SMS" : "WhatsApp"} to the number ending <b>{phone.replace(/\D/g, "").slice(-4)}</b>. It lasts 10 minutes.
        </p>
        <label htmlFor="code">Code</label>
        <input id="code" className="field" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={7} required value={code} onChange={(e) => setCode(e.target.value)} />
        <button className="btn" type="submit" disabled={busy || code.replace(/\s/g, "").length !== 6}>
          {busy ? "Checking…" : "Confirm"}
        </button>{" "}
        <button type="button" className="btn alt" onClick={() => { setStep("details"); setNotice(null); }}>
          Start again
        </button>
        {message}
      </form>
    );
  }

  return (
    <form onSubmit={sendCode}>
      <fieldset>
        <legend>Where should we send it?</legend>
        {(["sms", "whatsapp"] as const).map((c) => (
          <label className="choice" key={c}>
            <input type="radio" name="channel" checked={channel === c} onChange={() => setChannel(c)} />
            <span><b>{c === "sms" ? "SMS" : "WhatsApp"}</b></span>
          </label>
        ))}
      </fieldset>

      <label htmlFor="phone">Your mobile number</label>
      <input id="phone" className="field" type="tel" inputMode="tel" autoComplete="tel" placeholder="0803 123 4567" required value={phone} onChange={(e) => setPhone(e.target.value)} />

      <label htmlFor="astate">State</label>
      <select id="astate" className="field" required value={state} onChange={(e) => { setState(e.target.value); setLga(""); setLgaOptions([]); }}>
        <option value="">Choose your state</option>
        {LOCATIONS.map((l) => <option key={l.slug} value={l.slug}>{l.name}</option>)}
      </select>

      <label htmlFor="alga">Local government (optional)</label>
      <select id="alga" className="field" value={lga} onChange={(e) => setLga(e.target.value)} disabled={!lgaOptions.length}>
        <option value="">{state ? "Whole state" : "Choose a state first"}</option>
        {lgaOptions.map((l) => <option key={l.slug} value={l.slug}>{l.name}</option>)}
      </select>

      <fieldset>
        <legend>What should we warn you about?</legend>
        {([["flood", "Flooding"], ["heat", "Dangerous heat"], ["both", "Both"]] as const).map(([v, label]) => (
          <label className="choice" key={v}>
            <input type="radio" name="hazard" checked={hazard === v} onChange={() => setHazard(v)} />
            <span><b>{label}</b></span>
          </label>
        ))}
      </fieldset>

      <fieldset>
        <legend>How serious before we message you?</legend>
        <label className="choice">
          <input type="radio" name="level" checked={minLevel === 2} onChange={() => setMinLevel(2)} />
          <span><b>High or worse</b> (recommended)<br /><small>Only when it is likely to matter.</small></span>
        </label>
        <label className="choice">
          <input type="radio" name="level" checked={minLevel === 3} onChange={() => setMinLevel(3)} />
          <span><b>Severe only</b><br /><small>The fewest messages.</small></span>
        </label>
      </fieldset>

      <label className="choice" style={{ marginTop: 14 }}>
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} required />
        <span>
          I agree to get FloodWatch alerts at this number. Network charges may apply. I can stop at any time with the link in each message.
          I have read the <a href="/privacy">privacy page</a>.
        </span>
      </label>

      <Turnstile onToken={setToken} resetSignal={resetSignal} />

      <button className="btn" type="submit" disabled={busy || !state || !consent || (Boolean(TURNSTILE_SITE_KEY) && !token)}>
        {busy ? "Sending…" : "Send me a code"}
      </button>
      {message}
    </form>
  );
}
