// SSOT Phase 035 §3.1 — Sandbox audit DTO (Zod SSOT re-export)
// Canonical: apps/backend/src/modules/line-sandbox/dto/line-sandbox-audit.dto.ts
// (legacy src/backend/modules/line-sandbox/dto/line-sandbox-audit.dto.ts)
// - Single source: packages/shared/src/schemas/line-review-contract.ts (no forked shapes).
import { RunAuditInputSchema } from '@repo/shared';
import type { RunAuditInput } from '@repo/shared';

export { RunAuditInputSchema };
export type LineSandboxAuditDto = RunAuditInput;
