// lib/statusSources.ts

// ─────────────────────────────
// TYPES & SHARED HELPERS
// ─────────────────────────────

export type StatusLevel = "operational" | "degraded" | "major_outage";

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
  latestItems?: StatusItem[];
}

// Use this in the main UI as subtitle / description
export const DASHBOARD_DESCRIPTION =
  "Infra status dashboard monitoring: AWS Health (global, us-east-2), Cloudflare, Datadog EU, GitHub, Boomi, Cybersource, commercetools, Ordergroove, Vercel, Contentful, Jira Software, and Confluence.";

/**
 * Strip HTML / CDATA and normalize whitespace.
 */
function stripHtml(input: string): string {
  if (!input) return "";
  return input
    .replace(/<!\[CDATA\[/g, "")
    .replace(/\]\]>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Truncate to max length with ellipsis.
 */
function truncate(input: string, max: number): string {
  if (!input) return "";
  if (input.length <= max) return input;
  return input.slice(0, max - 1).trimEnd() + "…";
}

/**
 * Infer status from a text blob (RSS title + description).
 * We NEVER return "unknown".
 */
function inferStatusFromText(text: string): StatusLevel {
  const lower = (text || "").toLowerCase();

  if (!lower) {
    // if feed is empty but reachable, be optimistic
    return "operational";
  }

  // Strong "red" signals
  if (
    lower.includes("major outage") ||
    lower.includes("critical") ||
    lower.includes("unavailable") ||
    lower.includes("service disruption") ||
    lower.includes("downtime") ||
    lower.includes("outage")
  ) {
    return "major_outage";
  }

  // Amber / degraded signals
  if (
    lower.includes("partial") ||
    lower.includes("degraded") ||
    lower.includes("degradation") ||
    lower.includes("incident") ||
    lower.includes("maintenance") ||
    lower.includes("investigating") ||
    lower.includes("monitoring")
  ) {
    return "degraded";
  }

  // Explicit green-ish phrases
  if (
    lower.includes("resolved") ||
    lower.includes("operational") ||
    lower.includes("normal") ||
    lower.includes("all systems")
  ) {
    return "operational";
  }

  // Default: operational (no "unknown")
  return "operational";
}

/**
 * Generic RSS-based status fetcher with trimmed text.
 */
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

    const titleMatch = firstItem.match(/<title>([\s\S]*?)<\/title>/i);
    const descrMatch = firstItem.match(
      /<description>([\s\S]*?)<\/description>/i
    );
    const pubDateMatch = firstItem.match(/<pubDate>([^<]*)<\/pubDate>/i);

    const rawTitle = titleMatch?.[1] ?? "";
    const rawDesc = descrMatch?.[1] ?? "";

    const plainTitle = stripHtml(rawTitle);
    const plainDesc = stripHtml(rawDesc);
    const lastUpdated = pubDateMatch?.[1]?.trim();

    const combinedPlain = (plainTitle + " " + plainDesc).trim();
    const status = inferStatusFromText(combinedPlain);

    const latestItems: StatusItem[] = itemBlocks.slice(0, 3).map((block) => {
      const rawItemTitle =
        block.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "";
      const rawItemDesc =
        block.match(/<description>([\s\S]*?)<\/description>/i)?.[1] ?? "";
      const date = block.match(/<pubDate>([^<]*)<\/pubDate>/i)?.[1]?.trim();
      const link = block.match(/<link>([^<]*)<\/link>/i)?.[1]?.trim();

      const plain = stripHtml(rawItemTitle || rawItemDesc || "No title");

      return {
        title: truncate(plain, 120),
        date,
        link,
      };
    });

    const messageSource =
      combinedPlain || plainTitle || plainDesc || "No recent items in feed";
    const message = truncate(messageSource, 260);

    return {
      id,
      name,
      status,
      detailUrl: detailUrl ?? url,
      lastUpdated,
      message,
      latestItems: latestItems.length ? latestItems : undefined,
    };
  } catch (err) {
    console.error(`RSS status fetch failed for ${name}`, err);

    // If we can't even read the feed, treat as "degraded" (definite)
    const now = new Date().toISOString();
    return {
      id,
      name,
      status: "degraded",
      detailUrl: detailUrl ?? url,
      lastUpdated: now,
      message: "Unable to fetch status feed",
      latestItems: [
        {
          title: "Unable to fetch status feed",
          date: now,
          link: detailUrl ?? url,
        },
      ],
    };
  }
}

