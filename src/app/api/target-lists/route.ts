import { z } from "zod";

import { getPostHogClient } from "@/lib/posthog-server";
import { getSupabaseAndUser } from "@/lib/supabase/server";

const CreateBody = z.object({
  name: z.string().trim().min(1, "name is required").max(200),
  original_filename: z.string().max(300).nullish(),
});

/** Create a target account list. Rows are appended separately in batches. */
export async function POST(request: Request) {
  const ctx = await getSupabaseAndUser();
  if (!ctx) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { supabase, user } = ctx;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = CreateBody.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  const { data: list, error } = await supabase
    .from("target_account_lists")
    .insert({
      user_id: user.id,
      name: parsed.data.name,
      original_filename: parsed.data.original_filename ?? null,
    })
    .select("*")
    .single();

  if (error || !list) {
    return Response.json(
      { error: `Failed to create list: ${error?.message ?? "unknown error"}` },
      { status: 500 },
    );
  }

  const posthog = getPostHogClient();
  posthog.capture({
    distinctId: user.id,
    event: "target_list_created",
    properties: {
      list_id: list.id,
      has_filename: Boolean(parsed.data.original_filename),
    },
  });

  return Response.json(list);
}

/** List the signed-in user's target account lists, newest first. */
export async function GET() {
  const ctx = await getSupabaseAndUser();
  if (!ctx) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { supabase, user } = ctx;

  // RLS already scopes rows to the owner; the eq is defense in depth, same as
  // import-csv's ownership re-check.
  const { data: lists, error } = await supabase
    .from("target_account_lists")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return Response.json(
      { error: `Failed to load lists: ${error.message}` },
      { status: 500 },
    );
  }

  return Response.json({ lists: lists ?? [] });
}
