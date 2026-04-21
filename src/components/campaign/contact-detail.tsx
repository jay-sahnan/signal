"use client";

import { useState } from "react";
import { ExternalLink, Linkedin, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PriorityCallout } from "@/components/ui/priority-callout";
import { SocialPostCard } from "@/components/ui/social-post-card";
import { cn } from "@/lib/utils";
import type { CampaignContact, WebResearchResult } from "@/lib/types/campaign";

type Variant = "wide" | "sidebar";

const LINK_FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded";

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

interface ContactDetailProps {
  contact: CampaignContact;
  onRetry?: (contactId: string) => void;
  variant?: Variant;
}

function WebResultCard({
  result,
  onOpen,
  compact,
}: {
  result: WebResearchResult;
  onOpen: () => void;
  compact?: boolean;
}) {
  return (
    <div className="border-border hover:bg-muted/30 rounded-md border p-2 text-sm transition-colors">
      <div className="flex items-start gap-1.5">
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Read full: ${result.title}`}
          className={cn(
            "line-clamp-2 flex-1 text-left text-xs font-medium hover:underline",
            LINK_FOCUS,
          )}
        >
          {result.title}
        </button>
        {result.url && (
          <a
            href={result.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open source for ${result.title}`}
            className={cn(
              "text-muted-foreground hover:text-foreground shrink-0 transition-colors",
              LINK_FOCUS,
            )}
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
      {!compact && result.text && (
        <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">
          {result.text}
        </p>
      )}
      {result.publishedDate && (
        <p className="text-muted-foreground/60 mt-1 text-xs tabular-nums">
          {formatDate(result.publishedDate)}
        </p>
      )}
    </div>
  );
}

function WebResultsList({
  title,
  results,
  onSelect,
  compact,
  defaultCount = 3,
}: {
  title: string;
  results: WebResearchResult[];
  onSelect: (result: WebResearchResult) => void;
  compact?: boolean;
  defaultCount?: number;
}) {
  const [showAll, setShowAll] = useState(false);
  if (!results || results.length === 0) return null;

  const visible = showAll ? results : results.slice(0, defaultCount);

  return (
    <div className="space-y-2">
      <h4 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
        {title}
      </h4>
      <div className="space-y-1.5">
        {visible.map((r, i) => (
          <WebResultCard
            key={i}
            result={r}
            onOpen={() => onSelect(r)}
            compact={compact}
          />
        ))}
      </div>
      {results.length > defaultCount && (
        <Button variant="ghost" size="xs" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Show fewer" : `Show all ${results.length}`}
        </Button>
      )}
    </div>
  );
}

