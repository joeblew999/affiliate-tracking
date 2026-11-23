import { defineHandler } from "void";
import { EventsInput, type EventsOutput } from "../../../src/host-contract.ts";
import { eventsOnSale } from "../../../src/events.ts";

// The host asks which events are on sale (their venue paid), soonest first, with the places left.
export const POST = defineHandler.withValidator({ body: EventsInput })(
  async () => ({ events: await eventsOnSale() }) satisfies EventsOutput,
);
