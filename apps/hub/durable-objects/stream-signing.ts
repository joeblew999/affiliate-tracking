// The key the wakes sent to subscribers are signed with (packages/streams).
import { defineDurableState } from "void/durable";
import { signingState } from "streams";

export const Signing = defineDurableState(signingState);
export default Signing;
