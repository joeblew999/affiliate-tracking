// Clicks per day as bars (each day's count on hover), and the top countries, devices or sites.
import { date } from "../format.ts";

export function ClicksChart({ days }: { days: { date: string; clicks: number }[] }) {
  const max = Math.max(1, ...days.map((d) => d.clicks));
  const first = days[0]?.date;
  const last = days.at(-1)?.date;
  return (
    <figure>
      <div
        role="img"
        aria-label="Clicks per day"
        className="flex h-28 items-end gap-[3px] border-b border-foreground/15"
      >
        {days.map((d) => (
          <div
            key={d.date}
            title={`${date(Date.parse(d.date))}: ${d.clicks} clicks`}
            className={
              d.clicks
                ? "min-h-1 flex-1 rounded-t-[3px] bg-primary"
                : "h-px flex-1 bg-foreground/10"
            }
            style={d.clicks ? { height: `${(d.clicks / max) * 100}%` } : undefined}
          />
        ))}
      </div>
      {first && last && (
        <figcaption className="mt-1.5 flex justify-between text-xs text-muted-foreground">
          <span>{date(Date.parse(first))}</span>
          <span>Most in a day: {max}</span>
          <span>Today</span>
        </figcaption>
      )}
    </figure>
  );
}

export function TopList({
  title,
  rows,
}: {
  title: string;
  rows: { value: string; clicks: number }[];
}) {
  const max = Math.max(1, ...rows.map((r) => r.clicks));
  return (
    <div>
      <h3 className="mb-2 text-sm font-medium">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No clicks yet</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {rows.map((row) => (
            <li key={row.value} className="relative flex justify-between rounded px-2 py-1">
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 rounded bg-muted"
                style={{ width: `${(row.clicks / max) * 100}%` }}
              />
              <span className="relative truncate">{row.value}</span>
              <span className="relative tabular-nums">{row.clicks}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
