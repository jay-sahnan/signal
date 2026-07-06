import { readFileSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";

import { getSupabaseAndUser } from "@/lib/supabase/server";

const VALID_SLUGS = [
  "revenue-agent",
  "qa",
  "customer-intelligence",
  "proactive-agents",
] as const;
type Slug = (typeof VALID_SLUGS)[number];

function slugToFilename(slug: Slug): string {
  return `targeting-${slug}.md`;
}

function isValidSlug(slug: string): slug is Slug {
  return (VALID_SLUGS as readonly string[]).includes(slug);
}

function configPath(filename: string): string {
  return path.join(process.cwd(), "config", filename);
}

export async function GET(request: NextRequest) {
  const ctx = await getSupabaseAndUser();
  if (!ctx) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const slug = request.nextUrl.searchParams.get("slug");

  if (!slug || !isValidSlug(slug)) {
    return Response.json(
      {
        error:
          "Invalid or missing slug. Must be one of: revenue-agent, qa, customer-intelligence, proactive-agents",
      },
      { status: 400 },
    );
  }

  const filename = slugToFilename(slug);
  const filePath = configPath(filename);

  try {
    const content = readFileSync(filePath, "utf8");
    const stats = statSync(filePath);
    return Response.json({
      slug,
      filename,
      content,
      lastModified: stats.mtime.toISOString(),
    });
  } catch {
    return Response.json(
      { error: `File not found: ${filename}` },
      { status: 404 },
    );
  }
}

export async function POST(request: NextRequest) {
  const ctx = await getSupabaseAndUser();
  if (!ctx) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { slug, content } = body as { slug: string; content: string };

  if (!slug || !isValidSlug(slug)) {
    return Response.json(
      {
        error:
          "Invalid or missing slug. Must be one of: revenue-agent, qa, customer-intelligence, proactive-agents",
      },
      { status: 400 },
    );
  }

  if (typeof content !== "string") {
    return Response.json(
      { error: "content must be a string" },
      { status: 400 },
    );
  }

  const filename = slugToFilename(slug);
  const filePath = configPath(filename);

  try {
    writeFileSync(filePath, content, "utf8");
    const stats = statSync(filePath);
    return Response.json({
      success: true,
      slug,
      filename,
      lastModified: stats.mtime.toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json(
      { error: `Failed to write file: ${message}` },
      { status: 500 },
    );
  }
}
