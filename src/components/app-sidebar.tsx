"use client";

import { SafeLink } from "@/components/safe-link";

import {
  Eye,
  LayoutDashboard,
  Mail,
  MessageCircle,
  MessageSquare,
  Settings,
  Target,
  UserCircle,
  Zap,
} from "lucide-react";

import { NavUser } from "@/components/nav-user";
import { SidebarCampaigns } from "@/components/sidebar-campaigns";
import { useCampaign } from "@/lib/campaign-context";
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

const navItems = [
  {
    title: "Overview",
    url: "/",
    icon: LayoutDashboard,
  },
  {
    title: "Chat",
    url: "/chat",
    icon: MessageCircle,
  },
  {
    title: "Campaigns",
    url: "/campaigns",
    icon: Target,
  },
  {
    title: "Signals",
    url: "/signals",
    icon: Zap,
  },
  {
    title: "Tracking",
    url: "/tracking",
    icon: Eye,
  },
  {
    title: "Outreach",
    url: "/outreach",
    icon: Mail,
  },
  {
    title: "Profiles",
    url: "/profile",
    icon: UserCircle,
  },
];

const defaultUser = {
  name: "",
  email: "",
  avatar: "",
};

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const { activeCampaignId, setActiveCampaignId } = useCampaign();

  return (
    <Sidebar variant="inset" collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<SafeLink href="/" />}>
              <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                <span className="text-sm font-bold">S</span>
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">Signal</span>
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

        <SidebarSeparator />

        <SidebarCampaigns
          activeCampaignId={activeCampaignId}
          onSelectCampaign={setActiveCampaignId}
        />
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
          <SidebarMenuItem>
            <SidebarMenuButton
              render={
                <a href="mailto:jaysahnan31@gmail.com?subject=Signal%20feedback" />
              }
              tooltip="Feedback"
              aria-label="Give feedback"
            >
              <MessageSquare />
              <span>Feedback</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarSeparator />
        <NavUser user={defaultUser} />
      </SidebarFooter>
    </Sidebar>
  );
}
