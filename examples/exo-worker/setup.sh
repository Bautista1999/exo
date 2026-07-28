#!/usr/bin/env bash
# ExoWorker first-time setup for an existing exo checkout.
#
# Does not clone or install exo. Run this after checking out the ExoWorker
# branch — it configures .env, registers a model, and creates the ExoWorker
# agent via ./exo.sh.
#
#   git checkout examples/exo-worker
#   bash examples/exo-worker/setup.sh
#   ./exo.sh
set -euo pipefail

SCRIPT_PATH="${BASH_SOURCE[0]:-$0}"
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

MODEL_NAME="${EXO_MODEL:-gpt-5.6-terra}"
MODEL_PROVIDER="${EXO_MODEL_PROVIDER:-}"
UPSTREAM_MODEL="${EXO_UPSTREAM_MODEL:-}"
USER_NAME="${EXO_USER_NAME:-}"
AGENT_NAME="${EXO_AGENT_NAME:-ExoWorker}"
DEFAULT_OPENROUTER_BASE_URL="https://openrouter.ai/api/v1"
DEFAULT_OPENROUTER_MODEL="z-ai/glm-5.2"

die() {
  echo "error: $*" >&2
  exit 1
}

info() {
  echo
  echo "==> $*"
}

print_worker_frame() {
  local line
  if [[ -t 1 && "${TERM:-}" != "dumb" ]]; then
    for line in "$@"; do
      printf '\033[2K\r%s\n' "$line"
    done
  else
    printf '%s\n' "$@"
  fi
}

show_worker_banner() {
  local animated=false
  if [[ -t 1 && "${TERM:-}" != "dumb" ]]; then
    animated=true
  fi

  if [[ "$animated" == true ]]; then
    local frame
    for frame in 1 1 2 1 1 2 1 1 2 1; do
      if [[ "$frame" == 1 ]]; then
        print_worker_frame \
          '              .--------.' \
          '             / .------. \' \
          '            | |  o  o  | |' \
          '            | |   __   | |    ((' \
          '            | '\''--------'\'' |    ))' \
          '           /|    [EXO]   |\ .----.' \
          '          /_|            |_\|    |]' \
          '            |_| |____| |_|  '\''----'\'''
      else
        print_worker_frame \
          '              .--------.' \
          '             / .------. \' \
          '            | |  -  -  | |' \
          '            | |   __   | |    ))' \
          '            | '\''--------'\'' |    ((' \
          '           /|    [EXO]   |\ .----.' \
          '          /_|            |_\|    |]' \
          '            |_| |____| |_|  '\''----'\'''
      fi
      sleep 0.16
      printf '\033[8A'
    done
  fi

  print_worker_frame \
    '              .--------.' \
    '             / .------. \' \
    '            | |  o  o  | |' \
    '            | |   __   | |   ((' \
    '            | '\''--------'\'' |    ))' \
    '           /|    [EXO]   |\ .----.' \
    '          /_|            |_\|    |]' \
    '            |_| |____| |_|  '\''----'\'''

  printf '\n'
  if [[ -t 1 && "${TERM:-}" != "dumb" && -z "${NO_COLOR:-}" ]]; then
    printf '\033[1m'
  fi
  printf ' _____ __  __  ___        __        _____  ____  _  _______ ____  \n'
  printf '| ____|\\ \\/ / / _ \\       \\ \\      / / _ \\|  _ \\| |/ / ____|  _ \\ \n'
  printf '|  _|   \\  / | | | | _____ \\ \\ /\\ / / | | | |_) | '\'' /|  _| | |_) |\n'
  printf '| |___  /  \\ | |_| ||_____| \\ V  V /| |_| |  _ <| . \\| |___|  _ < \n'
  printf '|_____|/_/\\_\\ \\___/          \\_/\\_/  \\___/|_| \\_\\_|\\_\\_____|_| \\_\\\n'
  if [[ -t 1 && "${TERM:-}" != "dumb" && -z "${NO_COLOR:-}" ]]; then
    printf '\033[0m'
    printf '\n                              \033[3mPowered by Exo\033[0m\n\n'
  else
    printf '\n                              Powered by Exo\n\n'
  fi
}

