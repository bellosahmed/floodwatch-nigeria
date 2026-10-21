import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { alertsConfig } from "@/lib/alerts/config";
import "./globals.css";

export const metadata: Metadata = {
  title: "FloodWatch Nigeria",
  description:
    "Free flood early-warning for every Nigerian state: rainfall and river forecasts confirmed by community reports and river gauges.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export const dynamic = "force-dynamic"; // the Alerts link depends on configuration

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <div className="wrap row">
            <Link prefetch={false} href="/" className="brand">
              FloodWatch <span>Nigeria</span>
            </Link>
            <nav>
              <Link prefetch={false} href="/calendar">Calendar</Link>
              <Link prefetch={false} href="/report">Report</Link>
              {alertsConfig().enabled && <Link prefetch={false} href="/alerts">Alerts</Link>}
              <Link prefetch={false} href="/api-docs">Partners</Link>
            </nav>
          </div>
        </header>
        <main className="wrap">{children}</main>
        <footer className="wrap foot">
          <p>
            Built on reports from people like you and partner river gauges. Not an official warning. In danger? Call
            112 or your State Emergency Management Agency.
          </p>
          <p>
            Weather data by{" "}
            <a href="https://open-meteo.com" rel="noopener noreferrer">
              Open-Meteo.com
            </a>{" "}
            (CC BY 4.0). Local government boundaries:{" "}
            <a href="https://www.geoboundaries.org" rel="noopener noreferrer">
              geoBoundaries
            </a>{" "}
            from GRID3 (CC BY 4.0).
          </p>
          <p>
            <Link prefetch={false} href="/privacy">Privacy</Link> · <Link prefetch={false} href="/terms">Terms</Link> · <Link prefetch={false} href="/api-docs">For partners</Link>
          </p>
        </footer>
      </body>
    </html>
  );
}
