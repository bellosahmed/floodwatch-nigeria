import { HEAT_LABELS, LEVEL_LABELS, type Level } from "./types";

// The app tracks two hazards on the same 0-3 scale. Pages take ?hazard=heat to switch.

export type Hazard = "flood" | "heat";

export const HAZARDS: Record<Hazard, { title: string; labels: readonly string[] }> = {
  flood: { title: "Flood", labels: LEVEL_LABELS },
  heat: { title: "Heat", labels: HEAT_LABELS },
};

export function parseHazard(value: string | string[] | undefined): Hazard {
  return value === "heat" ? "heat" : "flood";
}

/** A day (or LGA day) with both hazard levels. */
export type HazardDay = { level: Level; heatLevel: Level };

export const levelFor = (day: HazardDay, hazard: Hazard): Level => (hazard === "heat" ? day.heatLevel : day.level);
export const labelFor = (level: Level, hazard: Hazard): string => HAZARDS[hazard].labels[level];
