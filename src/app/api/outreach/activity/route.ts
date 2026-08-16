import { getSupabaseAndUser } from "@/lib/supabase/server";
import {
  classifyPending,
  classifySent,
  filterActivity,
  gmailSearchUrl,
  replySnippet,
  type ActivityItem,
} from "@/lib/outreach/activity";

/**
 * The outreach activity feed: what went out, what came back, and what did not
 * send.
 *
 * A union of two sources, because neither alone answers the question. Sent
 * mail lives in sent_emails; mail that is approved but has not left has no
 * sent_emails row at all, which is precisely why queued, scheduled and failed
 * sends are invisible everywhere in the product today.
 *
 * Auth is RLS, via getSupabaseAndUser, exactly as /api/dashboard does. There
 * is deliberately NO user_id filter in this file: adding one would mask a
 * policy that was written wrong, and the policies are the thing that has to be
 * right. (Contrast /api/outreach/send-now, which does use the admin client,
 * but only because it must, and pays for it with an explicit ownership check.)
 *
 * Bodies are not included here. This rides the outreach page's existing 10s
 * poll, and shipping every sent body on every poll would be gratuitous; the
 * detail route loads one on expand.
 */

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/**
 * The organizations embed names its foreign key on purpose. people has TWO
 * FKs to organizations -- organization_id and affiliation_detached_from, the
 * latter added by 20260802000000 -- so an unqualified embed is ambiguous and
 * PostgREST refuses the whole query with "more than one relationship was
 * found". Removing the constraint name turns this route into a 500.
 */
interface PersonJoin {
  name: string | null;
  title: string | null;
  organizations: { name: string | null } | null;
}

/**
 * Row shapes declared by hand. PostgREST's inferred types give up on a
 * two-level embed and widen the whole result to an error type, which then
 * hides every real field access behind a single unhelpful error.
 */
interface CampaignJoin {
  name: string | null;
}

interface SentRow {
  id: string;
  campaign_id: string | null;
  campaign: CampaignJoin | CampaignJoin[] | null;
  subject: string;
  to_email: string;
  from_email: string | null;
  status: string;
  sent_at: string;
  message_id: string | null;
  person: PersonJoin | PersonJoin[] | null;
  email_replies: Array<{
    kind: string;
    body_text: string | null;
    received_at: string;
  }> | null;
}

interface PendingRow {
  id: string;
  campaign_id: string | null;
  campaign: CampaignJoin | CampaignJoin[] | null;
  subject: string;
  to_email: string;
  status: string;
  created_at: string;
  last_error: string | null;
  last_error_at: string | null;
  last_error_kind: string | null;
  person: PersonJoin | PersonJoin[] | null;
  enrollment: { next_send_at: string | null } | null;
}

