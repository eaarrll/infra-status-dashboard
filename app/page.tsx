// app/page.tsx
import {
  getAllStatuses,
  type StatusSummary,
  type StatusLevel,
  DASHBOARD_DESCRIPTION,
} from "@/lib/statusSources";

export const revalidate = 60; // ISR – refresh data every 60 seconds

export default async function HomePage() {
  const statuses = await getAllStatuses();

  return (
    <main className="min-h-screen flex justify-center bg-slate-950 text-slate-100 py-10 px-4">
      <div className="w-full max-w-5xl">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold mb-2">Infra Status Dashboard</h1>
          <p className="text-sm text-slate-400">{DASHBOARD_DESCRIPTION}</p>
        </header>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {statuses.map((s) => (
            <StatusCard key={s.id} summary={s} />
          ))}
        </section>
      </div>
    </main>
  );
}

function StatusCard({ summary }: { summary: StatusSummary }) {
  const badgeClass = getBadgeClass(summary.status);
  const label = getStatusLabel(summary.status);

  return (
    <article className="border border-slate-800 rounded-xl p-4 bg-slate-900/60 backdrop-blur flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">{summary.name}</h2>
        <span className={`text-xs px-2 py-1 rounded-full ${badgeClass}`}>
          {label}
        </span>
      </div>

      {summary.message && (
        <p className="text-xs text-slate-300">{summary.message}</p>
      )}

      {summary.latestItems && summary.latestItems.length > 0 && (
        <ul className="mt-1 space-y-1 text-xs text-slate-200">
          {summary.latestItems.map((item, idx) => (
            <li key={idx}>
              {item.link ? (
                <a
                  href={item.link}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2 hover:no-underline"
                >
                  {item.title}
                </a>
              ) : (
                <span>{item.title}</span>
              )}
              {item.date && (
                <div className="text-[10px] text-slate-400">{item.date}</div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-1 flex items-center justify-between text-[11px] text-slate-400">
        {summary.lastUpdated && (
          <span>Last update: {summary.lastUpdated}</span>
        )}
        {summary.detailUrl && (
          <a
            href={summary.detailUrl}
            target="_blank"
            rel="noreferrer"
            className="underline hover:no-underline"
          >
            View status page
          </a>
        )}
      </div>
    </article>
  );
}

// ---------- helpers for badge + label ----------

function getBadgeClass(status: StatusLevel): string {
  switch (status) {
    case "operational":
      return "bg-emerald-500/15 text-emerald-300 border border-emerald-400/40";
    case "degraded":
      return "bg-amber-500/15 text-amber-300 border border-amber-400/40";
    case "major_outage":
      return "bg-rose-500/15 text-rose-300 border border-rose-400/40";
    default:
      // should never hit; treat anything unexpected as degraded
      return "bg-amber-500/15 text-amber-300 border border-amber-400/40";
  }
}

function getStatusLabel(status: StatusLevel): string {
  switch (status) {
    case "operational":
      return "Operational";
    case "degraded":
      return "Degraded";
    case "major_outage":
      return "Major outage";
    default:
      return "Degraded";
  }
}
