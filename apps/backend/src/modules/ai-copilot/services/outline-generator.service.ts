// SSOT Phase 094 Task 6 — Outline generator (prompt → tree → draft job row)
// Canonical: apps/backend/src/modules/ai-copilot/services/outline-generator.service.ts
// - Zod gate → deterministic outline chain → AiCoPilotJob row doubles as the
//   editable draft store (<30s, no CourseDetail churn). Port-based tests.
import { BadRequestException, Injectable } from '@nestjs/common';
import { COPILOT_STREAM, CourseOutlinePromptSchema } from '@repo/shared';
import { DeterministicOutlineAdapter } from '../adapters/llm-orchestrator.adapter';

export interface OutlineJobStore {
  createJob(args: { userId: string; jobType: string; inputPayload: unknown }): Promise<{ id: string }>;
  completeJob(jobId: string, resultData: unknown): Promise<void>;
  failJob(jobId: string, errorMessage: string): Promise<void>;
}

export interface OutlineBus {
  xadd(stream: string, fields: Record<string, string | number>): Promise<unknown>;
}

@Injectable()
export class OutlineGeneratorService {
  constructor(
    private readonly llm: DeterministicOutlineAdapter,
    private readonly jobs: OutlineJobStore,
    private readonly bus?: OutlineBus,
  ) {}

  async generate(args: {
    userId: string;
    prompt: { topic: string; targetAudience: string; difficultyLevel: string; numberOfSections?: number };
  }): Promise<{ jobId: string; sections: Array<{ sectionTitle: string; lessons: Array<{ lessonTitle: string; outcome: string }> }> }> {
    const parsed = CourseOutlinePromptSchema.safeParse(args.prompt);
    if (!parsed.success) throw new BadRequestException('Invalid outline prompt');
    const t0 = Date.now();
    const job = await this.jobs.createJob({ userId: args.userId, jobType: 'COURSE_OUTLINE_GEN', inputPayload: parsed.data });
    try {
      const sections = await this.llm.completeOutline({
        topic: parsed.data.topic,
        targetAudience: parsed.data.targetAudience,
        difficultyLevel: parsed.data.difficultyLevel,
        numberOfSections: parsed.data.numberOfSections,
      });
      await this.jobs.completeJob(job.id, { sections });
      await this.bus
        ?.xadd(COPILOT_STREAM, {
          event: 'outline_generated',
          jobId: job.id,
          sections: sections.length,
          tookMs: Date.now() - t0,
          at: Date.now(),
        })
        .catch(() => undefined);
      return { jobId: job.id, sections };
    } catch (e) {
      await this.jobs.failJob(job.id, (e as Error).message).catch(() => undefined);
      throw e;
    }
  }
}