export function ContactDetail({
  contact,
  onRetry,
  variant = "wide",
}: ContactDetailProps) {
  const [selectedResult, setSelectedResult] =
    useState<WebResearchResult | null>(null);

  const isSidebar = variant === "sidebar";
  const data = contact.enrichment_data;
  const linkedin = data?.linkedin;
  const twitter = data?.twitter;
  const news = data?.news;
  const articles = data?.articles;
  const background = data?.background;
  const hasWebResearch =
    (news && news.length > 0) ||
    (articles && articles.length > 0) ||
    (background && background.length > 0);

  const postLimit = isSidebar ? 2 : 4;
  const webResultLimit = isSidebar ? 2 : 3;
  const socialGridClass = isSidebar ? "space-y-5" : "grid gap-6 md:grid-cols-2";
  const researchGridClass = isSidebar
    ? "space-y-5"
    : "grid gap-6 md:grid-cols-3";
  const containerClass = isSidebar
    ? "space-y-4 px-4 pb-4 pt-2"
    : "space-y-6 py-4";

  if (contact.enrichment_status === "in_progress") {
    return (
      <div className="text-muted-foreground flex items-center justify-center gap-2 py-4 text-sm">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Enriching this contact...
      </div>
    );
  }

  if (contact.enrichment_status === "pending") {
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-4 text-center">
        <p className="text-muted-foreground text-sm">Not yet enriched.</p>
        {onRetry ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onRetry(contact.id)}
          >
            Enrich contact
          </Button>
        ) : (
          <p className="text-muted-foreground text-xs">
            Click the sparkle icon or use the chat to run enrichment.
          </p>
        )}
      </div>
    );
  }

  if (contact.enrichment_status === "failed") {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-4 text-center">
        <p className="text-sm text-red-600 dark:text-red-400">
          Enrichment failed for this contact.
        </p>
        {onRetry && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onRetry(contact.id)}
          >
            Retry enrichment
          </Button>
        )}
      </div>
    );
  }

  if (!linkedin && !twitter && !hasWebResearch) {
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-4 text-center">
        <p className="text-muted-foreground text-sm">
          No enrichment data available.
        </p>
        {onRetry && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onRetry(contact.id)}
          >
            Enrich contact
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className={containerClass}>
      <PriorityCallout
        score={contact.priority_score}
        reason={contact.score_reason}
      />

      {(linkedin || twitter) && (
        <div className={socialGridClass}>
          {linkedin && (
            <section className="space-y-3">
              <h4 className="text-sm font-semibold">LinkedIn</h4>

              {linkedin.profileInfo && (
                <div className="text-sm">
                  <p className="font-medium">
                    {linkedin.profileInfo.name}
                    {linkedin.profileInfo.username && (
                      <a
                        href={`https://linkedin.com/in/${linkedin.profileInfo.username}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Open ${linkedin.profileInfo.name}'s LinkedIn profile`}
                        className="text-muted-foreground hover:text-foreground ml-2 inline-flex items-center gap-1 font-normal transition-colors"
                      >
                        <Linkedin className="h-3 w-3" />@
                        {linkedin.profileInfo.username}
                      </a>
                    )}
                  </p>
                  {linkedin.profileInfo.headline && (
                    <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">
                      {linkedin.profileInfo.headline}
                    </p>
                  )}
                </div>
              )}

              {linkedin.posts && linkedin.posts.length > 0 && (
                <div className="space-y-2">
                  <h5 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                    Recent posts
                  </h5>
                  <div className="space-y-2">
                    {linkedin.posts.slice(0, postLimit).map((post, i) => (
                      <SocialPostCard
                        key={i}
                        text={post.text}
                        metrics={[
                          { label: "likes", value: post.likes ?? 0 },
                          { label: "comments", value: post.comments ?? 0 },
                        ]}
                        date={post.created_at}
                        url={post.url}
                        formatDate={formatDate}
                      />
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          {twitter && (
            <section className="space-y-3">
              <h4 className="text-sm font-semibold">X / Twitter</h4>

              {twitter.user && (
                <div className="text-sm">
                  <p className="font-medium">
                    {twitter.user.name}
                    <span className="text-muted-foreground ml-2 font-normal">
                      @{twitter.user.username}
                    </span>
                  </p>
                  {twitter.user.followers_count != null && (
                    <p className="text-muted-foreground mt-0.5 text-xs tabular-nums">
                      {twitter.user.followers_count.toLocaleString()} followers
                    </p>
                  )}
                  {twitter.user.description && (
                    <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">
                      {twitter.user.description}
                    </p>
                  )}
                </div>
              )}

              {twitter.tweets && twitter.tweets.length > 0 && (
                <div className="space-y-2">
                  <h5 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                    Recent tweets
                  </h5>
                  <div className="space-y-2">
                    {twitter.tweets.slice(0, postLimit).map((tweet, i) => (
                      <SocialPostCard
                        key={i}
                        text={tweet.text}
                        metrics={[
                          {
                            label: "likes",
                            value: tweet.public_metrics?.like_count,
                          },
                          {
                            label: "replies",
                            value: tweet.public_metrics?.reply_count,
                          },
                          {
                            label: "views",
                            value: tweet.public_metrics?.view_count,
                          },
                        ]}
                        date={tweet.created_at}
                        formatDate={formatDate}
                      />
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {hasWebResearch && (
        <div className={researchGridClass}>
          {news && (
            <WebResultsList
              title="News & mentions"
              results={news}
              onSelect={setSelectedResult}
              compact={isSidebar}
              defaultCount={webResultLimit}
            />
          )}
          {articles && (
            <WebResultsList
              title="Articles & talks"
              results={articles}
              onSelect={setSelectedResult}
              compact={isSidebar}
              defaultCount={webResultLimit}
            />
          )}
          {background && (
            <WebResultsList
              title="Background"
              results={background}
              onSelect={setSelectedResult}
              compact={isSidebar}
              defaultCount={webResultLimit}
            />
          )}
        </div>
      )}

      <Dialog
        open={!!selectedResult}
        onOpenChange={(open) => {
          if (!open) setSelectedResult(null);
        }}
      >
        <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="pr-8 leading-tight">
              {selectedResult?.title}
            </DialogTitle>
            <div className="text-muted-foreground flex items-center gap-3 text-xs">
              {selectedResult?.publishedDate && (
                <span className="tabular-nums">
                  {formatDate(selectedResult.publishedDate)}
                </span>
              )}
              {selectedResult?.url && (
                <a
                  href={selectedResult.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    "hover:text-foreground inline-flex items-center gap-1",
                    LINK_FOCUS,
                  )}
                >
                  View source <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </DialogHeader>
          <div className="-mx-4 flex-1 overflow-y-auto px-4">
            <article className="prose prose-sm dark:prose-invert max-w-none">
              <p className="whitespace-pre-line">
                {selectedResult?.text || "No content available."}
              </p>
            </article>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
