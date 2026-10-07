// SSOT Phase 038 Task 2 — Pipeline job DTO (Zod SSOT re-export)
// Canonical: apps/backend/src/modules/pipeline/application/dto/pipeline-job.dto.ts
// (legacy src/backend/modules/pipeline/application/dto/pipeline-job.dto.ts)
// - Single source: packages/shared/src/schemas/book-pipeline.zod.ts (no forked shapes).
import { ProcessBookJobInputSchema } from '@repo/shared';
import type { ProcessBookJobInput } from '@repo/shared';

export { ProcessBookJobInputSchema };
export type PipelineJobDto = ProcessBookJobInput;
