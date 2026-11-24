// The affiliate service, on a demo site, put the demo back (its src/demo-reset.ts), and the shop,
// following that (src/hub.ts), does its part: every account that isn't one of the demo's people
// is removed, with its sessions, and nobody is unsubscribed from emails any more. The demo's own
// accounts stay as they are, signed in or not, so whoever pressed the button still is.
import { demoPeople } from "affiliates/demo";
import { db, notInArray } from "void/db";
import { schema } from "../.void/better-auth-schema.ts";
import { emailOptOuts } from "../db/schema.ts";

export async function resetDemo(): Promise<void> {
  const demo = demoPeople.map((person) => person.userId);
  await db.delete(schema.session).where(notInArray(schema.session.userId, demo));
  await db.delete(schema.account).where(notInArray(schema.account.userId, demo));
  await db.delete(schema.user).where(notInArray(schema.user.id, demo));
  await db.delete(emailOptOuts);
}
