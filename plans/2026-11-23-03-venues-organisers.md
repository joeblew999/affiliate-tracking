# 2026-11-23-03-venues-organisers.md

Events are run at venues, by organisers. The business books a venue for an event and pays the
venue before any ticket is sold. Then everyone is told the event is on sale. Each ticket pays the
organiser a percentage, and the affiliate who owns the buyer theirs. What's left, after the venue,
is the profit. The events are online (2026-11-23): each venue is where an online event is hosted,
with a cost and a number of places.

## Who gets paid, and how

| Who                                    | What                                 | When                          |
| -------------------------------------- | ------------------------------------ | ----------------------------- |
| The venue                              | Its price, in full                   | When the event is booked      |
| The organiser                          | Their percentage of each ticket      | With the payout runs, as now  |
| The affiliate who owns the buyer       | Their percentage of each ticket      | With the payout runs, as now  |

- All three are paid through Stripe Connect, from the payouts account. Each payment's money is
  added from the business's bank first (a top-up), as for affiliates now.
- Both percentages are on the ticket price, not the tax. Neither comes out of the other.
- A refunded ticket takes back the organiser's share as well as the affiliate's, the same way.
- An organiser can't be an affiliate. The service refuses to make one person both.

## The demo

- **3 venues**, each with a name, a price and a number of places: the attendees it takes to fill
  it.
- **3 events**, each at one of the venues, each with an organiser and the organiser's
  percentage.
- **Organisers** are new demo people. Their venue payments and organiser shares are seeded with
  exact amounts, like the rest of `demo.ts`.

## Booking an event, and putting it on sale

1. **The admin books it:** a venue, a date and time, a ticket price, an organiser and their
   percentage.
2. **The venue is paid at once,** through the same queue as payouts: the money is added to the
   payouts account, then transferred to the venue's Stripe account. The event can't be sold
   until the venue's payment has gone. If it fails, it's retried, and the admin sees why.
3. **Once the venue is paid, the event goes on sale,** and every shop user is sent an email
   saying so (Void's email). The emails are sent through a queue in batches, so a big list never
   stops halfway. Each email has a link to stop them.

## Knowing when it's in profit

The admin page shows, for each event:
- tickets sold, out of the venue's places;
- money in: the tickets, not counting tax;
- money out: the venue, the organiser's shares, the affiliates' shares;
- profit so far;
- **tickets still to sell to break even.** Before any are sold, this is worked out from the full
  ticket price less the organiser's percentage. After that, it uses what each ticket has actually
  netted so far, since only some buyers come through affiliates.

## Where things live

- **The service (`apps/affiliates`) pays everyone:** affiliates, organisers and venues. Each is
  a payee with a Stripe Connect account, and it has the payout queue, the top-ups and the
  refunds. Organisers and venues are new kinds of payee beside partners. Organiser shares are
  credited on each sale, as affiliate commission is.
- **The shop (`apps/shop`) has the venues and events** (its first own tables), the ticket
  checkout, and the emails to its users. It tells the service about each event through its
  client, as it already does for sign-ups and checkouts: the event, its organiser and share, and
  its venue and price. It asks the service whether the venue is paid before it opens sales.

## Tests

- **Dev:**
  - booking an event pays its venue (a manual payment without Stripe), and only then opens
    sales and sends the emails (Void's email testing);
  - a ticket credits both the organiser and the affiliate, with exact amounts;
  - a refund takes back both;
  - the admin page's profit and break-even figures for a seeded event match `demo.ts`;
  - an organiser can't apply as an affiliate.
- **Stripe:** a venue paid by a real top-up and transfer in test mode, once a venue has gone
  through Stripe's onboarding in a test (the step carried from the last plan).

## Still open

- **If any venue is a physical place people attend,** Managed Payments doesn't cover that
  event's tickets (docs.stripe.com/payments/managed-payments/eligibility, read 2026-11-23).
  Those would need Stripe Tax instead.
