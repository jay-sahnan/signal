"use client";

import { Fragment, useState } from "react";
import { ChevronRight, ExternalLink, Loader2, Sparkles } from "lucide-react";

import { ContactDetail } from "@/components/campaign/contact-detail";
import {
  enrichmentStatusStyles,
  type EnrichmentStatus,
} from "@/lib/status-styles";
import type { CampaignContact } from "@/lib/types/campaign";

interface ContactsTableProps {
  contacts: CampaignContact[];
  onContactEnriched: (contactId: string, data: CampaignContact) => void;
}

export function ContactsTable({
  contacts,
  onContactEnriched,
}: ContactsTableProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [enrichingIds, setEnrichingIds] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const enrichContact = async (contactId: string) => {
    setEnrichingIds((prev) => new Set(prev).add(contactId));
    try {
      const res = await fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId }),
      });
      const result = await res.json();

      if (result.status === "enriched" || result.status === "failed") {
        // Notify parent to re-fetch data
        onContactEnriched(contactId, {} as CampaignContact);
        setExpandedIds((prev) => new Set(prev).add(contactId));
      }

      if (result.errors?.length) {
        console.warn(`[enrich] Partial errors:`, result.errors);
      }
    } catch (err) {
      console.error(`[enrich] Failed:`, err);
    } finally {
      setEnrichingIds((prev) => {
        const next = new Set(prev);
        next.delete(contactId);
        return next;
      });
    }
  };

  if (contacts.length === 0) {
    return (
      <div className="text-muted-foreground py-12 text-center text-sm">
        No contacts found for this campaign. Use the chat to search for people.
      </div>
    );
  }

  return (
    <div className="border-border overflow-hidden rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-border bg-muted/50 border-b">
            <th className="w-8 px-3 py-2.5" />
            <th className="px-3 py-2.5 text-left font-medium">Name</th>
            <th className="hidden px-3 py-2.5 text-left font-medium sm:table-cell">
              Title
            </th>
            <th className="hidden px-3 py-2.5 text-left font-medium md:table-cell">
              Company
            </th>
            <th className="px-3 py-2.5 text-left font-medium">Enrichment</th>
          </tr>
        </thead>
        <tbody>
          {contacts.map((contact) => {
            const isExpanded = expandedIds.has(contact.id);
            const enrichment =
              enrichmentStatusStyles[
                contact.enrichment_status as EnrichmentStatus
              ] ?? enrichmentStatusStyles.pending;

            return (
              <Fragment key={contact.id}>
                <tr
                  className="border-border hover:bg-muted/30 focus-visible:outline-ring cursor-pointer border-b transition-colors last:border-b-0 focus-visible:outline-2"
                  role="button"
                  tabIndex={0}
                  aria-expanded={isExpanded}
                  onClick={() => toggleExpand(contact.id)}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === "Enter") {
                      e.preventDefault();
                      toggleExpand(contact.id);
                    } else if (e.key === " ") {
                      e.preventDefault();
                      toggleExpand(contact.id);
                    }
                  }}
                >
                  <td className="px-3 py-2.5">
                    <ChevronRight
                      className={`text-muted-foreground h-4 w-4 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                    />
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium">{contact.name}</span>
                      {contact.linkedin_url && (
                        <a
                          href={
                            contact.linkedin_url.startsWith("http")
                              ? contact.linkedin_url
                              : `https://linkedin.com/in/${contact.linkedin_url.replace(/^\//, "")}`
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-foreground"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </td>
                  <td className="text-muted-foreground hidden px-3 py-2.5 sm:table-cell">
                    {contact.title || "--"}
                  </td>
                  <td className="text-muted-foreground hidden px-3 py-2.5 md:table-cell">
                    {contact.company?.name || "--"}
                  </td>
                  <td className="px-3 py-2.5">
                    <div
                      className="inline-flex items-center gap-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="inline-flex items-center gap-1.5 text-xs">
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${enrichment.className}`}
                        />
                        {enrichment.label}
                      </span>
                      {(contact.enrichment_status === "pending" ||
                        contact.enrichment_status === "failed") &&
                        !enrichingIds.has(contact.id) && (
                          <button
                            onClick={() => enrichContact(contact.id)}
                            className="text-muted-foreground hover:text-foreground hover:bg-muted rounded-md p-1 transition-colors"
                            title="Enrich contact"
                            aria-label={`Enrich ${contact.name}`}
                          >
                            <Sparkles className="h-3.5 w-3.5" />
                          </button>
                        )}
                      {enrichingIds.has(contact.id) && (
                        <Loader2 className="text-muted-foreground h-3.5 w-3.5 animate-spin" />
                      )}
                    </div>
                  </td>
                </tr>
                {isExpanded && (
                  <tr className="border-border border-b last:border-b-0">
                    <td colSpan={5} className="bg-muted/20 px-4">
                      <ContactDetail contact={contact} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
