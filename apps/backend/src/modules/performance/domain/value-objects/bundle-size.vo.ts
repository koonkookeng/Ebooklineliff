// SSOT Phase 029 §5.1 — BundleSize value object (2MB guard invariant)
// Canonical: apps/backend/src/modules/performance/domain/value-objects/bundle-size.vo.ts
// (legacy src/backend/modules/performance/domain/value-objects/bundle-size.vo.ts)
// - Immutable: total/gzip bytes + chunk count + pass/fail + headroom margin.
// - Zero new deps.
import { BUNDLE_MAX_BYTES } from '@repo/shared';

export class BundleSize {
  private constructor(
    readonly totalBytes: number,
    readonly gzipBytes: number,
    readonly chunkCount: number,
  ) {
    if (!Number.isInteger(totalBytes) || totalBytes <= 0) throw new Error('Invalid total bundle bytes');
    if (!Number.isInteger(gzipBytes) || gzipBytes <= 0) throw new Error('Invalid gzip bundle bytes');
    if (!Number.isInteger(chunkCount) || chunkCount <= 0) throw new Error('Invalid chunk count');
  }

  static of(totalBytes: number, gzipBytes: number, chunkCount: number): BundleSize {
    return new BundleSize(totalBytes, gzipBytes, chunkCount);
  }

  get isWithinGuard(): boolean {
    return this.totalBytes <= BUNDLE_MAX_BYTES;
  }

  /** Bytes of headroom remaining (negative when over budget). */
  get headroomBytes(): number {
    return BUNDLE_MAX_BYTES - this.totalBytes;
  }
}
