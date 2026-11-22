// The usual "is the D1 binding there" check, as a type guard: after it, env.DB
// is known to be set.
import type { AffiliateEnv, DbEnv } from './types.ts';

export function hasDb(env: AffiliateEnv): env is DbEnv {
    return Boolean(env.DB);
}
