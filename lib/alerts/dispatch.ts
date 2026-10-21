import type { Level } from "../types";
import { DAY_MS } from "../types";
import type { Store, Subscription } from "../store";
import { alertMessage } from "./compose";
import type { AlertsConfig } from "./config";
import { decryptPhone, hashPhone } from "./pii";

// Deciding who gets an alert, and sending it. Built to be calm and hard to misuse:
//  - one alert per "episode": a new one only when the hazard first reaches the person's level, or gets worse;
//  - nothing is sent unless ALERTS_LIVE=true (otherwise the job only reports what it would do);
//  - a hard daily cap, spent on the most severe cases first;
//  - a subscription is claimed before sending, so two overlapping job runs cannot message someone twice.

export type Reading = { level: Level; firstDate: string | null; areaName: string };
export type Lookup = (sub: Subscription) => Promise<Reading | null>;
export type Decision = "send" | "end-episode" | "none";

/** Pure. level = how bad the hazard is for this person's area right now. */
export function decide(sub: Pick<Subscription, "minLevel" | "lastAlertLevel">, level: number): Decision {
  if (level < sub.minLevel) return sub.lastAlertLevel > 0 ? "end-episode" : "none"; // it has passed: a future one is a new episode
  if (sub.lastAlertLevel === 0) return "send"; // first time at or above their level
  return level > sub.lastAlertLevel ? "send" : "none"; // only tell them again if it got worse
}

export type RunSummary = {
  live: boolean;
  considered: number;
  noData: number;
  wouldSend: number; // only counted when not live
  sent: number;
  failed: number;
  capped: number; // had an alert due but the daily cap was already reached
  endedEpisodes: number;
};

type Ctx = {
  store: Store;
  config: Extract<AlertsConfig, { enabled: true }>;
  lookup: Lookup;
  todayIso: string;
  nowMs: number;
};

export async function runAlerts(ctx: Ctx): Promise<RunSummary> {
  const { store, config, lookup, todayIso, nowMs } = ctx;
  const summary: RunSummary = { live: config.live, considered: 0, noData: 0, wouldSend: 0, sent: 0, failed: 0, capped: 0, endedEpisodes: 0 };

  const due: { sub: Subscription; reading: Reading }[] = [];
  for (const sub of await store.listConfirmedSubscriptions()) {
    summary.considered++;
    const reading = await lookup(sub);
    if (!reading) {
      summary.noData++;
      continue;
    }
    const action = decide(sub, reading.level);
    if (action === "end-episode") {
      summary.endedEpisodes++;
      if (config.live) await store.setAlertState(sub.id, 0, null);
    } else if (action === "send") due.push({ sub, reading });
  }

  // If the cap cuts the list short, the people in the worst danger are messaged first.
  due.sort((a, b) => b.reading.level - a.reading.level);
  let room = config.dailyCap - (await store.countSends({ sinceMs: nowMs - DAY_MS }));

  for (const { sub, reading } of due) {
    if (room <= 0) {
      summary.capped++;
      continue;
    }
    if (!config.live) {
      summary.wouldSend++;
      room--;
      continue;
    }

    // Claim first, send second. If sending fails the claim is undone, so the next run tries again.
    await store.setAlertState(sub.id, reading.level, nowMs);
    let ok = false;
    try {
      const phone = decryptPhone(sub.phoneEnc);
      const result = await config.messenger.send({
        kind: "alert",
        channel: sub.channel,
        toDigits: phone,
        text: alertMessage({
          hazard: sub.hazard,
          level: Math.min(reading.level, 3) as 2 | 3,
          areaName: reading.areaName,
          stateSlug: sub.state,
          firstDate: reading.firstDate,
          todayIso,
          siteUrl: config.siteUrl,
          unsubCode: sub.unsubCode,
        }),
      });
      ok = result.ok;
      await store.logSend("alert", hashPhone(phone), ok);
      if (!result.ok) console.error(`[alerts] send failed: ${result.error}`);
    } catch (err) {
      console.error("[alerts] could not prepare an alert:", err instanceof Error ? err.name : "error");
      await store.logSend("alert", sub.phoneHash, false);
    }

    if (ok) summary.sent++;
    else {
      summary.failed++;
      await store.setAlertState(sub.id, sub.lastAlertLevel, sub.lastAlertAt ? Date.parse(sub.lastAlertAt) : null);
    }
    room--;
  }
  return summary;
}
