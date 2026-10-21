// Builds data/lgas.json: every Local Government Area with a representative point and its state.
//   npm run lgas
// Source: geoBoundaries (CC BY 4.0), which republishes GRID3 Nigeria LGA boundaries.
// Run once. The app reads the saved file and never downloads boundaries at runtime.
import { mkdirSync, writeFileSync } from "node:fs";
import { LOCATIONS } from "../lib/locations";

type Pos = [number, number]; // [lon, lat]
type Ring = Pos[];
type Geometry = { type: "Polygon"; coordinates: Ring[] } | { type: "MultiPolygon"; coordinates: Ring[][] };
type Feature = { properties: { shapeName: string }; geometry: Geometry };
type Collection = { features: Feature[] };

const API = "https://www.geoboundaries.org/api/current/gbOpen/NGA";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000), redirect: "follow" });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return (await res.json()) as T;
}

async function loadLevel(level: "ADM1" | "ADM2") {
  const meta = await getJson<{ simplifiedGeometryGeoJSON: string }>(`${API}/${level}/`);
  return getJson<Collection>(meta.simplifiedGeometryGeoJSON);
}

const polygons = (g: Geometry): Ring[][] => (g.type === "Polygon" ? [g.coordinates] : g.coordinates);

function inRing(p: Pos, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Inside the outer ring and not inside any hole. */
const inPolygon = (p: Pos, poly: Ring[]) => inRing(p, poly[0]) && !poly.slice(1).some((hole) => inRing(p, hole));
const inGeometry = (p: Pos, g: Geometry) => polygons(g).some((poly) => inPolygon(p, poly));

function ringCentroid(ring: Ring): { area: number; c: Pos } {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a += f;
    cx += (ring[j][0] + ring[i][0]) * f;
    cy += (ring[j][1] + ring[i][1]) * f;
  }
  a /= 2;
  return a === 0 ? { area: 0, c: ring[0] } : { area: Math.abs(a), c: [cx / (6 * a), cy / (6 * a)] };
}

/** Centroid of the biggest polygon; if it falls outside the shape (crescents), use the nearest interior grid point. */
function interiorPoint(g: Geometry): Pos {
  const biggest = polygons(g)
    .map((poly) => ({ poly, ...ringCentroid(poly[0]) }))
    .sort((a, b) => b.area - a.area)[0];
  if (inPolygon(biggest.c, biggest.poly)) return biggest.c;

  const xs = biggest.poly[0].map((p) => p[0]);
  const ys = biggest.poly[0].map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  let best: Pos = biggest.poly[0][0];
  let bestD = Infinity;
  for (let i = 0; i <= 24; i++) {
    for (let j = 0; j <= 24; j++) {
      const p: Pos = [x0 + ((x1 - x0) * i) / 24, y0 + ((y1 - y0) * j) / 24];
      const d = (p[0] - biggest.c[0]) ** 2 + (p[1] - biggest.c[1]) ** 2;
      if (d < bestD && inPolygon(p, biggest.poly)) {
        bestD = d;
        best = p;
      }
    }
  }
  return best;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
// geoBoundaries spells some states differently from our list.
const ALIASES: Record<string, string> = {
  federalcapitalterritory: "fct",
  abujafederalcapitalterritory: "fct",
  abuja: "fct",
  nassarawa: "nasarawa",
};
const stateSlug = (name: string) => {
  const key = ALIASES[norm(name)] ?? norm(name);
  return LOCATIONS.find((l) => norm(l.name) === key)?.slug;
};

const slugify = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function main() {
  console.error("downloading boundaries...");
  const [adm1, adm2] = await Promise.all([loadLevel("ADM1"), loadLevel("ADM2")]);

  const states = adm1.features.map((f) => ({ slug: stateSlug(f.properties.shapeName), name: f.properties.shapeName, g: f.geometry }));
  const unmatched = states.filter((s) => !s.slug).map((s) => s.name);
  if (unmatched.length) throw new Error(`Unrecognised state names: ${unmatched.join(", ")}`);

  const used = new Set<string>();
  const lgas = adm2.features.map((f) => {
    const [lon, lat] = interiorPoint(f.geometry);
    const state = states.find((s) => inGeometry([lon, lat], s.g))?.slug;
    if (!state) throw new Error(`No state contains LGA ${f.properties.shapeName} at ${lat},${lon}`);

    let slug = `${state}-${slugify(f.properties.shapeName)}`;
    for (let n = 2; used.has(slug); n++) slug = `${state}-${slugify(f.properties.shapeName)}-${n}`;
    used.add(slug);

    return { slug, name: f.properties.shapeName.trim(), state, lat: Math.round(lat * 1000) / 1000, lon: Math.round(lon * 1000) / 1000 };
  });
  lgas.sort((a, b) => a.state.localeCompare(b.state) || a.name.localeCompare(b.name));

  mkdirSync("data", { recursive: true });
  writeFileSync(
    "data/lgas.json",
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      source: "geoBoundaries (CC BY 4.0), from GRID3 Nigeria LGA boundaries, 2022",
      note: "lat/lon is a representative point inside each LGA, not an administrative centre",
      lgas,
    }),
  );

  const perState = new Map<string, number>();
  lgas.forEach((l) => perState.set(l.state, (perState.get(l.state) ?? 0) + 1));
  console.error(`wrote data/lgas.json: ${lgas.length} LGAs in ${perState.size} states`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
