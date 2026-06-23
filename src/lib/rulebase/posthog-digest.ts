/**
 * Daily PostHog usage digest — external users only, Beam app only.
 * Queries yesterday's events, summarizes with Claude, posts to Slack.
 */

import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";

// ── Config ──────────────────────────────────────────────────────────────

const POSTHOG_API_KEY = process.env.POSTHOG_API_KEY;
const POSTHOG_PROJECT_ID = process.env.POSTHOG_PROJECT_ID;
const POSTHOG_HOST =
  process.env.POSTHOG_HOST ||
  process.env.NEXT_PUBLIC_POSTHOG_HOST ||
  "https://us.posthog.com";

const SLACK_WEBHOOK =
  process.env.POSTHOG_SLACK_WEBHOOK_URL || process.env.SLACK_WEBHOOK_URL;

const MODEL_ID = "claude-haiku-4-5-20251001";

// Filter: Beam + main app only, exclude internal rulebase users
const APP_DOMAIN_FILTER = `(properties.$current_url LIKE '%beam.rulebase.co%' OR properties.$current_url LIKE '%eu.beam.rulebase.co%' OR properties.$current_url LIKE '%app.rulebase.co%' OR properties.$current_url LIKE '%eu.app.rulebase.co%')`;
const EXCLUDE_INTERNAL = `(person.properties.email NOT LIKE '%@rulebase.co' OR person.properties.email IS NULL)`;

// ── Types ───────────────────────────────────────────────────────────────

interface HogQLResult {
  columns: string[];
  results: unknown[][];
}

interface QueryResult {
  label: string;
  data: Record<string, unknown>[];
  error?: string;
}

// ── HogQL query helper ─────────────────────────────────────────────────

async function hogqlQuery(query: string): Promise<HogQLResult> {
  const res = await fetch(
    `${POSTHOG_HOST}/api/projects/${POSTHOG_PROJECT_ID}/query/`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${POSTHOG_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: { kind: "HogQLQuery", query },
      }),
    },
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`PostHog query failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  return { columns: data.columns ?? [], results: data.results ?? [] };
}

function rowsToObjects(result: HogQLResult): Record<string, unknown>[] {
  return result.results.map((row) =>
    Object.fromEntries(result.columns.map((col, i) => [col, row[i]])),
  );
}

async function safeQuery(label: string, query: string): Promise<QueryResult> {
  try {
    const result = await hogqlQuery(query);
    return { label, data: rowsToObjects(result) };
  } catch (e) {
    return {
      label,
      data: [],
      error: e instanceof Error ? e.message : "Unknown error",
    };
  }
}

// ── Queries ─────────────────────────────────────────────────────────────

function queryActiveUsers(): Promise<QueryResult> {
  return safeQuery(
    "Active Users",
    `SELECT
      person.properties.email as email,
      domain(person.properties.email) as org,
      count() as events,
      countIf(event = '$pageview') as pageviews,
      dateDiff('second', min(timestamp), max(timestamp)) as session_seconds,
      toString(min(timestamp)) as first_seen,
      toString(max(timestamp)) as last_seen
    FROM events
    WHERE toDate(timestamp) = today() - interval 1 day
      AND ${APP_DOMAIN_FILTER}
      AND ${EXCLUDE_INTERNAL}
      AND person_id != ''
    GROUP BY person_id, email, org
    ORDER BY events DESC
    LIMIT 30`,
  );
}

function queryPageViews(): Promise<QueryResult> {
  return safeQuery(
    "Pages",
    `SELECT
      replaceRegexpAll(properties.$current_url, '\\\\?.*', '') as page,
      count() as views,
      count(distinct person_id) as users
    FROM events
    WHERE event = '$pageview'
      AND toDate(timestamp) = today() - interval 1 day
      AND ${APP_DOMAIN_FILTER}
      AND ${EXCLUDE_INTERNAL}
    GROUP BY page
    ORDER BY views DESC
    LIMIT 20`,
  );
}

function queryRageClicks(): Promise<QueryResult> {
  return safeQuery(
    "Rage Clicks",
    `SELECT
      coalesce(person.properties.email, person.properties.$initial_referrer, distinct_id) as user,
      domain(person.properties.email) as org,
      replaceRegexpAll(properties.$current_url, '\\\\?.*', '') as page,
      properties.$el_text as element,
      toString(timestamp) as time,
      properties.$session_id as session_id,
      concat('${POSTHOG_HOST}/project/${POSTHOG_PROJECT_ID}/replay/', properties.$session_id) as recording_url
    FROM events
    WHERE event = '$rageclick'
      AND toDate(timestamp) = today() - interval 1 day
      AND ${APP_DOMAIN_FILTER}
      AND ${EXCLUDE_INTERNAL}
    ORDER BY timestamp DESC
    LIMIT 20`,
  );
}

function queryExceptions(): Promise<QueryResult> {
  return safeQuery(
    "Errors",
    `SELECT
      properties.$exception_message as error,
      properties.$exception_type as type,
      replaceRegexpAll(properties.$current_url, '\\\\?.*', '') as page,
      coalesce(person.properties.email, distinct_id) as user,
      toString(timestamp) as time,
      concat('${POSTHOG_HOST}/project/${POSTHOG_PROJECT_ID}/replay/', properties.$session_id) as recording_url
    FROM events
    WHERE event = '$exception'
      AND toDate(timestamp) = today() - interval 1 day
      AND ${APP_DOMAIN_FILTER}
      AND ${EXCLUDE_INTERNAL}
    ORDER BY timestamp DESC
    LIMIT 20`,
  );
}

function queryTotalUsers(): Promise<QueryResult> {
  return safeQuery(
    "Totals",
    `SELECT
      count(distinct person_id) as total_users,
      count(distinct domain(person.properties.email)) as total_orgs
    FROM events
    WHERE ${APP_DOMAIN_FILTER}
      AND ${EXCLUDE_INTERNAL}
      AND person_id != ''
      AND person.properties.email != ''`,
  );
}

// ── Formatting ──────────────────────────────────────────────────────────

function fmt(result: QueryResult): string {
  if (result.error) return `[Query failed: ${result.error}]`;
  if (result.data.length === 0) return "[No data]";
  return result.data
    .map((row) =>
      Object.entries(row)
        .map(([k, v]) => `${k}: ${v ?? "null"}`)
        .join(" | "),
    )
    .join("\n");
}

// ── Claude summarization ────────────────────────────────────────────────

async function summarize(
  users: QueryResult,
  pages: QueryResult,
  rageClicks: QueryResult,
  errors: QueryResult,
  totals: QueryResult,
): Promise<string> {
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString(
    "en-US",
    { weekday: "short", month: "short", day: "numeric" },
  );

  const { text } = await generateText({
    model: anthropic(MODEL_ID),
    prompt: `Analyze yesterday's usage of the Rulebase apps (app.rulebase.co + beam.rulebase.co). Internal rulebase.co users are excluded — this is external customers only.

