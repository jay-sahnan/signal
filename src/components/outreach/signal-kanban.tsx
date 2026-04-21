"use client";

import type { EnrollmentCard } from "@/app/outreach/page";
import { RelativeTime } from "@/components/ui/relative-time";
import { StatusPill } from "@/components/ui/status-pill";
import {
  OUTREACH_STATUS,
  type OutreachStatus,
  resolveDbEnrollmentStatus,
} from "@/lib/outreach/status";

interface SignalKanbanProps {
  enrollments: EnrollmentCard[];
}

const COLUMNS: { status: OutreachStatus; label: string }[] = [
  { status: "waiting", label: OUTREACH_STATUS.waiting.label },
  { status: "ready", label: OUTREACH_STATUS.ready.label },
  { status: "sent", label: OUTREACH_STATUS.sent.label },
  { status: "replied", label: OUTREACH_STATUS.replied.label },
];

function ContactCard({ card }: { card: EnrollmentCard }) {
  return (
    <div className="border-border bg-background rounded-lg border p-3 shadow-sm">
      <p className="text-sm font-medium">{card.person_name}</p>
      {(card.person_title || card.company_name) && (
        <p className="text-muted-foreground mt-0.5 text-xs">
          {card.person_title}
          {card.person_title && card.company_name && " @ "}
          {card.company_name}
        </p>
      )}
      <div className="mt-2 flex items-center justify-between">
        <span className="text-muted-foreground text-xs">
          Step {card.current_step}
        </span>
        {card.outreach_status && card.outreach_status !== "not_contacted" && (
          <span className="text-muted-foreground text-xs capitalize">
            {card.outreach_status}
          </span>
        )}
      </div>
      {card.next_send_at && (
        <p className="text-muted-foreground mt-1 text-xs">
          <>
            Next: <RelativeTime iso={card.next_send_at} />
          </>
        </p>
      )}
    </div>
  );
}

export function SignalKanban({ enrollments }: SignalKanbanProps) {
  if (enrollments.length === 0) {
    return (
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Pipeline</h2>
        <p className="text-muted-foreground text-sm">
          No active enrollments. Create a sequence and approve emails to get
          started.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Pipeline</h2>
      <div className="grid grid-cols-4 gap-4">
        {COLUMNS.map((col) => {
          const cards = enrollments.filter(
            (e) => resolveDbEnrollmentStatus(e.status) === col.status,
          );
          return (
            <div key={col.status} className="border-border rounded-lg border">
              <div className="border-border flex items-center justify-between border-b px-3 py-2">
                <span className="text-sm font-medium">{col.label}</span>
                <StatusPill status={col.status}>{cards.length}</StatusPill>
              </div>
              <div className="space-y-2 p-2">
                {cards.length === 0 ? (
                  <p className="text-muted-foreground p-2 text-center text-xs">
                    --
                  </p>
                ) : (
                  cards.map((card) => <ContactCard key={card.id} card={card} />)
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
