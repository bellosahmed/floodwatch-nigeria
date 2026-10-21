import type { Metadata } from "next";
import Link from "next/link";
import LegalBanner, { contactLine } from "@/components/LegalBanner";

export const metadata: Metadata = { title: "Terms · FloodWatch" };
export const dynamic = "force-dynamic";

export default function Terms() {
  return (
    <>
      <h1>Terms of use</h1>
      <LegalBanner />

      <h2>What this is, and is not</h2>
      <p>
        FloodWatch gives guidance about possible flooding and heat, built from public weather and river forecasts, reports from
        people, and partner river gauges. <b>It is not an official warning service.</b> Always follow instructions from NiMet,
        NiHSA, NEMA and your State Emergency Management Agency. In an emergency call 112.
      </p>

      <h2>No guarantee</h2>
      <p>
        Forecasts can be wrong, reports can be mistaken or false, and the service can be slow or unavailable. A low level or
        &quot;No reports&quot; never means an area is safe. We provide the service as it is, and to the extent the law allows we are
        not responsible for losses that come from relying on it. Do not make life-or-death decisions from this site alone.
      </p>

      <h2>Phone alerts</h2>
      <p>
        Alerts are optional and are <b>unofficial guidance</b>. They may be wrong, late, or never arrive (phone networks, delivery
        and WhatsApp rules are outside our control), and no alert means nothing about safety. We may change or stop the alert service at
        any time. You can stop yours at any time with the link in each message. Only use your own number.
      </p>

      <h2>When you post a report</h2>
      <ul>
        <li>Report only what you really see, and be accurate about how bad it is.</li>
        <li>Do not post personal details of other people, links, or anything abusive or misleading.</li>
        <li>Fake or repeated reports to cause alarm are not allowed. We may hide reports and block abusive devices.</li>
        <li>By posting, you allow us to show your report publicly and use it, without your identity, to improve warnings.</li>
      </ul>

      <h2>Data sources</h2>
      <p>
        Weather data by Open-Meteo.com (CC BY 4.0). Local government boundaries by geoBoundaries, from GRID3 (CC BY 4.0). See also our{" "}
        <Link prefetch={false} href="/privacy">privacy page</Link>.
      </p>

      <h2>Contact</h2>
      <p>{contactLine()}</p>
    </>
  );
}
