// Every request that does something is a step in the control plane (examples/activity): of the
// action the shop sent it for, or a new one by whoever is signed in (middleware/01.user.ts).
import { activityMiddleware } from "activity/server";
import "../src/activity.ts";

export default activityMiddleware((c) => {
  const user = c.get("shopUser");
  return user ? { id: user.id, name: user.name || user.email } : null;
});