/**
 * Map Statuspage indicator -> StatusLevel.
 * No "unknown": default → "degraded".
 */
function mapStatuspageIndicator(indicator?: string | null): StatusLevel {
  switch (indicator) {
    case "none":
      return "operational";
    case "minor":
      return "degraded";
    case "major":
    case "critical":
      return "major_outage";
    default:
      // If they add new indicators we don't know, treat as degraded
      return "degraded";
  }
}

/**
 * Generic "simple HTTP ping" status (for endpoints that don't expose
 * a proper status JSON but where reachability already tells us a lot).
 */
async function getSimpleHttpStatus(
  id: string,
  name: string,
  url: string
): Promise<StatusSummary> {
  try {
    const res = await fetch(url, { next: { revalidate: 60 } });
    const now = new Date().toISOString();
    const ok = res.ok;

    const status: StatusLevel = ok
      ? "operational"
      : res.status >= 500
      ? "major_outage"
      : "degraded";

    const msg = ok
      ? `Endpoint reachable (HTTP ${res.status})`
      : `Endpoint error (HTTP ${res.status})`;

    return {
      id,
      name,
      status,
      detailUrl: url,
      lastUpdated: now,
      message: msg,
      latestItems: [
        {
          title: msg,
          date: now,
          link: url,
        },
      ],
    };
  } catch (err) {
    console.error(`${name} simple HTTP status check failed`, err);
    const now = new Date().toISOString();
    return {
      id,
      name,
      status: "degraded",
      detailUrl: url,
      lastUpdated: now,
      message: "Unable to reach endpoint",
      latestItems: [
        {
          title: "Unable to reach endpoint",
          date: now,
          link: url,
        },
      ],
    };
  }
}

/**
 * Generic Statuspage `/api/v2/status.json` consumer (no incidents list).
 */
