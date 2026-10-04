#!/usr/bin/env bash
# Real PostgreSQL policies and migrations; not a Supabase HTTP/auth emulator.
set -euo pipefail
cd "$(dirname "$0")/.."
container="signal-sql-test-$$-$RANDOM"
docker run --detach --rm --name "$container" --network none \
  -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17-alpine >/dev/null
trap 'docker rm --force "$container" >/dev/null 2>&1 || true' EXIT
for attempt in {1..30}; do
  if docker exec "$container" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
run_sql() {
  docker exec -i "$container" psql -X -q -U postgres -v ON_ERROR_STOP=1 < "$1" >/dev/null
}
run_sql supabase/test-support/auth-fixture.sql
for migration in supabase/migrations/*.sql; do run_sql "$migration"; done
for test in supabase/tests/*.sql; do
  run_sql "$test"
  echo "Passed: $test"
done
bash supabase/tests/workspace-concurrency.sh "$container"
