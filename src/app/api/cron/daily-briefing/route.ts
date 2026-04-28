import { NextResponse } from "next/server";

/**
 * Vercel Cron handler — runs daily at 8am ET (12:00 UTC).
 * Calls the internal /api/daily-briefing endpoint with service-role auth.
 */
export async function GET() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json({ error: "Missing service key" }, { status: 500 });
  }

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000");

  const res = await fetch(`${baseUrl}/api/daily-briefing`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceKey}`,
    },
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
