// Organisers and venues, added by an admin. Each is paid through a shop user (an organiser, or a
// venue's contact) with a payee record (partners) of that role, who signs in to set up payouts as
// an affiliate does. One person has one role: an affiliate can't be an organiser or a venue's
// contact, nor the other way round.
import { partners, venues, type newVenue } from "@schema";
import { HTTPException } from "hono/http-exception";
import { db, eq } from "void/db";
import type { z } from "zod";
import { codeFor } from "./partners.ts";
import { partnersWritten } from "./outcomes.ts";

type ShopUser = { id: string; email: string; name: string | null };

/** The user's payee record in this role: theirs already, or made now, active. */
async function payeeFor(user: ShopUser, role: "organiser" | "venue"): Promise<string> {
  const [existing] = await db.select().from(partners).where(eq(partners.userId, user.id));
  if (existing) {
    if (existing.role !== role)
      throw new HTTPException(409, {
        message: `${user.email} is already ${existing.role === "affiliate" ? "an affiliate" : existing.role === "organiser" ? "an organiser" : "a venue's contact"}`,
      });
    return existing.id;
  }
  const name = user.name || user.email;
  const [row] = await db
    .insert(partners)
    .values({
      role,
      userId: user.id,
      email: user.email,
      name,
      code: codeFor(name),
      status: "active",
      commissionPct: 0,
    })
    .returning({ id: partners.id });
  if (!row) throw new Error("no payee made");
  await partnersWritten([row.id]);
  return row.id;
}

export const addOrganiser = (user: ShopUser) => payeeFor(user, "organiser");

export async function addVenue(
  venue: Omit<z.output<typeof newVenue>, "contactEmail">,
  contact: ShopUser,
) {
  const payeeId = await payeeFor(contact, "venue");
  const [row] = await db
    .insert(venues)
    .values({ ...venue, payeeId })
    .returning({ id: venues.id });
  return row?.id;
}
