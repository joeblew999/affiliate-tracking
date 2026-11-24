// Which subscriptions follow which streams (src/server).
import { defineDurableState } from "void/durable";
import { directoryState } from "../src/server/index.ts";

export const Directory = defineDurableState(directoryState);
export default Directory;
