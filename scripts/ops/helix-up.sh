#!/usr/bin/env bash
# Idempotent HelixDB bring-up for the server, mirroring start-local.ps1
# -WithHelix on Windows: ensure the enterprise-dev container is running with
# the local 6969->8080 mapping, wait for the query endpoint, then (re-)seed
# the verified 80-paper literature corpus (the container keeps state in
# memory, so re-seeding after a restart is expected and safe).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

docker inspect helix-open-scientist-dev >/dev/null 2>&1 || \
  docker run -d --name helix-open-scientist-dev --restart unless-stopped \
    -p 6969:8080 ghcr.io/helixdb/enterprise-dev:latest

docker start helix-open-scientist-dev >/dev/null 2>&1 || true

for _ in $(seq 1 30); do
  if curl -sf -m 5 -X POST http://127.0.0.1:6969/v1/query \
      -H 'Content-Type: application/json' -d '{"request_type":"ping"}' >/dev/null 2>&1; then
    break
  fi
  # Empty-body probe also works: any HTTP response (even a parse error) means
  # the gateway is accepting connections.
  if curl -s -m 5 -X POST http://127.0.0.1:6969/v1/query \
      -H 'Content-Type: application/json' -d '{}' | grep -q 'request_type'; then
    break
  fi
  sleep 2
done

PYTHON_EXECUTABLE="${PYTHON_EXECUTABLE:-/opt/miniforge3/envs/os312/bin/python}"
HELIX_URL="${HELIX_URL:-http://127.0.0.1:6969}" \
  node --import "file://$ROOT/apps/api/node_modules/tsx/dist/loader.mjs" scripts/seed-papers.ts
echo "helix ready on 6969 (container: helix-open-scientist-dev)"