usage() {
  cat <<'EOF'
Usage:
  bash examples/exo-worker/setup.sh [options]

Configure ExoWorker in the current exo checkout. Does not clone or reinstall exo.

Options:
  --help                Show this help

Environment overrides (defaults applied when unset):
  EXO_MODEL, EXO_MODEL_PROVIDER, EXO_UPSTREAM_MODEL, EXO_AGENT_NAME, EXO_AGENT,
  EXO_CONVERSATION, EXO_CONVERSATION_NAME, EXO_MODULE, EXO_LOCAL_PROMPT_FILE,
  EXO_WORKER_REPO, EXO_WORKER_SELF_MAP, EXO_WORKER_LOCAL_PROMPT_FILE,
  EXO_USER_NAME, OPENAI_API_KEY, OPENROUTER_API_KEY
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h)
      usage
      exit 0
      ;;
    *)
      die "unknown option: $1 (see --help)"
      ;;
  esac
done

[[ -f "$REPO_ROOT/exo.sh" && -f "$REPO_ROOT/examples/exo-worker/harness.ts" ]] \
  || die "run this from an exo checkout that contains examples/exo-worker/"

export EXO_AGENT_NAME="$AGENT_NAME"
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

prompt_yes_no() {
  local prompt="$1"
  local default="$2"
  local suffix answer
  case "$default" in
    y|Y) suffix="Y/n" ;;
    n|N) suffix="y/N" ;;
    *) die "invalid yes/no default: $default" ;;
  esac
  while true; do
    read -r -p "$prompt [$suffix]: " answer
    answer="${answer:-$default}"
    case "$answer" in
      y|Y|yes|YES) return 0 ;;
      n|N|no|NO) return 1 ;;
      *) echo "Please answer yes or no." ;;
    esac
  done
}

prompt_text() {
  local prompt="$1"
  local default="$2"
  local value
  read -r -p "$prompt [$default]: " value
  printf '%s' "${value:-$default}"
}

read_secret() {
  local prompt="$1"
  local value="" char
  printf '%s: ' "$prompt" >&2
  while IFS= read -r -s -n1 char; do
    if [[ -z "$char" ]]; then
      break
    fi
    if [[ "$char" == $'\x7f' || "$char" == $'\x08' ]]; then
      if [[ -n "$value" ]]; then
        value="${value%?}"
        printf '\b \b' >&2
      fi
      continue
    fi
    value+="$char"
    printf '*' >&2
  done
  echo >&2
  printf '%s' "$value"
}

env_value() {
  local key="$1"
  local file="$2"
  [[ -f "$file" ]] || return 0
  awk -F= -v key="$key" '
    $1 == key { print substr($0, length(key) + 2); found = 1; exit }
    END { if (!found) exit 1 }
  ' "$file" 2>/dev/null || true
}

set_env_value() {
  local key="$1"
  local value="$2"
  local file="$3"
  local tmp
  [[ "$value" != *$'\n'* ]] || die "$key cannot contain newlines"
  tmp="$(mktemp)"
  if [[ -f "$file" ]] && grep -qE "^${key}=" "$file"; then
    awk -v key="$key" -v value="$value" '
      BEGIN { updated = 0 }
      $0 ~ "^" key "=" {
        print key "=" value
        updated = 1
        next
      }
      { print }
      END { if (!updated) print key "=" value }
    ' "$file" >"$tmp"
  else
    [[ -f "$file" ]] && cp "$file" "$tmp"
    if [[ -s "$tmp" ]]; then
      printf '\n' >>"$tmp"
    fi
    printf '%s=%s\n' "$key" "$value" >>"$tmp"
  fi
  mv "$tmp" "$file"
  chmod 600 "$file"
}

choose_model_provider() {
  echo "Choose the API provider ExoWorker should use:" >&2
  echo "1) OpenAI" >&2
  echo "2) OpenRouter" >&2
  local choice
  while true; do
    read -r -p "Provider [1-2, default 1]: " choice
    case "${choice:-1}" in
      1) printf '%s' openai; return ;;
      2) printf '%s' openrouter; return ;;
      *) echo "Please choose 1 or 2." >&2 ;;
    esac
  done
}

