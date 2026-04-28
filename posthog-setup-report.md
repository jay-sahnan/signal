<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of PostHog analytics into Signal. The project already had a solid foundation (packages installed, `instrumentation-client.ts`, server-side client, reverse proxy rewrites, and user identification via Clerk), so this pass supplemented the existing instrumentation with two new events and built a dashboard from the full event set.

**What was already in place:**

- Client-side init via `instrumentation-client.ts` (Next.js 15.3+ pattern) with exception capture enabled and a `/ingest` reverse proxy in `next.config.ts`
- Server-side `posthog-node` client in `src/lib/posthog-server.ts`
- User identification via `src/components/posthog-identify.tsx` using Clerk user ID + email
- 13 events already instrumented across client and server

**New events added in this session:**

- `campaign_deleted` — added to `src/app/campaigns/page.tsx`
- `outreach_drafted` — added to `src/app/api/outreach/process/route.ts`

## All instrumented events

| Event                      | Description                                        | File                                     |
| -------------------------- | -------------------------------------------------- | ---------------------------------------- |
| `chat_message_sent`        | User submits a message to the AI agent             | `src/components/chat/chat-input.tsx`     |
| `csv_uploaded`             | User uploads a CSV file in the chat                | `src/components/chat/chat-input.tsx`     |
| `draft_approved`           | User approves email drafts for a contact           | `src/app/outreach/review/page.tsx`       |
| `draft_rejected`           | User rejects email drafts for a contact            | `src/app/outreach/review/page.tsx`       |
| `email_sent_now`           | User sends an email immediately from review        | `src/app/outreach/review/page.tsx`       |
| `email_regenerated`        | User regenerates an email draft                    | `src/app/outreach/review/page.tsx`       |
| `contact_scores_refreshed` | User refreshes contact scores in a campaign        | `src/app/campaigns/[id]/page.tsx`        |
| `campaign_deleted`         | User deletes a campaign                            | `src/app/campaigns/page.tsx`             |
| `chat_completed`           | Server: AI chat stream finished (with token usage) | `src/app/api/chat/route.ts`              |
| `csv_import_completed`     | Server: CSV company import finished                | `src/app/api/import-csv/route.ts`        |
| `outreach_email_sent`      | Server: approved outreach email was sent           | `src/app/api/outreach/send-now/route.ts` |
| `outreach_drafted`         | Server: signal-triggered email draft created       | `src/app/api/outreach/process/route.ts`  |
| `email_replied`            | Webhook: prospect replied to an outreach email     | `src/app/api/agentmail/webhook/route.ts` |
| `email_delivered`          | Webhook/tracking: email confirmed delivered        | `src/app/api/agentmail/webhook/route.ts` |
| `email_bounced`            | Webhook/tracking: email bounced                    | `src/app/api/agentmail/webhook/route.ts` |
| `email_opened`             | Tracking: email opened                             | `src/app/api/email/track/route.ts`       |
| `email_clicked`            | Tracking: link in email clicked                    | `src/app/api/email/track/route.ts`       |
| `email_complained`         | Tracking: email marked as spam                     | `src/app/api/email/track/route.ts`       |

## Next steps

We've built a dashboard and five insights to keep an eye on user behavior, based on the events instrumented:

- **Dashboard**: [Analytics basics](https://us.posthog.com/project/401646/dashboard/1521443)
- **Insight**: [Outreach funnel: draft → approve → send → reply](https://us.posthog.com/project/401646/insights/HkypHb6x) — end-to-end conversion funnel
- **Insight**: [Email engagement over time](https://us.posthog.com/project/401646/insights/YN5A0kYZ) — delivered, opened, replied trends
- **Insight**: [Chat activity](https://us.posthog.com/project/401646/insights/m4Y2GRXK) — daily AI agent usage
- **Insight**: [Draft review: approved vs rejected](https://us.posthog.com/project/401646/insights/VwblXZ9t) — draft quality signal
- **Insight**: [Campaign churn signals](https://us.posthog.com/project/401646/insights/vK70zib1) — CSV imports vs campaign deletions

### Agent skill

We've left an agent skill folder in your project at `.claude/skills/integration-nextjs-app-router/`. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
