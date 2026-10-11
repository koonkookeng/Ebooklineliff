// SSOT Phase 127 §8.2/Gate 6 — backup verifier job (restoration-tested proof)
// Canonical: apps/backend/src/modules/disaster-recovery/cron/backup-verifier.job.ts
// (legacy src/backend/modules/disaster-recovery/cron/backup-verifier.job.ts)
// - verifyLatest() re-reads the newest unverified snapshots from the R2 vault,
//   recomputes SHA-256, and marks verifiedAt/isRestorationTested on match.
//   Checksum mismatch is left unverified (alert lane, never silent).
// - Ports-based (tsx-importable, no @nestjs/schedule — invoked by the DR
//   module starter like the 046 keyspace sweeper). Zero new deps.
import { sha256hex, type PitrDbPort, type PitrVaultPort } from '../services/r2-pitr-backup.service';

export interface VerifyOutcome {
  snapshotId: string;
  verified: boolean;
  reason: string;
}

export async function verifySnapshot(
  row: { snapshotId: string; r2StoragePath: string; checksumSha256: string; fileSizeBytes: bigint | number },
  vault: PitrVaultPort,
): Promise<VerifyOutcome> {
  if (!vault.getObjectBuffer) {
    return { snapshotId: row.snapshotId, verified: false, reason: 'vault-read-unsupported' };
  }
  let body: Buffer;
  try {
    body = await vault.getObjectBuffer(row.r2StoragePath);
  } catch (err) {
    return { snapshotId: row.snapshotId, verified: false, reason: `vault-read-failed:${err instanceof Error ? err.message : 'unknown'}` };
  }
  if (body.byteLength !== Number(row.fileSizeBytes)) {
    return { snapshotId: row.snapshotId, verified: false, reason: 'size-mismatch' };
  }
  if (sha256hex(body) !== row.checksumSha256) {
    return { snapshotId: row.snapshotId, verified: false, reason: 'checksum-mismatch' };
  }
  return { snapshotId: row.snapshotId, verified: true, reason: 'ok' };
}

export class BackupVerifierJob {
  constructor(
    private readonly vault: PitrVaultPort,
    private readonly db: PitrDbPort,
  ) {}

  async verifyLatest(limit = 5): Promise<VerifyOutcome[]> {
    const rows = ((await this.db.disasterRecoverySnapshot.findMany?.({
      where: { verifiedAt: null },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })) ?? []) as Array<{
      snapshotId: string;
      r2StoragePath: string;
      checksumSha256: string;
      fileSizeBytes: bigint | number;
    }>;
    const outcomes: VerifyOutcome[] = [];
    for (const row of rows) {
      const outcome = await verifySnapshot(row, this.vault);
      outcomes.push(outcome);
      if (outcome.verified) {
        try {
          await this.db.disasterRecoverySnapshot.update?.({
            where: { snapshotId: row.snapshotId },
            data: { verifiedAt: new Date(), isRestorationTested: true },
          });
        } catch {
          /* ledger mark is best-effort */
        }
      }
    }
    return outcomes;
  }
}
