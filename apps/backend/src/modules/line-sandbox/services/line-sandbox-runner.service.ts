// SSOT Phase 035 Task 2 — Sandbox audit runner (grade + atomic persist + event)
// Canonical: apps/backend/src/modules/line-sandbox/services/line-sandbox-runner.service.ts
// (legacy src/backend/modules/line-sandbox/services/line-sandbox-runner.service.ts)
// - executeAllCheckers: Zod-gate signals → 8 pure checkpoints (timed) → score
//   via scoreOf() → single nested create (audit + items, Gate 7) → analytics
//   event (Gate 8, best-effort). DB failure surfaces 400 (audit must record or
//   report — never silently pass).
// - Zero new deps: Prisma SSOT + RedisClusterService only.
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../infra/database/prisma.service';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';
import {
  AUDIT_EVENT_CHANNEL,
  RunAuditInputSchema,
  isApprovedForSubmission,
  scoreOf,
  type LineReviewAuditSummary,
  type RunAuditInput,
} from '@repo/shared';
import { checkMemoryPerformance } from '../checkers/memory-performance.checker';
import { checkAuthSecurity } from '../checkers/auth-security.checker';
import { checkPaymentPolicy } from '../checkers/payment-policy.checker';
import type { CheckerResult } from '../checkers/checker.types';

interface SandboxTables {
  lineMiniAppSandboxAudit: {
    create: (args: unknown) => Promise<{ id: string; createdAt: Date }>;
  };
}

const CHECKERS = [checkMemoryPerformance, checkAuthSecurity, checkPaymentPolicy];

@Injectable()
export class LineSandboxRunnerService {
  private readonly logger = new Logger(LineSandboxRunnerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisClusterService,
  ) {}

  async executeAllCheckers(body: unknown): Promise<LineReviewAuditSummary> {
    const parsed = RunAuditInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid sandbox audit input');
    const input: RunAuditInput = parsed.data;

    const timed: Array<CheckerResult & { testId: string; executionTimeMs: number }> = [];
    for (const checker of CHECKERS) {
      const start = Date.now();
      const results = checker(input);
      const elapsed = Date.now() - start;
      for (const r of results) {
        timed.push({ ...r, testId: randomUUID(), executionTimeMs: elapsed });
      }
    }

    const overallScore = scoreOf(timed);
    const approved = isApprovedForSubmission(overallScore);
    const auditId = randomUUID();

    const saved = await (this.prisma as unknown as SandboxTables).lineMiniAppSandboxAudit
      .create({
        data: {
          id: auditId,
          tenantId: input.tenantId,
          overallScore,
          isApprovedForSubmission: approved,
          testedByUserId: input.userId,
          testResults: {
            create: timed.map((t) => ({
              category: t.category,
              checkPointName: t.checkPointName,
              isPassed: t.isPassed,
              executionTimeMs: Math.max(0, Math.round(t.executionTimeMs)),
              memoryUsageMB: t.memoryUsageMB,
              ...(t.diagnosticMessage ? { diagnosticMessage: t.diagnosticMessage } : {}),
            })),
          },
        },
      })
      .catch((err: unknown) => {
        throw new BadRequestException(err instanceof Error ? err.message : 'Audit persist failed');
      });

    await this.redis
      .publish(
        AUDIT_EVENT_CHANNEL,
        JSON.stringify({ event: 'line.sandbox.audit', auditId: saved.id, tenantId: input.tenantId, overallScore, approved }),
      )
      .catch((err: unknown) => {
        this.logger.warn(`Audit event failed: ${err instanceof Error ? err.message : 'unknown'}`);
      });

    return {
      auditId: saved.id,
      tenantId: input.tenantId,
      overallScore,
      isApprovedForSubmission: approved,
      results: timed.map((t) => ({
        testId: t.testId,
        category: t.category,
        checkPointName: t.checkPointName,
        isPassed: t.isPassed,
        executionTimeMs: t.executionTimeMs,
        memoryUsageMB: t.memoryUsageMB,
        ...(t.diagnosticMessage ? { diagnosticMessage: t.diagnosticMessage } : {}),
      })),
      timestamp: saved.createdAt.toISOString(),
    };
  }
}
