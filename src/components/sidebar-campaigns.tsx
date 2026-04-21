"use client";

import { useEffect, useRef, useState } from "react";
import { SafeLink } from "@/components/safe-link";
import { Loader2, Target } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  campaignStatusDotStyles,
  type CampaignStatus,
} from "@/lib/status-styles";

interface Campaign {
  id: string;
  name: string;
  status: string;
  created_at: string;
  companyCount?: number;
  contactCount?: number;
}

interface SidebarCampaignsProps {
  activeCampaignId: string | null;
  onSelectCampaign: (id: string | null) => void;
}

export function SidebarCampaigns({
  activeCampaignId,
  onSelectCampaign,
}: SidebarCampaignsProps) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    const fetchCampaigns = async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("campaigns")
        .select("id, name, status, created_at")
        .order("updated_at", { ascending: false });

      if (mountedRef.current) {
        if (!error && data) {
          setCampaigns(data);
        }
        setLoading(false);
      }
    };

    // Initial fetch + periodic polling for agent-created campaigns
    fetchCampaigns();
    const interval = setInterval(fetchCampaigns, 10000);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Campaigns</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {loading && (
            <SidebarMenuItem>
              <SidebarMenuButton disabled>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Loading...</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}

          {!loading && campaigns.length === 0 && (
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => onSelectCampaign(null)}
                render={<SafeLink href="/chat" />}
                tooltip="Speak to agent to create a campaign"
                className="text-muted-foreground"
              >
                <span className="text-xs">Speak to agent to get started</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}

          {campaigns.map((campaign) => (
            <SidebarMenuItem key={campaign.id}>
              <SidebarMenuButton
                isActive={activeCampaignId === campaign.id}
                onClick={() => onSelectCampaign(campaign.id)}
                render={<SafeLink href={`/campaigns/${campaign.id}`} />}
                tooltip={campaign.name}
              >
                <div className="relative">
                  <Target className="h-4 w-4" />
                  <span
                    className={`absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full ${campaignStatusDotStyles[campaign.status as CampaignStatus] || "bg-gray-400"}`}
                  />
                </div>
                <span className="truncate">{campaign.name}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
