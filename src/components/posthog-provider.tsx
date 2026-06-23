"use client";

import posthog from "posthog-js";
import { PostHogProvider } from "posthog-js/react";

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST =
  process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.posthog.com";

if (POSTHOG_KEY && typeof window !== "undefined") {
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    person_profiles: "identified_only",
    capture_pageview: false, // handled by PostHogPageView for SPA
    capture_pageleave: true,
    autocapture: true,
  });
}

export function PostHogClientProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!POSTHOG_KEY) return <>{children}</>;

  return <PostHogProvider client={posthog}>{children}</PostHogProvider>;
}
