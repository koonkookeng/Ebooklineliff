// SSOT Phase 096 §7.1 — Learning event subscriber (083 seam → 096 listener)
// Canonical: apps/backend/src/modules/gamification/application/subscribers/learning-event.subscriber.ts
// - Bridges 083 learning events (page read / lesson watched / quiz pass)
//   into the 096 study-activity listener. Zero new deps.
import { Injectable } from '@nestjs/common';
import { StudyActivityListener, type StudyActivityEvent } from '../../events/study-activity.listener';

@Injectable()
export class LearningEventSubscriber {
  constructor(private readonly listener: StudyActivityListener) {}

  async onLearningEvent(event: StudyActivityEvent): Promise<void> {
    await this.listener.onStudyActivity(event);
  }
}
