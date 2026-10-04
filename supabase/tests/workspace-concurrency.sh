#!/usr/bin/env bash
set -euo pipefail
container=$1
test_tmp=$(mktemp -d)
trap 'rm -f "$test_tmp/first" "$test_tmp/second"; rmdir "$test_tmp"' EXIT
docker exec -i -e PGAPPNAME=signal-workspace-race "$container" \
  psql -X -Atq -U postgres -v ON_ERROR_STOP=1 > "$test_tmp/first" <<'SQL' &
begin;
set local role service_role;
select public.ensure_workspace('concurrent-first-signup');
select pg_sleep(2);
commit;
SQL
first_pid=$!
ready=false
for attempt in {1..50}; do
  if [ "$(docker exec "$container" psql -X -Atq -U postgres -c "select count(*) from pg_stat_activity where application_name = 'signal-workspace-race' and wait_event = 'PgSleep'")" = 1 ]; then
    ready=true
    break
  fi
  sleep 0.1
done
if [ "$ready" != true ]; then wait "$first_pid"; echo 'Concurrent test did not reach its barrier' >&2; exit 1; fi
docker exec -i "$container" psql -X -Atq -U postgres -v ON_ERROR_STOP=1 > "$test_tmp/second" <<'SQL'
set role service_role;
select public.ensure_workspace('concurrent-first-signup');
SQL
wait "$first_pid"
test "$(head -n 1 "$test_tmp/first")" = "$(head -n 1 "$test_tmp/second")"
echo 'Passed: simultaneous first-time workspace provisioning'
