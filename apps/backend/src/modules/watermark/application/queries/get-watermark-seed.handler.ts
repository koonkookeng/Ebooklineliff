// SSOT Phase 042 §5.1 — GetWatermarkSeed handler (seed issuance use-case)
// Canonical: apps/backend/src/modules/watermark/application/queries/get-watermark-seed.handler.ts
// (legacy src/backend/modules/watermark/application/queries/get-watermark-seed.handler.ts)
// - Builds the Zod-verified seed payload, persists the audit log WITHOUT
//   blocking (Gate 7), and emits watermark.seed_issued through the injectable
//   stream sink (default no-op; production binds Redis xadd at the module).
// - tsx-safe (no param decorators). Zero new deps.
import { WatermarkSeedPayloadSchema, type WatermarkSeedPayload } from '@repo/shared';
import { WatermarkSeed } from '../../domain/watermark-seed.entity';
import { WatermarkCryptoService } from '../services/watermark-crypto.service';
import { WatermarkSeedRepository } from '../../infrastructure/repositories/watermark-seed.repository';

export interface SeedRequest {
  userId: string;
  lineUserId?: string;
  displayName: string;
  productId: string;
  clientIp: string;
  userAgent: string;
}

export interface WatermarkEventSink {
  (stream: string, event: Record<string, unknown>): void;
}

export class GetWatermarkSeedHandler {
  // NOTE: Module wires via useFactory (no param decorators — tsx-safe).
  constructor(
    private readonly crypto?: WatermarkCryptoService,
    private readonly seeds?: WatermarkSeedRepository,
    private readonly sink?: WatermarkEventSink,
  ) {}

  async execute(req: SeedRequest): Promise<WatermarkSeedPayload> {
    if (!this.crypto) throw new Error('Watermark service unavailable');
    const seedId = this.crypto.newSeedId();
    const timestamp = new Date().toISOString();
    const userIdHash = this.crypto.generateUserIdHash(req.userId);
    const hmacSignature = this.crypto.generateHMACSignature(seedId, userIdHash, timestamp);
    const seed = WatermarkSeed.create({
      seedId,
      userId: req.userId,
      lineUserId: req.lineUserId,
      productId: req.productId,
      clientIp: req.clientIp,
      userIdHash,
      displayName: req.displayName,
      timestamp,
      hmacSignature,
    });
    const payload: WatermarkSeedPayload = {
      seedId: seed.props.seedId,
      userIdHash: seed.props.userIdHash,
      lineUserId: seed.props.lineUserId,
      displayName: seed.props.displayName,
      clientIp: seed.props.clientIp,
      timestamp: seed.props.timestamp,
      hmacSignature: seed.props.hmacSignature,
      config: {
        opacityMin: 0.12,
        opacityMax: 0.25,
        fontSizePx: 12,
        motionMode: 'LISSAJOUS_CURVE',
        steganographyEnabled: true,
      },
    };
    const verified = WatermarkSeedPayloadSchema.safeParse(payload);
    if (!verified.success) throw new Error('Seed contract violation');
    // Async audit + event (never block the overlay bootstrap).
    void this.seeds
      ?.issueSeedLog({
        seedId,
        userId: req.userId,
        lineUserId: req.lineUserId,
        productId: req.productId,
        clientIp: req.clientIp,
        userAgent: req.userAgent,
        hmacSignature,
      })
      .catch(() => undefined);
    try {
      this.sink?.('stream:security:watermark-events', {
        type: 'watermark.seed_issued',
        seedId,
        userId: req.userId,
        productId: req.productId,
        at: timestamp,
      });
    } catch {
      // Event delivery must never fail issuance.
    }
    return verified.data;
  }
}
