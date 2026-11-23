// The key wakes are signed with (packages/streams/src/signing.ts).
import { defineDurableState } from "void/durable";
import { signingState } from "streams";

export const Signing = defineDurableState(signingState);
export default Signing;
