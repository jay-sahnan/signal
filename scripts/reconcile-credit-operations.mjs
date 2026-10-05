import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const help = `Operator credit recovery (service-role credentials required):
  node scripts/reconcile-credit-operations.mjs list [AFTER_UUID]
  node scripts/reconcile-credit-operations.mjs inspect OPERATION_UUID
  node scripts/reconcile-credit-operations.mjs apply REVIEWED_DECISION.json
See docs/operations/credit-recovery.md. No automatic refunds or provider retries.`;

export async function runCreditRecovery(args, { env = process.env, request = fetch, read = readFile, print = console.log } = {}) {
  if (!args.length || args[0] === "--help") { print(help); return; }
  const [command, value] = args;
  if (!["list", "inspect", "apply"].includes(command) || (command === "list" ? args.length > 2 : args.length !== 2)) throw new Error(help);
  const url = new URL(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || "https://missing.invalid");
  if (url.hostname === "missing.invalid" || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  if (url.username || url.password || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))) throw new Error("Use HTTPS for the database connection");
  async function api(path, body) {
    const response = await request(`${url.origin}/rest/v1/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`Recovery database request failed (HTTP ${response.status}); no outcome should be assumed. Re-inspect and retry the identical decision.`);
    return response.json();
  }
  const columns = "id,workspace_id,user_id,kind,source,state,credits,charged,execution_attempt,created_at,started_at,finished_at";
  async function inspect(id) {
    if (!uuid.test(id)) throw new Error("Valid operation UUID required");
    const rows = await api(`credit_operations?id=eq.${id}&select=${columns}&limit=1`);
    if (rows.length !== 1) throw new Error("Operation not found");
    return rows[0];
  }
  if (command === "list") {
    if (value && !uuid.test(value)) throw new Error("Valid page cursor UUID required");
    const rows = await api(`credit_operations?state=eq.uncertain&select=${columns}&order=id.asc&limit=101${value ? `&id=gt.${value}` : ""}`);
    const operations = rows.slice(0, 100);
    print(JSON.stringify({ operations, nextAfter: rows.length > 100 ? operations[99].id : null }, null, 2));
    return;
  }
  if (command === "inspect") {
    const operation = await inspect(value);
    const usage = await api(`api_usage?credit_operation_id=eq.${value}&select=id,service,operation,estimated_cost_usd,created_at,metadata&order=created_at.asc&limit=101`);
    const audit = await api(`credit_operation_reconciliations?operation_id=eq.${value}&select=*`);
    print(JSON.stringify({ operation, usage: usage.slice(0, 100), usageTruncated: usage.length > 100, audit,
      guidance: "Missing usage is not proof that no work occurred. Verify provider receipts, application writes and absence of continuing work before deciding." }, null, 2));
    return;
  }
  const decision = JSON.parse(await read(value, "utf8"));
  if (!decision || !uuid.test(decision.operationId) || !uuid.test(decision.attemptId)
    || typeof decision.operator !== "string" || decision.operator.trim().length < 3
    || typeof decision.evidenceReference !== "string" || decision.evidenceReference.trim().length < 8
    || decision.applicationWritesChecked !== true || decision.executionStopped !== true || !["completed", "no_work", "waived"].includes(decision.outcome)
    || decision.result === undefined) throw new Error("Reviewed provider evidence, application writes, operator, attempt and replay result are required");
  if (!Number.isSafeInteger(decision.charged) || decision.charged < 0 || (["no_work", "waived"].includes(decision.outcome) && decision.charged !== 0)) throw new Error("Invalid final charge for the confirmed outcome");
  const operation = await inspect(decision.operationId);
  if (!["uncertain", "succeeded"].includes(operation.state) || operation.execution_attempt !== decision.attemptId) throw new Error("Only the inspected uncertain attempt can be settled; inspect again");
  if (operation.state === "succeeded") {
    const audit = await api(`credit_operation_reconciliations?operation_id=eq.${decision.operationId}&select=operation_id&limit=1`);
    if (audit.length !== 1) throw new Error("Operation completed outside operator recovery; inspect the saved outcome instead of retrying this decision");
  }
  if (decision.charged > operation.credits) throw new Error("Final charge exceeds the reserved quote");
  const applied = await api("rpc/reconcile_credit_operation", {
    p_id: decision.operationId, p_attempt: decision.attemptId, p_operator: decision.operator,
    p_evidence: `${decision.outcome}: ${decision.evidenceReference}`, p_charged: decision.charged,
    p_result: JSON.stringify(decision.result),
  });
  print(JSON.stringify({ operationId: decision.operationId, applied, message: applied ? "Audited settlement saved" : "Identical decision was already applied" }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCreditRecovery(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
