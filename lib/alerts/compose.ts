import { shortDay } from "../format";
import type { AlertHazard } from "../store";

// What people actually receive. SMS is plain, short and unmistakably unofficial, and every message carries a
// one-tap way to stop. Text is kept to basic GSM characters so each message stays within two SMS segments.

export const CONSENT_VERSION = "2026-10-v1";
/** Two concatenated GSM-7 segments. Anything longer costs more and can arrive out of order. */
export const MAX_MESSAGE_CHARS = 306;

const ALLOWED = /[^A-Za-z0-9 .,:;!?'"()/@#%&+\-_=*\n]/g;

/** Strip accents and anything outside the basic SMS alphabet, so a stray symbol cannot double the cost. */
export function gsmSafe(text: string): string {
  return text.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(ALLOWED, "").replace(/\s+/g, " ").trim();
}

const LEVEL_WORD: Record<AlertHazard, Record<2 | 3, string>> = {
  flood: { 2: "HIGH flood risk", 3: "SEVERE flood risk" },
  heat: { 2: "DANGEROUS heat", 3: "EXTREME heat" },
};

export function otpMessage(code: string): string {
  return `FloodWatch code: ${code}. It expires in 10 minutes. If you did not ask for this, ignore it.`;
}

export type AlertMessageInput = {
  hazard: AlertHazard;
  level: 2 | 3;
  areaName: string; // e.g. "Rivers" or "Akuku Toru, Rivers"
  stateSlug: string;
  firstDate: string | null; // YYYY-MM-DD the hazard starts, or null
  todayIso: string;
  siteUrl: string; // no trailing slash
  unsubCode: string;
};

export function alertMessage(i: AlertMessageInput): string {
  const when = !i.firstDate || i.firstDate <= i.todayIso ? "now" : `from ${shortDay(i.firstDate)}`;
  const area = gsmSafe(i.areaName);
  const text =
    `FloodWatch: ${LEVEL_WORD[i.hazard][i.level]} in ${area} ${when}. Unofficial guidance, follow NEMA/SEMA. ` +
    `${i.siteUrl}/state/${i.stateSlug}${i.hazard === "heat" ? "?hazard=heat" : ""} Stop: ${i.siteUrl}/u/${i.unsubCode}`;

  if (text.length <= MAX_MESSAGE_CHARS) return text;
  // A very long area name: shorten the area, never the disclaimer or the stop link.
  const room = MAX_MESSAGE_CHARS - (text.length - area.length) - 1;
  return text.replace(area, `${area.slice(0, Math.max(8, room))}~`);
}

