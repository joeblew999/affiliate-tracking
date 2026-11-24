// Places marked in a stream as it was written (src/streams.ts): the stream's end just before each
// of the last few marked events. A stream only grows, and a reader that wants the latest of it,
// not all there ever was, reads from the oldest of these marks. One object per stream.
import { defineDurableState } from "void/durable";

/** How many marks back a reader starts. */
const KEPT = 30;

export const Marks = defineDurableState({
  initialState: { offsets: [] as string[] },
  methods: {
    /** A marked event is about to be added, with the stream ending at `offset`. */
    mark(context, offset: string) {
      context.state.offsets = [...context.state.offsets, offset].slice(-KEPT);
    },
    /** Where to read from: the oldest mark kept, or the stream's start. */
    from(context) {
      return context.state.offsets[0] ?? "-1";
    },
  },
});
export default Marks;
