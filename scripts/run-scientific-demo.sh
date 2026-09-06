#!/usr/bin/env bash
# Linux/macOS equivalent of scripts/run-scientific-demo.ps1: one-command
# reproduction of the core scientific output (local-grounded by default).
# See README "提交用一键核心 Demo". Requires: curl, git, python3, pnpm.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

EXECUTION_MODE='local-grounded'
MAX_ROUNDS=2
PROJECT_ID='submission-demo'
API_PORT=3002
REQUEST_TIMEOUT_SECONDS=1800
SKIP_START=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --execution-mode) EXECUTION_MODE="$2"; shift 2 ;;
    --max-rounds) MAX_ROUNDS="$2"; shift 2 ;;
    --project-id) PROJECT_ID="$2"; shift 2 ;;
    --api-port) API_PORT="$2"; shift 2 ;;
    --request-template) REQUEST_TEMPLATE="$2"; shift 2 ;;
    --skip-start) SKIP_START=1; shift ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

API_BASE="http://127.0.0.1:$API_PORT"
REQUEST_TEMPLATE="${REQUEST_TEMPLATE:-$ROOT/examples/ar11158-scientific-demo.request.json}"
RUNTIME="$ROOT/.runtime/submission-demo"
OUTPUT="$ROOT/output/scientific-demo"
mkdir -p "$RUNTIME" "$OUTPUT"

read_env() {
  local key="$1" value=''
  if [[ -f "$ROOT/.env" ]]; then
    value="$(grep -E "^\s*${key}\s*=" "$ROOT/.env" | tail -1 | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'\$//")"
  fi
  printf '%s' "$value"
}

