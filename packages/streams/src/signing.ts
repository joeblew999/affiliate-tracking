// The server's signing key (keys.ts): made the first time it's asked for, and kept. One object,
// named "signing". Void's durable state, for an app's `durable-objects/`.
import type { DurableStateContext, DurableStateDefinition } from "void/durable";
import { newSigningKey, type SigningKey } from "./keys.ts";

type State = { key: SigningKey | null };
type Context = DurableStateContext<State, Record<string, unknown>>;

const methods = {
  /** The key wakes are signed with. Its private half stays on the server. */
  async key(context: Context): Promise<SigningKey> {
    context.state.key ??= await newSigningKey();
    return context.state.key;
  },
};

export type SigningMethods = typeof methods;

export const signingState: DurableStateDefinition<
  State,
  Record<string, unknown>,
  SigningMethods
> = {
  initialState: { key: null },
  methods,
};
