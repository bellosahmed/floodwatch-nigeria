import type { Metadata } from "next";
import Link from "next/link";
import ReportForm from "@/components/ReportForm";

export const metadata: Metadata = { title: "Report flooding · FloodWatch" };

export default function ReportPage() {
  return (
    <>
      <h1>Report flooding</h1>
      <p className="notice">
        In danger right now? Call <b>112</b> or your State Emergency Management Agency first. This form is not an
        emergency line.
      </p>
      <ReportForm />
      <p className="lead" style={{ marginTop: 16 }}>
        Your name and phone number are not collected. Reports are shown with the place and time only.{" "}
        <Link prefetch={false} href="/">Back to all states</Link>
      </p>
    </>
  );
}
