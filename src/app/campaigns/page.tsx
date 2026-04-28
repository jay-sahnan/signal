"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";

interface CampaignRow {
  id: string;
  name: string;
  status: string;
  created_at: string;
}

export default function CampaignsIndexPage() {
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    const fetchCampaigns = async () => {
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from("campaigns")
          .select("id, name, status, created_at")
          .order("updated_at", { ascending: false });

        if (error) {
          console.error("Failed to fetch campaigns:", error.message);
          if (mountedRef.current) {
            toast.error(`Failed to load campaigns: ${error.message}`);
          }
        }

        if (mountedRef.current) {
          setCampaigns(data ?? []);
          setLoading(false);
        }
      } catch (err) {
        console.error("Campaigns fetch error:", err);
        if (mountedRef.current) {
          toast.error("Failed to load campaigns");
          setLoading(false);
        }
      }
    };

    fetchCampaigns();
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleDelete = async (campaign: CampaignRow) => {
    setDeletingId(campaign.id);
    const supabase = createClient();
    const { error } = await supabase
      .from("campaigns")
      .delete()
      .eq("id", campaign.id);

    if (error) {
      toast.error(`Failed to delete: ${error.message}`);
      setDeletingId(null);
      return;
    }

    setCampaigns((prev) => prev.filter((c) => c.id !== campaign.id));
    toast.success(`Deleted "${campaign.name}"`);
    setDeletingId(null);
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="space-y-6 p-4 md:p-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Campaigns</h1>
          <p className="text-muted-foreground text-sm">
            All campaigns in your workspace. Click a name to open it; delete
            ones you no longer need.
          </p>
        </div>

        {loading ? (
          <div className="space-y-2">
            <div className="bg-muted/40 h-9 w-full animate-pulse rounded" />
            <div className="bg-muted/40 h-9 w-full animate-pulse rounded" />
            <div className="bg-muted/40 h-9 w-full animate-pulse rounded" />
          </div>
        ) : campaigns.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No campaigns yet. Start one from the chat or the Overview page.
          </p>
        ) : (
          <div className="border-border overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-border bg-muted/50 border-b">
                  <th className="px-4 py-2.5 text-left font-medium">Name</th>
                  <th className="px-4 py-2.5 text-left font-medium">Status</th>
                  <th className="w-12 px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {campaigns.map((campaign) => (
                  <tr
                    key={campaign.id}
                    className="border-border border-b last:border-b-0"
                  >
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/campaigns/${campaign.id}`}
                        className="focus-visible:ring-ring rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2"
                      >
                        {campaign.name}
                      </Link>
                    </td>
                    <td className="text-muted-foreground px-4 py-2.5 capitalize">
                      {campaign.status}
                    </td>
                    <td className="px-4 py-2.5">
                      <Dialog>
                        <DialogTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              aria-label="Delete campaign"
                              disabled={deletingId === campaign.id}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          }
                        />
                        <DialogContent>
                          <DialogTitle>Delete campaign</DialogTitle>
                          <DialogDescription>
                            This will permanently delete &quot;{campaign.name}
                            &quot; and all its companies and contacts. This
                            cannot be undone.
                          </DialogDescription>
                          <DialogFooter>
                            <DialogClose render={<Button variant="outline" />}>
                              Cancel
                            </DialogClose>
                            <Button
                              variant="destructive"
                              onClick={() => handleDelete(campaign)}
                              disabled={deletingId === campaign.id}
                            >
                              {deletingId === campaign.id
                                ? "Deleting..."
                                : "Delete Campaign"}
                            </Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
