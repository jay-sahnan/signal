"use client";

import { ExternalLink, Linkedin, Mail } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import type { OrgChartPerson } from "./org-chart";

interface PersonDrawerProps {
  person: OrgChartPerson | null;
  onClose: () => void;
}

export function PersonDrawer({ person, onClose }: PersonDrawerProps) {
  return (
    <Sheet open={person !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="overflow-y-auto p-0">
        {person && (
          <>
            <SheetHeader>
              <SheetTitle>{person.name}</SheetTitle>
              {person.title && (
                <SheetDescription>{person.title}</SheetDescription>
              )}
            </SheetHeader>

            <div className="space-y-4 px-4 pb-6">
              {(person.department || person.seniority) && (
                <div className="flex flex-wrap gap-1.5">
                  {person.department && (
                    <span className="bg-muted rounded-full px-2 py-0.5 text-xs">
                      {person.department}
                    </span>
                  )}
                  {person.seniority && (
                    <span className="bg-muted rounded-full px-2 py-0.5 text-xs capitalize">
                      {person.seniority}
                    </span>
                  )}
                </div>
              )}

              {person.role_summary && (
                <div>
                  <div className="text-muted-foreground mb-1 text-xs font-semibold tracking-wide uppercase">
                    What they do
                  </div>
                  <p className="text-sm">{person.role_summary}</p>
                </div>
              )}

              {person.outreach_status && (
                <div>
                  <div className="text-muted-foreground mb-1 text-xs font-semibold tracking-wide uppercase">
                    Outreach status
                  </div>
                  <p className="text-sm capitalize">
                    {person.outreach_status.replace(/_/g, " ")}
                  </p>
                </div>
              )}

              <div>
                <div className="text-muted-foreground mb-1 text-xs font-semibold tracking-wide uppercase">
                  Contact
                </div>
                <div className="space-y-1.5">
                  {person.linkedin_url && (
                    <a
                      href={person.linkedin_url}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-foreground text-muted-foreground flex items-center gap-2 text-sm"
                    >
                      <Linkedin className="h-3.5 w-3.5" /> LinkedIn
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  {person.work_email && (
                    <a
                      href={`mailto:${person.work_email}`}
                      className="hover:text-foreground text-muted-foreground flex items-center gap-2 text-sm"
                    >
                      <Mail className="h-3.5 w-3.5" /> {person.work_email}
                    </a>
                  )}
                  {!person.linkedin_url && !person.work_email && (
                    <p className="text-muted-foreground text-sm italic">
                      No contact info yet.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
