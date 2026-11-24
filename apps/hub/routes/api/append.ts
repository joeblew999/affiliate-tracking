// Events added to streams that are read, not followed (src/streams.ts).
import { defineHandler } from "void";
import { AppendInput, AppendOutput } from "../../src/contract.ts";
import { append } from "../../src/streams.ts";

export const POST = defineHandler.withValidator({ body: AppendInput })(async (_c, { body }) => {
  for (const stream of body.streams) await append(stream, body.events, body.mark);
  return AppendOutput.parse({ appended: true });
});
