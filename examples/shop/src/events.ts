// The events the shop sells: those on sale at the affiliate service, which books them, pays their
// venues and puts them on sale (its events()), and how the shop shows them. A ticket is a one-off
// Stripe payment for the event's Stripe product.
import type { Event } from "affiliates/client";
import { affiliatesService } from "./affiliates.ts";

/** The events on sale, soonest first. */
export async function eventsOnSale(): Promise<Event[]> {
  return (await affiliatesService().events()).events;
}

/** One event on sale, or null. */
export async function eventOnSale(id: string): Promise<Event | null> {
  return (await eventsOnSale()).find((e) => e.id === id) ?? null;
}

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
export const price = (cents: number, currency = "usd") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(
    cents / 100,
  );
