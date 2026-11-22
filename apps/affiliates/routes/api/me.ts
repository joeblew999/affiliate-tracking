import { defineHandler } from "void";
import { currentUser } from "@/user";

// Who the host app says is signed in, or null.
export const GET = defineHandler(async (c) => ({ user: await currentUser(c) }));
