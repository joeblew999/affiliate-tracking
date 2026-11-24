// A read stream's latest events: from its oldest mark kept (src/streams.ts).
import { defineHandler } from "void";
import { RecentInput, RecentOutput } from "../../src/contract.ts";
import { recent } from "../../src/streams.ts";

export const POST = defineHandler.withValidator({ body: RecentInput })(async (_c, { body }) =>
  RecentOutput.parse(await recent(body.stream)),
);
