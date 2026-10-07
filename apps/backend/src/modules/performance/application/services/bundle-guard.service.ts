// SSOT Phase 029 Task 3/§5.1 — Bundle guard service (2MB CI gate evaluation)
// Canonical: apps/backend/src/modules/performance/application/services/bundle-guard.service.ts
// (legacy src/backend/modules/performance/.../bundle-guard.service.ts)
// - Pure evaluation (BundleSize VO) + idempotent manifest persist; the CI script
//   scripts/check-bundle-size.ts enforces the same BUNDLE_MAX_BYTES constant.
// - Zero new deps.
import { BadRequestException, Injectable } from '@nestjs/common';
import { BundleSize } from '../../domain/value-objects/bundle-size.vo';
import { PrismaPerformanceRepository } from '../../infrastructure/persistence/prisma-performance.repository';
import { BUNDLE_MAX_BYTES } from '@repo/shared';

export interface ChunkEntry {
  name: string;
  sizeBytes: number;
}

export interface BundleGuardResult {
  passed: boolean;
  buildHash: string;
  totalSizeBytes: number;
  gzipSizeBytes: number;
  headroomBytes: number;
}

function hashChunks(chunks: ChunkEntry[]): string {
  const input = chunks.map((c) => `${c.name}:${c.sizeBytes}`).join('|');
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    h1 = Math.imul(h1 ^ input.charCodeAt(i), 16777619);
    h2 = Math.imul(h2 + input.charCodeAt(i), 31);
  }
  return `b${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}`;
}

@Injectable()
export class BundleGuardService {
  constructor(private readonly repo: PrismaPerformanceRepository) {}

  /** Evaluate a build manifest and record the verdict (throws 400 on bad input). */
  async evaluateManifest(chunks: unknown, gzipSizeBytes: unknown): Promise<BundleGuardResult> {
    if (!Array.isArray(chunks) || chunks.length === 0) throw new BadRequestException('Manifest chunks missing');
    const entries: ChunkEntry[] = chunks.map((c) => {
      const row = c as { name?: unknown; sizeBytes?: unknown };
      if (typeof row.name !== 'string' || typeof row.sizeBytes !== 'number' || row.sizeBytes <= 0) {
        throw new BadRequestException('Invalid chunk entry');
      }
      return { name: row.name, sizeBytes: row.sizeBytes };
    });
    if (typeof gzipSizeBytes !== 'number' || gzipSizeBytes <= 0) throw new BadRequestException('Invalid gzip size');
    const total = entries.reduce((sum, c) => sum + c.sizeBytes, 0);
    const size = BundleSize.of(total, Math.floor(gzipSizeBytes), entries.length);
    const buildHash = hashChunks(entries);
    const result: BundleGuardResult = {
      passed: size.isWithinGuard,
      buildHash,
      totalSizeBytes: total,
      gzipSizeBytes: Math.floor(gzipSizeBytes),
      headroomBytes: size.headroomBytes,
    };
    await this.repo.saveManifest({
      buildHash,
      totalSizeBytes: total,
      gzipSizeBytes: Math.floor(gzipSizeBytes),
      isPassedGuard: size.isWithinGuard,
      chunksJson: entries,
    });
    return result;
  }

  async latest(): Promise<BundleGuardResult | null> {
    const row = await this.repo.latestManifest();
    if (!row) return null;
    return {
      passed: row.isPassedGuard,
      buildHash: row.buildHash,
      totalSizeBytes: row.totalSizeBytes,
      gzipSizeBytes: row.gzipSizeBytes,
      headroomBytes: BUNDLE_MAX_BYTES - row.totalSizeBytes,
    };
  }
}
