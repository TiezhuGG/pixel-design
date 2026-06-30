#!/usr/bin/env bash
set -euo pipefail

BRANCH="${PIXELDESIGN_DEPLOY_BRANCH:-${DEPLOY_BRANCH:-main}}"
COMPOSE_FILE="${PIXELDESIGN_COMPOSE_FILE:-docker-compose.yml}"
export COMPOSE_PROJECT_NAME="${PIXELDESIGN_COMPOSE_PROJECT_NAME:-pixeldesign}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is not installed" >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "docker compose plugin is not installed" >&2
  exit 1
fi

echo "==> Fetching latest code from ${BRANCH}"
git fetch origin "${BRANCH}"
git checkout "${BRANCH}"
git pull --ff-only origin "${BRANCH}"

echo "==> Rebuilding and restarting Docker services"
docker compose -f "${COMPOSE_FILE}" up -d --build --remove-orphans

echo "==> Cleaning dangling Docker images"
docker image prune -f

echo "==> Current containers"
docker compose -f "${COMPOSE_FILE}" ps
