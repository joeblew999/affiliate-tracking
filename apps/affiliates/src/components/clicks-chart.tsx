// Clicks per day as bars, with each day's count on hover.
export function ClicksChart({ days }: { days: { date: string; clicks: number }[] }) {
  const max = Math.max(1, ...days.map((d) => d.clicks));
  const width = 600 / Math.max(1, days.length);
  return (
    <svg
      role="img"
      aria-label="Clicks per day"
      viewBox="0 0 600 120"
      preserveAspectRatio="none"
      className="h-32 w-full"
    >
      {days.map((d, i) => {
        const height = Math.round((d.clicks / max) * 110);
        return (
          <rect
            key={d.date}
            x={i * width + 1}
            width={Math.max(1, width - 2)}
            y={120 - height}
            height={height}
            className="fill-primary"
          >
            <title>{`${d.date}: ${d.clicks} clicks`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

export function TopList({
  title,
  rows,
}: {
  title: string;
  rows: { value: string; clicks: number }[];
}) {
  return (
    <div className="rounded-lg border p-4">
      <h3 className="mb-2 text-sm text-muted-foreground">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No clicks yet</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {rows.map((row) => (
            <li key={row.value} className="flex justify-between">
              <span>{row.value}</span>
              <span className="tabular-nums">{row.clicks}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
