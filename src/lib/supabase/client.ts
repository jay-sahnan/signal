"use client";

import { createBrowserClient } from "@supabase/ssr";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;

interface ClerkWindow {
  Clerk?: {
    session?: { getToken: () => Promise<string | null> };
  };
}

/**
 * Browser Supabase client that forwards the Clerk session token as a Bearer
 * header on every request. Supabase's third-party auth integration validates
 * the JWT and exposes the Clerk user id as `auth.jwt() ->> 'sub'` for RLS.
 *
 * Reads the token from `window.Clerk.session` (initialized by ClerkProvider)
 * so callers don't need a hook context — works inside callbacks, effects,
 * imperative service functions.
 */
export const createClient = () =>
  createBrowserClient(supabaseUrl!, supabaseKey!, {
    global: {
      fetch: async (input, init = {}) => {
        const token =
          typeof window !== "undefined"
            ? await ((
                window as unknown as ClerkWindow
              ).Clerk?.session?.getToken() ?? null)
            : null;
        const headers = new Headers(init.headers);
        if (token) headers.set("Authorization", `Bearer ${token}`);
        return fetch(input, { ...init, headers });
      },
    },
  });
