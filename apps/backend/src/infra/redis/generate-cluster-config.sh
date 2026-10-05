#!/bin/sh
# SSOT Phase 002 §5 — render per-node redis.conf from redis-cluster.tmpl
# Usage: REDIS_PASSWORD=... sh generate-cluster-config.sh [output-dir]
set -eu
OUT_DIR="${1:-./redis-cluster-conf}"
PASSWORD="${REDIS_PASSWORD:-RedisSecure144XZ}"
BASE_PORT="${REDIS_BASE_PORT:-7000}"
TEMPLATE="$(dirname "$0")/redis-cluster.tmpl"
mkdir -p "$OUT_DIR"
i=0
while [ "$i" -lt 6 ]; do
  PORT=$((BASE_PORT + i))
  DIR="$OUT_DIR/node-$((i + 1))"
  mkdir -p "$DIR"
  sed -e "s/{{PORT}}/$PORT/g" -e "s|{{DIR}}|$DIR|g" -e "s/{{PASSWORD}}/$PASSWORD/g" "$TEMPLATE" > "$DIR/redis.conf"
  echo "wrote $DIR/redis.conf"
  i=$((i + 1))
done
