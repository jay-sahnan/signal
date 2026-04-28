import { PostHog } from "posthog-node";

type PostHogLike = Pick<PostHog, "capture" | "identify" | "shutdown">;

const noop: PostHogLike = {
  capture: () => {},
  identify: () => {},
  shutdown: async () => {},
};

let posthogClient: PostHogLike | null = null;

export function getPostHogClient(): PostHogLike {
  if (posthogClient) return posthogClient;

  const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  if (!token) {
    posthogClient = noop;
    return posthogClient;
  }

  posthogClient = new PostHog(token, {
    host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    flushAt: 1,
    flushInterval: 0,
  });
  return posthogClient;
}
