import type { Metadata } from "next";
import AdminPanel from "@/components/AdminPanel";

// Not for the public: hidden from search engines, and everything it shows comes from endpoints that need the key.
export const metadata: Metadata = { title: "Moderation · FloodWatch", robots: { index: false, follow: false } };

export default function AdminPage() {
  return (
    <>
      <h1>Moderation</h1>
      <AdminPanel />
    </>
  );
}
