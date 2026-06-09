#!/usr/bin/env bash
# Run on the server from repo root: ./scripts/local-deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not reachable (check: ls -l /var/run/docker.sock; user in 'docker' group, or correct socket ownership)."
  exit 1
fi

docker compose up -d --build

echo "Waiting for Postgres..."
until docker compose exec -T db pg_isready -U friendtracker >/dev/null 2>&1; do
  sleep 2
done

echo "Waiting for API to be ready (auto-migration runs on startup)..."
until docker compose exec -T api wget -qO- http://localhost:3000/api/health 2>/dev/null | grep -q 'ok'; do
  sleep 2
done

echo "Seeding players and curated builds..."
DATABASE_URL="postgresql://friendtracker:${DB_PASSWORD:-devpassword}@localhost:5474/friendtracker" pnpm seed

echo "Fetching live hero stats from OpenDota..."
DATABASE_URL="postgresql://friendtracker:${DB_PASSWORD:-devpassword}@localhost:5474/friendtracker" pnpm fetch-data

echo "Populating hero builds from stats..."
DATABASE_URL="postgresql://friendtracker:${DB_PASSWORD:-devpassword}@localhost:5474/friendtracker" pnpm populate-builds

echo "Done."
echo "  Web:    http://localhost:8743/"
echo "  Health: http://localhost:8743/api/health"
