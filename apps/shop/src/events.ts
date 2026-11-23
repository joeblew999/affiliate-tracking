// The shop's events: the demo's (affiliates/demo, shared with the affiliate service's seed), each
// with its page's id. A ticket is a one-off Stripe payment for the event's Stripe product.
import { demoEvents, eventTimes } from "affiliates/demo";

export type EventId = keyof typeof demoEvents;

/** The events, dated from now. */
export const events = () =>
  Object.entries(demoEvents).map(([id, event]) => {
    const { startsAt, endsAt } = eventTimes(event);
    return { ...event, id: id as EventId, startsAt: startsAt.getTime(), endsAt: endsAt.getTime() };
  });

export const eventOf = (id: string) => events().find((e) => e.id === id) ?? null;

/** An event's day and time, as the shop shows it (UTC). */
export function when(event: { startsAt: number; endsAt: number }): string {
  const day = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(event.startsAt));
  const time = (at: number) =>
    new Intl.DateTimeFormat("en-US", { timeStyle: "short", timeZone: "UTC" }).format(new Date(at));
  return `${day}, ${time(event.startsAt)} to ${time(event.endsAt)} UTC`;
}

/** A price in its currency, as the shop shows it. */
export const price = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
