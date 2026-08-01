import { z } from "zod";

import { getPostHogClient } from "@/lib/posthog-server";
import { getSupabaseAndUser } from "@/lib/supabase/server";
import {
  appendAccountsToList,
  MAX_ROWS_PER_REQUEST,
} from "@/lib/services/target-lists";

export const maxDuration = 60;

const PersonSchema = z.object({
  name: z.string().min(1),
  title: z.string().nullish(),
  email: z.string().nullish(),
  linkedin_url: z.string().nullish(),
});

const RowSchema = z.object({
  name: z.string(),
  domain: z.string().nullish(),
  url: z.string().nullish(),
  industry: z.string().nullish(),
  location: z.string().nullish(),
  description: z.string().nullish(),
  person: PersonSchema.nullish(),
  extra: z.record(z.string(), z.string()).optional(),
});

const Body = z.object({
  rows: z
    .array(RowSchema)
    .min(1, "rows array is required and must not be empty"),
});

/** Append a batch of parsed CSV rows to a target account list. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: listId } = await params;

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

  // Cheap length guard before full validation, same shape as import-csv.
  const rawRows = (body as { rows?: unknown } | null)?.rows;
  if (Array.isArray(rawRows) && rawRows.length > MAX_ROWS_PER_REQUEST) {
    return Response.json(
      {
        error: `Too many rows (${rawRows.length}). Send at most ${MAX_ROWS_PER_REQUEST} per request and batch the rest.`,
      },
      { status: 413 },
    );
  }

  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  // Verify the list exists and belongs to the signed-in user (defense in
  // depth on top of RLS).
  const { data: list, error: listError } = await supabase
    .from("target_account_lists")
    .select("id, user_id")
    .eq("id", listId)
    .single();

  if (listError || !list) {
    return Response.json({ error: "List not found" }, { status: 404 });
  }
  if (list.user_id !== user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await appendAccountsToList(
    supabase,
    listId,
    parsed.data.rows,
    {
      userId: user.id,
    },
  );

  const posthog = getPostHogClient();
  posthog.capture({
    distinctId: user.id,
    event: "target_list_accounts_imported",
    properties: {
      list_id: listId,
      imported: result.imported,
      skipped: result.skipped,
      failed: result.failed,
      people_imported: result.peopleImported,
      total: parsed.data.rows.length,
    },
  });

  return Response.json(result);
}
