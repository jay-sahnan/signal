import { fetchRealSpend } from "@/lib/services/real-spend";
import { getSupabaseAndUser } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const ctx = await getSupabaseAndUser();
  if (!ctx) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { supabase } = ctx;

  const { searchParams } = new URL(request.url);
  const period = searchParams.get("period") || "30d";
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(searchParams.get("pageSize") || "20", 10)),
  );

  // Calculate date cutoff
  let since: string | null = null;
  if (period === "24h") {
    since = new Date(Date.now() - 86400000).toISOString();
  } else if (period === "7d") {
    since = new Date(Date.now() - 7 * 86400000).toISOString();
  } else if (period === "30d") {
    since = new Date(Date.now() - 30 * 86400000).toISOString();
  }
  const nowIso = new Date().toISOString();
  const realSpendStart =
    since ?? new Date(Date.now() - 365 * 86400000).toISOString();

  // Build queries -- apply date filter inline to avoid type gymnastics
  const totalQuery = supabase.from("api_usage").select("estimated_cost_usd");
  const serviceQuery = supabase
    .from("api_usage")
    .select("service, estimated_cost_usd");
  const opQuery = supabase
    .from("api_usage")
    .select(
      "service, operation, estimated_cost_usd, tokens_input, tokens_output",
    );
  const dailyQuery = supabase
    .from("api_usage")
    .select("created_at, service, estimated_cost_usd")
    .order("created_at", { ascending: true });

  if (since) {
    totalQuery.gte("created_at", since);
    serviceQuery.gte("created_at", since);
    opQuery.gte("created_at", since);
    dailyQuery.gte("created_at", since);
  }

  const recentQuery = supabase
    .from("api_usage")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (since) recentQuery.gte("created_at", since);

  const [
    totalRes,
    byServiceRes,
    byOperationRes,
    dailyRes,
    recentRes,
    realSpend,
  ] = await Promise.all([
    totalQuery,
    serviceQuery,
    opQuery,
    dailyQuery,
    recentQuery,
    fetchRealSpend(realSpendStart, nowIso),
  ]);

  // Aggregate total
  const totalCost = (totalRes.data ?? []).reduce(
    (sum: number, r: { estimated_cost_usd: number }) =>
      sum + Number(r.estimated_cost_usd),
    0,
  );

  // Aggregate by service
  const serviceMap = new Map<
    string,
    { cost: number; calls: number; tokens_input: number; tokens_output: number }
  >();
  for (const row of byServiceRes.data ?? []) {
    const prev = serviceMap.get(row.service) ?? {
      cost: 0,
      calls: 0,
      tokens_input: 0,
      tokens_output: 0,
    };
    prev.cost += Number(row.estimated_cost_usd);
    prev.calls++;
    serviceMap.set(row.service, prev);
  }

  // Aggregate by operation
  const opMap = new Map<
    string,
    { cost: number; calls: number; tokens_input: number; tokens_output: number }
  >();
  for (const row of (byOperationRes.data ?? []) as Array<{
    service: string;
    operation: string;
    estimated_cost_usd: number;
    tokens_input: number | null;
    tokens_output: number | null;
  }>) {
    const key = `${row.service}/${row.operation}`;
    const prev = opMap.get(key) ?? {
      cost: 0,
      calls: 0,
      tokens_input: 0,
      tokens_output: 0,
    };
    prev.cost += Number(row.estimated_cost_usd);
    prev.calls++;
    prev.tokens_input += row.tokens_input ?? 0;
    prev.tokens_output += row.tokens_output ?? 0;
    opMap.set(key, prev);
  }

  // Merge token totals into serviceMap
  for (const [key, op] of opMap) {
    const service = key.split("/")[0];
    const svc = serviceMap.get(service);
    if (svc) {
      svc.tokens_input += op.tokens_input;
      svc.tokens_output += op.tokens_output;
    }
  }

  // Daily time series
  const dayMap = new Map<string, Record<string, number>>();
  for (const row of dailyRes.data ?? []) {
    const day = (row.created_at as string).slice(0, 10);
    if (!dayMap.has(day)) dayMap.set(day, {});
    const bucket = dayMap.get(day)!;
    bucket[row.service as string] =
      (bucket[row.service as string] ?? 0) + Number(row.estimated_cost_usd);
    bucket.total = (bucket.total ?? 0) + Number(row.estimated_cost_usd);
  }

  const daily = Array.from(dayMap.entries())
    .map(([date, costs]) => ({ date, ...costs }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Build response
  const byService = Array.from(serviceMap.entries())
    .map(([service, stats]) => ({ service, ...stats }))
    .sort((a, b) => b.cost - a.cost);

  const byOperation = Array.from(opMap.entries())
    .map(([key, stats]) => {
      const [service, operation] = key.split("/");
      return { service, operation, ...stats };
    })
    .sort((a, b) => b.cost - a.cost);

  const recentTotal = recentRes.count ?? 0;

  return Response.json({
    period,
    totalCost,
    byService,
    byOperation,
    daily,
    realSpend,
    recent: recentRes.data ?? [],
    recentPagination: {
      page,
      pageSize,
      totalRows: recentTotal,
      totalPages: Math.ceil(recentTotal / pageSize),
    },
  });
}
