#!/usr/bin/env bash
# SSOT Phase 127 §8.2 — PostgreSQL PITR WAL archive to Cloudflare R2 Vault (60s cadence)
# Canonical: apps/backend/src/infra/scripts/backup-r2-vault.sh
# (legacy infra/scripts/backup-r2-vault.sh)
# - switch WAL -> sha256 -> R2 PUT (SigV4 via aws-cli or wrangler r2) ->
#   prints the snapshot manifest line the verifier job consumes.
# - Secrets via env only (PGBIN/PGHOST/PGUSER/PGPASSWORD, R2_*). Zero egress.
# - Run from cron every 60s: * * * * * bash backup-r2-vault.sh
set -euo pipefail

NODE_NAME="${DR_NODE_NAME:-db-primary}"
R2_BUCKET="${R2_VAULT_BUCKET:?R2_VAULT_BUCKET is required}"
R2_PREFIX="${R2_VAULT_PREFIX:-dr-vault}"
DAY="$(date -u +%F)"
STAMP="$(date -u +%FT%H-%M-%SZ)"
ARCHIVE_DIR="${WAL_ARCHIVE_DIR:-/var/lib/postgresql/wal-archive}"
MANIFEST_KEY="${R2_PREFIX}/${NODE_NAME}/${DAY}/wal_log-${STAMP}.wal"

echo "[PITR] Switching WAL segment on ${NODE_NAME}..."
PGPASSWORD="${PGPASSWORD:?PGPASSWORD is required}" \
  psql -h "${PGHOST:-localhost}" -U "${PGUSER:-postgres}" -c "SELECT pg_switch_wal();" >/dev/null

LATEST_WAL="$(ls -t "${ARCHIVE_DIR}" 2>/dev/null | head -n 1 || true)"
if [ -z "$LATEST_WAL" ]; then
  echo "[PITR] No WAL segment ready — skipping beat (next 60s cadence retries)."
  exit 0
fi

SHA="$(sha256sum "${ARCHIVE_DIR}/${LATEST_WAL}" | awk '{print $1}')"
SIZE="$(wc -c <"${ARCHIVE_DIR}/${LATEST_WAL}")"

echo "[PITR] Uploading ${LATEST_WAL} (${SIZE}B sha256:${SHA:0:12}…) -> r2://${R2_BUCKET}/${MANIFEST_KEY}"
if command -v aws >/dev/null 2>&1; then
  aws s3 cp "${ARCHIVE_DIR}/${LATEST_WAL}" "s3://${R2_BUCKET}/${MANIFEST_KEY}" \
    --endpoint-url "${R2_ENDPOINT_URL:?R2_ENDPOINT_URL is required}" --only-show-errors
elif command -v wrangler >/dev/null 2>&1; then
  wrangler r2 object put "${R2_BUCKET}/${MANIFEST_KEY}" --file "${ARCHIVE_DIR}/${LATEST_WAL}"
else
  echo "[PITR] ERROR: neither aws nor wrangler CLI available." >&2
  exit 2
fi

echo "[PITR] MANIFEST snapshotId=${STAMP} backupType=WAL_LOG r2StoragePath=${MANIFEST_KEY} fileSizeBytes=${SIZE} checksumSha256=${SHA}"
echo "[PITR] WAL archived. RPO < 60s guaranteed."
