// Stop event emails: one button, from the link in an email.
import { Form, useForm } from "@void/react";
import { Button } from "../src/components/ui/button.tsx";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../src/components/ui/card.tsx";
import type { Props } from "./unsubscribe.server.ts";

export default function Unsubscribe({ u, s, valid, stopped }: Props) {
  const stop = useForm("/unsubscribe?stop", { u, s }, { throwOnError: false });
  return (
    <main className="flex min-h-svh items-start justify-center bg-muted/40 px-4 py-10 sm:items-center">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>
            <h1 className="text-xl font-semibold">Event emails</h1>
          </CardTitle>
          <CardDescription>
            {stopped
              ? "Done: you won't get emails about new events any more."
              : !valid
                ? "That link isn't complete. Use the one in the email."
                : "Stop getting an email each time an event goes on sale?"}
          </CardDescription>
        </CardHeader>
        {valid && !stopped && (
          <CardFooter>
            <Form form={stop} className="w-full">
              <Button type="submit" className="w-full" disabled={stop.pending}>
                Stop event emails
              </Button>
            </Form>
          </CardFooter>
        )}
      </Card>
    </main>
  );
}
