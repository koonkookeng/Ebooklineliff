// SSOT Phase 096 §7.1 — Study activity listener (stream fan-in → point engine)
// Canonical: apps/backend/src/modules/gamification/events/study-activity.listener.ts
// - Consumes verified study events (page/lesson/quiz/checkin) and routes
//   them to the point engine (non-blocking; failures never break reading).
// - Port-based for DB-free tests. Zero new deps.
import { Injectable, Logger } from '@nestjs/common';
import { PointEngineService } from '../services/point-engine.service';

export interface StudyActivityEvent {
  userId: string;
  squadId?: string;
  activityType: string;
  referenceId: string;
  dwellTimeSec: number;
  signatureNonce: string;
}

@Injectable()
export class StudyActivityListener {
  private readonly logger = new Logger(StudyActivityListener.name);

  constructor(private readonly points: PointEngineService) {}

  async onStudyActivity(event: StudyActivityEvent): Promise<void> {
    try {
      await this.points.claim({
        userId: event.userId,
        squadId: event.squadId,
        input: {
          activityType: event.activityType,
          referenceId: event.referenceId,
          dwellTimeSec: event.dwellTimeSec,
          signatureNonce: event.signatureNonce,
        },
      });
    } catch (e) {
      this.logger.warn(`point claim skipped: ${(e as Error).message}`);
    }
  }
}
