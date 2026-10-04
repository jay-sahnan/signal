#!/usr/bin/env bash
set -euo pipefail
container=$1
test_tmp=$(mktemp -d)
trap 'rm -f "$test_tmp/first" "$test_tmp/second"; rmdir "$test_tmp"' EXIT
docker exec -i "$container" psql -X -q -U postgres -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
set role service_role;
select public.grant_credits(public.ensure_workspace('last-credit'), 'last-credit-purchase', 1, 'v1', null);
SQL
docker exec -i -e PGAPPNAME=signal-credit-race "$container" \
  psql -X -Atq -U postgres -v ON_ERROR_STOP=1 > "$test_tmp/first" <<'SQL' &
begin;
set local role service_role;
select (public.reserve_credits((select id from public.workspaces where owner_user_id = 'last-credit'),
  'last-credit', 'first', repeat('a',64), 'research', 'web', 1, 'v1')).id;
select pg_sleep(2);
commit;
SQL
first_pid=$!
ready=false
for attempt in {1..50}; do
  if [ "$(docker exec "$container" psql -X -Atq -U postgres -c "select count(*) from pg_stat_activity where application_name = 'signal-credit-race' and wait_event = 'PgSleep'")" = 1 ]; then ready=true; break; fi
  sleep 0.1
done
if [ "$ready" != true ]; then wait "$first_pid"; echo 'Credit race did not reach barrier' >&2; exit 1; fi
if docker exec -i "$container" psql -X -Atq -U postgres -v ON_ERROR_STOP=1 > "$test_tmp/second" 2>&1 <<'SQL'
set role service_role;
select (public.reserve_credits((select id from public.workspaces where owner_user_id = 'last-credit'),
  'last-credit', 'second', repeat('b',64), 'research', 'mcp', 1, 'v1')).id;
SQL
then
  wait "$first_pid"; echo 'Both requests reserved the last credit' >&2; exit 1
fi
wait "$first_pid"
grep -q 'Insufficient credits' "$test_tmp/second"
test "$(docker exec "$container" psql -X -Atq -U postgres -c "select count(*) from public.credit_operations where workspace_id = (select id from public.workspaces where owner_user_id = 'last-credit')")" = 1
echo 'Passed: concurrent web and MCP requests cannot reserve the same last credit'
