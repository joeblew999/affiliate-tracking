// The affiliate service, for code that runs outside a route (auth.ts's hooks): through Cloudflare's
// own `env` from "cloudflare:workers", typed by the bindings Void generates (.void/bindings.d.ts).
import { env } from "cloudflare:workers";
import { env as vars } from "void/env";
import { affiliates } from "affiliates/client";

declare global {
  namespace Cloudflare {
    interface Env extends VoidGeneratedEnvBindings {}
  }
}

export function affiliatesService() {
  return affiliates(env.AFFILIATES, vars.AFFILIATES_HOST_TOKEN);
}
