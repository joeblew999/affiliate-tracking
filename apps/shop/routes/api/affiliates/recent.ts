// The affiliate service, making one of its pages: the viewer's latest activity, for the page's
// Activity pane to start with (src/streams.ts).
import { defineHandler } from "void";
import { recent } from "../../../src/streams.ts";

export const GET = defineHandler((c) => recent(c.req.query("viewer") ?? ""));
