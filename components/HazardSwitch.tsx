import Link from "next/link";
import { HAZARDS, type Hazard } from "@/lib/hazard";

/** Flood / Heat toggle. Plain links with a query string, so it works without any client JavaScript. */
export default function HazardSwitch({ current, path }: { current: Hazard; path: string }) {
  return (
    <nav className="switch" aria-label="Choose hazard">
      {(Object.keys(HAZARDS) as Hazard[]).map((h) => (
        <Link
          prefetch={false}
          key={h}
          href={h === "flood" ? path : `${path}?hazard=${h}`}
          className={h === current ? "on" : ""}
          aria-current={h === current ? "page" : undefined}
        >
          {HAZARDS[h].title}
        </Link>
      ))}
    </nav>
  );
}
