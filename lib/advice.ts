import type { Level } from "./types";

/** Plain-language guidance per combined level. Kept generic: official instructions always win. */
export const ADVICE: Record<Level, string[]> = {
  0: ["Nothing flagged right now. If you see flooding, report it so your neighbours are warned."],
  1: ["Clear drains and gutters around your home or shop.", "Know your nearest high ground and your emergency number."],
  2: [
    "Move valuables and documents off the floor.",
    "Avoid crossing flooded roads or streams, including on foot.",
    "Charge phones and keep ID, medicine and water ready.",
  ],
  3: [
    "If you live near water or in a low area, move to higher ground early.",
    "Follow instructions from SEMA, NEMA and local leaders immediately.",
    "Never drive or walk through moving water.",
  ],
};

/** Heat guidance per level. Basic, widely accepted precautions; official heat advisories always win. */
export const HEAT_ADVICE: Record<Level, string[]> = {
  0: ["No unusual heat expected. Keep drinking water through the day."],
  1: [
    "Very hot weather: drink water often and avoid the midday sun where you can.",
    "Check on elderly neighbours, babies and people who work outdoors.",
  ],
  2: [
    "Dangerous heat: stay in shade or indoors from late morning to late afternoon.",
    "Never leave a child or pet in a parked vehicle.",
    "Heat stroke is an emergency: confusion, hot dry skin or fainting means get medical help and cool the person down.",
  ],
  3: [
    "Extreme heat: avoid outdoor work and travel in the daytime.",
    "Drink water before you are thirsty, and rest in the coolest place available.",
    "Seek emergency help for confusion, fainting, or very hot dry skin.",
  ],
};
