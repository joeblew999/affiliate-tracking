// The shop's Better Auth at this app's /api/auth: every call the pages make with Better Auth's
// client (src/auth-client.ts: the session, the admin plugin's "View as" and its stop, sign out) goes
// to the shop through the binding, on this page's own origin.
import { defineHandler } from "void";
import { toShop } from "@/user";

const shop = defineHandler((c) => toShop(c));
export const GET = shop;
export const POST = shop;
