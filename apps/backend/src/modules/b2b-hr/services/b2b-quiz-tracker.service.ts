// SSOT Phase 098 BDD-2 — Quiz attempt tracker (score + pass/fail ledger)
// Canonical: apps/backend/src/modules/b2b-hr/services/b2b-quiz-tracker.service.ts
// - Seat must exist + ACTIVE → score gate (0..maxScore) → isPassed derive →
//   attempt row → b2b.quiz.completed stream (Gate 8).
// - Port-based for DB-free tests. Zero new deps.
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { B2B_HR_STREAM, quizPassStatus } from '@repo/shared';
import type { B2bHrRepository } from '../repositories/b2b-hr.repository';
import type { HrSeatBus } from './b2b-seat.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class B2bHrQuizTrackerService {
  constructor(
    private readonly repo: B2bHrRepository,
    private readonly bus: HrSeatBus,
  ) {}

  async recordAttempt(args: {
    seatId: string;
    courseId: string;
    quizId: string;
    scoreObtained: number;
    maxScore: number;
    passingScore?: number;
    timeTakenSec: number;
  }): Promise<{
    attemptId: string;
    seatId: string;
    score: number;
    status: 'PASSED' | 'FAILED';
    completedAt: string;
  }> {
    if (!UUID_RE.test(args.seatId)) throw new BadRequestException('Invalid seatId');
    if (!(args.scoreObtained >= 0) || !(args.maxScore > 0) || args.scoreObtained > args.maxScore) {
      throw new BadRequestException('Invalid score');
    }
    if (!(args.timeTakenSec >= 0)) throw new BadRequestException('Invalid timeTakenSec');
    const passing = args.passingScore ?? 70;
    const seat = await this.repo.findSeat(args.seatId);
    if (!seat) throw new NotFoundException('Seat not found');
    if (seat.status !== 'ACTIVE') throw new BadRequestException('Seat is not active');

    const pct = (args.scoreObtained / args.maxScore) * 100;
    const status = quizPassStatus(pct, passing);
    const row = await this.repo.recordQuizAttempt({
      seatId: args.seatId,
      courseId: args.courseId,
      quizId: args.quizId,
      scoreObtained: args.scoreObtained,
      maxScore: args.maxScore,
      isPassed: status === 'PASSED',
      timeTakenSec: args.timeTakenSec,
    });
    await this.bus
      .xadd(B2B_HR_STREAM, {
        event: 'b2b.quiz.completed',
        seatId: args.seatId,
        quizId: args.quizId,
        score: Math.round(pct * 100) / 100,
        status,
        at: Date.now(),
      })
      .catch(() => undefined);
    return {
      attemptId: row.id,
      seatId: args.seatId,
      score: Math.round(pct * 100) / 100,
      status,
      completedAt: row.completedAt instanceof Date ? row.completedAt.toISOString() : String(row.completedAt),
    };
  }
}
