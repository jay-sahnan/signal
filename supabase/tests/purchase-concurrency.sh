#!/usr/bin/env bash
set -euo pipefail
container=$1
test_tmp=$(mktemp -d)
trap 'rm -f "$test_tmp/first" "$test_tmp/second"; rmdir "$test_tmp"' EXIT
docker exec -i "$container" psql -X -q -U postgres -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
set role service_role;
select public.ensure_workspace('purchase-race') as w \gset
insert into public.workspace_billing(workspace_id, stripe_customer_id) values(:'w', 'cus_race');
select public.grant_credits(:'w', 'purchase-race-credit', 1, 'v1', null);
SQL
docker exec -i -e PGAPPNAME=signal-purchase-race "$container" \
  psql -X -Atq -U postgres -v ON_ERROR_STOP=1 > "$test_tmp/first" 2>&1 <<'SQL' &
begin;
set local role service_role;
select id from public.workspaces where owner_user_id = 'purchase-race' for update;
select pg_sleep(2);
select (public.reserve_credits((select id from public.workspaces where owner_user_id = 'purchase-race'),
  'purchase-race', 'research', repeat('a',64), 'research', 'web', 1, 'v1')).id;
commit;
SQL
first_pid=$!
ready=false
for attempt in {1..50}; do
  if [ "$(docker exec "$container" psql -X -Atq -U postgres -c "select count(*) from pg_stat_activity where application_name = 'signal-purchase-race' and wait_event = 'PgSleep'")" = 1 ]; then ready=true; break; fi
  sleep 0.1
done
if [ "$ready" != true ]; then wait "$first_pid"; echo 'Purchase race did not reach barrier' >&2; exit 1; fi
if ! docker exec -i "$container" psql -X -Atq -U postgres -v ON_ERROR_STOP=1 > "$test_tmp/second" 2>&1 <<'SQL'
set role service_role;
select (public.claim_credit_order((select id from public.workspaces where owner_user_id = 'purchase-race'),
  'purchase-race', 'price_pack', 100, 'v1', 1000, 'usd', null)).id;
SQL
then
  wait "$first_pid" || true; cat "$test_tmp/first" "$test_tmp/second"; exit 1
fi
if ! wait "$first_pid"; then cat "$test_tmp/first" "$test_tmp/second"; exit 1; fi
echo 'Passed: checkout and research use compatible lock ordering'
