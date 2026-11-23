// An event's page: what, when and where, and Buy ticket (Stripe's Checkout), or that you have one.
import { action, Link } from "@void/react";
import { useState } from "react";
import { Button } from "../../src/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../../src/components/ui/card.tsx";
import type { Props } from "./[id].server.ts";

export default function Event({ event, signedIn, payments, hasTicket }: Props) {
  const [busy, setBusy] = useState(false);
  const buy = () => {
    setBusy(true);
    void action("/events/[id]?buy", { params: { id: event.id } }).finally(() => setBusy(false));
  };
  return (
    <main className="flex min-h-svh items-start justify-center bg-muted/40 px-4 py-10 sm:items-center">
      <div className="w-full max-w-sm space-y-4">
        <Link href="/" className="text-sm text-muted-foreground">
          All events
        </Link>
        <Card>
          <CardHeader>
            <CardTitle>
              <h1 className="text-xl font-semibold">{event.name}</h1>
            </CardTitle>
            <CardDescription>{event.when}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>{event.description}</p>
            <p className="text-muted-foreground">{event.location}</p>
          </CardContent>
          <CardFooter className="flex flex-col items-stretch gap-2">
            {hasTicket ? (
              <p className="text-sm font-medium">You have a ticket.</p>
            ) : event.soldOut ? (
              <p className="text-sm font-medium">Sold out.</p>
            ) : !payments ? (
              <p className="text-sm text-muted-foreground">
                This shop isn't taking payments: it has no Stripe key.
              </p>
            ) : !signedIn ? (
              <Button nativeButton={false} render={<Link href="/" />}>
                Sign in to buy a ticket
              </Button>
            ) : (
              <Button disabled={busy} onClick={buy}>
                Buy ticket, {event.price}
              </Button>
            )}
          </CardFooter>
        </Card>
      </div>
    </main>
  );
}
