// Where a viewer's latest actions begin in their stream (src/streams.ts): the stream's offset just
// before each of the last few actions started. A stream only grows, and a page shows the latest
// actions, not all there ever were, so it reads from the oldest of these, not from the start.
// One object per viewer.
import { defineDurableState } from "void/durable";

/** How many actions back a page reads. */
const ACTIONS = 30;

export const RecentActions = defineDurableState({
  initialState: { starts: [] as string[] },
  methods: {
    /** An action is about to start, with the stream ending at `offset`. */
    started(context, offset: string) {
      context.state.starts = [...context.state.starts, offset].slice(-ACTIONS);
    },
    /** Where to read from: before the oldest of the latest actions, or the stream's start. */
    from(context) {
      return context.state.starts[0] ?? "-1";
    },
  },
});
export default RecentActions;
