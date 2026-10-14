#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
case "${1:-status}" in
  up) node lab/preflight.mjs; docker compose -p marketplace-lab --env-file lab/.env -f compose.yaml -f lab/compose.yaml up --build --wait --wait-timeout 60 ;;
  status) docker compose -p marketplace-lab --env-file lab/.env -f compose.yaml -f lab/compose.yaml ps ;;
  stop) docker compose -p marketplace-lab --env-file lab/.env -f compose.yaml -f lab/compose.yaml down ;;
  fault) LAB_FAULT=unhealthy docker compose -p marketplace-lab --env-file lab/.env -f compose.yaml -f lab/compose.yaml up --no-deps --wait --wait-timeout 20 test-service ;;
  recover) LAB_FAULT=healthy docker compose -p marketplace-lab --env-file lab/.env -f compose.yaml -f lab/compose.yaml up --no-deps --wait --wait-timeout 30 test-service ;;
  *) echo "Allowed: up, status, stop, fault, recover" >&2; exit 1 ;;
esac
