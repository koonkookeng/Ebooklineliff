// SSOT Phase 110 §7.2 — RFM calculator (pure math + metric ledger)
// Canonical: apps/backend/src/modules/user-inspector/services/rfm-calculator.service.ts
// - Thresholds verbatim §7.2 (R ≤7d=5 / >90d=1, F ≥10=5 / =1→1, M ≥10k=5 / <500=1).
// - Pure score functions delegate to the Zod SSOT (single math source).
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { UserInspectorRepository } from '../repositories/user-inspector.repository';
import {
  RFMScoreSchema,
  recencyScoreFor,
  frequencyScoreFor,
  monetaryScoreFor,
  rfmSegmentLabel,
  type RFMScore,
} from '@repo/shared';

@Injectable()
export class RfmCalculatorService {
  constructor(private readonly repo: UserInspectorRepository) {}

  scoreRecency(lastActiveAt: Date | null, now = new Date()): number {
    if (!lastActiveAt) return 1;
    const days = Math.max(0, (now.getTime() - lastActiveAt.getTime()) / 86_400_000);
    return recencyScoreFor(days);
  }

  scoreFrequency(totalOrders: number): number {
    return frequencyScoreFor(Math.max(0, totalOrders));
  }

  scoreMonetary(ltv: number): number {
    return monetaryScoreFor(Math.max(0, ltv));
  }

  segmentFor(r: number, f: number, m: number, totalOrders: number): string {
    return rfmSegmentLabel(r, f, m, totalOrders);
  }

  async recalculate(userId: string): Promise<RFMScore & { lifetimeValue: number; totalOrders: number }> {
    const orders = await this.repo.getCompletedOrders(userId);
    const ltv = orders.reduce((acc, o) => acc + Number(o.netAmount), 0);
    const totalOrders = orders.length;
    const lastActive = orders.length > 0 ? orders[0].createdAt : null;
    const r = this.scoreRecency(lastActive);
    const f = this.scoreFrequency(totalOrders);
    const m = this.scoreMonetary(ltv);
    const score: RFMScore = RFMScoreSchema.parse({
      recencyScore: r,
      frequencyScore: f,
      monetaryScore: m,
      segmentLabel: this.segmentFor(r, f, m, totalOrders),
    });
    const [ebooks, courses] = await Promise.all([
      this.repo.distinctEbooksRead(userId),
      this.repo.distinctCoursesEnrolled(userId),
    ]);
    await this.repo.upsertMetric(userId, {
      lifetimeValue: Math.round(ltv * 100) / 100,
      totalOrders,
      totalEbooksRead: ebooks,
      totalCoursesEnrolled: courses,
      recencyScore: r,
      frequencyScore: f,
      monetaryScore: m,
      rfmSegment: score.segmentLabel,
    });
    await this.repo.invalidate360(userId);
    return { ...score, lifetimeValue: ltv, totalOrders };
  }
}
