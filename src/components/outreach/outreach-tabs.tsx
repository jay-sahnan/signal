"use client";

import { useState } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  OutreachDraftsPanel,
  type DraftRow,
} from "@/components/outreach/outreach-drafts-panel";
import { SequenceList } from "@/components/outreach/sequence-list";
import { SignalKanban } from "@/components/outreach/signal-kanban";
import type { EnrollmentCard, SequenceRow } from "@/app/outreach/page";

interface OutreachTabsProps {
  drafts: DraftRow[];
  sequences: SequenceRow[];
  enrollments: EnrollmentCard[];
  onRefresh: () => void;
}

export function OutreachTabs({
  drafts,
  sequences,
  enrollments,
  onRefresh,
}: OutreachTabsProps) {
  const [selectedSequence, setSelectedSequence] = useState<string | null>(null);
  const filteredEnrollments = selectedSequence
    ? enrollments.filter((e) => e.sequence_id === selectedSequence)
    : enrollments;

  return (
    <Tabs defaultValue="inbox" className="space-y-4">
      <TabsList>
        <TabsTrigger value="inbox">
          Inbox
          {drafts.length > 0 && (
            <span className="text-muted-foreground ml-1 text-xs tabular-nums">
              {drafts.length}
            </span>
          )}
        </TabsTrigger>
        <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
        <TabsTrigger value="sequences">Sequences</TabsTrigger>
      </TabsList>

      <TabsContent value="inbox">
        <OutreachDraftsPanel drafts={drafts} onRefresh={onRefresh} />
      </TabsContent>

      <TabsContent value="pipeline">
        <SignalKanban enrollments={filteredEnrollments} />
      </TabsContent>

      <TabsContent value="sequences">
        <SequenceList
          sequences={sequences}
          selectedId={selectedSequence}
          onSelect={(id) =>
            setSelectedSequence(id === selectedSequence ? null : id)
          }
        />
      </TabsContent>
    </Tabs>
  );
}