/** PostgREST returns an embedded to-one as an object, or an array in some shapes. */
function one<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export async function GET(request: Request) {
  const ctx = await getSupabaseAndUser();
  if (!ctx) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { supabase } = ctx;

  const { searchParams } = new URL(request.url);
  const filter = searchParams.get("filter") ?? "all";
  const before = searchParams.get("before");
  const limit = Math.min(
    Number(searchParams.get("limit")) || DEFAULT_LIMIT,
    MAX_LIMIT,
  );

  const campaignId = searchParams.get("campaignId");

  // Over-fetch each side by the page size: the two are merged and re-sorted in
  // JS, so either could contribute the whole page.
  let sentQuery = supabase
    .from("sent_emails")
    .select(
      "id, campaign_id, subject, to_email, from_email, status, sent_at, message_id, " +
        "campaign:campaigns(name), " +
        "person:people(name, title, organizations!people_organization_id_fkey(name)), " +
        "email_replies(kind, from_email, subject, received_at, body_text)",
    )
    .order("sent_at", { ascending: false })
    .limit(limit);
  if (before) sentQuery = sentQuery.lt("sent_at", before);
  if (campaignId) sentQuery = sentQuery.eq("campaign_id", campaignId);

  let pendingQuery = supabase
    .from("email_drafts")
    .select(
      "id, campaign_id, subject, to_email, status, created_at, last_error, last_error_at, last_error_kind, " +
        "campaign:campaigns(name), " +
        "person:people(name, title, organizations!people_organization_id_fkey(name)), " +
        "enrollment:sequence_enrollments(next_send_at)",
    )
    .eq("review_status", "approved")
    .in("status", ["draft", "queued"])
    .order("created_at", { ascending: false })
    .limit(limit);
  if (campaignId) pendingQuery = pendingQuery.eq("campaign_id", campaignId);

  const [sentRes, pendingRes] = await Promise.all([sentQuery, pendingQuery]);
  if (sentRes.error || pendingRes.error) {
    console.error(
      "[activity] query failed:",
      sentRes.error ?? pendingRes.error,
    );
    return Response.json({ error: "Could not load activity" }, { status: 500 });
  }

  const items: ActivityItem[] = [];

  for (const row of (sentRes.data ?? []) as unknown as SentRow[]) {
    const person = one(row.person);
    const replies = row.email_replies ?? [];
    // Newest reply drives both the snippet and the sort position, so a thread
    // that just got a response rises to the top of the feed.
    const newest = replies
      .slice()
      .sort((a, b) => b.received_at.localeCompare(a.received_at))[0];

    items.push({
      id: row.id,
      source: "sent",
      state: classifySent(row.status),
      campaign_id: row.campaign_id,
      campaign_name: one(row.campaign)?.name ?? null,
      person_name: person?.name ?? null,
      person_title: person?.title ?? null,
      company_name: one(person?.organizations ?? null)?.name ?? null,
      to_email: row.to_email,
      subject: row.subject,
      at: newest?.received_at ?? row.sent_at,
      sent_at: row.sent_at,
      next_send_at: null,
      reply_count: replies.length,
      reply_snippet: replySnippet(newest?.body_text ?? null),
      // A reply we matched but never captured the words of. Distinct from an
      // empty reply, and the row has to say so rather than showing nothing.
      reply_captured: !!newest && newest.body_text !== null,
      error: null,
      gmail_url: gmailSearchUrl(row.message_id, row.from_email),
    });
  }

  for (const row of (pendingRes.data ?? []) as unknown as PendingRow[]) {
    const person = one(row.person);
    const nextSendAt = one(row.enrollment)?.next_send_at ?? null;

    items.push({
      id: `draft:${row.id}`,
      source: "pending",
      campaign_id: row.campaign_id,
      campaign_name: one(row.campaign)?.name ?? null,
      state: classifyPending({
        status: row.status,
        last_error_kind: row.last_error_kind,
        next_send_at: nextSendAt,
      }),
      person_name: person?.name ?? null,
      person_title: person?.title ?? null,
      company_name: one(person?.organizations ?? null)?.name ?? null,
      to_email: row.to_email,
      subject: row.subject,
      at: row.last_error_at ?? nextSendAt ?? row.created_at,
      sent_at: null,
      next_send_at: nextSendAt,
      reply_count: 0,
      reply_snippet: null,
      reply_captured: false,
      error: row.last_error
        ? {
            kind: row.last_error_kind ?? "failed",
            message: row.last_error,
            at: row.last_error_at ?? row.created_at,
          }
        : null,
      // A draft has not been sent, so there is no message in Gmail to open.
      gmail_url: null,
    });
  }

  const filtered = filterActivity(items, filter);
  filtered.sort((a, b) => b.at.localeCompare(a.at));
  const page = filtered.slice(0, limit);

  // Only sent rows are cursor-paginated (pending mail is a bounded set). The
  // page is ordered by `at` (a reply lifts an old email to the top), so "the
  // oldest sent_at on the page" can sit far below sent rows that were fetched
  // but sliced off; a cursor there skips them on every later page, forever.
  // The cursor may only advance past rows that were actually returned: walk
  // the fetched sent rows newest-first and stop at the first one the page
  // does not contain. Rows below that boundary are re-fetched next page
  // (consumers should dedupe by id).
  const sentRows = (sentRes.data ?? []) as unknown as SentRow[];
  let nextCursor: string | null = null;
  if (sentRows.length === limit) {
    const returnedIds = new Set(page.map((i) => i.id));
    for (const row of sentRows) {
      if (!returnedIds.has(row.id)) break;
      nextCursor = row.sent_at;
    }
  }

  return Response.json({
    items: page,
    nextCursor,
  });
}
