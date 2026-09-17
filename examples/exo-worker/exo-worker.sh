#!/usr/bin/env bash
# Launch ExoWorker via the repo-root exo.sh with ExoWorker defaults.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

export EXO_AGENT_NAME="${EXO_AGENT_NAME:-ExoWorker}"
export EXO_AGENT="${EXO_AGENT:-exo-worker}"
export EXO_CONVERSATION="${EXO_CONVERSATION:-job-1}"
export EXO_CONVERSATION_NAME="${EXO_CONVERSATION_NAME:-First job}"
export EXO_MODULE="${EXO_MODULE:-examples/exo-worker/harness.ts}"
export EXO_TEMPLATE="${EXO_TEMPLATE:-minimal}"
export EXO_SANDBOX_PROVIDER="${EXO_SANDBOX_PROVIDER:-local-process}"
export EXO_SANDBOX_BACKEND="${EXO_SANDBOX_BACKEND:-local-process}"
export EXO_LOCAL_PROMPT_FILE="${EXO_LOCAL_PROMPT_FILE:-$REPO_ROOT/.exo/exo-worker-profile.md}"
export EXO_WORKER_LOCAL_PROMPT_FILE="${EXO_WORKER_LOCAL_PROMPT_FILE:-$EXO_LOCAL_PROMPT_FILE}"
export EXO_WORKER_REPO="${EXO_WORKER_REPO:-/workspace/exo}"
export EXO_WORKER_SELF_MAP="${EXO_WORKER_SELF_MAP:-/workspace/exo/examples/exo-worker/SELF.md}"

cd "$REPO_ROOT"

normalize_provider() {
  case "$1" in
    local_process) printf '%s\n' local-process ;;
    *) printf '%s\n' "$1" ;;
  esac
}

# Agent-scoped sandboxes are durable: updating sandbox_provider on the agent
# does not evict config/agent-sandbox-v2.json. A leftover Docker sandbox then
# fails when the CLI only registers local-process.
clear_durable_agent_sandbox() {
  local agent_id="$1"
  local agent_dir=".exo/exoharness/agents/$agent_id"
  local cid key

  if command -v docker >/dev/null 2>&1; then
    while IFS= read -r cid; do
      [[ -n "$cid" ]] || continue
      key="$(docker inspect -f '{{index .Config.Labels "exo.sandbox.key"}}' "$cid" 2>/dev/null || true)"
      if [[ "$key" == "agent:${agent_id}:"* ]]; then
        docker stop "$cid" >/dev/null 2>&1 || true
        docker rm "$cid" >/dev/null 2>&1 || true
      fi
    done < <(docker ps -aq --filter "label=exo.sandbox.key" 2>/dev/null || true)
  fi

  rm -rf "$agent_dir/sandboxes"

  python3 - "$agent_dir" <<'PY'
import json, pathlib, sys
agent_dir = pathlib.Path(sys.argv[1])
artifacts = agent_dir / "artifacts"
if not artifacts.is_dir():
    raise SystemExit(0)
for meta in artifacts.glob("*/*.json"):
    try:
        data = json.loads(meta.read_text())
    except Exception:
        continue
    if data.get("path") != "config/agent-sandbox-v2.json":
        continue
    meta.unlink(missing_ok=True)
    meta.with_suffix(".bin").unlink(missing_ok=True)
PY
}

durable_agent_sandbox_provider() {
  local agent_id="$1"
  python3 - "$agent_id" <<'PY'
import json, pathlib, sys
agent_id = sys.argv[1]
artifacts = pathlib.Path(".exo/exoharness/agents") / agent_id / "artifacts"
best = None
best_bin = None
if artifacts.is_dir():
    for meta in artifacts.glob("*/*.json"):
        try:
            data = json.loads(meta.read_text())
        except Exception:
            continue
        if data.get("path") != "config/agent-sandbox-v2.json":
            continue
        if best is None or data.get("version", 0) > best.get("version", 0):
            best = data
            best_bin = meta.with_suffix(".bin")
if best_bin and best_bin.is_file():
    print(json.loads(best_bin.read_text()).get("provider", ""))
PY
}

EXO_BIN="${EXO_BIN:-$REPO_ROOT/target/debug/exo}"
if [[ -x "$EXO_BIN" ]] &&
  "$EXO_BIN" --root .exo agent show "$EXO_AGENT" >/dev/null 2>&1; then
  agent_id="$(
    "$EXO_BIN" --root .exo agent show "$EXO_AGENT" |
      awk -F': ' '$1 == "id" { print $2; exit }'
  )"
  agent_provider="$(
    "$EXO_BIN" --root .exo agent show "$EXO_AGENT" |
      awk -F': ' '$1 == "sandbox_provider" { print $2; exit }'
  )"
  durable_provider="$(normalize_provider "$(durable_agent_sandbox_provider "$agent_id")")"

  if [[ -n "$durable_provider" && "$durable_provider" != "$EXO_SANDBOX_PROVIDER" ]]; then
    echo "Clearing durable $durable_provider sandbox so $EXO_AGENT can use $EXO_SANDBOX_PROVIDER..."
    clear_durable_agent_sandbox "$agent_id"
  fi

  if [[ "$agent_provider" != "$EXO_SANDBOX_PROVIDER" ]]; then
    "$EXO_BIN" --root .exo --sandbox-backend "$EXO_SANDBOX_BACKEND" \
      agent update "$EXO_AGENT" \
      --module "$EXO_MODULE" \
      --sandbox-provider "$EXO_SANDBOX_PROVIDER" \
      --sandbox-scope agent \
      --networking enabled >/dev/null
  fi

  if "$EXO_BIN" --root .exo conversation show \
    "$EXO_AGENT" "$EXO_CONVERSATION" >/dev/null 2>&1; then
    conversation_provider="$(
      "$EXO_BIN" --root .exo conversation show "$EXO_AGENT" "$EXO_CONVERSATION" |
        awk -F': ' '$1 == "sandbox_provider" { print $2; exit }'
    )"
    if [[ "$conversation_provider" != "$EXO_SANDBOX_PROVIDER" ]]; then
      "$EXO_BIN" --root .exo --sandbox-backend "$EXO_SANDBOX_BACKEND" \
        conversation update "$EXO_AGENT" "$EXO_CONVERSATION" \
        --sandbox-provider "$EXO_SANDBOX_PROVIDER" \
        --sandbox-scope agent >/dev/null
    fi
  fi
fi

exec ./exo.sh "$@"