# Import the project .env into this process (mirrors start-local.ps1). The API
# resolves the python interpreter from its own process env only
# (PYTHON_EXECUTABLE || 'python') — without this export the PATH fallback can
# pick an unrelated interpreter (e.g. one bundled with Inkscape) and every
# deterministic diagnostic then fails with ModuleNotFoundError.
if [[ -f "$ROOT/.env" ]]; then
  while IFS='=' read -r key value; do
    key="${key//[[:space:]]/}"
    [[ -z "$key" || "$key" == \#* ]] && continue
    value="${value%$'\r'}"
    value="${value#\"}"; value="${value%\"}"
    value="${value#\'}"; value="${value%\'}"
    if [[ -n "$key" && -n "$value" ]]; then
      export "$key=$value"
    fi
  done < <(grep -v '^[[:space:]]*$' "$ROOT/.env")
fi

CORONAL_DATASET_ID="$(read_env CORONAL_DATASET_ID)"
CORONAL_DATASET_ID="${CORONAL_DATASET_ID:-coronal-starter-v1}"
export CORONAL_DATASET_ID
MANIFEST="$ROOT/data/dataset/$CORONAL_DATASET_ID/manifest.json"
if [[ ! -f "$MANIFEST" ]]; then
  echo "Missing dataset manifest: $MANIFEST" >&2
  echo "Fetch or prepare dataset '$CORONAL_DATASET_ID' first (README section 4: 下载日冕数据)." >&2
  exit 1
fi

PYTHON_EXECUTABLE="${PYTHON_EXECUTABLE:-$(read_env PYTHON_EXECUTABLE)}"
PYTHON_EXECUTABLE="${PYTHON_EXECUTABLE:-python3}"
if ! command -v "$PYTHON_EXECUTABLE" >/dev/null 2>&1; then
  PYTHON_EXECUTABLE=python
fi
echo "Python preflight: $PYTHON_EXECUTABLE"
if ! "$PYTHON_EXECUTABLE" -c "import numpy, astropy, matplotlib, sunpy" 2>/dev/null; then
  echo "Python scientific stack preflight failed for '$PYTHON_EXECUTABLE'." >&2
  echo "Install the locked dependencies (requirements.txt) or point PYTHON_EXECUTABLE" >&2
  echo "at a suitable interpreter, e.g.: PYTHON_EXECUTABLE=/path/to/python $0" >&2
  exit 1
fi

healthy() { curl -sf -m 5 "$API_BASE/api/health" | grep -q '"status":"ok"'; }
if ! healthy; then
  if [[ "$SKIP_START" == 1 ]]; then
    echo "API is not healthy at $API_BASE and --skip-start was supplied." >&2
    exit 1
  fi
  echo "Starting API on port $API_PORT (log: .runtime/submission-demo/api.log)..."
  PORT="$API_PORT" nohup pnpm --filter @open-scientist/api dev > "$RUNTIME/api.log" 2>&1 &
  for _ in $(seq 1 60); do
    healthy && break
    sleep 2
  done
fi
healthy || { echo "API did not become healthy at $API_BASE (see $RUNTIME/api.log)." >&2; exit 1; }

SERVED_DATASET="$(curl -sf -m 5 "$API_BASE/api/health" | "$PYTHON_EXECUTABLE" -c "import json,sys; print(json.load(sys.stdin).get('coronalDatasetId',''))")"
if [[ "$SERVED_DATASET" != "$CORONAL_DATASET_ID" ]]; then
  echo "API dataset mismatch: requested '$CORONAL_DATASET_ID' but API serves '$SERVED_DATASET'." >&2
  echo "Stop the local services, set CORONAL_DATASET_ID, and restart before running the demo." >&2
  exit 1
fi

PROJECT_STATUS="$(curl -s -o /dev/null -w '%{http_code}' -m 10 "$API_BASE/api/projects/$PROJECT_ID")"
if [[ "$PROJECT_STATUS" == "404" ]]; then
  curl -sf -m 20 -X POST -H 'Content-Type: application/json' -d "{\"name\":\"$PROJECT_ID\"}" "$API_BASE/api/projects" >/dev/null
fi

REQUEST_PATH="$RUNTIME/request.json"
"$PYTHON_EXECUTABLE" - "$REQUEST_TEMPLATE" "$EXECUTION_MODE" "$MAX_ROUNDS" "$REQUEST_PATH" <<'PY'
import json, sys
request = json.load(open(sys.argv[1], encoding='utf-8'))
request['executionMode'] = sys.argv[2]
request['maxRounds'] = int(sys.argv[3])
json.dump(request, open(sys.argv[4], 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
PY

HEADERS_PATH="$RUNTIME/response.headers.txt"
SSE_PATH="$RUNTIME/response.sse"
echo "Running $EXECUTION_MODE scientific demo (maxRounds=$MAX_ROUNDS)..."
set +e
curl -N --max-time "$REQUEST_TIMEOUT_SECONDS" -sS -D "$HEADERS_PATH" \
  -H 'Content-Type: application/json' --data-binary "@$REQUEST_PATH" \
  "$API_BASE/api/projects/$PROJECT_ID/runs" -o "$SSE_PATH"
CURL_EXIT=$?
set -e
if [[ $CURL_EXIT -ne 0 ]]; then
  RUN_ID="$(grep -i '^x-workflow-run-id:' "$HEADERS_PATH" 2>/dev/null | tail -1 | tr -d '\r' | awk '{print $2}')"
  echo "SSE stream ended early (curl $CURL_EXIT)." >&2
  if [[ -n "${RUN_ID:-}" ]]; then
    echo "The run persists server-side; reconnect with:" >&2
    echo "  curl -N --max-time $REQUEST_TIMEOUT_SECONDS '$API_BASE/api/projects/$PROJECT_ID/runs/$RUN_ID/stream' -o $SSE_PATH" >&2
  fi
  exit 1
fi

COMPLETION_LINE="$(grep 'scientific.loop-complete' "$SSE_PATH" | tail -1 || true)"
if [[ -z "$COMPLETION_LINE" ]]; then
  echo "The stream ended without scientific.loop-complete. Inspect $SSE_PATH." >&2
  tail -5 "$SSE_PATH" >&2 || true
  exit 1
fi

GIT_COMMIT="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
# The loop-complete SSE line embeds the full multi-MB result, so it must be
# parsed inside python from the file — passing it as argv overflows on Windows.
"$PYTHON_EXECUTABLE" - "$SSE_PATH" "$MANIFEST" "$REQUEST_PATH" "$GIT_COMMIT" "$OUTPUT" <<'PY'
import hashlib, json, os, subprocess, sys

sse_path, manifest_path, request_path, git_commit, out_dir = sys.argv[1:6]
completion_line = None
for line in open(sse_path, encoding='utf-8'):
    if 'scientific.loop-complete' in line:
        completion_line = line
if not completion_line:
    sys.exit('no scientific.loop-complete line in sse stream')
payload = json.loads(completion_line[len('data: '):].strip())
result = payload['result']

def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()

json.dump(result, open(os.path.join(out_dir, 'scientific-result.json'), 'w', encoding='utf-8'),
          ensure_ascii=False, indent=2)
json.dump(json.load(open(request_path, encoding='utf-8')),
          open(os.path.join(out_dir, 'request.json'), 'w', encoding='utf-8'),
          ensure_ascii=False, indent=2)
preprocessing = sorted({
    event.get('preprocessing', {}).get('version')
    for line in open(sse_path, encoding='utf-8')
    if 'scientific.processing-result' in line
    for event in [json.loads(line[len('data: '):].strip())]
    if event.get('preprocessing', {}).get('version')
})
dirty = subprocess.run(['git', 'status', '--porcelain'], capture_output=True, text=True).stdout.splitlines()
metadata = {
    'runId': result.get('runId'),
    'datasetId': os.environ.get('CORONAL_DATASET_ID'),
    'datasetManifestSha256': sha256(manifest_path),
    'requestSha256': sha256(request_path),
    'sseStreamPath': 'response.sse',
    'codeCommit': git_commit,
    'codeStateDirtyFiles': len(dirty),
    'preprocessingVersions': preprocessing,
    'terminationReason': result.get('terminationReason'),
}
json.dump(metadata, open(os.path.join(out_dir, 'run-metadata.json'), 'w', encoding='utf-8'),
          ensure_ascii=False, indent=2)
summary = {
    'runId': result.get('runId'),
    'terminationReason': result.get('terminationReason'),
    'hypotheses': len(result.get('hypotheses', [])),
    'evidence': len(result.get('evidence', [])),
    'validationTasks': len(result.get('validationTasks', [])),
}
print(json.dumps(summary, ensure_ascii=False))
PY

cp "$SSE_PATH" "$OUTPUT/response.sse"
[[ -f "$HEADERS_PATH" ]] && cp "$HEADERS_PATH" "$OUTPUT/response.headers.txt"
echo "Scientific demo complete. Result: $OUTPUT/scientific-result.json"
