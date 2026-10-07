// SSOT Phase 048 §5.2 — CourseCompletedEventHandler (Auto-issue on 100% completion)
// Canonical: apps/backend/src/modules/certificate/application/event-handlers/course-completed.handler.ts
// (legacy src/backend/modules/certificate/application/event-handlers/course-completed.handler.ts)
// - Listens to CourseCompletedEvent (from Phase 045/046 progress sync).
// - Idempotent: checks existing certificate before issuing.
// - Emits certificate_issued event for analytics (§7.1).
// - Zero new deps.
import { Injectable, Logger } from '@nestjs/common';
import { CertificatePdfGeneratorService } from '../services/certificate-pdf-generator.service';
import { PrismaService } from '../../../../infra/database/prisma.service';

/** Minimal event-bus port (§7.1 certificate.issued analytics) — zero new deps. */
export interface CertificateEventBus {
  emit(event: string, payload: Record<string, unknown>): void;
}

export const CERTIFICATE_EVENT_BUS = 'CERTIFICATE_EVENT_BUS';

export interface CourseCompletedEvent {
  userId: string;
  courseId: string;
  displayName: string;
  courseTitle: string;
  completedAt: Date;
}

@Injectable()
export class CourseCompletedEventHandler {
  private readonly logger = new Logger(CourseCompletedEventHandler.name);

  // NOTE: plain constructor (no parameter decorators) keeps this class
  // tsx-importable under the Phase 027–047 useFactory precedent; the module
  // wires CERTIFICATE_EVENT_BUS via the inject array.
  constructor(
    private readonly certService: CertificatePdfGeneratorService,
    private readonly eventBus: CertificateEventBus | null,
    private readonly prisma: PrismaService,
  ) {}

  async handleCourseCompleted(event: CourseCompletedEvent): Promise<void> {
    this.logger.log(`Course completed event received for user ${event.userId}, course ${event.courseId}`);

    // Check if certificate already exists
    const existing = await this.prisma.courseCertificate.findUnique({
      where: { userId_courseId: { userId: event.userId, courseId: event.courseId } },
    }).catch(() => null);

    if (existing) {
      this.logger.log(`Certificate already exists for user ${event.userId}, course ${event.courseId}`);
      return;
    }

    // Generate certificate (names resolved from DB inside the service).
    try {
      const result = await this.certService.generateCertificate({
        userId: event.userId,
        courseId: event.courseId,
      });

      // Emit analytics event (§7.1 certificate_issued → Redis Stream via bus).
      this.eventBus?.emit('certificate.issued', {
        userId: event.userId,
        courseId: event.courseId,
        certificateNo: result.certificateNo,
        completionDurationDays: 0, // Could calculate from enrollment date
        issuedAt: new Date().toISOString(),
      });

      this.logger.log(`Certificate issued: ${result.certificateNo} for user ${event.userId}`);
    } catch (error) {
      this.logger.error(`Failed to generate certificate for user ${event.userId}, course ${event.courseId}`, error);
      // Don't throw - event processing should not fail silently but log error
    }
  }
}