import { formatTimeNigeria } from "@/lib/time";

/** Tells people when the forecast shown is older than usual, or missing, instead of silently showing it. */
export default function ForecastNotice({ available, stale, asOf }: { available: boolean; stale: boolean; asOf: string | null }) {
  if (!available) {
    return (
      <p className="notice" role="status">
        The weather forecast source is unreachable right now, so only community reports and river gauges are shown. Check
        NiMet or NiHSA for official forecasts.
      </p>
    );
  }
  if (stale && asOf) {
    return (
      <p className="notice" role="status">
        The weather source is temporarily unreachable, so this forecast is from {formatTimeNigeria(new Date(asOf))}. It will
        refresh by itself when the source is back.
      </p>
    );
  }
  return null;
}
