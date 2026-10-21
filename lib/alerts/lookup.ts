import type { CombinedFeed } from "../combined";
import type { DayRisk } from "../forecast";
import type { LgaForecast } from "../lga-forecast";
import { lgaBySlug } from "../lgas";
import { bySlug } from "../locations";
import type { Subscription } from "../store";
import type { Level } from "../types";
import type { Lookup, Reading } from "./dispatch";

/** How many days ahead an alert looks. Short on purpose: a warning for next week is not worth waking someone for. */
export const ALERT_WINDOW_DAYS = 3;

const levelOf = (d: DayRisk, hazard: Subscription["hazard"]): Level => (hazard === "heat" ? d.heatLevel : d.level);

/** Worst level in the next few days, and the first day at or above `minLevel`. Past days are ignored. */
export function nearTerm(days: DayRisk[], hazard: Subscription["hazard"], minLevel: number, window = ALERT_WINDOW_DAYS) {
  const ahead = days.filter((d) => d.phase !== "past").slice(0, window);
  const level = Math.max(0, ...ahead.map((d) => levelOf(d, hazard))) as Level;
  return { level, firstDate: ahead.find((d) => levelOf(d, hazard) >= minLevel)?.date ?? null };
}

/**
 * Turns the live forecast into "how bad is it for this subscriber". State subscriptions use the state's combined
 * level (forecast plus community reports and gauges); LGA subscriptions use that LGA's own rainfall or heat outlook.
 */
export function createLookup(deps: {
  feed: CombinedFeed;
  getLga: (stateSlug: string) => Promise<LgaForecast[]>;
  /** Community level per LGA from reports that named one (see computeLgaGround). */
  lgaGround?: Map<string, Level>;
}): Lookup {
  const lgaCache = new Map<string, Promise<LgaForecast[]>>();

  return async (sub): Promise<Reading | null> => {
    const stateName = bySlug(sub.state)?.name ?? sub.state;

    if (sub.lga) {
      const lga = lgaBySlug(sub.lga);
      if (!lga) return null;
      // A failed forecast for one state must not stop alerts for everyone else, so it becomes "no forecast".
      if (!lgaCache.has(sub.state)) lgaCache.set(sub.state, deps.getLga(sub.state).catch(() => []));
      const forecast = (await lgaCache.get(sub.state)!).find((l) => l.slug === sub.lga);
      // People reporting flooding in this very LGA count too (floods only). It is happening now, so no "from" date.
      const ground = sub.hazard === "flood" ? (deps.lgaGround?.get(lga.slug) ?? 0) : 0;
      const areaName = `${lga.name}, ${stateName}`;
      if (!forecast) return ground > 0 ? { level: ground, firstDate: null, areaName } : null;
      const near = nearTerm(forecast.days, sub.hazard, sub.minLevel);
      return { level: Math.max(near.level, ground) as Level, firstDate: ground >= sub.minLevel ? null : near.firstDate, areaName };
    }

    const state = deps.feed.locations.find((l) => l.slug === sub.state);
    if (!state?.forecast) {
      // No forecast: only trust what people and gauges on the ground are reporting, and only for floods.
      return sub.hazard === "flood" && state && state.ground.level > 0 ? { level: state.ground.level, firstDate: null, areaName: stateName } : null;
    }
    if (sub.hazard === "heat") {
      const { level, firstDate } = nearTerm(state.forecast.days, "heat", sub.minLevel);
      return { level, firstDate, areaName: stateName };
    }
    const forecast = nearTerm(state.forecast.days, "flood", sub.minLevel);
    // Once people or gauges on the ground confirm flooding, use the combined level: it is happening now, not "from
    // Tuesday". Otherwise rely only on the short-range forecast.
    const confirmed = state.ground.level >= 1;
    return { level: confirmed ? state.level : forecast.level, firstDate: state.ground.level >= sub.minLevel ? null : forecast.firstDate, areaName: stateName };
  };
}
