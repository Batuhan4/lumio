#!/usr/bin/env bash
set -euo pipefail

if ! command -v stellar >/dev/null 2>&1; then
  echo "The 'stellar' CLI is required but was not found in PATH." >&2
  exit 1
fi

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PROJECT_ROOT=$(cd "${SCRIPT_DIR}/.." && pwd)

ENV_FILE="${PROJECT_ROOT}/.env.local"
RUNNER_ENV="${PROJECT_ROOT}/packages/runner_service/.env.runner"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing .env.local. Run scripts/bootstrap-agent.ts manually." >&2
  exit 1
fi

if [[ ! -f "${RUNNER_ENV}" ]]; then
  echo "Missing packages/runner_service/.env.runner. Create it first." >&2
  exit 1
fi

source "${ENV_FILE}"
source "${RUNNER_ENV}"

if [[ -z "${RUNNER_SECRET:-}" ]]; then
  echo "RUNNER_SECRET is not set in .env.runner." >&2
  exit 1
fi

if [[ -z "${VITE_RUNNER_PUBLIC_KEY:-}" ]]; then
  echo "VITE_RUNNER_PUBLIC_KEY must be set in .env.local." >&2
  exit 1
fi

if [[ -z "${RUNNER_CONTRACT_ID:-}" ]]; then
  echo "RUNNER_CONTRACT_ID must be set in .env.runner." >&2
  exit 1
fi

if [[ -z "${RUNNER_AGENT_REGISTRY_ID:-}" ]]; then
  echo "RUNNER_AGENT_REGISTRY_ID must be set in .env.runner." >&2
  exit 1
fi

ACCOUNT_NAME=${1:-"me"}

echo "Checking local account '${ACCOUNT_NAME}'..."
ACCOUNT_SECRET=$(stellar keys show "${ACCOUNT_NAME}")
ACCOUNT_ADDRESS=$(stellar keys address "${ACCOUNT_NAME}")

echo "Funding account ${ACCOUNT_ADDRESS} via friendbot..."
curl -sf "http://localhost:8000/friendbot?addr=${ACCOUNT_ADDRESS}" >/dev/null || true

echo "Registering runner in agent registry..."
stellar contract invoke \
  --network development \
  --id "${RUNNER_AGENT_REGISTRY_ID}" \
  --source "${ACCOUNT_NAME}" \
  -- register_agent \
  --developer "${ACCOUNT_ADDRESS}" \
  --metadata_uri null \
  --runners "[\"${VITE_RUNNER_PUBLIC_KEY}\"]" \
  --initial_rate_card '{ "manifest_hash": "0000000000000000000000000000000000000000000000000000000000000000", "rates": { "http_calls": "100000000", "llm_in": "10000", "llm_out": "20000", "runtime_ms": "1" } }'

echo "Registering agent complete."

echo "Registering runner grant for account ${ACCOUNT_ADDRESS}..."
stellar contract invoke \
  --network development \
  --id "${RUNNER_CONTRACT_ID}" \
  --source "${ACCOUNT_NAME}" \
  -- grant_runner \
  --user "${ACCOUNT_ADDRESS}" \
  --runner "${VITE_RUNNER_PUBLIC_KEY}" \
  --agent_id 1 \
  --expires_at null

echo "Bootstrapping complete."
