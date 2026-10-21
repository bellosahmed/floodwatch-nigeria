import type { Metadata } from "next";
import AlertsForm from "@/components/AlertsForm";
import { alertsConfig } from "@/lib/alerts/config";

export const metadata: Metadata = { title: "Get alerts · FloodWatch" };
export const dynamic = "force-dynamic";

export default function AlertsPage() {
  const config = alertsConfig();

  if (!config.enabled) {
    return (
      <>
        <h1>Get alerts</h1>
        <p className="notice">Phone alerts are not available yet. For now, check this site, and follow NEMA and your State Emergency Management Agency.</p>
      </>
    );
  }

  return (
    <>
      <h1>Get an alert on your phone</h1>
      {config.messenger.name === "dry-run" && (
        <p className="notice" role="status">
          <b>Test mode.</b> No real messages are sent.
        </p>
      )}
      <p className="lead">
        We message you only when flooding or dangerous heat is likely in your area. We will not message you for small risks, and we will not
        repeat ourselves unless it gets worse.
      </p>
      <p className="notice">
        These are <b>unofficial</b> warnings built from forecasts. They can be wrong or late. In danger, call 112 and follow NEMA and your State
        Emergency Management Agency.
      </p>
      <AlertsForm />
      <p className="legend">
        We keep your number encrypted, only to send these alerts. Stopping deletes it. See the <a href="/privacy">privacy page</a>.
      </p>
    </>
  );
}
