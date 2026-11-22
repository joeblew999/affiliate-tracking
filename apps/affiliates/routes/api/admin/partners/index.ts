import { partners } from "@schema";
import { defineHandler } from "void";
import { db, desc } from "void/db";
import { requireAdmin } from "@/access";

// Every partner, newest first.
export const GET = defineHandler(async (c) => {
  await requireAdmin(c);
  return { partners: await db.select().from(partners).orderBy(desc(partners.createdAt)) };
});