async function getStatuspageStatus(
  id: string,
  name: string,
  url: string,
  detailUrl: string
): Promise<StatusSummary> {
  try {
    const res = await fetch(url, { next: { revalidate: 60 } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const indicator = data?.status?.indicator as string | undefined;
    const status = mapStatuspageIndicator(indicator);
    const description = data?.status?.description as string | undefined;
    const updatedAt = data?.page?.updated_at as string | undefined;

    return {
      id,
      name,
      status,
      detailUrl,
      lastUpdated: updatedAt,
      message: description,
    };
  } catch (err) {
    console.error(`${name} status fetch failed`, err);
    const now = new Date().toISOString();
    return {
      id,
      name,
      status: "degraded",
      detailUrl,
      lastUpdated: now,
      message: "Unable to fetch status",
      latestItems: [
        {
          title: `Unable to fetch ${name} status`,
          date: now,
          link: detailUrl,
        },
      ],
    };
  }
}

// ─────────────────────────────
// PROVIDERS
// ─────────────────────────────

// CLOUDFLARE → /api/v2/status.json (Statuspage)
export async function getCloudflareStatus(): Promise<StatusSummary> {
  return getStatuspageStatus(
    "cloudflare",
    "Cloudflare",
    "https://www.cloudflarestatus.com/api/v2/status.json",
    "https://www.cloudflarestatus.com"
  );
}

// AWS HEALTH (global + us-east-2)
export async function getAwsHealthStatus(): Promise<StatusSummary> {
  return getSimpleHttpStatus(
    "aws-health",
    "AWS Health",
    "https://health.aws.amazon.com/health/status"
  );
}

export async function getAwsHealthUsEast2Status(): Promise<StatusSummary> {
  return getSimpleHttpStatus(
    "aws-health-us-east-2",
    "AWS Health (us-east-2)",
    "https://health.aws.amazon.com/health/status?region=us-east-2"
  );
}

// VERCEL → /api/v2/status.json (Statuspage)
export function getVercelStatus(): Promise<StatusSummary> {
  return getStatuspageStatus(
    "vercel",
    "Vercel",
    "https://www.vercel-status.com/api/v2/status.json",
    "https://www.vercel-status.com"
  );
}

// CONTENTFUL → /api/v2/status.json (Statuspage)
export function getContentfulStatus(): Promise<StatusSummary> {
  return getStatuspageStatus(
    "contentful",
    "Contentful",
    "https://www.contentfulstatus.com/api/v2/status.json",
    "https://www.contentfulstatus.com"
  );
}

// JIRA → /api/v2/status.json (Statuspage)
export function getJiraStatus(): Promise<StatusSummary> {
  return getStatuspageStatus(
    "jira",
    "Jira Software",
    "https://jira-software.status.atlassian.com/api/v2/status.json",
    "https://jira-software.status.atlassian.com/"
  );
}

// CONFLUENCE → /api/v2/status.json (Statuspage)
export function getConfluenceStatus(): Promise<StatusSummary> {
  return getStatuspageStatus(
    "confluence",
    "Confluence",
    "https://confluence.status.atlassian.com/api/v2/status.json",
    "https://confluence.status.atlassian.com/"
  );
}

// CYBERSOURCE (Statuspage summary JSON)
export async function getCybersourceStatus(): Promise<StatusSummary> {
  const url = "https://status.cybersource.com/api/v2/status.json";

  try {
    const res = await fetch(url, { next: { revalidate: 60 } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const indicator = data?.status?.indicator as string | undefined;
    const status = mapStatuspageIndicator(indicator);

    const incidents = (data?.incidents ?? []) as any[];

    const latestItems: StatusItem[] = incidents.slice(0, 3).map((incident) => ({
      title: incident.name ?? "Incident",
      date: incident.started_at ?? incident.created_at,
      link:
        incident.shortlink ?? incident.url ?? "https://status.cybersource.com",
    }));

    return {
      id: "cybersource",
      name: "Cybersource",
      status,
      detailUrl: "https://status.cybersource.com",
      lastUpdated: data?.page?.updated_at,
      message: data?.status?.description,
      latestItems: latestItems.length ? latestItems : undefined,
    };
  } catch (err) {
    console.error("Cybersource status fetch failed", err);
    const now = new Date().toISOString();
    return {
      id: "cybersource",
      name: "Cybersource",
      status: "degraded",
      detailUrl: "https://status.cybersource.com",
      lastUpdated: now,
      message: "Unable to fetch status",
      latestItems: [
        {
          title: "Unable to fetch Cybersource status",
          date: now,
          link: "https://status.cybersource.com",
        },
      ],
    };
  }
}

// COMMERCETOOLS (RSS)
export function getCommercetoolsStatus(): Promise<StatusSummary> {
  return getRssStatus(
    "commercetools",
    "commercetools",
    "https://status.commercetools.com/pages/56e4295370fe4ece420002bb/rss",
    "https://status.commercetools.com"
  );
}

// ORDERGROOVE (simple HTTP ping to their status API)
export function getOrdergrooveStatus(): Promise<StatusSummary> {
  return getSimpleHttpStatus(
    "ordergroove",
    "Ordergroove",
    "https://status.ordergroove.com/api/v2/status.json"
  );
}

// DATADOG EU (Statuspage /api/v2/status.json)
export function getDatadogEuStatus(): Promise<StatusSummary> {
  return getStatuspageStatus(
    "datadog-eu",
    "Datadog EU",
    "https://status.datadoghq.eu/api/v2/status.json",
    "https://status.datadoghq.eu"
  );
}

// GITHUB (Statuspage /api/v2/status.json)
export function getGithubStatus(): Promise<StatusSummary> {
  return getStatuspageStatus(
    "github",
    "GitHub",
    "https://www.githubstatus.com/api/v2/status.json",
    "https://www.githubstatus.com"
  );
}

// BOOMI (Statuspage /api/v2/status.json)
export function getBoomiStatus(): Promise<StatusSummary> {
  return getStatuspageStatus(
    "boomi",
    "Boomi",
    "https://status.boomi.com/api/v2/status.json",
    "https://status.boomi.com"
  );
}

// ─────────────────────────────
// AGGREGATOR
// ─────────────────────────────

export async function getAllStatuses(): Promise<StatusSummary[]> {
  return Promise.all([
    // AWS
    getAwsHealthStatus(),
    getAwsHealthUsEast2Status(),

    // CDN / infra / monitoring
    getCloudflareStatus(),
    getDatadogEuStatus(),

    // SaaS / tools
    getGithubStatus(),
    getBoomiStatus(),
    getCybersourceStatus(),
    getCommercetoolsStatus(),
    getOrdergrooveStatus(),

    // Dev / hosting / content / Atlassian
    getVercelStatus(),
    getContentfulStatus(),
    getJiraStatus(),
    getConfluenceStatus(),
  ]);
}
