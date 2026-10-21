"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export type StateRow = {
  slug: string;
  name: string;
  capital: string;
  level: number;
  label: string;
  detail: string;
  heatLevel: number;
  heatLabel: string;
};

export default function StateList({ rows }: { rows: StateRow[] }) {
  const [query, setQuery] = useState("");

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? rows.filter((r) => r.name.toLowerCase().includes(q) || r.capital.toLowerCase().includes(q)) : rows;
  }, [query, rows]);

  return (
    <>
      <input
        className="search"
        type="search"
        placeholder="Search your state or city"
        aria-label="Search your state or city"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <ul className="list">
        {shown.map((r) => (
          <li key={r.slug}>
            <Link href={`/state/${r.slug}`} className="item" prefetch={false}>
              <span>
                <strong>{r.name}</strong>
                <small>{r.detail}</small>
              </span>
              <span className="badges">
                <span className={`badge l${r.level}`}>{r.label}</span>
                {r.heatLevel >= 1 && (
                  <span className={`badge l${r.heatLevel}`} title="Heat outlook for the next 7 days">
                    {r.heatLabel}
                  </span>
                )}
              </span>
            </Link>
          </li>
        ))}
        {!shown.length && <li className="lead">No match for “{query}”.</li>}
      </ul>
    </>
  );
}
