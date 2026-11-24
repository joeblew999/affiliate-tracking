// The key the wakes sent to subscribers are signed with (src/server).
import { defineDurableState } from "void/durable";
import { signingState } from "../src/server/index.ts";

export const Signing = defineDurableState(signingState);
export default Signing;
