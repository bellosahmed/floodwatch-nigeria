"use client";

import { useEffect, useState } from "react";
import { LOCATIONS } from "@/lib/locations";
import { ago } from "@/lib/format";
import { SEVERITY_LABELS } from "@/lib/types";

type AdminReport = {
  id: string;
  at: string;
  state: string;
  lgaName?: string;
  area: string;
  severity: 1 | 2 | 3;
  note: string;
  hidden: boolean;
  deviceTag: string;
};
type Stats = {
  store: string;
  subscribers: { confirmed: number; pending: number; byState: Record<string, number> };
  last24h: { codesSent: number; alertsSent: number };
  alerts: { enabled: true; provider: string; live: boolean; dailyCap: number } | { enabled: false; reason: string };
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const STATE_NAME = Object.fromEntries(LOCATIONS.map((l) => [l.slug, l.name]));

async function call<T>(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T | null }> {
  try {
    const res = await fetch(path, { credentials: "same-origin", ...init });
    return { ok: res.ok, status: res.status, data: res.ok ? ((await res.json()) as T) : null };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

/** Moderation: see recent reports, hide bad ones (or everything from one device), and watch the alert service. */
export default function AdminPanel() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [state, setState] = useState("");
  const [showHidden, setShowHidden] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [refreshTick, setRefreshTick] = useState(0);
  const refresh = () => setRefreshTick((n) => n + 1);

  useEffect(() => {
    let cancelled = false;
    call<{ authenticated: boolean }>("/api/admin/session").then((r) => !cancelled && setAuthed(Boolean(r.data?.authenticated)));
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch inside the effect, with a cancel flag so a slow answer cannot overwrite a newer one.
  useEffect(() => {
    if (!authed) return;
    let cancelled = false;
    (async () => {
      const [r, s] = await Promise.all([
        call<{ reports: AdminReport[] }>(`/api/admin/reports?limit=100${state ? `&state=${state}` : ""}`),
        call<Stats>("/api/admin/stats"),
      ]);
      if (cancelled) return;
      if (r.status === 401) return setAuthed(false); // the session ended
      if (r.data) setReports(r.data.reports);
      if (s.data) setStats(s.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [authed, state, refreshTick]);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const r = await call("/api/admin/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) });
    setKey(""); // never keep the key around
    if (r.ok) setAuthed(true);
    else setError(r.status === 429 ? "Too many wrong tries. Wait an hour." : "That key is not right.");
  }

  async function logout() {
    await call("/api/admin/session", { method: "DELETE" });
    setAuthed(false);
    setReports([]);
    setStats(null);
  }

  async function act(id: string, hidden: boolean, alsoSameDevice = false) {
    setBusyId(id);
    const r = await call("/api/admin/reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, hidden, alsoSameDevice }) });
    setBusyId(null);
    if (r.status === 401) return setAuthed(false);
    refresh();
  }

  if (authed === null) return <p className="lead">Loading…</p>;

  if (!authed) {
    return (
      <form onSubmit={login} autoComplete="off">
        <label htmlFor="key">Moderator key</label>
        <input id="key" className="field" type="password" autoComplete="off" required value={key} onChange={(e) => setKey(e.target.value)} />
        <button className="btn" type="submit" disabled={!key}>Sign in</button>
        {error && <p className="notice" role="alert">{error}</p>}
      </form>
    );
  }

  const shown = reports.filter((r) => showHidden || !r.hidden);

  return (
    <>
      <p className="actions">
        <button className="btn alt" onClick={refresh}>Refresh</button>
        <button className="btn alt" onClick={logout}>Sign out</button>
      </p>

      {stats && (
        <section className="card" aria-label="Alert service">
          <h2 style={{ marginTop: 0 }}>Alert service</h2>
          <p>
            {stats.alerts.enabled
              ? <>Provider <b>{stats.alerts.provider}</b>. {stats.alerts.live ? <b>LIVE: real messages are sent.</b> : <>Not live: the job only reports what it would send.</>} Daily cap {stats.alerts.dailyCap}.</>
              : <>Off: {stats.alerts.reason}.</>}
          </p>
          <p>
            Subscribers: <b>{stats.subscribers.confirmed}</b> confirmed, {stats.subscribers.pending} waiting for a code. Last 24 hours:{" "}
            {plural(stats.last24h.codesSent, "code")}, <b>{plural(stats.last24h.alertsSent, "alert")}</b> sent. Storage: {stats.store}.
          </p>
          {Object.keys(stats.subscribers.byState).length > 0 && (
            <p className="legend">
              {Object.entries(stats.subscribers.byState).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([s, n]) => `${STATE_NAME[s] ?? s} ${n}`).join(" · ")}
            </p>
          )}
        </section>
      )}

      <h2>Reports</h2>
      <div className="actions">
        <select className="field" aria-label="Filter by state" value={state} onChange={(e) => setState(e.target.value)} style={{ width: "auto" }}>
          <option value="">All states</option>
          {LOCATIONS.map((l) => <option key={l.slug} value={l.slug}>{l.name}</option>)}
        </select>
        <label className="choice" style={{ margin: 0 }}>
          <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />
          <span>Show hidden</span>
        </label>
      </div>

      {!shown.length && <p className="lead">No reports.</p>}
      <ul className="list">
        {shown.map((r) => (
          <li key={r.id} className={`card report-row${r.hidden ? " is-hidden" : ""}`}>
            <p style={{ margin: 0 }}>
              <span className={`badge l${r.severity}`}>{SEVERITY_LABELS[r.severity]}</span>{" "}
              <b>{STATE_NAME[r.state] ?? r.state}</b>{r.lgaName ? ` · ${r.lgaName}` : ""} · {r.area}
              {r.hidden && <span className="badge l3" style={{ marginLeft: 8 }}>Hidden</span>}
            </p>
            {r.note && <p style={{ margin: "4px 0" }}>{r.note}</p>}
            <p className="legend" style={{ margin: "4px 0 8px" }}>{ago(r.at)} · device {r.deviceTag}</p>
            <div className="actions">
              {r.hidden ? (
                <button className="btn alt" disabled={busyId === r.id} onClick={() => act(r.id, false)}>Restore</button>
              ) : (
                <>
                  <button className="btn" disabled={busyId === r.id} onClick={() => act(r.id, true)}>Hide</button>
                  <button className="btn alt" disabled={busyId === r.id} onClick={() => act(r.id, true, true)}>Hide all from this device</button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
