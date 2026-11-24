// The columns every table starts with (db/schema.ts says why these).
import { integer, text } from "void/schema-d1";
import { now as clock } from "../../src/clock.ts";

/** A random UUID key. */
export const id = () =>
  text()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

/** When the row was made: milliseconds since 1970, by the service's clock (src/clock.ts). */
export const now = () =>
  integer()
    .notNull()
    .$defaultFn(() => clock());
