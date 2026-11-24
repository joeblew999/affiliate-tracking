// One event added to a stream others follow, and its subscribers told (src/streams.ts).
import { defineHandler } from "void";
import { PublishInput, PublishOutput } from "../../src/contract.ts";
import { publish } from "../../src/streams.ts";

export const POST = defineHandler.withValidator({ body: PublishInput })(async (_c, { body }) =>
  PublishOutput.parse(await publish(body.stream, body.event)),
);