Date: ${yesterday}

USERS:
${fmt(users)}

PAGES:
${fmt(pages)}

RAGE CLICKS:
${fmt(rageClicks)}

ERRORS:
${fmt(errors)}

TOTALS:
${fmt(totals)}

Write a tight Slack digest using mrkdwn. Only include sections that have data. Skip empty sections entirely. Format:

*Users* — one line per person: email (org) | what they did | how long
*Stuck* — rage clicks: user (email or ID), org, page, element, time. Include the PostHog recording link as <url|Watch>. Only if there are rage clicks.
*Broken* — errors: what broke, where, who hit it, time. Include <recording_url|Watch>. Only if there are errors.
*Action* — 1-3 bullet points of specific things to fix, based only on data above.

Rules:
- Max 800 characters total
- No section headers for empty sections
- No filler ("no issues detected", "everything looks good")
- Every word must reference specific data
- If there's nothing material to report, just say "Quiet day — no external activity"`,
    maxOutputTokens: 1000,
  });

  return text;
}

// ── Main ────────────────────────────────────────────────────────────────

export async function generateAndPostPostHogDigest(): Promise<{
  success: boolean;
  summary: string;
}> {
  if (!POSTHOG_API_KEY || !POSTHOG_PROJECT_ID) {
    throw new Error("Missing POSTHOG_API_KEY or POSTHOG_PROJECT_ID");
  }
  if (!SLACK_WEBHOOK) {
    throw new Error("Missing POSTHOG_SLACK_WEBHOOK_URL or SLACK_WEBHOOK_URL");
  }

  const [users, pages, rageClicks, errors, totals] = await Promise.all([
    queryActiveUsers(),
    queryPageViews(),
    queryRageClicks(),
    queryExceptions(),
    queryTotalUsers(),
  ]);

  const digest = await summarize(users, pages, rageClicks, errors, totals);

  const date = new Date().toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  const totalUsersAllTime =
    totals.data.length > 0 ? Number(totals.data[0].total_users) || 0 : 0;
  const totalOrgs =
    totals.data.length > 0 ? Number(totals.data[0].total_orgs) || 0 : 0;
  const activeCount = users.data.length;

  let message = `*Rulebase — ${date}*\n`;
  message += `\`${totalUsersAllTime} users\` \`${totalOrgs} orgs\` \`${activeCount} active yesterday\`\n\n`;
  message += digest;

  const slackRes = await fetch(SLACK_WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: message }),
  });

  if (!slackRes.ok) {
    throw new Error(
      `Slack failed: ${slackRes.status} ${await slackRes.text()}`,
    );
  }

  return {
    success: true,
    summary: `Posted: ${activeCount} active, ${rageClicks.data.length} rage clicks, ${errors.data.length} errors`,
  };
}
