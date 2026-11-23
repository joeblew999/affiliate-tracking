// The control plane: one room per viewer (a person's user id, or "admins"), holding their actions
// and the steps each caused, in both apps (packages/activity). A page connecting gets them all,
// then each change as the work reports it. Here in the shop because the shop has the users:
// Void auth gives each connection its signed-in user, the affiliate service's pages included (its
// address is in auth.ts's trustedOrigins).
import { defineRoom } from "void/ws";
import { ActivityEvent, apply, ClientMessage, kept, ServerMessage, type Action } from "activity";

/**
 * Everyone may watch their own room. An admin may watch any: the one with everyone's actions, and
 * a person's own (as while viewing the program as them, when the session switches between the two).
 */
function mayWatch(viewer: string, user: { id: string; role?: string | null } | null) {
  if (!user) return false;
  return viewer === user.id || user.role === "admin";
}

async function load(storage: DurableObjectStorage): Promise<Map<string, Action>> {
  const saved = (await storage.get<Action[]>("actions")) ?? [];
  return new Map(saved.map((a) => [a.id, a]));
}

export default defineRoom({
  messages: { client: ClientMessage, server: ServerMessage },
  onBeforeConnect(ctx) {
    if (!mayWatch(String(ctx.params.viewer), ctx.user))
      return new Response("Not yours to watch", { status: 403 });
  },
  async onConnect(ctx) {
    await ctx.connection.send({ type: "snapshot", actions: kept(await load(ctx.storage)) });
  },
  actions: {
    /** One event from the work: the action it's about updated, saved, and sent to every page. */
    async record(ctx, event: ActivityEvent) {
      const actions = await load(ctx.storage);
      const action = apply(actions, ActivityEvent.parse(event));
      await ctx.storage.put("actions", kept(actions));
      await ctx.room.broadcast({ type: "action", action });
    },
  },
});
