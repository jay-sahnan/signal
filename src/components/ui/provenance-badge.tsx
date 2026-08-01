import { cn } from "@/lib/utils";

/**
 * Shows how much a contact's email and employer can be trusted.
 *
 * Both facts were previously invisible in the UI: the database has carried
 * work_email_source and work_email_confidence since April and no component ever
 * read them, so a blind {first}.{last}@domain guess looked exactly like an
 * address the user typed in. Surfacing it is what makes the send gate
 * intelligible — a blocked contact should be obvious before someone tries to
 * email them and wonders why nothing happened.
 */

// No amber token exists in globals.css, and these states genuinely block a
// send, so `blocked` borrows the destructive tint rather than introducing a new
// design token for this one component.
const TONE = {
  ok: "bg-success/10 text-success",
  blocked: "bg-destructive/10 text-destructive",
  muted: "bg-muted text-muted-foreground",
} as const;

type Tone = keyof typeof TONE;

function Pill({
  tone,
  children,
  title,
  className,
}: {
  tone: Tone;
  children: React.ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-block shrink-0 rounded-full px-1.5 py-0.5 text-xs font-medium",
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export interface EmailProvenance {
  work_email?: string | null;
  work_email_source?: string | null;
  work_email_verification?: string | null;
  work_email_confidence?: number | null;
}

export function EmailProvenanceBadge({
  person,
  className,
}: {
  person: EmailProvenance;
  className?: string;
}) {
  if (!person.work_email) return null;

  const source = person.work_email_source;
  const verification = person.work_email_verification;

  if (source === "user_entered") {
    return (
      <Pill tone="ok" title="You entered this address." className={className}>
        entered
      </Pill>
    );
  }
  if (source === "send_confirmed") {
    return (
      <Pill
        tone="ok"
        title="A previous send to this address was accepted by the mailbox."
        className={className}
      >
        confirmed
      </Pill>
    );
  }
  if (verification === "deliverable") {
    return (
      <Pill
        tone="ok"
        title="A verifier confirmed this mailbox accepts mail."
        className={className}
      >
        verified
      </Pill>
    );
  }
  if (verification === "risky") {
    return (
      <Pill
        tone="blocked"
        title="Accepted by a catch-all domain, which accepts every address — this says nothing about whether this particular mailbox exists."
        className={className}
      >
        catch-all
      </Pill>
    );
  }
  if (verification === "undeliverable") {
    return (
      <Pill
        tone="blocked"
        title="This mailbox was rejected."
        className={className}
      >
        undeliverable
      </Pill>
    );
  }

  // unknown / unchecked — most often a pattern guess on an instance with no
  // email provider configured.
  return (
    <Pill
      tone="muted"
      title={
        source === "pattern_derived"
          ? "Guessed from the company's email pattern and never confirmed. Blocked from outreach until verified."
          : "Never verified. Blocked from outreach until confirmed."
      }
      className={className}
    >
      {source === "pattern_derived" ? "guessed" : "unverified"}
    </Pill>
  );
}

export interface AffiliationProvenance {
  affiliation_source?: string | null;
  affiliation_confidence?: number | null;
  affiliation_evidence?: string | null;
}

/** Mirrors AFFILIATION_SEND_THRESHOLD in services/affiliation.ts. */
const SEND_THRESHOLD = 0.6;

const AFFILIATION_LABEL: Record<string, string> = {
  user_entered: "you confirmed this",
  email_domain: "verified email at the company's domain",
  team_page: "listed on the company's own website",
  linkedin_profile: "their LinkedIn profile names this company",
  csv_import: "your uploaded list places them here",
  llm_verified: "checked against their profile",
  search_stamp: "only appeared in a search for this company",
};

export function AffiliationBadge({
  person,
  className,
}: {
  person: AffiliationProvenance;
  className?: string;
}) {
  const confidence = person.affiliation_confidence ?? 0;
  const source = person.affiliation_source;

  // Confirmed well enough to contact — no badge, to keep lists quiet. Only the
  // exceptions are worth pixels.
  if (source && confidence >= SEND_THRESHOLD) return null;

  const why = source
    ? (AFFILIATION_LABEL[source] ?? source)
    : "nothing on file says they work here";

  return (
    <Pill
      tone="blocked"
      title={`${person.affiliation_evidence ?? why}. Blocked from outreach until confirmed.`}
      className={className}
    >
      unconfirmed employer
    </Pill>
  );
}
