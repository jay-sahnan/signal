/**
 * Pure helpers for the outreach activity feed.
 *
 * No React and no Supabase, so the interesting logic (which state a row is in,
 * where "Open in Gmail" points) is unit-testable without jsdom or a database.
 */

/**
 * What a row in the feed is doing right now.
 *
 * `sent` rows come from sent_emails; the rest come from email_drafts that have
 * no sent_emails row yet, which is exactly why queued, scheduled and failed
 * mail is invisible in the product today.
 */
export type ActivityState =
  | "replied"
  | "bounced"
  | "sent"
  | "queued"
  | "scheduled"
  | "deferred"
  | "blocked"
  | "failed";

export interface ActivityReply {
  kind: "reply" | "bounce";
  from_email: string;
  subject: string;
  received_at: string;
  body_text: string | null;
}

export interface ActivityItem {
  id: string;
  source: "sent" | "pending";
  state: ActivityState;
  campaign_id: string | null;
  campaign_name: string | null;
  person_name: string | null;
  person_title: string | null;
  company_name: string | null;
  to_email: string;
  subject: string;
  /** Sort key: newest reply, else sent_at, else the scheduled send time. */
  at: string;
  sent_at: string | null;
  next_send_at: string | null;
  reply_count: number;
  reply_snippet: string | null;
  /**
   * False when a reply arrived but its words were never captured. Distinct
   * from an empty reply, and the row has to say so rather than showing blank.
   */
  reply_captured: boolean;
  error: { kind: string; message: string; at: string } | null;
  gmail_url: string | null;
}

/**
 * The filters the UI offers, and the states each one covers.
 *
 * Shared by the API route and the panel on purpose. The list is fetched
 * unfiltered and narrowed in the client, so if these two disagreed the chip
 * counts and the rows behind them would drift apart.
 *
 * "Needs attention" folds blocked in with failed because both are waiting on
 * the user; deferred is deliberately filed under "waiting" instead, since the
 * daily cap resolves itself tomorrow.
 */
export const FILTER_STATES: Record<string, ActivityState[]> = {
  replied: ["replied"],
  bounced: ["bounced"],
  sent: ["sent"],
  pending: ["queued", "scheduled", "deferred"],
  failed: ["failed", "blocked"],
};

export function filterActivity(
  items: ActivityItem[],
  filter: string,
): ActivityItem[] {
  const wanted = FILTER_STATES[filter];
  return wanted ? items.filter((i) => wanted.includes(i.state)) : items;
}

/** First line or so of a reply, for the collapsed row. */
export const SNIPPET_CHARS = 180;

export function replySnippet(body: string | null): string | null {
  if (!body) return null;
  const oneLine = body.replace(/\s+/g, " ").trim();
  if (!oneLine) return null;
  return oneLine.length > SNIPPET_CHARS
    ? oneLine.slice(0, SNIPPET_CHARS).trimEnd() + "…"
    : oneLine;
}

/**
 * The state of a row that came from sent_emails.
 *
 * sent_emails.status only ever holds 'sent', 'replied' or 'bounced' in
 * practice; anything else is a legacy value and reads as plain sent.
 */
export function classifySent(status: string): ActivityState {
  if (status === "replied") return "replied";
  if (status === "bounced") return "bounced";
  return "sent";
}

/**
 * The state of a row that came from email_drafts and has not sent.
 *
 * The error kind wins when there is one, because "why it did not send" is more
 * useful than "it is waiting". Note `deferred` is deliberately its own state
 * and not a failure: hitting the daily cap is routine, and showing it as
 * failed would bury the two kinds that need attention.
 */
export function classifyPending(draft: {
  status: string;
  last_error_kind: string | null;
  next_send_at: string | null;
}): ActivityState {
  if (draft.last_error_kind === "failed") return "failed";
  if (draft.last_error_kind === "blocked") return "blocked";
  if (draft.last_error_kind === "deferred") return "deferred";
  if (draft.status === "queued") return "queued";
  return draft.next_send_at ? "scheduled" : "queued";
}

/**
 * A link that opens this exact message in Gmail.
 *
 * There is no thread id to work with: agentmail_thread_id was dropped in
 * 20260730000001 and nothing replaced it. `rfc822msgid:` is the remaining
 * handle, and it is enough, because Gmail threads on References, so resolving
 * the *sent* message lands the reader in the conversation with the replies.
 *
 * Two details that are behaviour, not decoration:
 *
 * - Angle brackets are stripped. Gmail tolerates them inconsistently.
 * - `authuser=<from address>` rather than `/u/0/`. We know which mailbox sent
 *   this, and /u/0 is whichever Google account the reader happened to sign
 *   into first, which for anyone with a personal and a work account is a coin
 *   flip that lands on "no results".
 *
 * Returns null when there is no Message-ID. Deliberately does NOT fall back to
 * a subject search: on a cold email that is a shotgun, and silently opening
 * the wrong thread is worse than opening nothing.
 */
export function gmailSearchUrl(
  messageId: string | null,
  fromEmail: string | null,
): string | null {
  if (!messageId) return null;
  const bare = messageId.replace(/^</, "").replace(/>$/, "").trim();
  if (!bare) return null;
  const query = encodeURIComponent(`rfc822msgid:${bare}`);
  const account = fromEmail ? `?authuser=${encodeURIComponent(fromEmail)}` : "";
  return `https://mail.google.com/mail/u/${account}#search/${query}`;
}
