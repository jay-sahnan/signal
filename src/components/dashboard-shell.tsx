"use client";

import { MessageCircle, Plus } from "lucide-react";

import { AgentPanel } from "@/components/agent-panel";
import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { CampaignProvider, useCampaign } from "@/lib/campaign-context";

function HeaderAgentButton() {
  const { agentOpen, setAgentOpen, openAgentWith, setActiveChatId } =
    useCampaign();

  const handleNewChat = () => {
    // Force a new chat by clearing active chat and opening
    setActiveChatId(null);
    openAgentWith();
  };

  return (
    <div className="flex items-center gap-0.5">
      {agentOpen && (
        <Button
          variant="ghost"
          size="sm"
          onClick={handleNewChat}
          aria-label="New chat"
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          New Chat
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setAgentOpen(!agentOpen)}
        aria-pressed={agentOpen}
      >
        <MessageCircle className="mr-1.5 h-4 w-4" />
        {agentOpen ? "Close" : "Agent"}
      </Button>
    </div>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <CampaignProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="max-h-dvh overflow-hidden">
          <header className="bg-background/50 sticky top-0 z-50 flex h-12 shrink-0 items-center gap-2 border-b px-4 backdrop-blur-md lg:px-6">
            <div className="flex w-full items-center justify-between">
              <div className="flex items-center gap-1 lg:gap-2">
                <SidebarTrigger className="-ml-1" />
                <Separator
                  orientation="vertical"
                  className="mx-2 data-[orientation=vertical]:h-4"
                />
              </div>
              <div className="flex items-center gap-2">
                <HeaderAgentButton />
              </div>
            </div>
          </header>
          <div className="relative flex min-h-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
              {children}
            </div>
            <AgentPanel />
          </div>
        </SidebarInset>
      </SidebarProvider>
    </CampaignProvider>
  );
}
