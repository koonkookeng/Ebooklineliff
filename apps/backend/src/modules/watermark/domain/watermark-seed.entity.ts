// SSOT Phase 042 §5.1 — WatermarkSeed entity (issuance invariants)
// Canonical: apps/backend/src/modules/watermark/domain/watermark-seed.entity.ts
// (legacy src/backend/modules/watermark/domain/watermark-seed.entity.ts)
// - A seed binds (user, product, ip, timestamp) for 15 minutes; refreshes are
//   background-only (§2.2 LOADING never blocks reading).
// - Pure + tsx-safe. Zero new deps.
import { WATERMARK_SEED_TTL_SEC } from '@repo/shared';

export interface WatermarkSeedProps {
  seedId: string;
  userId: string;
  lineUserId?: string;
  productId: string;
  clientIp: string;
  userIdHash: string;
  displayName: string;
  timestamp: string;
  hmacSignature: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class WatermarkSeed {
  private constructor(readonly props: WatermarkSeedProps) {}

  static create(props: WatermarkSeedProps): WatermarkSeed {
    if (!UUID_RE.test(props.seedId)) throw new Error('Invalid seed id');
    if (!props.userId) throw new Error('Missing user id');
    if (!props.productId) throw new Error('Missing product id');
    if (!props.clientIp) throw new Error('Missing client ip');
    if (!/^[0-9a-f]{64}$/i.test(props.userIdHash)) throw new Error('Invalid user id hash');
    if (!props.displayName) throw new Error('Missing display name');
    if (Number.isNaN(Date.parse(props.timestamp))) throw new Error('Invalid timestamp');
    if (!props.hmacSignature) throw new Error('Missing HMAC signature');
    return new WatermarkSeed({ ...props });
  }

  /** Seconds until the 15-minute refresh (<=0 means refresh now). */
  ttlRemainingSec(nowMs: number = Date.now()): number {
    const issuedAt = Date.parse(this.props.timestamp);
    return WATERMARK_SEED_TTL_SEC - Math.floor((nowMs - issuedAt) / 1000);
  }

  isExpired(nowMs: number = Date.now()): boolean {
    return this.ttlRemainingSec(nowMs) <= 0;
  }

  /** Public overlay text (never exposes raw ids beyond the hash prefix). */
  displayText(): string {
    const who = this.props.lineUserId ?? this.props.userIdHash.slice(0, 8);
    return `${this.props.displayName} (${who}) - CONFIDENTIAL`;
  }
}
