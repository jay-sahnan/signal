"use client";

import { useEffect, useState } from "react";
import { SafeLink } from "@/components/safe-link";

import {
  LayoutDashboard,
  MessageCircle,
  Plus,
  Settings,
  SlidersHorizontal,
} from "lucide-react";

import { NavUser } from "@/components/nav-user";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { useCampaign } from "@/lib/campaign-context";
import { listChats, type ChatSummary } from "@/lib/services/chat-history";

const navItems = [
  {
    title: "Feed",
    url: "/",
    icon: LayoutDashboard,
  },
  {
    title: "ICP",
    url: "/icp",
    icon: SlidersHorizontal,
  },
];

const defaultUser = {
  name: "",
  email: "",
  avatar: "",
};

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const mins = Math.round((now - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const { chatListVersion, requestLoadChat, openAgentWith } = useCampaign();
  const [chats, setChats] = useState<ChatSummary[]>([]);

  useEffect(() => {
    listChats(10).then(setChats);
  }, [chatListVersion]);

  const handleNewChat = () => {
    openAgentWith();
  };

  return (
    <Sidebar variant="inset" collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<SafeLink href="/" />}>
              <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                <span className="text-sm font-bold">R</span>
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">Rulebase</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="sr-only">Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    render={<SafeLink href={item.url} />}
                    tooltip={item.title}
                  >
                    <item.icon />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Chats section */}
        <SidebarGroup>
          <SidebarGroupLabel>
            <span className="flex-1">Chats</span>
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="New Chat" onClick={handleNewChat}>
                  <Plus />
                  <span>New Chat</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {chats.map((chat) => (
                <SidebarMenuItem key={chat.id}>
                  <SidebarMenuButton
                    tooltip={chat.title}
                    onClick={() => requestLoadChat(chat.id)}
                  >
                    <MessageCircle />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-xs">{chat.title}</span>
                      <span className="text-muted-foreground truncate text-[10px]">
                        {timeAgo(chat.updated_at)}
                      </span>
                    </div>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<SafeLink href="/settings" />}
              tooltip="Settings"
            >
              <Settings />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarSeparator />
        <NavUser user={defaultUser} />
      </SidebarFooter>
    </Sidebar>
  );
}
