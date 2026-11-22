import { defineHandler, type InferProps } from "void";
import { currentUser } from "@/user";

export const loader = defineHandler(async (c) => ({ user: await currentUser(c) }));
export type Props = InferProps<typeof loader>;
