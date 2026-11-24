// The unsubscribe link in each event email (src/email-links.ts): the user's id, signed. Pressing the
// button stops the emails; opening the link alone doesn't (mail scanners open links).
import { HTTPException } from "hono/http-exception";
import { defineHandler, defineHead, type InferProps } from "void";
import { db } from "void/db";
import { z } from "zod";
import { emailOptOuts } from "../db/schema.ts";
import { signedBy } from "../src/email-links.ts";

const link = z.object({ u: z.string().min(1).max(255), s: z.string().min(1).max(128) });

export const loader = defineHandler((c) => {
  const parsed = link.safeParse(c.req.query());
  return {
    u: parsed.data?.u ?? "",
    s: parsed.data?.s ?? "",
    valid: parsed.success,
    stopped: c.req.query("done") !== undefined,
  };
});
export type Props = InferProps<typeof loader>;

export const head = defineHead(() => ({ title: "Event emails" }));

export const actions = {
  stop: defineHandler.withValidator({ body: link })(async (c, { body }) => {
    if (!(await signedBy(body.u, body.s)))
      throw new HTTPException(400, { message: "That link isn't valid" });
    await db
      .insert(emailOptOuts)
      .values({ userId: body.u, createdAt: Date.now() })
      .onConflictDoNothing();
    return c.redirect("/unsubscribe?done", 303);
  }),
};
