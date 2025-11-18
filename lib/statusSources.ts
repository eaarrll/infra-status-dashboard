// lib/statusSources.ts

export type StatusLevel =
  | "operational"
  | "degraded"
  | "partial_outage"
  | "major_outage"
  | "unknown";

export interface StatusItem {
  title: string;
  date?: string;
  link?: string;
}

export interface StatusSummary {
  id: string;
  name: string;
  status: StatusLevel;
  detailUrl?: string;
  lastUpdated?: string;
  message?: string;
  latestItems?: StatusItem[]; // <-- extra details to show on the card
}

function inferStatusFromText(text: string): StatusLevel {
  const lower = text.toLowerCase();

  if (lower.includes("outage") || lower.includes("major") || lower.includes("down")) {
    return "major_outage";
  }
  if (
    lower.includes("partial") ||
    lower.includes("degraded") ||
    lower.includes("incident") ||
    lower.includes("maintenance")
  ) {
    return "degraded";
  }
  return "operational";
}

async function getRssStatus(
  id: string,
  name: string,
  url: string,
  detailUrl?: string
): Promise<StatusSummary> {
  try {
    const res = await fetch(url, { next: { revalidate: 60 } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();

    // grab first 3 <item> blocks
    const itemBlocks = [...xml.matchAll(/<item>[\s\S]*?<\/item>/gi)].map(
      (m) => m[0]
    );
    const firstItem = itemBlocks[0] ?? "";

    const titleMatch = firstItem.match(/<title>([^<]*)<\/title>/i);
    const descrMatch = firstItem.match(/<description>([\s\S]*?)<\/description>/i);
    const pubDateMatch = firstItem.match(/<pubDate>([^<]*)<\/pubDate>/i);

    const itemTitle = titleMatch?.[1]?.trim() ?? "";
    const itemDesc = descrMatch?.[1]?.trim() ?? "";
    const lastUpdated = pubDateMatch?.[1]?.trim();

    const textForStatus = `${itemTitle} ${itemDesc}`;
    const status = textForStatus ? inferStatusFromText(textForStatus) : "operational";

    const latestItems = itemBlocks.slice(0, 3).map((block) => {
      const t = block.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() ?? "";
      const d = block
        .match(/<description>([\s\S]*?)<\/description>/i)?.[1]
        ?.trim();
      const date = block.match(/<pubDate>([^<]*)<\/pubDate>/i)?.[1]?.trim();
      const link = block.match(/<link>([^<]*)<\/link>/i)?.[1]?.trim();

      return {
        title: t || d || "No title",
        date,
        link,
      };
    });

    return {
      id,
      name,
      status,
      detailUrl: detailUrl ?? url,
      lastUpdated,
      message: itemTitle || itemDesc || "No recent items in feed",
      latestItems,
    };
  } catch (err) {
    console.error(`RSS status fetch failed for ${name}`, err);
    return {
      id,
      name,
      status: "unknown",
      detailUrl: detailUrl ?? url,
      message: "Unable to fetch status",
    };
  }
}

function mapCloudflareIndicator(indicator?: string | null): StatusLevel {
  switch (indicator) {
    case "none":
      return "operational";
    case "minor":
      return "degraded";
    case "major":
    case "critical":
      return "major_outage";
    default:
      return "unknown";
  }
}

export async function getCloudflareStatus(): Promise<StatusSummary> {
  const url = "https://www.cloudflarestatus.com/api/v2/summary.json";

  try {
    const res = await fetch(url, { next: { revalidate: 60 } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const indicator = data?.status?.indicator as string | undefined;
    const status = mapCloudflareIndicator(indicator);

    const incidents = (data?.incidents ?? []) as any[];

    const latestItems: StatusItem[] = incidents.slice(0, 3).map((incident) => ({
      title: incident.name ?? "Incident",
      date: incident.started_at ?? incident.created_at,
      link:
        incident.shortlink ??
        incident.url ??
        "https://www.cloudflarestatus.com",
    }));

    return {
      id: "cloudflare",
      name: "Cloudflare",
      status,
      detailUrl: "https://www.cloudflarestatus.com",
      lastUpdated: data?.page?.updated_at,
      message: data?.status?.description,
      latestItems: latestItems.length ? latestItems : undefined,
    };
  } catch (err) {
    console.error("Cloudflare status fetch failed", err);
    return {
      id: "cloudflare",
      name: "Cloudflare",
      status: "unknown",
      detailUrl: "https://www.cloudflarestatus.com",
      message: "Unable to fetch status",
    };
  }
}

export async function getAwsHealthStatus(): Promise<StatusSummary> {
  const url = "https://health.aws.amazon.com/health/status";

  try {
    const res = await fetch(url, { next: { revalidate: 60 } });
    const ok = res.ok;
    const now = new Date().toISOString();

    return {
      id: "aws-health",
      name: "AWS Health",
      status: ok ? "operational" : "major_outage",
      detailUrl: url,
      lastUpdated: now,
      message: ok
        ? "Status page reachable (HTTP 200)"
        : `Status page error (HTTP ${res.status})`,
      latestItems: [
        {
          title: ok
            ? "Status page reachable (HTTP 200)"
            : `Status page error (HTTP ${res.status})`,
          date: now,
          link: url,
        },
      ],
    };
  } catch (err) {
    console.error("AWS Health status fetch failed", err);
    const now = new Date().toISOString();
    return {
      id: "aws-health",
      name: "AWS Health",
      status: "unknown",
      detailUrl: url,
      lastUpdated: now,
      message: "Unable to fetch status",
      latestItems: [
        {
          title: "Unable to reach status page",
          date: now,
          link: url,
        },
      ],
    };
  }
}

export function getVercelStatus(): Promise<StatusSummary> {
  return getRssStatus(
    "vercel",
    "Vercel",
    "https://www.vercel-status.com/history.rss",
    "https://www.vercel-status.com"
  );
}

export function getContentfulStatus(): Promise<StatusSummary> {
  return getRssStatus(
    "contentful",
    "Contentful",
    "https://www.contentfulstatus.com/history.rss",
    "https://www.contentfulstatus.com"
  );
}

export function getJiraStatus(): Promise<StatusSummary> {
  return getRssStatus(
    "jira",
    "Jira Software",
    "https://jira-software.status.atlassian.com/history.rss",
    "https://jira-software.status.atlassian.com/"
  );
}

export function getConfluenceStatus(): Promise<StatusSummary> {
  return getRssStatus(
    "confluence",
    "Confluence",
    "https://confluence.status.atlassian.com/history.rss",
    "https://confluence.status.atlassian.com/"
  );
}

export async function getAllStatuses(): Promise<StatusSummary[]> {
  return Promise.all([
    getAwsHealthStatus(),
    getCloudflareStatus(),
    getVercelStatus(),
    getContentfulStatus(),
    getJiraStatus(),
    getConfluenceStatus(),
  ]);
}
