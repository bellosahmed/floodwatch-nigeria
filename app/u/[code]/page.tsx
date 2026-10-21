import type { Metadata } from "next";
import UnsubscribeButton from "@/components/UnsubscribeButton";

export const metadata: Metadata = { title: "Stop alerts · FloodWatch", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function StopPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const valid = /^[A-Za-z0-9_-]{10}$/.test(code);

  return (
    <>
      <h1>Stop alerts</h1>
      {valid ? (
        <>
          <p className="lead">Tap the button to stop FloodWatch alerts to this number. We will delete the number.</p>
          <UnsubscribeButton code={code} />
        </>
      ) : (
        <p className="notice">That stop link is not valid. If you still get messages, please contact us.</p>
      )}
    </>
  );
}
