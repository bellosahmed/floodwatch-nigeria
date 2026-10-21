import raw from "../data/lgas.json";

// Local Government Areas. Built once by `npm run lgas` from open boundary data (CC BY 4.0).
// lat/lon is a representative point INSIDE each LGA, not its administrative centre.

export type Lga = { slug: string; name: string; state: string; lat: number; lon: number };

type LgaFile = { generatedAt: string; source: string; note: string; lgas: Lga[] };
const data = raw as unknown as LgaFile;

export const LGA_META = { source: data.source, note: data.note } as const;
export const ALL_LGAS: readonly Lga[] = data.lgas;

const byState = new Map<string, Lga[]>();
for (const lga of ALL_LGAS) byState.set(lga.state, [...(byState.get(lga.state) ?? []), lga]);
const bySlugMap = new Map(ALL_LGAS.map((l) => [l.slug, l]));

export const lgasOf = (stateSlug: string): Lga[] => byState.get(stateSlug) ?? [];
export const lgaBySlug = (slug: string): Lga | undefined => bySlugMap.get(slug);

/** Beyond this distance, daily rainfall at the state's forecast point agrees only weakly with the LGA (correlation ~0.5). */
export const LARGE_SPREAD_KM = 150;

/** Great-circle distance in km. */
function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((bLat - aLat) * rad) / 2) ** 2 +
    Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(((bLon - aLon) * rad) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** How far the state's forecast point is from its farthest local government, in km (0 if the state has no LGAs). */
export function farthestLgaKm(stateSlug: string, pointLat: number, pointLon: number): number {
  return Math.round(Math.max(0, ...lgasOf(stateSlug).map((l) => distanceKm(pointLat, pointLon, l.lat, l.lon))));
}
