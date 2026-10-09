// SSOT Phase 096 Task 3 — Point engine (verified claim → atomic ledger)
// Canonical: apps/backend/src/modules/gamification/services/point-engine.service.ts
// - Flow: Zod gate → dwell ≥5s → HMAC nonce → velocity cap → ONE
//   $transaction: PointTransaction + user rewardPoints + squad/challenge
//   totals (Gate 7) → leaderboard fan-out + stream (Gate 8).
// - Port-based for DB-free tests. Zero new deps.
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import {
  CLAIM_VELOCITY_LIMIT,
  CLAIM_VELOCITY_WINDOW_SEC,
  ClaimPointInputSchema,
  SQUAD_STREAM,
  MIN_DWELL_SEC,
  pointsFor,
} from '@repo/shared';
import { verifyClaimNonce } from './anti-cheat.guard';

export interface PointTx {
  run<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
}

export interface PointStorePort {
  recordTransaction(
    tx: unknown,
    args: { userId: string; squadId: string | null; activityType: string; pointsEarned: number; multiplier: number },
  ): Promise<void>;
  incrementUserPoints(tx: unknown, userId: string, points: number): Promise<number>;
  incrementSquadPoints(tx: unknown, squadId: string, userId: string, points: number): Promise<void>;
  recentClaimCount(userId: string, windowSec: number): Promise<number>;
  markNonceUsed(nonce: string, ttlSec: number): Promise<boolean>;
  applyChallengeProgress(tx: unknown, squadId: string, points: number): Promise<{ completed: boolean; bonus: number }>;
}

export interface PointBoardPort {
  updateUserScore(args: { userId: string; addedPoints: number; tenantId?: string }): Promise<void>;
  updateSquadScore(args: { squadId: string; addedPoints: number; tenantId?: string }): Promise<void>;
}

export interface PointBus {
  xadd(stream: string, fields: Record<string, string | number>): Promise<unknown>;
}

@Injectable()
export class PointEngineService {
  constructor(
    private readonly store: PointStorePort,
    private readonly board: PointBoardPort,
    private readonly tx: PointTx,
    private readonly bus?: PointBus,
    private readonly secret: string = process.env['CLAIM_NONCE_SECRET'] || 'dev-claim-secret',
  ) {}

  async claim(args: {
    userId: string;
    squadId?: string;
    input: { activityType: string; referenceId: string; dwellTimeSec: number; signatureNonce: string };
  }): Promise<{ pointsEarned: number; newTotalPoints: number; squadBonusEarned: number }> {
    const parsed = ClaimPointInputSchema.safeParse(args.input);
    if (!parsed.success) throw new BadRequestException('Invalid point claim');
    if (parsed.data.dwellTimeSec < MIN_DWELL_SEC) {
      throw new ForbiddenException('Dwell time below anti-cheat threshold');
    }
    if (!verifyClaimNonce({
      nonce: parsed.data.signatureNonce,
      userId: args.userId,
      activityType: parsed.data.activityType,
      referenceId: parsed.data.referenceId,
      secret: this.secret,
    })) {
      throw new ForbiddenException('Invalid claim signature');
    }
    const recent = await this.store.recentClaimCount(args.userId, CLAIM_VELOCITY_WINDOW_SEC);
    if (recent >= CLAIM_VELOCITY_LIMIT) throw new ForbiddenException('Claim velocity exceeded');
    const fresh = await this.store.markNonceUsed(parsed.data.signatureNonce, 300);
    if (!fresh) throw new ForbiddenException('Claim already processed');

    const pointsEarned = pointsFor(parsed.data.activityType, 1.0);
    const out = await this.tx.run(async (tx) => {
      await this.store.recordTransaction(tx, {
        userId: args.userId,
        squadId: args.squadId ?? null,
        activityType: parsed.data.activityType,
        pointsEarned,
        multiplier: 1.0,
      });
      const newTotalPoints = await this.store.incrementUserPoints(tx, args.userId, pointsEarned);
      let squadBonusEarned = 0;
      if (args.squadId) {
        await this.store.incrementSquadPoints(tx, args.squadId, args.userId, pointsEarned);
        const challenge = await this.store.applyChallengeProgress(tx, args.squadId, pointsEarned);
        if (challenge.completed) {
          squadBonusEarned = challenge.bonus;
          await this.store.incrementUserPoints(tx, args.userId, challenge.bonus);
        }
      }
      return { newTotalPoints, squadBonusEarned };
    });

    await this.board.updateUserScore({ userId: args.userId, addedPoints: pointsEarned }).catch(() => undefined);
    if (args.squadId) {
      await this.board.updateSquadScore({ squadId: args.squadId, addedPoints: pointsEarned }).catch(() => undefined);
    }
    await this.bus
      ?.xadd(SQUAD_STREAM, {
        event: 'points_claimed',
        userId: args.userId,
        activityType: parsed.data.activityType,
        points: pointsEarned,
        at: Date.now(),
      })
      .catch(() => undefined);
    return { pointsEarned, newTotalPoints: out.newTotalPoints + out.squadBonusEarned, squadBonusEarned: out.squadBonusEarned };
  }
}
