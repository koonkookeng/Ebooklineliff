// SSOT Phase 023 §5.1 — Header input DTO (Zod SSOT re-export; NestJS validation via schemas)
import { DynamicHeaderInputSchema, DynamicHeaderPayloadSchema } from '@repo/shared';

export const HeaderInputSchema = DynamicHeaderInputSchema;
export const HeaderPayloadSchema = DynamicHeaderPayloadSchema;
export type { DynamicHeaderInput, DynamicHeaderPayload } from '@repo/shared';
