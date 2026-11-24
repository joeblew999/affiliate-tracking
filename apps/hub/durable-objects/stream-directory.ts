// Which subscriptions follow which streams (packages/streams).
import { defineDurableState } from "void/durable";
import { directoryState } from "streams";

export const Directory = defineDurableState(directoryState);
export default Directory;
