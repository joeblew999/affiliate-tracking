import { partners } from "@schema";
import { HTTPException } from "hono/http-exception";
import { defineHandler } from "void";
import { db } from "void/db";
import { z } from "zod";
import { requireAuth } from "void/auth";
import { partnerForUser } from "@/partners";

/** The terms a partner accepts when applying; bump when they change. */
export const TERMS_VERSION = "2026-11-22";

function codeFor(name: string): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 20) || "partner";
  return `${base}-${crypto.randomUUID().slice(0, 4)}`;
}

// A signed-in host user applies to be a partner. Pending until an admin approves.
export const POST = defineHandler.withValidator({
  body: z.object({
    name: z.string().trim().min(1).max(100),
    application: z.string().trim().max(2000).optional(),
    acceptTerms: z.literal(true),
  }),
})(async (c, { body }) => {
  const user = requireAuth(c);
  if (await partnerForUser(user.id)) throw new HTTPException(409, { message: "Already applied" });
  const [partner] = await db
    .insert(partners)
    .values({
      userId: user.id,
      email: user.email,
      name: body.name,
      code: codeFor(body.name),
      application: body.application ?? null,
      termsVersion: TERMS_VERSION,
      termsAcceptedAt: Date.now(),
    })
    .returning({ id: partners.id, code: partners.code, status: partners.status });
  if (!partner) throw new Error("partner not created");
  return partner;
});