configure_model_provider() {
  local provider="$1"
  case "$provider" in
    openai)
      MODEL_PROVIDER_LABEL="OpenAI"
      MODEL_API_KEY_ENV="OPENAI_API_KEY"
      MODEL_BASE_URL=""
      DEFAULT_UPSTREAM_MODEL="$MODEL_NAME"
      ;;
    openrouter)
      MODEL_PROVIDER_LABEL="OpenRouter"
      MODEL_API_KEY_ENV="OPENROUTER_API_KEY"
      MODEL_BASE_URL="$DEFAULT_OPENROUTER_BASE_URL"
      DEFAULT_UPSTREAM_MODEL="$DEFAULT_OPENROUTER_MODEL"
      ;;
    *)
      die "unsupported model provider: $provider"
      ;;
  esac
}

prompt_env_secret() {
  local key="$1"
  local file="$2"
  local description="$3"
  local existing env_existing value
  existing="$(env_value "$key" "$file")"
  if [[ -n "$existing" ]]; then
    echo "$key is already set in .env; using it."
    return
  fi
  env_existing="${!key:-}"
  if [[ -n "$env_existing" ]]; then
    if prompt_yes_no "$key is set in your shell environment. Use it for .env?" y; then
      set_env_value "$key" "$env_existing" "$file"
      return
    fi
  fi
  while true; do
    value="$(read_secret "$description")"
    if [[ -n "$value" ]]; then
      set_env_value "$key" "$value" "$file"
      return
    fi
    echo "$key is required."
  done
}

show_worker_banner
echo "ExoWorker setup"
echo "Checkout: $REPO_ROOT"
echo "Module:   $EXO_MODULE"
echo

info "Build exo CLI"
./exo.sh build

ENV_FILE="$REPO_ROOT/.env"
if [[ ! -f "$ENV_FILE" && -f "$REPO_ROOT/.env.example" ]]; then
  cp "$REPO_ROOT/.env.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
else
  touch "$ENV_FILE"
  chmod 600 "$ENV_FILE"
fi

info "Configure model provider"
if [[ -z "$MODEL_PROVIDER" ]]; then
  MODEL_PROVIDER="$(choose_model_provider)"
fi
configure_model_provider "$MODEL_PROVIDER"
echo "Using $MODEL_PROVIDER_LABEL."

if [[ -z "$UPSTREAM_MODEL" ]]; then
  if [[ "$MODEL_PROVIDER" == "openrouter" ]]; then
    UPSTREAM_MODEL="$(prompt_text "OpenRouter model id" "$DEFAULT_UPSTREAM_MODEL")"
  else
    UPSTREAM_MODEL="$DEFAULT_UPSTREAM_MODEL"
  fi
fi

info "Configure API keys"
prompt_env_secret "$MODEL_API_KEY_ENV" "$ENV_FILE" \
  "$MODEL_PROVIDER_LABEL API key"

info "Configure ExoWorker"
USER_NAME="$(prompt_text "Your name, or blank to skip" "$USER_NAME")"
AGENT_NAME="$(prompt_text "Agent display name" "$AGENT_NAME")"
export EXO_AGENT_NAME="$AGENT_NAME"
./exo.sh write-profile ${USER_NAME:+--user-name "$USER_NAME"}

info "Store secrets and register model"
./exo.sh register-model --model "$MODEL_NAME" \
  --upstream-model "$UPSTREAM_MODEL" \
  --secret-name "$MODEL_PROVIDER" --secret-env "$MODEL_API_KEY_ENV" \
  ${MODEL_BASE_URL:+--base-url "$MODEL_BASE_URL"}

info "Create ExoWorker agent"
./exo.sh setup-agent --agent-name "$AGENT_NAME"

cat <<EOF

ExoWorker is ready in this checkout.

Start chatting:
  bash examples/exo-worker/exo-worker.sh

Do not run plain ./exo.sh for ExoWorker — that starts the canonical Exo agent.
EOF
