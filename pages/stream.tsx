// One stream (stream.server.ts): its events, newest first, with each new one as it's written.
import { stream } from "@durable-streams/client";
import { Link } from "@void/react";
import { useEffect, useState } from "react";
import { Badge } from "../src/components/ui/badge.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../src/components/ui/card.tsx";
import type { Props } from "./stream.server.ts";

/** An event as the hub's envelope has it (bus.ts), if it is one. */
function parts(event: unknown) {
  const e = (event ?? {}) as { id?: unknown; type?: unknown; causedBy?: unknown; data?: unknown };
  return typeof e.type === "string" && typeof e.id === "string"
    ? {
        type: e.type,
        id: e.id,
        causedBy: typeof e.causedBy === "string" ? e.causedBy : null,
        data: e.data,
      }
    : null;
}

export default function Stream({ organization, name, json, events, offset }: Props) {
  const [all, setAll] = useState(events);
  const [live, setLive] = useState(false);
  useEffect(() => {
    if (!json) return;
    const stop = new AbortController();
    void stream<unknown>({
      url: new URL(`/console/tail/${organization.id}/${name}`, location.origin).href,
      offset,
      live: "sse",
      signal: stop.signal,
    })
      .then((reading) => {
        setLive(true);
        reading.subscribeJson((batch) => setAll((before) => [...before, ...batch.items]));
      })
      .catch(() => setLive(false));
    return () => stop.abort();
  }, [organization.id, name, json, offset]);

  return (
    <div className="grid gap-6">
      <Link
        href={`/?org=${organization.slug}`}
        className="text-sm underline-offset-4 hover:underline"
      >
        ← {organization.name}
      </Link>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {name} {live && <Badge variant="secondary">live</Badge>}
          </CardTitle>
          <CardDescription>
            {json
              ? `${all.length} events, newest first.`
              : "A binary stream: its events aren't shown."}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {all
            .map((event, index) => ({ event, index }))
            .reverse()
            .map(({ event, index }) => {
              const known = parts(event);
              return (
                <div key={index} className="rounded-lg border p-3 text-sm">
                  {known && (
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Badge>{known.type}</Badge>
                      <code className="text-xs text-muted-foreground">{known.id}</code>
                      {known.causedBy && (
                        <span className="text-xs text-muted-foreground">
                          caused by <code>{known.causedBy}</code>
                        </span>
                      )}
                    </div>
                  )}
                  <pre className="overflow-x-auto text-xs">
                    {JSON.stringify(known ? known.data : event, null, 2)}
                  </pre>
                </div>
              );
            })}
        </CardContent>
      </Card>
    </div>
  );
}
