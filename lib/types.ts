// Shared vocabulary. Every module imports levels and severities from here so the
// numbers mean the same thing in the forecast, ground and combined layers.

export type Level = 0 | 1 | 2 | 3;
export type Severity = 1 | 2 | 3; // what a person reports: minor, dangerous, severe

export const LEVEL_LABELS = ["Low", "Watch", "High", "Severe"] as const;
// Ground level 0 means nobody has reported anything. That is NOT the same as "Low".
export const GROUND_LABELS = ["No reports", "Watch", "High", "Severe"] as const;
// Heat uses the same 0-3 scale, with its own words.
export const HEAT_LABELS = ["Normal", "Hot", "Dangerous heat", "Extreme heat"] as const;
export const SEVERITY_LABELS = ["", "Minor", "Dangerous", "Severe"] as const;

export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;

export const DISCLAIMER =
  "Indicative guidance only, not an official warning. 'No reports' or 'Low' does not mean an area is safe. " +
  "Follow NiHSA, NiMet, NEMA and your State Emergency Management Agency.";
